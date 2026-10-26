//go:build e2e

package e2e

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
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
	"strconv"
	"strings"
	"syscall"
	"testing"
	"time"

	"github.com/ajnart/self-host/internal/catalog"
	"github.com/ajnart/self-host/internal/project"
)

// This is an opt-in functional scenario, separate from the catalog lifecycle
// sweep. All credentials stay inside this test's owned Project and HTTP client.
// E2E_HOMARR_FUNCTIONAL=1 go test -tags e2e -timeout 45m -run '^TestHomarrFunctional$' ./e2e
func TestHomarrFunctional(t *testing.T) {
	if os.Getenv("E2E_HOMARR_FUNCTIONAL") != "1" {
		t.Skip("set E2E_HOMARR_FUNCTIONAL=1 for the bounded Homarr functional scenario")
	}
	if !dockerAvailable {
		t.Skip("Docker unavailable; Homarr functional acceptance remains unverified")
	}
	if err := sweepBudgetError(t.Deadline()); err != nil {
		t.Fatal(err)
	}
	parent, parentCancel := sweepCommandContext(t.Deadline())
	t.Cleanup(parentCancel)
	ctx, cancel := context.WithTimeout(parent, 30*time.Minute)
	t.Cleanup(cancel)
	lockPath := filepath.Join(os.TempDir(), globalLockName)
	release, err := acquireGlobal(ctx, lockPath)
	if err != nil {
		t.Fatal("Homarr functional global serial slot unavailable")
	}
	// Cleanup registrations run in reverse order: keep the slot until the
	// runner's owned Compose teardown has completed.
	t.Cleanup(release)
	if _, err := os.Lstat(blockedMarkerPath(lockPath)); err == nil || !os.IsNotExist(err) {
		t.Fatal("recover the previous owned teardown blocker before functional acceptance")
	}
	guard := &sweepGuard{ProjectNames: map[string]string{}}
	guard.OnBlock = func(owned string) {
		payload := map[string]string{"project": owned, "compose_project": guard.ProjectName(owned)}
		if writeBlockedMarker(lockPath, payload) != nil {
			t.Error("could not persist the owned teardown blocker")
		}
	}
	r := newRunner(t, guard)
	r.commandCtx = ctx
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
	r.evidence.Probe = "Headless administrator access to private Home board, anonymous access denial, reversible authenticated edit, real ntfy message and Homarr notifications/statistics, owned synthetic Jellyfin audio release, duplicate-free reconciliation and targeted failure recovery; optional browser rendering is separately recorded"
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
		if err := hfWriteTone(filepath.Join(r.storageRoot, "media", "music", "Selfhost E2E Tone.wav")); err != nil {
			return err
		}
		reservation.release()
		for _, id := range r.spec.Apps {
			if err := hfCommand(r, installArguments(targetSpec{ID: id, Apps: []string{id}}, r.storageRoot, ports)...); err != nil {
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
	initialAdminUser, initialAdminPassword := secrets["ADMIN_USER"], secrets["ADMIN_PASSWORD"]
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
		if baseline.Board.IsPublic {
			return errors.New("Home visibility is public instead of private")
		}
		if len(baseline.Board.CreatorID) == 0 {
			return errors.New("Home creatorId field is missing from the full board response")
		}
		var creatorID string
		if bytes.Equal(baseline.Board.CreatorID, []byte("null")) {
			if baseline.Board.SummaryCreatorID != "" {
				return errors.New("Home null creatorId conflicts with its REST creator")
			}
			// This scenario starts a new isolated Project: upstream seeds a
			// private dashboard and onboarding adopts it without a creator.
			for i := range r.evidence.Stages {
				if r.evidence.Stages[i].Name == "administrator-board" {
					r.evidence.Stages[i].Reason = "adopted private seeded board; creator not assigned by upstream"
				}
			}
		} else {
			if json.Unmarshal(baseline.Board.CreatorID, &creatorID) != nil || creatorID == "" {
				return errors.New("Home creatorId does not match the scalar ownership contract")
			}
			if creatorID != userID || baseline.Board.SummaryCreatorID != userID {
				return errors.New("Home creator differs from the authenticated administrator")
			}
		}
		var home hfBoard
		if err := hfTRPC(ctx, client, homarrURL, "", "board.getHomeBoard", "GET", nil, &home); err != nil || home.ID != baseline.Board.ID {
			return errors.New("administrator home board is not the managed Home board")
		}
		if err := hfPrivateBoardAccess(ctx, client, homarrURL, baseline.Board); err != nil {
			return err
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
		// Only the generated, owned token is perturbed. Setup runs the Link
		// target first, so ntfy re-issues the token before Homarr links it.
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
		perturbed := stored["NTFY_HOMARR_TOKEN"]
		recovered := r.run("setup", "homarr", "--json")
		repaired, linked := false, false
		for _, event := range recovered.events {
			switch {
			case event.App == "ntfy" && event.Step == "topic-token" && event.Event == "step.ok":
				repaired = true
			case event.App == "homarr" && event.Step == "link-ntfy" && event.Event == "step.ok":
				linked = true
			}
		}
		healed, err := p.LoadSecrets()
		if err != nil || recovered.code != 0 || !repaired || !linked || healed["NTFY_HOMARR_TOKEN"] == "" || healed["NTFY_HOMARR_TOKEN"] == perturbed {
			return fmt.Errorf("invalid integration credential was not repaired by one Setup: exit=%d, token_repaired=%t, link_ok=%t", recovered.code, repaired, linked)
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
		if err := hfCommand(r, installArguments(targetSpec{ID: "gatus", Apps: []string{"gatus"}}, r.storageRoot, ports)...); err != nil {
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
		if err := hfCommand(r, installArguments(targetSpec{ID: "ntfy", Apps: []string{"ntfy"}}, r.storageRoot, ports)...); err != nil {
			return err
		}
		secrets, err = p.LoadSecrets()
		if err != nil {
			return errors.New("private reinstallation credentials unavailable")
		}
		if secrets["ADMIN_USER"] != initialAdminUser || secrets["ADMIN_PASSWORD"] != initialAdminPassword {
			return errors.New("shared administrator credentials changed during ntfy removal and reinstallation")
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

func hfPrivateBoardAccess(ctx context.Context, client *http.Client, base string, board hfBoard) error {
	var authenticated hfBoard
	if err := hfTRPC(ctx, client, base, "", "board.getBoardByName", "GET", map[string]string{"name": "Home"}, &authenticated); err != nil || authenticated.ID != board.ID || authenticated.IsPublic {
		return errors.New("administrator could not read private Home without an API key")
	}
	original := board.PageTitle
	changed := "Owned self-host reversible access proof"
	write := func(writeCtx context.Context, value any) error {
		return hfTRPC(writeCtx, client, base, "", "board.savePartialBoardSettings", "POST", map[string]any{"id": board.ID, "pageTitle": value}, nil)
	}
	if write(ctx, changed) != nil {
		return errors.New("administrator could not make a benign authenticated board edit")
	}
	defer func() {
		restoreCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		_ = write(restoreCtx, original)
	}()
	if err := hfTRPC(ctx, client, base, "", "board.getBoardByName", "GET", map[string]string{"name": "Home"}, &authenticated); err != nil || authenticated.PageTitle == nil || *authenticated.PageTitle != changed {
		return errors.New("authenticated board edit was not persisted")
	}
	if write(ctx, original) != nil {
		return errors.New("administrator could not revert the benign board edit")
	}
	if err := hfTRPC(ctx, client, base, "", "board.getBoardByName", "GET", map[string]string{"name": "Home"}, &authenticated); err != nil || !hfSameTitle(authenticated.PageTitle, original) {
		return errors.New("authenticated board edit did not restore its previous value")
	}
	anonymous := &http.Client{Timeout: 30 * time.Second}
	input, _ := json.Marshal(map[string]any{"json": map[string]string{"name": "Home"}})
	status, _, err := hfRequest(ctx, anonymous, "GET", base+"/api/trpc/board.getBoardByName?input="+url.QueryEscape(string(input)), nil, nil)
	if err != nil || (status != http.StatusUnauthorized && status != http.StatusForbidden && status != http.StatusNotFound) {
		return errors.New("anonymous caller was not denied the private Home board read")
	}
	status, body, err := hfRequest(ctx, anonymous, "GET", base+"/api/boards", nil, nil)
	if err != nil {
		return errors.New("anonymous private REST board access could not be checked")
	}
	if status == http.StatusUnauthorized || status == http.StatusForbidden {
		return nil
	}
	var summaries []struct{ ID string }
	if status != http.StatusOK || json.Unmarshal(body, &summaries) != nil {
		return errors.New("anonymous REST board list did not match its access contract")
	}
	for _, summary := range summaries {
		if summary.ID == board.ID {
			return errors.New("anonymous REST board list exposed private Home")
		}
	}
	return nil
}

func hfSameTitle(left, right *string) bool {
	if left == nil || right == nil {
		return left == nil && right == nil
	}
	return *left == *right
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
		if !hfBrowserCommandSucceeded(output) {
			return nil, errors.New("optional browser acceptance command was not acknowledged")
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
	// Only the pinned public dashboard-icon CDN accompanies the private API origin.
	if _, err := run(ctx, "", "--args", "--no-sandbox", "--allowed-domains", "127.0.0.1,cdn.jsdelivr.net", "open", base+"/auth/login?callbackUrl=%2Fboards%2FHome"); err != nil {
		return err
	}
	if _, err := run(ctx, "", "wait", "#username"); err != nil {
		return errors.New("administrator browser login form did not appear")
	}
	// The pinned image's e2e/shared/login.ts waits for the form's React props
	// before filling: SSR input existence alone does not prove hydration.
	if err := hfPoll(ctx, time.Minute, func() bool {
		return hfBrowserBoolean(ctx, run, hfBrowserLoginHydrated)
	}, "administrator browser login form did not hydrate"); err != nil {
		return hfBrowserLoginDiagnostic(ctx, run, "administrator browser login form did not hydrate")
	}
	if !hfBrowserBoolean(ctx, run, hfBrowserAuthProbe) {
		return errors.New("browser auth transport observation could not be prepared")
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
	if err := hfPoll(ctx, 10*time.Second, func() bool {
		return hfBrowserBoolean(ctx, run, hfBrowserControlledValuesAgree)
	}, "browser input values did not reach controlled form state"); err != nil {
		return hfBrowserLoginDiagnostic(ctx, run, "browser input values did not reach controlled form state")
	}
	// Native keyboard activation avoids relying on an acknowledged coordinate
	// click: prove the actual credentials button has focus before sending Enter.
	if err := hfBrowserSubmitLogin(ctx, run); err != nil {
		return hfBrowserLoginDiagnostic(ctx, run, err.Error())
	}
	if err := hfPoll(ctx, time.Minute, func() bool {
		return hfBrowserBoolean(ctx, run, `(async () => { const r = await fetch('/api/auth/session'); if (!r.ok) return false; const s = await r.json(); return !!s.user?.id && s.user.permissions?.includes('admin') === true && !location.pathname.includes('/auth/'); })()`)
	}, "actual browser login did not establish an administrator dashboard session"); err != nil {
		return hfBrowserLoginDiagnostic(ctx, run, "actual browser login did not establish an administrator dashboard session")
	}
	if err := hfBrowserDismissTour(ctx, run); err != nil {
		return err
	}
	if err := hfBrowserFitCaptureViewport(ctx, run); err != nil {
		return err
	}
	var appSelectors []string
	for _, item := range inv.Board.Items {
		if item.Kind == "app" {
			appSelectors = append(appSelectors, `[data-grid-item-id="`+item.ID+`"]`)
		}
	}
	encodedApps, _ := json.Marshal(appSelectors)
	icons := "(" + hfBrowserAppIconsReady + ")(" + string(encodedApps) + ")"
	if err := hfPoll(ctx, time.Minute, func() bool { return hfBrowserBoolean(ctx, run, icons) }, "browser App icons did not load from their configured public sources"); err != nil {
		return err
	}
	dir := filepath.Join(r.logDir, "browser")
	if os.MkdirAll(dir, 0o700) != nil {
		return errors.New("persistent browser evidence directory unavailable")
	}
	var renderedChecks []string
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
		checks := []string{"Your homelab at a glance", "Admin login", inv.appFor("ntfy").Name, inv.appFor("jellyfin").Name}
		if kind == "notifications" {
			checks = []string{"Owned self-host functional notification"}
		}
		if kind == "mediaReleases" {
			checks = []string{"Selfhost E2E Tone"}
		}
		encoded, _ := json.Marshal(map[string]any{"selector": selector, "checks": checks, "links": []string{ntfyURL, jellyfinURL}, "notebook": kind == "notebook"})
		visible := "(" + hfBrowserWidgetVisible + ")(" + string(encoded) + ")"
		renderedChecks = append(renderedChecks, visible)
		if !hfBrowserBoolean(ctx, run, hfBrowserCaptureAtOrigin) {
			return errors.New("browser selector capture could not establish document origin")
		}
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
	if !hfBrowserBoolean(ctx, run, hfBrowserCaptureAtOrigin) {
		return errors.New("browser dashboard capture could not establish document origin")
	}
	for _, check := range renderedChecks {
		if err := hfPoll(ctx, time.Minute, func() bool { return hfBrowserBoolean(ctx, run, check) }, "browser dashboard capture lost the rendered live widget content"); err != nil {
			return err
		}
	}
	path := filepath.Join(dir, "dashboard.png")
	if _, err := run(ctx, "", "screenshot", path); err != nil {
		return errors.New("browser dashboard screenshot could not be captured")
	}
	if os.Chmod(path, 0o600) != nil {
		return errors.New("browser dashboard screenshot could not be made private")
	}
	return nil
}

func hfBrowserCommandSucceeded(output []byte) bool {
	var response struct{ Success bool }
	return json.Unmarshal(output, &response) == nil && response.Success
}

func hfBrowserSubmitLogin(ctx context.Context, run func(context.Context, string, ...string) ([]byte, error)) error {
	selector := `button[type="submit"][name="provider"][value="credentials"]`
	if _, err := run(ctx, "", "focus", selector); err != nil {
		return errors.New("administrator browser login button could not be focused")
	}
	if !hfBrowserBoolean(ctx, run, `(() => { const button = document.querySelector('button[type="submit"][name="provider"][value="credentials"]'); return !!button && button.form === document.querySelector('#username')?.form && !button.disabled && document.activeElement === button; })()`) {
		return errors.New("administrator browser login button focus was not established")
	}
	output, err := run(ctx, "", "press", "Enter")
	var response struct {
		Success bool
		Data    struct {
			Pressed             string
			ConfirmationPending bool `json:"confirmation_required"`
			DialogOpened        bool
		}
	}
	if err != nil || json.Unmarshal(output, &response) != nil || !response.Success || response.Data.Pressed != "Enter" || response.Data.ConfirmationPending || response.Data.DialogOpened {
		return errors.New("administrator browser login Enter was not executed")
	}
	return nil
}

// Homarr eb1d449 tour-shell.tsx globally intercepts Enter to advance the tour.
// Space activates the ordinary focused Skip tour button without that handler.
func hfBrowserDismissTour(ctx context.Context, run func(context.Context, string, ...string) ([]byte, error)) error {
	focus := `(() => { const buttons = Array.from(document.querySelectorAll('button')).filter(button => button.textContent.trim() === 'Skip tour');
 if (buttons.length !== 1 || buttons[0].disabled) return false;
 const button = buttons[0], rect = button.getBoundingClientRect(); if (!rect.width || !rect.height || getComputedStyle(button).visibility === 'hidden') return false;
 button.focus(); return document.activeElement === button; })()`
	if err := hfPoll(ctx, time.Minute, func() bool { return hfBrowserBoolean(ctx, run, focus) }, "browser Skip tour control did not become focusable"); err != nil {
		return err
	}
	output, err := run(ctx, "", "press", "Space")
	var response struct {
		Success bool
		Data    struct {
			Pressed             string
			ConfirmationPending bool `json:"confirmation_required"`
			DialogOpened        bool
		}
	}
	if err != nil || json.Unmarshal(output, &response) != nil || !response.Success || response.Data.Pressed != "Space" || response.Data.ConfirmationPending || response.Data.DialogOpened {
		return errors.New("browser Skip tour Space activation was not executed")
	}
	return hfPoll(ctx, time.Minute, func() bool { return hfBrowserBoolean(ctx, run, hfBrowserDashboardUnobscured) }, "browser dashboard remained obscured after Skip tour")
}

const hfBrowserDashboardUnobscured = `(() => {
return !Array.from(document.querySelectorAll('button')).some(button => button.textContent.trim() === 'Skip tour') &&
 !document.querySelector('[data-onboarding-tour-overlay], [data-onboarding-tour-focus-reveal-overlay], [aria-modal="true"], [inert]'); })()`

func TestHomarrBrowserRejectsGlobalTourOverlayWithoutSkip(t *testing.T) {
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("static browser script fixture requires installed Node")
	}
	gate, _ := json.Marshal(hfBrowserDashboardUnobscured)
	script := `let overlay=true;
 globalThis.document={querySelectorAll:()=>[],querySelector:selector=>overlay && selector.includes('[data-onboarding-tour-overlay]')?{}:null};
 if(eval(` + string(gate) + `)) throw Error('global blur overlay accepted without Skip button');
 overlay=false;
 if(!eval(` + string(gate) + `)) throw Error('unobscured dashboard rejected');`
	command := exec.Command(node, "--input-type=module")
	command.Stdin = strings.NewReader(script)
	if err := command.Run(); err != nil {
		t.Fatal("dashboard gate ignored pinned global tour blur overlay")
	}
}

func TestHomarrBrowserTourRequiresNormalDismissal(t *testing.T) {
	for _, tc := range []struct {
		name, ack       string
		cleared, wantOK bool
	}{
		{"normal Space", `{"success":true,"data":{"pressed":"Space"}}`, true, true},
		{"Enter advances tour", `{"success":true,"data":{"pressed":"Enter"}}`, true, false},
		{"confirmation pending", `{"success":true,"data":{"pressed":"Space","confirmation_required":true}}`, true, false},
		{"overlay persists", `{"success":true,"data":{"pressed":"Space"}}`, false, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
			defer cancel()
			pressed := false
			run := func(_ context.Context, stdin string, args ...string) ([]byte, error) {
				if args[0] == "press" {
					pressed = true
					return []byte(tc.ack), nil
				}
				result := true
				if pressed {
					result = tc.cleared
				}
				return []byte(fmt.Sprintf(`{"success":true,"data":{"result":%t}}`, result)), nil
			}
			err := hfBrowserDismissTour(ctx, run)
			if (err == nil) != tc.wantOK {
				t.Fatal("tour accepted wrong activation or obscured dashboard")
			}
		})
	}
}

func TestHomarrBrowserSubmitRequiresFocusedButtonAndExecutedKey(t *testing.T) {
	for _, tc := range []struct {
		name            string
		focused         bool
		acknowledgement string
		wantOK          bool
	}{
		{"executed", true, `{"success":true,"data":{"pressed":"Enter"}}`, true},
		{"wrong focus", false, `{"success":true,"data":{"pressed":"Enter"}}`, false},
		{"pending confirmation", true, `{"success":true,"data":{"pressed":"Enter","confirmation_required":true}}`, false},
		{"wrong key", true, `{"success":true,"data":{"pressed":"Tab"}}`, false},
		{"missing execution", true, `{"success":true,"data":{}}`, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			pressed := false
			run := func(_ context.Context, stdin string, args ...string) ([]byte, error) {
				if args[0] == "focus" {
					return []byte(`{"success":true}`), nil
				}
				if args[0] == "eval" {
					return []byte(fmt.Sprintf(`{"success":true,"data":{"result":%t}}`, tc.focused)), nil
				}
				if args[0] == "press" {
					pressed = true
					return []byte(tc.acknowledgement), nil
				}
				return nil, errors.New("synthetic-private-command-error")
			}
			err := hfBrowserSubmitLogin(context.Background(), run)
			if (err == nil) != tc.wantOK {
				t.Fatal("native submit accepted an unexecuted or unfocused action")
			}
			if !tc.focused && pressed {
				t.Fatal("key sent before correct button focus was proved")
			}
			if err != nil && strings.Contains(err.Error(), "synthetic-private") {
				t.Fatal("private driver output disclosed")
			}
		})
	}
}

const hfBrowserLoginHydrated = `(() => { const form = document.querySelector('#username')?.form; return !!form && Object.keys(form).some(key => key.startsWith('__reactProps$')); })()`

const hfBrowserControlledValuesAgree = `(() => {
return ['#username','#password'].every(selector => { const input = document.querySelector(selector);
 if (!input?.value) return false; const key = Object.keys(input).find(key => key.startsWith('__reactProps$'));
 return !!key && input[key].value === input.value; }); })()`

// Observe only the three pinned signIn fetches; return the original responses.
// Bodies/headers/URLs and field values are never retained in probe state.
const hfBrowserAuthProbe = `(() => {
const state = { providersCount:0, providersStatus:0, csrfCount:0, csrfStatus:0, callbackCount:0, callbackStatus:0,
 sameOrigin:true, credentialFields:false, transportFailed:false, rejectedCredentials:false, csrfError:false, otherAuthError:false, clickCount:0, trustedClick:false, submitCount:0, credentialsSubmitter:false, submitPrevented:false, invalidCount:0, pageErrorCount:0, rejectionCount:0 };
window.__selfhostAuthProbe = state; const original = window.fetch.bind(window);
// Observe the current login form through the stable document: filling controlled
// fields can rerender it after this probe is installed.
const loginForm = () => document.querySelector('#username')?.form;
document.addEventListener('click', event => { const button = event.target.closest?.('button[name="provider"][value="credentials"]'); if (button?.form && button.form === loginForm()) { state.clickCount++; state.trustedClick = state.trustedClick || event.isTrusted; } }, true);
document.addEventListener('submit', event => { if (event.target !== loginForm()) return; state.submitCount++; state.credentialsSubmitter = event.submitter?.value === 'credentials'; setTimeout(() => { state.submitPrevented = event.defaultPrevented; }, 0); }, true);
document.addEventListener('invalid', event => { if (event.target.form && event.target.form === loginForm()) state.invalidCount++; }, true);
window.addEventListener('error', () => { state.pageErrorCount++; });
window.addEventListener('unhandledrejection', () => { state.rejectionCount++; });
window.fetch = async (input, options) => {
 const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.href);
 const kind = {'/api/auth/providers':'providers','/api/auth/csrf':'csrf','/api/auth/callback/credentials':'callback'}[url.pathname];
 if (!kind) return original(input, options);
 state[kind+'Count']++; state.sameOrigin = state.sameOrigin && url.origin === location.origin;
 if (kind === 'callback') { const fields = new URLSearchParams(options?.body); state.credentialFields = !!fields.get('name') && !!fields.get('password'); }
 try { const response = await original(input, options); state[kind+'Status'] = response.status;
  if (kind === 'callback') { try { const body = await response.clone().json(); const error = new URL(body.url, location.href).searchParams.get('error');
   state.rejectedCredentials = error === 'CredentialsSignin'; state.csrfError = error === 'MissingCSRF' || error === 'CSRF'; state.otherAuthError = !!error && !state.rejectedCredentials && !state.csrfError;
  } catch {} } return response;
 } catch (error) { state.transportFailed = true; throw error; }
}; return true; })()`

// Read only fixed flags: never expose field values, response bodies, page text,
// browser errors, URL/query values, profiles or cookie/session contents.
func hfBrowserLoginDiagnostic(ctx context.Context, run func(context.Context, string, ...string) ([]byte, error), reason string) error {
	script := `(async () => {
const user = document.querySelector('#username'), password = document.querySelector('#password'), form = user?.form;
const button = form?.querySelector('button[name="provider"][value="credentials"]');
const agrees = input => { const key = input && Object.keys(input).find(key => key.startsWith('__reactProps$')); return !!input?.value && !!key && input[key].value === input.value; };
const state = { hydrated: !!form && Object.keys(form).some(key => key.startsWith('__reactProps$')),
 usernameFilled: !!user?.value, passwordFilled: !!password?.value,
 usernameStateAgrees: agrees(user), passwordStateAgrees: agrees(password),
 submitButtonPresent: !!button, submitButtonDisabled: !!button?.disabled || button?.getAttribute('aria-disabled') === 'true', submitButtonLoading: button?.hasAttribute('data-loading') === true, nativeFormValid: form?.matches(':valid') === true,
 formInvalid: !!form?.querySelector('[aria-invalid="true"]'), authRoute: location.pathname.includes('/auth/'),
 dashboardRoute: location.pathname.includes('/boards/'), sessionHTTP: false, sessionUser: false, adminPermission: false };
try { const response = await fetch('/api/auth/session'); state.sessionHTTP = response.ok;
 if (response.ok) { const session = await response.json(); state.sessionUser = !!session.user?.id; state.adminPermission = session.user?.permissions?.includes('admin') === true; }
} catch {} return { ...state, ...window.__selfhostAuthProbe }; })()`
	output, err := run(ctx, script, "eval", "--stdin")
	return hfBrowserLoginDiagnosticResult(reason, output, err)
}

func hfBrowserLoginDiagnosticResult(reason string, output []byte, err error) error {
	var response struct {
		Success bool
		Data    struct {
			Result struct {
				Hydrated, UsernameFilled, PasswordFilled, FormInvalid, AuthRoute, DashboardRoute, SessionHTTP, SessionUser, AdminPermission             bool
				UsernameStateAgrees, PasswordStateAgrees, SameOrigin, CredentialFields, TransportFailed, RejectedCredentials, CSRFError, OtherAuthError bool
				TrustedClick, CredentialsSubmitter, SubmitPrevented, SubmitButtonPresent, SubmitButtonDisabled, SubmitButtonLoading, NativeFormValid    bool
				ClickCount, SubmitCount, InvalidCount, PageErrorCount, RejectionCount                                                                   int
				ProvidersCount, ProvidersStatus, CSRFCount, CSRFStatus, CallbackCount, CallbackStatus                                                   int
			}
		}
	}
	if err != nil || json.Unmarshal(output, &response) != nil || !response.Success {
		return fmt.Errorf("%s; browser state unavailable", reason)
	}
	state := response.Data.Result
	diagnostic := fmt.Sprintf("%s; hydrated=%t, username_filled=%t, password_filled=%t, form_invalid=%t, auth_route=%t, dashboard_route=%t, session_http=%t, session_user=%t, admin_permission=%t, username_state_agrees=%t, password_state_agrees=%t, providers_count=%d, providers_status=%d, csrf_count=%d, csrf_status=%d, callback_count=%d, callback_status=%d, same_origin=%t, credential_fields=%t, transport_failed=%t, rejected_credentials=%t, csrf_error=%t, other_auth_error=%t", reason, state.Hydrated, state.UsernameFilled, state.PasswordFilled, state.FormInvalid, state.AuthRoute, state.DashboardRoute, state.SessionHTTP, state.SessionUser, state.AdminPermission, state.UsernameStateAgrees, state.PasswordStateAgrees, state.ProvidersCount, state.ProvidersStatus, state.CSRFCount, state.CSRFStatus, state.CallbackCount, state.CallbackStatus, state.SameOrigin, state.CredentialFields, state.TransportFailed, state.RejectedCredentials, state.CSRFError, state.OtherAuthError)
	return fmt.Errorf("%s; click_count=%d, trusted_click=%t, submit_count=%d, credentials_submitter=%t, submit_prevented=%t, invalid_count=%d, page_error_count=%d, rejection_count=%d, submit_button_present=%t, submit_button_disabled=%t, submit_button_loading=%t, native_form_valid=%t", diagnostic, state.ClickCount, state.TrustedClick, state.SubmitCount, state.CredentialsSubmitter, state.SubmitPrevented, state.InvalidCount, state.PageErrorCount, state.RejectionCount, state.SubmitButtonPresent, state.SubmitButtonDisabled, state.SubmitButtonLoading, state.NativeFormValid)
}

func TestHomarrBrowserLoginDiagnosticExcludesUntrustedValues(t *testing.T) {
	output := []byte(`{"success":true,"data":{"result":{"hydrated":true,"usernameFilled":true,"passwordFilled":true,"authRoute":true,"private":"synthetic-private-browser-state"},"private":"synthetic-private-browser-response"},"error":"synthetic-private-browser-error"}`)
	err := hfBrowserLoginDiagnosticResult("fixed login failure", output, nil)
	if strings.Contains(err.Error(), "synthetic-private") || !strings.Contains(err.Error(), "hydrated=true") || !strings.Contains(err.Error(), "session_user=false") {
		t.Fatal("browser diagnostics leaked private data or lost the fixed state flags")
	}
	err = hfBrowserLoginDiagnosticResult("fixed login failure", nil, errors.New("synthetic-private-command-error"))
	if strings.Contains(err.Error(), "synthetic-private") || !strings.Contains(err.Error(), "state unavailable") {
		t.Fatal("browser command errors entered public evidence")
	}
}

func TestHomarrBrowserProbePreservesFetchAndExcludesCredentialValues(t *testing.T) {
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("static browser script fixture requires installed Node")
	}
	probe, _ := json.Marshal(hfBrowserAuthProbe)
	controlled, _ := json.Marshal(hfBrowserControlledValuesAgree)
	script := `globalThis.location = {href:'http://127.0.0.1:8080/auth/login',origin:'http://127.0.0.1:8080'};
const originalResponse = {status:401,clone:()=>({json:async()=>({url:'http://127.0.0.1:8080/auth/login?error=CredentialsSignin',private:'synthetic-private-response'})})};
let receivedInput, receivedOptions;
globalThis.document = {querySelector:()=>null,addEventListener:()=>{}};
globalThis.window = {addEventListener:()=>{}, fetch:async(input,options)=>{receivedInput=input;receivedOptions=options;return originalResponse;}};
if (!eval(` + string(probe) + `)) throw Error('probe initialization failed');
const options={body:new URLSearchParams({name:'synthetic-private-name',password:'synthetic-private-password'}),headers:{private:'synthetic-private-header'}};
const input='/api/auth/callback/credentials';
const response=await window.fetch(input,options);
const state=window.__selfhostAuthProbe;
if(response!==originalResponse || receivedInput!==input || receivedOptions!==options) throw Error('fetch transport altered');
if(state.callbackCount!==1 || state.callbackStatus!==401 || !state.sameOrigin || !state.credentialFields || !state.rejectedCredentials) throw Error('fixed metadata lost');
if(JSON.stringify(state).includes('synthetic-private')) throw Error('private request or response retained');
const user={value:'synthetic-private-name','__reactProps$fixture':{value:'synthetic-private-name'}};
const password={value:'synthetic-private-password','__reactProps$fixture':{value:'synthetic-private-password'}};
globalThis.document={querySelector:selector=>selector==='#username'?user:password};
if(!eval(` + string(controlled) + `)) throw Error('valid controlled inputs rejected');
password.__reactProps$fixture.value='';
if(eval(` + string(controlled) + `)) throw Error('DOM-only password accepted');`
	command := exec.Command(node, "--input-type=module")
	command.Stdin = strings.NewReader(script)
	if err := command.Run(); err != nil {
		t.Fatal("static browser probe changed transport, leaked values, or accepted uncommitted controlled inputs")
	}
}

func TestHomarrBrowserProbeObservesReplacedLoginForm(t *testing.T) {
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("static browser script fixture requires installed Node")
	}
	probe, _ := json.Marshal(hfBrowserAuthProbe)
	script := `globalThis.location = {href:'http://127.0.0.1/auth/login',origin:'http://127.0.0.1'};
 const listeners = {};
 let currentForm = {addEventListener:()=>{}};
 globalThis.document = {querySelector:()=>({form:currentForm}),addEventListener:(kind,listener)=>{listeners[kind]=listener;}};
 globalThis.window = {addEventListener:()=>{},fetch:async()=>({status:200})};
 eval(` + string(probe) + `);
 currentForm = {};
 const button = {form:currentForm,value:'credentials'};
 if (!listeners.click || !listeners.submit || !listeners.invalid) throw Error('observer tied to replaceable form');
 listeners.click({target:{closest:()=>button},isTrusted:true});
 const event = {target:currentForm,submitter:button,defaultPrevented:false};
 listeners.submit(event); event.defaultPrevented=true;
 listeners.invalid({target:{form:currentForm}});
 listeners.click({target:{closest:()=>({form:{}})},isTrusted:true});
 listeners.submit({target:{},defaultPrevented:false});
 listeners.invalid({target:{form:{}}});
 await new Promise(resolve=>setTimeout(resolve,10));
 const state=window.__selfhostAuthProbe;
 if(state.clickCount!==1 || !state.trustedClick || state.submitCount!==1 || !state.credentialsSubmitter || !state.submitPrevented || state.invalidCount!==1) throw Error('current login form events lost or unrelated form counted');`
	command := exec.Command(node, "--input-type=module")
	command.Stdin = strings.NewReader(script)
	if err := command.Run(); err != nil {
		t.Fatal("browser probe did not follow replaced login form or isolate its events")
	}
}

// agent-browser v0.34 selector screenshots pass viewport-relative bounding
// rect coordinates directly to Page.captureScreenshot's document-space clip.
// At scroll origin the coordinate spaces agree; wait for two layout frames.
const hfBrowserCaptureAtOrigin = `(async () => { window.scrollTo(0, 0);
await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame);
return window.scrollX === 0 && window.scrollY === 0; })()`

const hfBrowserWidgetVisible = `(c) => { if (window.scrollX !== 0 || window.scrollY !== 0) return false; const el = document.querySelector(c.selector); if (!el) return false;
if (document.querySelector('[data-onboarding-tour-overlay], [data-onboarding-tour-focus-reveal-overlay], [aria-modal="true"], [inert]')) return false;
if (el.closest('[aria-hidden="true"]')) return false;
const rect = el.getBoundingClientRect(), style = getComputedStyle(el);
if (!rect.width || !rect.height || rect.top < 0 || rect.left < 0 || rect.bottom > innerHeight || rect.right > innerWidth || style.visibility === 'hidden' || style.display === 'none') return false;
if (!c.checks.every(text => el.innerText.includes(text))) return false;
return !c.notebook || c.links.every(url => Array.from(el.querySelectorAll('a')).some(a => a.href === url || a.href === url + '/')); }`

// Keep the real board in view so lazy widget rendering and driver crops both
// cover visible content. Never expand beyond the owned 1440x4096 bound.
const hfBrowserWidgetDocumentBottom = `(() => {
const widgets = Array.from(document.querySelectorAll('[data-grid-item-id]'));
if (!widgets.length) return 0;
return Math.ceil(Math.max(...widgets.map(widget => widget.getBoundingClientRect().bottom + window.scrollY))); })()`

const hfBrowserCaptureGeometryFits = `(height) => window.scrollX === 0 && window.scrollY === 0 &&
innerWidth === 1440 && innerHeight === height &&
Array.from(document.querySelectorAll('[data-grid-item-id]')).every(widget => {
 const rect = widget.getBoundingClientRect();
 return rect.width > 0 && rect.height > 0 && rect.top >= 0 && rect.left >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight;
})`

func hfBrowserFitCaptureViewport(ctx context.Context, run func(context.Context, string, ...string) ([]byte, error)) error {
	// Measure after fixing width: the grid's square cells resize with its width.
	if _, err := run(ctx, "", "set", "viewport", "1440", "1100"); err != nil {
		return errors.New("browser initial capture width could not be established")
	}
	if !hfBrowserBoolean(ctx, run, hfBrowserCaptureAtOrigin) {
		return hfBrowserCaptureGeometryDiagnostic(ctx, run, "browser initial capture origin could not be established")
	}
	output, err := run(ctx, hfBrowserWidgetDocumentBottom, "eval", "--stdin")
	var response struct {
		Success bool
		Data    struct{ Result int }
	}
	if err != nil || json.Unmarshal(output, &response) != nil || !response.Success || response.Data.Result <= 0 || response.Data.Result > 4032 {
		return hfBrowserCaptureGeometryDiagnostic(ctx, run, "browser widget bounds exceed the bounded capture viewport")
	}
	// Padding/min-height may keep document.scrollHeight larger than the viewport.
	// Fit the actual widget bounds plus a bounded64px margin, not the body floor.
	height := response.Data.Result + 64
	if height < 1100 {
		height = 1100
	}
	if _, err := run(ctx, "", "set", "viewport", "1440", strconv.Itoa(height)); err != nil {
		return errors.New("browser bounded capture viewport could not be applied")
	}
	if !hfBrowserBoolean(ctx, run, hfBrowserCaptureAtOrigin) || !hfBrowserBoolean(ctx, run, "("+hfBrowserCaptureGeometryFits+")("+strconv.Itoa(height)+")") {
		return hfBrowserCaptureGeometryDiagnostic(ctx, run, "browser widgets did not fit the applied capture viewport")
	}
	return nil
}

func hfBrowserCaptureGeometryDiagnostic(ctx context.Context, run func(context.Context, string, ...string) ([]byte, error), reason string) error {
	script := `(() => { const widgets=Array.from(document.querySelectorAll('[data-grid-item-id]'));
 return {width:Math.ceil(innerWidth),height:Math.ceil(innerHeight),documentHeight:Math.ceil(document.scrollingElement?.scrollHeight ?? 0),
 widgetBottom:Math.ceil(Math.max(0,...widgets.map(widget=>widget.getBoundingClientRect().bottom))),scrollX:Math.ceil(window.scrollX),scrollY:Math.ceil(window.scrollY)}; })()`
	output, err := run(ctx, script, "eval", "--stdin")
	var response struct {
		Success bool
		Data    struct {
			Result struct{ Width, Height, DocumentHeight, WidgetBottom, ScrollX, ScrollY int }
		}
	}
	if err != nil || json.Unmarshal(output, &response) != nil || !response.Success {
		return fmt.Errorf("%s; numeric_geometry_unavailable=true", reason)
	}
	g := response.Data.Result
	for _, n := range []int{g.Width, g.Height, g.DocumentHeight, g.WidgetBottom, g.ScrollX, g.ScrollY} {
		if n < 0 || n > 100000 {
			return fmt.Errorf("%s; numeric_geometry_unavailable=true", reason)
		}
	}
	return fmt.Errorf("%s; width=%d, height=%d, document_height=%d, widget_bottom=%d, scroll_x=%d, scroll_y=%d", reason, g.Width, g.Height, g.DocumentHeight, g.WidgetBottom, g.ScrollX, g.ScrollY)
}

const hfBrowserAppIconsReady = `(selectors) => selectors.length > 0 && selectors.every(selector => {
const tile = document.querySelector(selector); if (!tile) return false;
const images = Array.from(tile.querySelectorAll('img'));
return images.length > 0 && images.every(image => image.complete && image.naturalWidth > 0); })`

func TestHomarrBrowserAppIconsMustActuallyLoad(t *testing.T) {
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("static browser script fixture requires installed Node")
	}
	probe, _ := json.Marshal(hfBrowserAppIconsReady)
	script := `let images=[{complete:true,naturalWidth:32}];
 globalThis.document={querySelector:()=>({querySelectorAll:()=>images})};
 if(!eval(` + string(probe) + `)(["owned-public-tile"])) throw Error('loaded App icon rejected');
 images=[{complete:true,naturalWidth:0}];if(eval(` + string(probe) + `)(["owned-public-tile"])) throw Error('broken App icon accepted');
 images=[{complete:false,naturalWidth:32}];if(eval(` + string(probe) + `)(["owned-public-tile"])) throw Error('pending App icon accepted');
 images=[];if(eval(` + string(probe) + `)(["owned-public-tile"])) throw Error('missing App icon accepted');`
	command := exec.Command(node, "--input-type=module")
	command.Stdin = strings.NewReader(script)
	if err := command.Run(); err != nil {
		t.Fatal("App icon acceptance did not distinguish loaded images from broken or missing images")
	}
}

func TestHomarrBrowserCaptureRequiresRenderedContentAfterResize(t *testing.T) {
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("static browser script fixture requires installed Node")
	}
	gate, _ := json.Marshal(hfBrowserWidgetVisible)
	script := `let rendered=false;let bottom=1600;
 globalThis.innerWidth=1440;globalThis.innerHeight=1100;globalThis.window={scrollX:0,scrollY:0};
 const tile={closest:()=>null,getBoundingClientRect:()=>({width:568,height:426,top:1200,left:20,right:588,bottom}),get innerText(){return rendered?'Selfhost E2E Tone':''}};
 globalThis.document={querySelector:selector=>selector==='owned-media'?tile:null};
 globalThis.getComputedStyle=()=>({visibility:'visible',display:'block'});
 const check=eval(` + string(gate) + `);const c={selector:'owned-media',checks:['Selfhost E2E Tone'],notebook:false};
 if(check(c)) throw Error('offscreen widget accepted');
 innerHeight=2068;if(check(c)) throw Error('unrendered content accepted after resize');
 rendered=true;if(!check(c)) throw Error('fully visible rendered content rejected');
 window.scrollY=100;if(check(c)) throw Error('late vertical scroll accepted');window.scrollY=0;
 window.scrollX=20;if(check(c)) throw Error('late horizontal scroll accepted');window.scrollX=0;
 bottom=2100;if(check(c)) throw Error('partially offscreen content accepted');`
	command := exec.Command(node, "--input-type=module")
	command.Stdin = strings.NewReader(script)
	if err := command.Run(); err != nil {
		t.Fatal("capture accepted offscreen or unrendered content after viewport resize")
	}
}

func TestHomarrBrowserCaptureFitsWidgetBoundsDespiteBodyFloor(t *testing.T) {
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("static browser script fixture requires installed Node")
	}
	bounds, _ := json.Marshal(hfBrowserWidgetDocumentBottom)
	fits, _ := json.Marshal(hfBrowserCaptureGeometryFits)
	script := `globalThis.window={scrollX:0,scrollY:0};globalThis.innerWidth=1440;globalThis.innerHeight=2064;
 let bottom=2000;globalThis.document={scrollingElement:{scrollHeight:9000},querySelectorAll:()=>[{getBoundingClientRect:()=>({width:500,height:800,top:1200,left:20,right:520,bottom})}]};
 if(eval(` + string(bounds) + `)!==2000) throw Error('body floor used for widget bounds');
 const fit=eval(` + string(fits) + `);if(!fit(2064)) throw Error('visible widgets rejected because body is taller');
 bottom=2100;if(fit(2064)) throw Error('cropped widget accepted');bottom=2000;
 innerWidth=1280;if(fit(2064)) throw Error('wrong responsive width accepted');innerWidth=1440;
 innerHeight=2164;if(fit(2064)) throw Error('wrong height accepted');innerHeight=2064;
 window.scrollY=1;if(fit(2064)) throw Error('scrolled crop accepted');`
	command := exec.Command(node, "--input-type=module")
	command.Stdin = strings.NewReader(script)
	if err := command.Run(); err != nil {
		t.Fatal("capture geometry confused document floor with visible widget bounds")
	}
}

func TestHomarrBrowserCaptureGeometryDiagnosticExcludesPrivateFields(t *testing.T) {
	run := func(_ context.Context, _ string, _ ...string) ([]byte, error) {
		return []byte(`{"success":true,"data":{"result":{"width":1440,"height":2064,"documentHeight":2128,"widgetBottom":2000,"scrollX":0,"scrollY":0,"private":"synthetic-private-value"}},"error":"synthetic-private-error"}`), nil
	}
	err := hfBrowserCaptureGeometryDiagnostic(context.Background(), run, "fixed geometry failure")
	if strings.Contains(err.Error(), "synthetic-private") || !strings.Contains(err.Error(), "widget_bottom=2000") {
		t.Fatal("geometry diagnostics exposed private fields or lost bounded metrics")
	}
}

func TestHomarrBrowserCaptureViewportIsBoundedAndVerified(t *testing.T) {
	for _, tc := range []struct {
		name         string
		height       int
		fits, wantOK bool
	}{
		{"board fits", 2068, true, true}, {"small board", 800, true, true}, {"maximum", 4032, true, true},
		{"oversize", 4033, true, false}, {"invalid", 0, true, false}, {"resize ineffective", 2068, false, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			sets := 0
			measured := false
			run := func(_ context.Context, stdin string, args ...string) ([]byte, error) {
				if args[0] == "set" {
					sets++
					if args[2] != "1440" {
						t.Fatal("capture changed dashboard width")
					}
					n, _ := strconv.Atoi(args[3])
					if n < 1100 || n > 4096 {
						t.Fatal("capture size outside owned bound")
					}
					return []byte(`{"success":true}`), nil
				}
				if stdin == hfBrowserCaptureAtOrigin {
					return []byte(`{"success":true,"data":{"result":true}}`), nil
				}
				if !measured {
					if sets != 1 {
						t.Fatal("capture measured responsive widget bounds before fixed width was applied")
					}
					measured = true
					return []byte(fmt.Sprintf(`{"success":true,"data":{"result":%d}}`, tc.height)), nil
				}
				return []byte(fmt.Sprintf(`{"success":true,"data":{"result":%t}}`, tc.fits)), nil
			}
			err := hfBrowserFitCaptureViewport(context.Background(), run)
			if (err == nil) != tc.wantOK {
				t.Fatal("capture accepted invalid bounds or ineffective viewport change")
			}
			if (tc.height <= 0 || tc.height > 4032) && sets > 1 {
				t.Fatal("invalid height applied")
			}
		})
	}
}

func TestHomarrBrowserCaptureUsesDocumentOrigin(t *testing.T) {
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("static browser script fixture requires installed Node")
	}
	reset, _ := json.Marshal(hfBrowserCaptureAtOrigin)
	script := `let frames=0;
 globalThis.window={scrollX:0,scrollY:240,scrollTo:(x,y)=>{window.scrollX=x;window.scrollY=y;}};
 globalThis.requestAnimationFrame=callback=>{frames++;setTimeout(callback,0);};
 const target={documentY:400,getBoundingClientRect(){return {y:this.documentY-window.scrollY}}};
 if(target.getBoundingClientRect().y===target.documentY) throw Error('fixture did not model offset crop');
 if(!await eval(` + string(reset) + `)) throw Error('origin not established');
 if(frames!==2 || target.getBoundingClientRect().y!==target.documentY) throw Error('viewport clip remains at wrong document location');`
	command := exec.Command(node, "--input-type=module")
	command.Stdin = strings.NewReader(script)
	if err := command.Run(); err != nil {
		t.Fatal("selector capture still uses scrolled viewport coordinates")
	}
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
		return hfCommandFailure(r, res, args)
	}
	return nil
}

// Retain only structured Logger failures. Raw streams and command arguments
// are private; the operation label comes from this scenario's fixed commands.
func hfCommandFailure(r *runner, res result, args []string) error {
	operation := "owned-operation"
	if len(args) > 0 {
		switch args[0] {
		case "install", "remove":
			if len(args) > 1 {
				for _, id := range []string{"homarr", "ntfy", "jellyfin", "gatus"} {
					if args[1] == id {
						operation = args[0] + "-" + id
					}
				}
			}
		case "setup":
			operation = "setup-selection"
			if len(args) > 1 && args[1] == "homarr" {
				operation = "setup-homarr"
			}
		case "restart":
			operation = "restart-selection"
		case "config":
			operation = "update-selected-lan-metadata"
		}
	}
	owned := append(slices.Clone(r.spec.Apps), "gatus")
	failures := redactedFailures(res.events, owned)
	for i := range r.evidence.Stages {
		stage := &r.evidence.Stages[i]
		if stage.Outcome != "running" {
			continue
		}
		stage.Command = []string{operation}
		stage.Termination = res.termination
		stage.Failures = append(stage.Failures, failures...)
		break
	}
	return fmt.Errorf("owned functional CLI operation %s failed: exit=%d; redacted failures=%d", operation, res.code, len(failures))
}

func TestHomarrCommandFailureRetainsOwnedEventsWithoutRawStreams(t *testing.T) {
	r := &runner{spec: targetSpec{Apps: []string{"homarr", "ntfy", "jellyfin"}}, evidence: &targetEvidence{}}
	r.evidence.Stages = []stageEvidence{{Name: "add-remove", Outcome: "running"}}
	res := result{code: 2, stdout: "synthetic-private-stdout", stderr: "synthetic-private-stderr", events: []event{
		{Event: "step.fail", App: "gatus", Step: "check", Error: "fixed redacted failure", Hint: "supported retry"},
		{Event: "step.fail", App: "unowned", Step: "check", Error: "synthetic-private-unowned"},
	}}
	err := hfCommandFailure(r, res, []string{"install", "gatus", "--set", "private=synthetic-private-argument"})
	raw, marshalErr := json.Marshal(r.evidence.Stages)
	if marshalErr != nil {
		t.Fatal(marshalErr)
	}
	output := string(raw) + err.Error()
	if strings.Contains(output, "synthetic-private") {
		t.Fatal("raw streams, private arguments or unowned failures entered public evidence")
	}
	stage := r.evidence.Stages[0]
	if len(stage.Failures) != 1 || stage.Failures[0].App != "gatus" || stage.Failures[0].Hint != "supported retry" || !strings.Contains(err.Error(), "install-gatus") || !strings.Contains(err.Error(), "exit=2") {
		t.Fatal("owned failure lost its precise operation or supported recovery evidence")
	}
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
	ID, Name, Href                string
	PingURL, Description, IconURL *string
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
	ID, Name         string
	CreatorID        json.RawMessage `json:"creatorId"`
	SummaryCreatorID string          `json:"-"`
	PageTitle        *string
	IsPublic         bool
	Items            []hfItem
}
type hfInventory struct {
	Apps         []hfApp
	Integrations []hfIntegration
	Board        hfBoard
}

func hfReadInventory(ctx context.Context, client *http.Client, base, key string) (hfInventory, error) {
	var inv hfInventory
	var boards []struct {
		ID, Name string
		IsPublic bool
		Creator  *struct{ ID string }
	}
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
	if inv.Board.IsPublic != boards[0].IsPublic {
		return inv, errors.New("REST and tRPC Home board visibility differs")
	}
	if boards[0].Creator != nil {
		inv.Board.SummaryCreatorID = boards[0].Creator.ID
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
	if inv.Board.ID == "" || inv.Board.Name != "Home" || inv.Board.IsPublic {
		return errors.New("private Home board identity or visibility differs from the selected dashboard")
	}
	if err := inv.validateAppRecords(expected); err != nil {
		return err
	}
	appIDs := map[string]bool{}
	for _, id := range expected {
		app := inv.appFor(id)
		if app.ID == "" || appIDs[app.ID] || app.Href != fmt.Sprintf("http://127.0.0.1:%d", ports[id]) {
			return errors.New("managed App tile URL is missing, duplicated or not browser-reachable")
		}
		appIDs[app.ID] = true
		if app.PingURL == nil || id == "ntfy" && *app.PingURL != "http://ntfy:80" || id == "jellyfin" && *app.PingURL != "http://jellyfin:8096" {
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
	if slices.Contains(expected, "gatus") {
		expectedIntegrations["gatus"] = []string{"stats"}
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
					if widget == "stats" && !hfGeneratedStatsMatches(item, kind, id) {
						return errors.New("generated stats entries differ from the selected integration metrics")
					}
					count++
				}
			}
			if count != 1 {
				return errors.New("generated integration widget is missing or duplicated")
			}
		}
	}
	// App records have already passed the strict upstream bookmark contract.
	seedIDs := map[string]bool{}
	for _, app := range inv.Apps {
		if app.Description == nil {
			seedIDs[app.ID] = true
		}
	}
	defaultWidgets := map[string]int{}
	itemIDs := map[string]bool{}
	notebooks := 0
	tiles := map[string]int{}
	for _, item := range inv.Board.Items {
		if item.ID == "" || itemIDs[item.ID] {
			return errors.New("board item identity is missing or duplicated")
		}
		itemIDs[item.ID] = true
		if item.Kind == "clock" || item.Kind == "weather" || item.Kind == "bookmarks" {
			if !hfSeedWidgetMatches(item, seedIDs) {
				return fmt.Errorf("upstream default widget shape differs from the source seed: kind=%s, option count=%d, integration count=%d", item.Kind, len(item.Options), len(item.IntegrationIDs))
			}
			defaultWidgets[item.Kind]++
			continue
		}
		for _, id := range item.IntegrationIDs {
			if !integrationIDs[id] {
				return errors.New("orphan integration widget survived reconciliation")
			}
		}
		if item.Kind == "app" {
			id, _ := item.Options["appId"].(string)
			if !appIDs[id] && !seedIDs[id] {
				return errors.New("orphan App tile survived reconciliation")
			}
			if len(item.IntegrationIDs) != 0 {
				return errors.New("App tile has an unexpected integration")
			}
			if seedIDs[id] && (len(item.Options) != 3 || !hfOpensInNewTab(item.Options) || item.Options["showTitle"] != true) {
				return errors.New("upstream bookmark tile shape differs from the source seed")
			}
			if appIDs[id] && (len(item.Options) != 3 || !hfOpensInNewTab(item.Options) || item.Options["showTitle"] != true) {
				return errors.New("managed App tile flags differ from the generated configuration")
			}
			tiles[id]++
			continue
		}
		if item.Kind == "assistant" && len(item.IntegrationIDs) == 0 {
			continue
		}
		if item.Kind != "notebook" {
			if len(item.IntegrationIDs) == 0 || len(item.IntegrationIDs) > 1 && item.Kind != "stats" {
				return errors.New("unexpected board widget survived reconciliation")
			}
			for _, integrationID := range item.IntegrationIDs {
				kind := ""
				for _, integration := range inv.Integrations {
					if integration.ID == integrationID {
						kind = integration.Kind
					}
				}
				if !slices.Contains(expectedIntegrations[kind], item.Kind) {
					return errors.New("unexpected board widget survived reconciliation")
				}
			}
			continue
		}
		if len(item.IntegrationIDs) != 0 {
			return errors.New("notebook has an unexpected integration")
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
	for _, kind := range []string{"clock", "weather", "bookmarks"} {
		if defaultWidgets[kind] != 1 {
			return fmt.Errorf("upstream default widget is missing or duplicated: clock=%d, weather=%d, bookmarks=%d", defaultWidgets["clock"], defaultWidgets["weather"], defaultWidgets["bookmarks"])
		}
	}
	for id := range seedIDs {
		if tiles[id] != 1 {
			return errors.New("upstream bookmark tile is missing or duplicated")
		}
	}
	for id := range appIDs {
		if tiles[id] != 1 {
			return errors.New("managed App tile is missing or duplicated")
		}
	}
	return nil
}

// Homarr persists the tile's new-tab flag as openIn: "newTab" and still
// accepts the legacy openInNewTab: true that self-host sends.
func hfOpensInNewTab(options map[string]any) bool {
	return options["openIn"] == "newTab" || options["openInNewTab"] == true
}

// The owning Homarr targets declare visible, noncompact metrics: ntfy
// messages, Jellyfin sessions and Gatus up/down/unknown/total. Entry IDs are
// auto-stack- followed by the first 32 hex characters of
// SHA256(integrationID + ":" + metric), as statsEntryID specifies. All
// integrations share one stats widget, so each contributes its own entries.
func hfGeneratedStatsMatches(item hfItem, kind, integrationID string) bool {
	var metrics []string
	switch kind {
	case "ntfy":
		metrics = []string{"messages"}
	case "jellyfin":
		metrics = []string{"sessions"}
	case "gatus":
		metrics = []string{"up", "down", "unknown", "total"}
	default:
		return false
	}
	entries, ok := item.Options["entries"].([]any)
	if !ok || len(item.Options) != 1 {
		return false
	}
	seen := map[string]bool{}
	for _, raw := range entries {
		entry, ok := raw.(map[string]any)
		if !ok || entry["integrationId"] != integrationID {
			continue
		}
		metric, _ := entry["metric"].(string)
		sum := sha256.Sum256([]byte(integrationID + ":" + metric))
		entryID := "auto-stack-" + hex.EncodeToString(sum[:])[:32]
		if seen[metric] || !slices.Contains(metrics, metric) || len(entry) != 6 || entry["id"] != entryID || entry["label"] != "" || entry["hidden"] != false || entry["compact"] != false {
			return false
		}
		seen[metric] = true
	}
	return len(seen) == len(metrics)
}

// seedBoardWidgetsAsync/placeAllWidgetsAsync retain four bookmark App tiles
// and exactly the three general defaultWidgetConfigs. board.getBoardByName
// returns their persisted options without injecting schema defaults.
// Ordinary seeding adds no notebook; the CLI owns its recap notebook.
// Verified at image revision eb1d449dca35991013843683bee5aafd53a99cc0
// (image sha256:4c446d8ebadc1756a54cf8c575aa547504a1760abb56738ae30426321e7accaa).
func hfSeedWidgetMatches(item hfItem, seedIDs map[string]bool) bool {
	if len(item.IntegrationIDs) != 0 {
		return false
	}
	switch item.Kind {
	case "clock":
		return len(item.Options) == 0
	case "weather":
		return len(item.Options) == 3 && item.Options["showHumidity"] == false && item.Options["showCity"] == false && item.Options["hasForecast"] == false
	case "bookmarks":
		if len(item.Options) != 4 || item.Options["title"] != "Useful Links" || item.Options["layout"] != "grid" || item.Options["openNewTab"] != true {
			return false
		}
		ids, ok := item.Options["items"].([]any)
		if !ok || len(ids) != len(seedIDs) {
			return false
		}
		seen := map[string]bool{}
		for _, value := range ids {
			id, ok := value.(string)
			if !ok || !seedIDs[id] || seen[id] {
				return false
			}
			seen[id] = true
		}
		return true
	}
	return false
}

// GET /api/apps contains all bookmarks, including these four upstream seeds.
// Seed records remain separate from the exact installed App/tile selection.
// Source: Homarr definitions/widget-integration-map.ts defaultBookmarkApps and
// db/migrations/seed.ts seedDefaultAppsAsync; no arbitrary extras are accepted.
func (inv hfInventory) validateAppRecords(expected []string) error {
	seeds := map[string]string{
		"Homarr Docs":    "https://homarr.dev/docs/getting-started",
		"Homarr GitHub":  "https://github.com/homarr-labs/homarr",
		"Help Translate": "https://homarr.dev/docs/community/translations",
		"Support Homarr": "https://opencollective.com/homarr",
	}
	managed := map[string]int{}
	seedCounts := map[string]int{}
	identities := map[string]bool{}
	unknown, invalidSeed, duplicates := 0, 0, 0
	for _, app := range inv.Apps {
		if app.ID == "" || identities[app.ID] {
			duplicates++
		}
		identities[app.ID] = true
		if app.Description != nil && strings.HasPrefix(*app.Description, "self-host tile:") {
			id := strings.TrimPrefix(*app.Description, "self-host tile:")
			if !slices.Contains(expected, id) {
				unknown++
				continue
			}
			managed[id]++
			continue
		}
		href, known := seeds[app.Name]
		if !known {
			unknown++
			continue
		}
		if app.Href != href || app.Description != nil || app.PingURL != nil {
			invalidSeed++
			continue
		}
		seedCounts[app.Name]++
	}
	missing := []string{}
	for _, id := range expected {
		if managed[id] == 0 {
			missing = append(missing, id) // Fixed scenario selections, never response names.
		} else if managed[id] != 1 {
			duplicates++
		}
	}
	missingSeeds := 0
	for name := range seeds {
		if seedCounts[name] == 0 {
			missingSeeds++
		} else if seedCounts[name] != 1 {
			duplicates++
		}
	}
	if len(inv.Apps) != len(expected)+len(seeds) || len(missing) != 0 || missingSeeds != 0 || unknown != 0 || invalidSeed != 0 || duplicates != 0 {
		return fmt.Errorf("dashboard App inventory mismatch: expected managed=%d and upstream seeds=4, actual total=%d, missing selected=%v, missing seeds=%d, unknown extras=%d, invalid seeds=%d, duplicates=%d", len(expected), len(inv.Apps), missing, missingSeeds, unknown, invalidSeed, duplicates)
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
