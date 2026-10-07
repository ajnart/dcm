//go:build e2e

package e2e

import (
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strings"
	"syscall"
	"testing"
	"time"

	"github.com/ajnart/self-host/internal/catalog"
	"github.com/ajnart/self-host/internal/project"
)

// This is an opt-in functional scenario, separate from the catalog lifecycle
// sweep. All credentials stay inside this test's owned Project and HTTP client.
// E2E_HOMARR_FUNCTIONAL=1 go test -tags e2e -run '^TestHomarrFunctional$' ./e2e
func TestHomarrFunctional(t *testing.T) {
	if os.Getenv("E2E_HOMARR_FUNCTIONAL") != "1" {
		t.Skip("set E2E_HOMARR_FUNCTIONAL=1 for the bounded Homarr functional scenario")
	}
	if !dockerAvailable {
		t.Skip("Docker unavailable; Homarr functional acceptance remains unverified")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
	t.Cleanup(cancel)
	lockPath := filepath.Join(os.TempDir(), "selfhost-e2e-global.lock")
	release, err := acquireGlobal(ctx, lockPath)
	if err != nil {
		t.Fatal("Homarr functional global serial slot unavailable")
	}
	// Cleanup registrations run in reverse order: keep the slot until the
	// runner's owned Compose teardown has completed.
	t.Cleanup(release)
	if _, err := os.Lstat(lockPath + ".blocked"); err == nil || !os.IsNotExist(err) {
		t.Fatal("recover the previous owned teardown blocker before functional acceptance")
	}
	guard := &sweepGuard{ProjectNames: map[string]string{}}
	guard.OnBlock = func(owned string) {
		data, _ := json.Marshal(map[string]string{"project": owned, "compose_project": guard.ProjectName(owned)})
		if os.WriteFile(lockPath+".blocked", append(data, '\n'), 0o600) != nil {
			t.Error("could not persist the owned teardown blocker")
		}
	}
	r := newRunner(t, guard)
	r.spec = targetSpec{Kind: "functional", ID: "homarr", Apps: []string{"homarr", "ntfy", "jellyfin"}}
	r.target = evidenceName(r.spec)
	if r.logDir == "" {
		r.logDir, err = os.MkdirTemp("", "selfhost-homarr-functional-evidence-")
		if err != nil {
			t.Fatal("persistent functional evidence directory unavailable")
		}
	}
	if os.MkdirAll(r.logDir, 0o700) != nil {
		t.Fatal("functional evidence directory unavailable")
	}
	r.evidence = newEvidence(r.spec, codeHead)
	r.evidence.BinarySHA256 = binarySHA
	r.evidence.Classification = "runnable"
	r.evidence.Probe = "Headless administrator/private board, real ntfy message and Homarr notifications/statistics, owned synthetic Jellyfin audio release, duplicate-free reconciliation and targeted failure recovery; browser rendering is separate"
	r.evidence.Stages = nil
	for _, name := range []string{"install", "administrator-board", "notification-roundtrip", "synthetic-media-release", "idempotency-restart", "url-reconciliation", "credential-recovery", "add-remove"} {
		r.evidence.Stages = append(r.evidence.Stages, stageEvidence{Name: name, Outcome: "not-run", Apps: map[string]string{}})
	}
	if os.Getenv("E2E_HOMARR_BROWSER") == "1" {
		r.evidence.Stages = append(r.evidence.Stages, stageEvidence{Name: "browser-dashboard", Outcome: "not-run", Apps: map[string]string{}})
	}
	r.saveEvidence()
	t.Logf("Homarr functional evidence: %s", r.logDir)
	reservation, err := reserveTargetPorts(catalog.Default(), targetSpec{Apps: []string{"homarr", "ntfy", "jellyfin", "gatus"}})
	if err != nil {
		r.evidence.Outcome = "blocked"
		r.saveEvidence()
		t.Fatal("functional ports or Compose isolation unavailable")
	}
	t.Cleanup(reservation.release)
	ports := reservation.primary
	homarrURL := fmt.Sprintf("http://127.0.0.1:%d", ports["homarr"])
	ntfyURL := fmt.Sprintf("http://127.0.0.1:%d", ports["ntfy"])
	jellyfinURL := fmt.Sprintf("http://127.0.0.1:%d", ports["jellyfin"])
	jar, _ := cookiejar.New(nil)
	client := &http.Client{Jar: jar, Timeout: 120 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	p := &project.Project{Root: r.project}
	var secrets map[string]string
	var baseline hfInventory
	hfStage(r, "install", func() error {
		if err := hfWriteTone(filepath.Join(r.root, "media", "music", "Selfhost E2E Tone.wav")); err != nil {
			return err
		}
		reservation.release()
		for _, id := range r.spec.Apps {
			if err := hfCommand(r, installArguments(targetSpec{ID: id, Apps: []string{id}}, r.root, ports)...); err != nil {
				return err
			}
		}
		if err := hfCommand(r, "setup", "--json"); err != nil {
			return err
		}
		if !r.waitRunning(statusWait, r.spec.Apps) {
			return errors.New("functional Apps did not become configured and healthy")
		}
		var err error
		secrets, err = p.LoadSecrets()
		if err != nil || secrets["HOMARR_API_KEY"] == "" || secrets["NTFY_TOPIC"] == "" || secrets["NTFY_HOMARR_TOKEN"] == "" || secrets["JELLYFIN_API_KEY"] == "" {
			return errors.New("functional private credentials are incomplete")
		}
		r.recordImages()
		if !completeImageEvidence(r.evidence.Images, expectedServices(r.spec)) {
			return errors.New("functional immutable image identities unavailable")
		}
		return nil
	})
	hfStage(r, "administrator-board", func() error {
		userID, err := hfAdminLogin(ctx, client, homarrURL, secrets)
		if err != nil {
			return err
		}
		var onboard struct{ Current string }
		if err := hfTRPC(ctx, client, homarrURL, "", "onboard.currentStep", "GET", nil, &onboard); err != nil || onboard.Current != "finish" {
			return errors.New("headless onboarding did not finish")
		}
		baseline, err = hfReadInventory(ctx, client, homarrURL, secrets["HOMARR_API_KEY"])
		if err != nil {
			return err
		}
		if baseline.Board.IsPublic || baseline.Board.CreatorID != userID {
			return errors.New("Home is not the administrator-owned private board")
		}
		var home hfBoard
		if err := hfTRPC(ctx, client, homarrURL, "", "board.getHomeBoard", "GET", nil, &home); err != nil || home.ID != baseline.Board.ID {
			return errors.New("administrator home board is not the managed Home board")
		}
		return baseline.validate(ports, secrets, []string{"ntfy", "jellyfin"})
	})
	hfStage(r, "notification-roundtrip", func() error {
		return hfNotifications(ctx, client, homarrURL, ntfyURL, secrets, baseline.integrationID("ntfy"))
	})
	hfStage(r, "synthetic-media-release", func() error {
		return hfMediaRelease(ctx, client, homarrURL, jellyfinURL, secrets, baseline.integrationID("jellyfin"))
	})
	hfStage(r, "idempotency-restart", func() error {
		for _, args := range [][]string{{"setup", "--json"}, {"restart", "--json"}, {"setup", "--json"}} {
			if err := hfCommand(r, args...); err != nil {
				return err
			}
		}
		if !r.waitRunning(statusWait, r.spec.Apps) {
			return errors.New("functional restart did not recover healthy Apps")
		}
		if _, err := hfAdminLogin(ctx, client, homarrURL, secrets); err != nil {
			return err
		}
		current, err := hfReadInventory(ctx, client, homarrURL, secrets["HOMARR_API_KEY"])
		if err != nil || !slices.Equal(baseline.identities(), current.identities()) {
			return errors.New("Setup or restart duplicated or replaced managed dashboard resources")
		}
		return current.validate(ports, secrets, []string{"ntfy", "jellyfin"})
	})
	hfStage(r, "url-reconciliation", func() error {
		app := baseline.appFor("ntfy")
		app.Href = "http://192.0.2.1:2586"
		if err := hfJSON(ctx, client, "PATCH", homarrURL+"/api/apps/"+app.ID, map[string]string{"ApiKey": secrets["HOMARR_API_KEY"]}, app.patch(), nil); err != nil {
			return errors.New("could not seed owned browser URL drift")
		}
		if err := hfCommand(r, "setup", "homarr", "--json"); err != nil {
			return err
		}
		if err := hfCommand(r, "config", "set", "LAN_IP=127.0.0.2", "--json"); err != nil {
			return err
		}
		settings, err := p.LoadSettings()
		if err != nil || settings["LAN_IP"] != "127.0.0.2" || settings["EXPOSURE"] != "local" || settings["BIND_IP"] != "127.0.0.1" {
			return errors.New("LAN metadata change widened the selected local exposure")
		}
		current, err := hfReadInventory(ctx, client, homarrURL, secrets["HOMARR_API_KEY"])
		if err != nil || !slices.Equal(baseline.identities(), current.identities()) {
			return errors.New("browser URL reconciliation changed dashboard ownership")
		}
		return current.validate(ports, secrets, []string{"ntfy", "jellyfin"})
	})
	hfStage(r, "credential-recovery", func() error {
		// Only the generated, owned token is perturbed. Running Homarr alone
		// exercises its consuming Link rather than ntfy's token repair step.
		stored, err := p.LoadSecrets()
		if err != nil {
			return errors.New("owned credentials unavailable for targeted recovery")
		}
		original := stored["NTFY_HOMARR_TOKEN"]
		defer func() { stored["NTFY_HOMARR_TOKEN"] = original; _ = p.SaveSecrets(stored) }()
		stored["NTFY_HOMARR_TOKEN"] = "tk_" + randomHex(64)
		if p.SaveSecrets(stored) != nil {
			return errors.New("could not seed the owned invalid token")
		}
		failed := r.run("setup", "homarr", "--json")
		useful := false
		for _, event := range failed.events {
			if event.App == "homarr" && event.Step == "link-ntfy" && event.Event == "step.fail" && strings.Contains(event.Error+event.Hint, "self-host setup homarr") {
				useful = true
			}
		}
		if failed.code != exitIncomplete || !useful {
			return errors.New("invalid integration credential did not produce a targeted retry operation")
		}
		stored["NTFY_HOMARR_TOKEN"] = original
		if p.SaveSecrets(stored) != nil {
			return errors.New("could not restore the owned valid token")
		}
		if err := hfCommand(r, "setup", "homarr", "--json"); err != nil {
			return err
		}
		current, err := hfReadInventory(ctx, client, homarrURL, secrets["HOMARR_API_KEY"])
		if err != nil || !slices.Equal(baseline.identities(), current.identities()) {
			return errors.New("targeted credential recovery altered unrelated dashboard resources")
		}
		return hfNotifications(ctx, client, homarrURL, ntfyURL, secrets, current.integrationID("ntfy"))
	})
	hfStage(r, "add-remove", func() error {
		if err := hfCommand(r, installArguments(targetSpec{ID: "gatus", Apps: []string{"gatus"}}, r.root, ports)...); err != nil {
			return err
		}
		current, err := hfReadInventory(ctx, client, homarrURL, secrets["HOMARR_API_KEY"])
		if err != nil {
			return err
		}
		if err := current.validate(ports, secrets, []string{"ntfy", "jellyfin", "gatus"}); err != nil {
			return err
		}
		if err := hfCommand(r, "remove", "gatus", "--yes", "--json"); err != nil {
			return err
		}
		current, err = hfReadInventory(ctx, client, homarrURL, secrets["HOMARR_API_KEY"])
		if err != nil || !slices.Equal(baseline.identities(), current.identities()) {
			return errors.New("generic App removal left stale resources or changed unrelated resources")
		}
		if err := hfCommand(r, "remove", "ntfy", "--yes", "--json"); err != nil {
			return err
		}
		removed, err := hfReadInventory(ctx, client, homarrURL, secrets["HOMARR_API_KEY"])
		if err != nil {
			return err
		}
		if err := removed.validate(ports, secrets, []string{"jellyfin"}); err != nil {
			return err
		}
		if !slices.Equal(baseline.identitiesFor("jellyfin"), removed.identitiesFor("jellyfin")) {
			return errors.New("integration removal changed unrelated Jellyfin resources")
		}
		if err := hfCommand(r, installArguments(targetSpec{ID: "ntfy", Apps: []string{"ntfy"}}, r.root, ports)...); err != nil {
			return err
		}
		secrets, err = p.LoadSecrets()
		if err != nil {
			return errors.New("private reinstallation credentials unavailable")
		}
		if err := hfCommand(r, "setup", "homarr", "--json"); err != nil {
			return err
		}
		current, err = hfReadInventory(ctx, client, homarrURL, secrets["HOMARR_API_KEY"])
		if err != nil {
			return err
		}
		if err := current.validate(ports, secrets, []string{"ntfy", "jellyfin"}); err != nil {
			return err
		}
		if !slices.Equal(baseline.identitiesFor("jellyfin"), current.identitiesFor("jellyfin")) {
			return errors.New("reinstallation changed unrelated Jellyfin resources")
		}
		return hfNotifications(ctx, client, homarrURL, ntfyURL, secrets, current.integrationID("ntfy"))
	})
	if os.Getenv("E2E_HOMARR_BROWSER") == "1" {
		hfStage(r, "browser-dashboard", func() error {
			current, err := hfReadInventory(ctx, client, homarrURL, secrets["HOMARR_API_KEY"])
			if err != nil {
				return err
			}
			return hfBrowserDashboard(ctx, r, homarrURL, ntfyURL, jellyfinURL, secrets, current)
		})
	}
	if r.evidence.complete() {
		r.evidence.Outcome = "pass"
	}
	r.saveEvidence()
	if r.evidence.Outcome == "pass" {
		if err := hfCapturePause(ctx, r, homarrURL, ntfyURL); err != nil {
			t.Fatal(err)
		}
	}
}

// The actual login form receives credentials only through a private stdin pipe.
// Browser command output is never copied into evidence or failure messages.
func hfBrowserDashboard(ctx context.Context, r *runner, base, ntfyURL, jellyfinURL string, secrets map[string]string, inv hfInventory) error {
	browser, err := exec.LookPath("agent-browser")
	if err != nil {
		return errors.New("optional browser acceptance requires installed agent-browser")
	}
	session := "selfhost-functional-" + r.name
	run := func(commandCtx context.Context, stdin string, args ...string) ([]byte, error) {
		commandCtx, cancel := context.WithTimeout(commandCtx, 30*time.Second)
		defer cancel()
		command := exec.CommandContext(commandCtx, browser, append([]string{"--session", session, "--json"}, args...)...)
		for _, variable := range os.Environ() {
			if !strings.HasPrefix(variable, "AGENT_BROWSER_") {
				command.Env = append(command.Env, variable)
			}
		}
		command.Stdin = strings.NewReader(stdin)
		output, err := command.Output()
		if err != nil {
			return nil, errors.New("optional browser acceptance command failed")
		}
		return output, nil
	}
	defer func() {
		closeCtx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
		defer cancel()
		if _, err := run(closeCtx, "", "close"); err != nil {
			r.t.Error("owned acceptance browser session could not close")
		}
	}()
	if _, err := run(ctx, "", "--args", "--no-sandbox", "--allowed-domains", "127.0.0.1", "open", base+"/auth/login?callbackUrl=%2Fboards%2FHome"); err != nil {
		return err
	}
	if _, err := run(ctx, "", "wait", "#username"); err != nil {
		return errors.New("administrator browser login form did not appear")
	}
	credentials, _ := json.Marshal(map[string]string{"name": secrets["ADMIN_USER"], "password": secrets["ADMIN_PASSWORD"]})
	script := `(() => { const credentials = ` + string(credentials) + `;
const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
for (const [selector, value] of [['#username', credentials.name], ['#password', credentials.password]]) {
 const input = document.querySelector(selector); if (!input) return false;
 setter.call(input, value); input.dispatchEvent(new Event('input', {bubbles:true})); input.dispatchEvent(new Event('change', {bubbles:true}));
} return true; })()`
	if !hfBrowserBoolean(ctx, run, script) {
		return errors.New("administrator browser login form could not be filled")
	}
	if _, err := run(ctx, "", "click", `button[type="submit"][name="provider"][value="credentials"]`); err != nil {
		return errors.New("administrator browser login form could not be submitted")
	}
	if err := hfPoll(ctx, time.Minute, func() bool {
		return hfBrowserBoolean(ctx, run, `(async () => { const r = await fetch('/api/auth/session'); if (!r.ok) return false; const s = await r.json(); return !!s.user?.id && s.user.permissions?.includes('admin') === true && !location.pathname.includes('/auth/'); })()`)
	}, "actual browser login did not establish an administrator dashboard session"); err != nil {
		return err
	}
	if _, err := run(ctx, "", "set", "viewport", "1440", "1100"); err != nil {
		return err
	}
	dir := filepath.Join(r.logDir, "browser")
	if os.MkdirAll(dir, 0o700) != nil {
		return errors.New("persistent browser evidence directory unavailable")
	}
	for _, kind := range []string{"notifications", "mediaReleases", "notebook"} {
		id := ""
		for _, item := range inv.Board.Items {
			if item.Kind == kind {
				if id != "" {
					return errors.New("browser acceptance widget ownership is ambiguous")
				}
				id = item.ID
			}
		}
		if id == "" {
			return errors.New("browser acceptance widget is missing")
		}
		selector := `[data-grid-item-id="` + id + `"]`
		if _, err := run(ctx, "", "scrollintoview", selector); err != nil {
			return errors.New("browser acceptance widget could not be brought into view")
		}
		checks := []string{"Your homelab at a glance", "Admin login", inv.appFor("ntfy").Name, inv.appFor("jellyfin").Name}
		if kind == "notifications" {
			checks = []string{"Owned self-host functional notification"}
		}
		if kind == "mediaReleases" {
			checks = []string{"Selfhost E2E Tone"}
		}
		encoded, _ := json.Marshal(map[string]any{"selector": selector, "checks": checks, "links": []string{ntfyURL, jellyfinURL}, "notebook": kind == "notebook"})
		visible := `(() => { const c = ` + string(encoded) + `; const el = document.querySelector(c.selector); if (!el) return false;
const rect = el.getBoundingClientRect(), style = getComputedStyle(el);
if (!rect.width || !rect.height || rect.bottom <= 0 || rect.top >= innerHeight || style.visibility === 'hidden' || style.display === 'none') return false;
if (!c.checks.every(text => el.innerText.includes(text))) return false;
return !c.notebook || c.links.every(url => Array.from(el.querySelectorAll('a')).some(a => a.href === url || a.href === url + '/')); })()`
		if err := hfPoll(ctx, time.Minute, func() bool { return hfBrowserBoolean(ctx, run, visible) }, "browser widget did not render the expected live notification, media or notebook content"); err != nil {
			return err
		}
		path := filepath.Join(dir, kind+".png")
		if _, err := run(ctx, "", "screenshot", selector, path); err != nil {
			return errors.New("browser widget screenshot could not be captured")
		}
		if os.Chmod(path, 0o600) != nil {
			return errors.New("browser widget screenshot could not be made private")
		}
	}
	path := filepath.Join(dir, "dashboard.png")
	if _, err := run(ctx, "", "screenshot", path, "--full"); err != nil {
		return errors.New("browser dashboard screenshot could not be captured")
	}
	if os.Chmod(path, 0o600) != nil {
		return errors.New("browser dashboard screenshot could not be made private")
	}
	return nil
}

func hfBrowserBoolean(ctx context.Context, run func(context.Context, string, ...string) ([]byte, error), script string) bool {
	output, err := run(ctx, script, "eval", "--stdin")
	var response struct {
		Success bool
		Data    struct{ Result bool }
	}
	return err == nil && json.Unmarshal(output, &response) == nil && response.Success && response.Data.Result
}

// Capture is opt-in and starts only once acceptance has passed. Its directory
// belongs to the caller; readiness contains public endpoints, never credentials.
// Creating a regular "resume" file there releases the healthy fixture early.
func hfCapturePause(ctx context.Context, r *runner, homarrURL, ntfyURL string) error {
	dir := os.Getenv("E2E_HOMARR_CAPTURE_DIR")
	if dir == "" {
		return nil
	}
	if !filepath.IsAbs(dir) {
		return errors.New("Homarr capture directory must be an absolute owned temporary directory")
	}
	info, err := os.Lstat(dir)
	if err != nil || !info.IsDir() || info.Mode().Perm()&0o077 != 0 {
		return errors.New("Homarr capture directory must be an existing private directory")
	}
	owner, ok := info.Sys().(*syscall.Stat_t)
	if !ok || owner.Uid != uint32(os.Getuid()) {
		return errors.New("Homarr capture directory must belong to the current user")
	}
	resolved, err := filepath.EvalSymlinks(dir)
	if err != nil {
		return errors.New("Homarr capture directory cannot be resolved")
	}
	tempRoot, err := filepath.EvalSymlinks(os.TempDir())
	if err != nil {
		return errors.New("Homarr capture temporary root cannot be resolved")
	}
	relative, err := filepath.Rel(tempRoot, resolved)
	if err != nil || relative == "." || relative == ".." || strings.HasPrefix(relative, ".."+string(os.PathSeparator)) {
		return errors.New("Homarr capture directory must be inside the temporary root")
	}
	resume := filepath.Join(resolved, "resume")
	if _, err := os.Lstat(resume); !os.IsNotExist(err) {
		return errors.New("Homarr capture directory must not contain a stale resume marker")
	}
	ready := struct {
		Project        string `json:"project"`
		ComposeProject string `json:"compose_project"`
		Binary         string `json:"binary"`
		HomarrURL      string `json:"homarr_url"`
		NtfyURL        string `json:"ntfy_url"`
	}{r.project, r.name, e2eBinary, homarrURL, ntfyURL}
	data, err := json.Marshal(ready)
	if err != nil {
		return errors.New("Homarr capture readiness could not be encoded")
	}
	file, err := os.OpenFile(filepath.Join(resolved, "ready.json"), os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		return errors.New("Homarr capture readiness requires a fresh ready.json path")
	}
	_, writeErr := file.Write(append(data, '\n'))
	closeErr := file.Close()
	if writeErr != nil || closeErr != nil {
		return errors.New("Homarr capture readiness could not be persisted")
	}
	r.t.Logf("Homarr functional capture ready: %s; create resume to continue teardown (maximum 10 minutes)", resolved)
	waitCtx, cancel := context.WithTimeout(ctx, 10*time.Minute)
	defer cancel()
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-waitCtx.Done():
			r.t.Log("Homarr capture wait ended; continuing owned teardown")
			return nil
		case <-ticker.C:
			marker, err := os.Lstat(resume)
			if os.IsNotExist(err) {
				continue
			}
			if err != nil || !marker.Mode().IsRegular() {
				return errors.New("Homarr capture resume marker must be a regular owned file")
			}
			markerOwner, ok := marker.Sys().(*syscall.Stat_t)
			if !ok || markerOwner.Uid != uint32(os.Getuid()) {
				return errors.New("Homarr capture resume marker must belong to the current user")
			}
			r.t.Log("Homarr capture resumed; continuing owned teardown")
			return nil
		}
	}
}

func hfStage(r *runner, name string, run func() error) {
	r.t.Helper()
	for i := range r.evidence.Stages {
		stage := &r.evidence.Stages[i]
		if stage.Name != name {
			continue
		}
		stage.Outcome = "running"
		r.saveEvidence()
		if err := run(); err != nil {
			stage.Outcome = "fail"
			stage.Reason = err.Error() // Helpers return fixed, credential-free reasons.
			r.evidence.Outcome = "failed"
			r.saveEvidence()
			r.t.Fatalf("Homarr functional %s failed: %s", name, stage.Reason)
		}
		stage.Outcome = "pass"
		for _, id := range r.spec.Apps {
			stage.Apps[id] = "pass"
		}
		r.saveEvidence()
		r.t.Logf("Homarr functional %s passed", name)
		return
	}
	r.t.Fatal("unknown Homarr functional stage")
}

func hfCommand(r *runner, args ...string) error {
	res := r.run(args...)
	if res.code != 0 {
		return errors.New("owned functional CLI operation failed; inspect its private Workflow state")
	}
	return nil
}

func hfRequest(ctx context.Context, client *http.Client, method, endpoint string, headers map[string]string, body []byte) (int, []byte, error) {
	req, err := http.NewRequestWithContext(ctx, method, endpoint, bytes.NewReader(body))
	if err != nil {
		return 0, nil, errors.New("functional request could not be constructed")
	}
	for key, value := range headers {
		req.Header.Set(key, value)
	}
	resp, err := client.Do(req)
	if err != nil {
		return 0, nil, errors.New("functional HTTP request failed")
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(io.LimitReader(resp.Body, 2*1024*1024+1))
	if err != nil || len(data) > 2*1024*1024 {
		return resp.StatusCode, nil, errors.New("functional HTTP response exceeded its bound or could not be read")
	}
	return resp.StatusCode, data, nil
}

func hfJSON(ctx context.Context, client *http.Client, method, endpoint string, headers map[string]string, input, output any) error {
	var body []byte
	if input != nil {
		var err error
		body, err = json.Marshal(input)
		if err != nil {
			return errors.New("functional JSON request could not be encoded")
		}
	}
	copyHeaders := map[string]string{}
	for key, value := range headers {
		copyHeaders[key] = value
	}
	if input != nil {
		copyHeaders["Content-Type"] = "application/json"
	}
	status, data, err := hfRequest(ctx, client, method, endpoint, copyHeaders, body)
	if err != nil {
		return err
	}
	if status < 200 || status >= 300 {
		return errors.New("functional JSON endpoint rejected the request")
	}
	if output != nil && json.Unmarshal(data, output) != nil {
		return errors.New("functional JSON response did not match the source contract")
	}
	return nil
}

// Homarr tRPC uses the SuperJSON data.json envelope. Dates' meta is irrelevant
// to these assertions; their identifiers/content/numeric metrics are plain JSON.
func hfTRPC(ctx context.Context, client *http.Client, base, key, procedure, method string, input, output any) error {
	endpoint := base + "/api/trpc/" + procedure
	body := []byte("{}")
	if input != nil {
		encoded, err := json.Marshal(map[string]any{"json": input})
		if err != nil {
			return errors.New("functional tRPC input could not be encoded")
		}
		body = encoded
		if method == "GET" {
			endpoint += "?input=" + url.QueryEscape(string(encoded))
		}
	}
	if method == "GET" {
		body = nil
	}
	headers := map[string]string{"Content-Type": "application/json"}
	if key != "" {
		headers["ApiKey"] = key
	}
	status, data, err := hfRequest(ctx, client, method, endpoint, headers, body)
	if err != nil {
		return err
	}
	var envelope struct {
		Result struct {
			Data struct{ JSON json.RawMessage }
		}
		Error json.RawMessage
	}
	if status < 200 || status >= 300 || json.Unmarshal(data, &envelope) != nil || len(envelope.Error) > 0 {
		return fmt.Errorf("functional Homarr %s rejected the request", procedure)
	}
	if output != nil && json.Unmarshal(envelope.Result.Data.JSON, output) != nil {
		return fmt.Errorf("functional Homarr %s response did not match the source contract", procedure)
	}
	return nil
}

func hfAdminLogin(ctx context.Context, client *http.Client, base string, secrets map[string]string) (string, error) {
	var csrf struct{ CSRFToken string }
	if err := hfJSON(ctx, client, "GET", base+"/api/auth/csrf", nil, nil, &csrf); err != nil || csrf.CSRFToken == "" {
		return "", errors.New("Homarr did not issue its login CSRF token")
	}
	form := url.Values{"name": {secrets["ADMIN_USER"]}, "password": {secrets["ADMIN_PASSWORD"]}, "csrfToken": {csrf.CSRFToken}, "callbackUrl": {base}}
	status, _, err := hfRequest(ctx, client, "POST", base+"/api/auth/callback/credentials", map[string]string{"Content-Type": "application/x-www-form-urlencoded", "X-Auth-Return-Redirect": "1"}, []byte(form.Encode()))
	if err != nil || status != http.StatusOK {
		return "", errors.New("Homarr administrator login callback failed")
	}
	var session struct {
		User struct {
			ID, Name    string
			Permissions []string
		}
	}
	if err := hfJSON(ctx, client, "GET", base+"/api/auth/session", nil, nil, &session); err != nil || session.User.ID == "" || session.User.Name != strings.ToLower(secrets["ADMIN_USER"]) || !slices.Contains(session.User.Permissions, "admin") {
		return "", errors.New("Homarr login did not establish the owned administrator session")
	}
	return session.User.ID, nil
}

type hfApp struct {
	ID, Name, Href, PingURL string
	Description, IconURL    *string
}

func (a hfApp) patch() map[string]any {
	return map[string]any{"name": a.Name, "description": a.Description, "iconUrl": a.IconURL, "href": a.Href, "pingUrl": a.PingURL}
}

type hfIntegration struct{ ID, Kind, URL string }
type hfItem struct {
	ID, Kind       string
	Options        map[string]any
	IntegrationIDs []string
}
type hfBoard struct {
	ID, Name, CreatorID string
	IsPublic            bool
	Items               []hfItem
}
type hfInventory struct {
	Apps         []hfApp
	Integrations []hfIntegration
	Board        hfBoard
}

func hfReadInventory(ctx context.Context, client *http.Client, base, key string) (hfInventory, error) {
	var inv hfInventory
	var boards []struct{ ID, Name string }
	if err := hfJSON(ctx, client, "GET", base+"/api/boards", map[string]string{"ApiKey": key}, nil, &boards); err != nil {
		return inv, err
	}
	if len(boards) != 1 || boards[0].Name != "Home" {
		return inv, errors.New("owned Home board is missing or duplicated")
	}
	if err := hfJSON(ctx, client, "GET", base+"/api/apps", map[string]string{"ApiKey": key}, nil, &inv.Apps); err != nil {
		return inv, err
	}
	if err := hfTRPC(ctx, client, base, key, "integration.all", "GET", nil, &inv.Integrations); err != nil {
		return inv, err
	}
	if err := hfTRPC(ctx, client, base, key, "board.getBoardByName", "GET", map[string]string{"name": "Home"}, &inv.Board); err != nil {
		return inv, err
	}
	if inv.Board.ID != boards[0].ID {
		return inv, errors.New("REST and tRPC Home board identities differ")
	}
	return inv, nil
}

func (inv hfInventory) appFor(id string) hfApp {
	for _, app := range inv.Apps {
		if app.Description != nil && *app.Description == "self-host tile:"+id {
			return app
		}
	}
	return hfApp{}
}
func (inv hfInventory) integrationID(kind string) string {
	for _, integration := range inv.Integrations {
		if integration.Kind == kind {
			return integration.ID
		}
	}
	return ""
}
func (inv hfInventory) identities() []string {
	ids := []string{"board:" + inv.Board.ID}
	for _, app := range inv.Apps {
		ids = append(ids, "app:"+app.ID)
	}
	for _, integration := range inv.Integrations {
		ids = append(ids, "integration:"+integration.ID)
	}
	for _, item := range inv.Board.Items {
		ids = append(ids, "item:"+item.ID)
	}
	slices.Sort(ids)
	return ids
}
func (inv hfInventory) identitiesFor(id string) []string {
	appID := inv.appFor(id).ID
	integrationID := inv.integrationID(id)
	ids := []string{"app:" + appID, "integration:" + integrationID}
	for _, item := range inv.Board.Items {
		if item.Options["appId"] == appID || slices.Contains(item.IntegrationIDs, integrationID) {
			ids = append(ids, "item:"+item.ID)
		}
	}
	slices.Sort(ids)
	return ids
}

func (inv hfInventory) validate(ports map[string]int, secrets map[string]string, expected []string) error {
	if inv.Board.ID == "" || inv.Board.Name != "Home" || inv.Board.IsPublic || len(inv.Apps) != len(expected) {
		return errors.New("private dashboard App inventory differs from the owned selection")
	}
	appIDs := map[string]bool{}
	for _, id := range expected {
		app := inv.appFor(id)
		if app.ID == "" || appIDs[app.ID] || app.Href != fmt.Sprintf("http://127.0.0.1:%d", ports[id]) {
			return errors.New("managed App tile URL is missing, duplicated or not browser-reachable")
		}
		appIDs[app.ID] = true
		if id == "ntfy" && app.PingURL != "http://ntfy:80" || id == "jellyfin" && app.PingURL != "http://jellyfin:8096" {
			return errors.New("integration ping URL is not its Docker-internal base URL")
		}
	}
	expectedIntegrations := map[string][]string{}
	if slices.Contains(expected, "ntfy") {
		expectedIntegrations["ntfy"] = []string{"notifications", "stats"}
	}
	if slices.Contains(expected, "jellyfin") {
		expectedIntegrations["jellyfin"] = []string{"mediaServer", "mediaReleases", "stats"}
	}
	if len(inv.Integrations) != len(expectedIntegrations) {
		return errors.New("dedicated integration inventory is missing or duplicated")
	}
	integrationIDs := map[string]bool{}
	for kind, widgets := range expectedIntegrations {
		id := inv.integrationID(kind)
		if id == "" || integrationIDs[id] {
			return errors.New("dedicated integration identity is missing or duplicated")
		}
		integrationIDs[id] = true
		for _, widget := range widgets {
			count := 0
			for _, item := range inv.Board.Items {
				if item.Kind == widget && slices.Contains(item.IntegrationIDs, id) {
					count++
				}
			}
			if count != 1 {
				return errors.New("generated integration widget is missing or duplicated")
			}
		}
	}
	notebooks := 0
	tiles := map[string]int{}
	for _, item := range inv.Board.Items {
		for _, id := range item.IntegrationIDs {
			if !integrationIDs[id] {
				return errors.New("orphan integration widget survived reconciliation")
			}
		}
		if item.Kind == "app" {
			id, _ := item.Options["appId"].(string)
			if !appIDs[id] {
				return errors.New("orphan App tile survived reconciliation")
			}
			tiles[id]++
		}
		if item.Kind != "notebook" {
			continue
		}
		content, _ := item.Options["content"].(string)
		if !strings.Contains(content, "Your homelab at a glance") {
			return errors.New("managed notebook marker is missing")
		}
		notebooks++
		for _, id := range expected {
			if !strings.Contains(content, inv.appFor(id).Name) || !strings.Contains(content, inv.appFor(id).Href) {
				return errors.New("notebook omitted an installed App or its current URL")
			}
		}
		for _, name := range []string{"ADMIN_PASSWORD", "HOMARR_API_KEY", "HOMARR_SECRET_ENCRYPTION_KEY", "NTFY_TOPIC", "NTFY_HOMARR_TOKEN", "JELLYFIN_API_KEY"} {
			if secrets[name] != "" && strings.Contains(content, secrets[name]) {
				return errors.New("managed notebook contains a credential value")
			}
		}
		for _, id := range []string{"ntfy", "jellyfin", "gatus"} {
			if !slices.Contains(expected, id) && strings.Contains(content, fmt.Sprintf("http://127.0.0.1:%d", ports[id])) {
				return errors.New("notebook retained a removed App URL")
			}
		}
	}
	if notebooks != 1 {
		return errors.New("managed notebook is missing or duplicated")
	}
	for id := range appIDs {
		if tiles[id] != 1 {
			return errors.New("managed App tile is missing or duplicated")
		}
	}
	return nil
}

func hfNotifications(ctx context.Context, client *http.Client, homarrURL, ntfyURL string, secrets map[string]string, integrationID string) error {
	if integrationID == "" {
		return errors.New("ntfy integration missing before notification proof")
	}
	message := "Owned self-host functional notification " + randomHex(16)
	topic := url.PathEscape(secrets["NTFY_TOPIC"])
	headers := map[string]string{"Authorization": "Bearer " + secrets["NTFY_HOMARR_TOKEN"], "Content-Type": "text/plain", "Title": "Owned functional probe"}
	status, body, err := hfRequest(ctx, client, "POST", ntfyURL+"/"+topic, headers, []byte(message))
	var issued struct{ ID, Message, Event string }
	if err != nil || status != 200 || json.Unmarshal(body, &issued) != nil || issued.ID == "" || issued.Message != message || issued.Event != "message" {
		return errors.New("ntfy did not accept the owned notification payload")
	}
	status, body, err = hfRequest(ctx, client, "GET", ntfyURL+"/"+topic+"/json?poll=1", headers, nil)
	if err != nil || status != 200 {
		return errors.New("ntfy token could not read its owned notification topic")
	}
	found := false
	decoder := json.NewDecoder(bytes.NewReader(body))
	for {
		var event struct{ ID, Message, Event string }
		err := decoder.Decode(&event)
		if err == io.EOF {
			break
		}
		if err != nil {
			return errors.New("ntfy notification stream is invalid JSON")
		}
		if event.ID == issued.ID && event.Message == message && event.Event == "message" {
			found = true
		}
	}
	if !found {
		return errors.New("ntfy read-back did not contain the exact published message")
	}
	for _, method := range []string{"GET", "POST"} {
		path := ntfyURL + "/" + topic
		if method == "GET" {
			path += "/json?poll=1"
		}
		status, _, err := hfRequest(ctx, client, method, path, nil, []byte("anonymous functional probe"))
		if err != nil || status != 401 && status != 403 {
			return errors.New("anonymous ntfy topic access was not denied")
		}
	}
	return hfPoll(ctx, 3*time.Minute, func() bool {
		var notifications []struct {
			Integration struct{ ID string }
			Data        []struct{ ID, Body string }
			Error       json.RawMessage
		}
		if hfTRPC(ctx, client, homarrURL, secrets["HOMARR_API_KEY"], "widget.notifications.getNotifications", "GET", map[string]any{"integrationIds": []string{integrationID}}, &notifications) != nil {
			return false
		}
		seen := false
		for _, source := range notifications {
			for _, notification := range source.Data {
				if source.Integration.ID == integrationID && notification.ID == issued.ID && notification.Body == message && (len(source.Error) == 0 || string(source.Error) == "null") {
					seen = true
				}
			}
		}
		if !seen {
			return false
		}
		var stats struct {
			Values       map[string]float64
			UpdatedAt    *float64
			Error, Stale bool
		}
		if hfTRPC(ctx, client, homarrURL, secrets["HOMARR_API_KEY"], "widget.stats.refresh", "POST", map[string]any{"integrationId": integrationID, "force": true}, &stats) != nil {
			return false
		}
		return !stats.Error && !stats.Stale && stats.UpdatedAt != nil && stats.Values["messages"] >= 1
	}, "Homarr notifications/statistics did not expose the exact live ntfy message")
}

func hfMediaRelease(ctx context.Context, client *http.Client, homarrURL, jellyfinURL string, secrets map[string]string, integrationID string) error {
	headers := map[string]string{"Authorization": `MediaBrowser Client="selfhost-functional", Device="selfhost-functional", DeviceId="selfhost-functional", Version="1.0.0", Token="` + secrets["JELLYFIN_API_KEY"] + `"`}
	if err := hfJSON(ctx, client, "POST", jellyfinURL+"/Library/Refresh", headers, nil, nil); err != nil {
		return errors.New("Jellyfin could not refresh its owned synthetic library")
	}
	itemID := ""
	if err := hfPoll(ctx, 3*time.Minute, func() bool {
		var items struct{ Items []struct{ ID, Path string } }
		if hfJSON(ctx, client, "GET", jellyfinURL+"/Items?Recursive=true&IncludeItemTypes=Audio&Fields=Path", headers, nil, &items) != nil {
			return false
		}
		for _, item := range items.Items {
			if strings.HasSuffix(item.Path, "/Selfhost E2E Tone.wav") && item.ID != "" {
				itemID = item.ID
				return true
			}
		}
		return false
	}, "Jellyfin did not scan the owned synthetic audio file"); err != nil {
		return err
	}
	return hfPoll(ctx, 3*time.Minute, func() bool {
		var release struct {
			Releases []struct {
				ID          string
				Integration struct{ ID string }
			}
			FailedIntegrations []json.RawMessage
		}
		if hfTRPC(ctx, client, homarrURL, secrets["HOMARR_API_KEY"], "widget.mediaRelease.getMediaReleases", "GET", map[string]any{"integrationIds": []string{integrationID}}, &release) != nil || len(release.FailedIntegrations) != 0 {
			return false
		}
		for _, item := range release.Releases {
			if item.ID == itemID && item.Integration.ID == integrationID {
				return true
			}
		}
		return false
	}, "Homarr media releases did not contain Jellyfin's exact synthetic library item")
}

func hfPoll(ctx context.Context, timeout time.Duration, check func() bool, reason string) error {
	deadline := time.Now().Add(timeout)
	for {
		if check() {
			return nil
		}
		if time.Now().After(deadline) {
			return errors.New(reason)
		}
		select {
		case <-ctx.Done():
			return errors.New("functional proof deadline exceeded")
		case <-time.After(2 * time.Second):
		}
	}
}

// A one-second PCM WAV generated locally. It has no downloaded media, external
// metadata, or copyrighted content, and exists only in this runner's media root.
func hfWriteTone(path string) error {
	const samples = 8000
	var wav bytes.Buffer
	wav.WriteString("RIFF")
	_ = binary.Write(&wav, binary.LittleEndian, uint32(36+samples*2))
	wav.WriteString("WAVEfmt ")
	for _, value := range []any{uint32(16), uint16(1), uint16(1), uint32(samples), uint32(samples * 2), uint16(2), uint16(16)} {
		_ = binary.Write(&wav, binary.LittleEndian, value)
	}
	wav.WriteString("data")
	_ = binary.Write(&wav, binary.LittleEndian, uint32(samples*2))
	for sample := 0; sample < samples; sample++ {
		_ = binary.Write(&wav, binary.LittleEndian, int16(2000*math.Sin(2*math.Pi*440*float64(sample)/samples)))
	}
	if os.MkdirAll(filepath.Dir(path), 0o755) != nil || os.WriteFile(path, wav.Bytes(), 0o644) != nil {
		return errors.New("owned synthetic media fixture could not be created")
	}
	return nil
}
