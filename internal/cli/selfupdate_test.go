package cli_test

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/ajnart/self-host/internal/catalog"
	"github.com/ajnart/self-host/internal/clitest"
	"github.com/ajnart/self-host/internal/system"
	"github.com/ajnart/self-host/internal/systemtest"
)

// fakeRelease serves the GitHub Releases API, the github.com "latest"
// redirect and the downloadable assets of one release.
type fakeRelease struct {
	tag            string
	binary         string
	checksum       string // overrides the real sha256 when set
	noAsset        bool
	apiError       int
	noRedirect     bool          // github.com/.../releases/latest answers 404
	archiveDelay   time.Duration // slow link
	archives       int           // archive downloads served
	apiCalls       int
	downloadAccept string // Accept header of the last archive download
}

func tarGz(t *testing.T, files map[string]string) []byte {
	t.Helper()
	var buf bytes.Buffer
	gz := gzip.NewWriter(&buf)
	tw := tar.NewWriter(gz)
	for name, body := range files {
		if err := tw.WriteHeader(&tar.Header{Name: name, Mode: 0o755, Size: int64(len(body))}); err != nil {
			t.Fatal(err)
		}
		tw.Write([]byte(body))
	}
	tw.Close()
	gz.Close()
	return buf.Bytes()
}

func (f *fakeRelease) server(t *testing.T, goos, goarch string) *httptest.Server {
	t.Helper()
	version := strings.TrimPrefix(strings.TrimPrefix(f.tag, "new-cli-"), "v")
	name := fmt.Sprintf("self-host_%s_%s_%s.tar.gz", version, goos, goarch)
	archive := tarGz(t, map[string]string{"LICENSE": "MIT", "self-host": f.binary})
	sum := sha256.Sum256(archive)
	digest := hex.EncodeToString(sum[:])
	if f.checksum != "" {
		digest = f.checksum
	}
	download := "/web/releases/download/" + f.tag + "/"
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/releases":
			f.apiCalls++
			if f.apiError != 0 {
				w.WriteHeader(f.apiError)
				return
			}
			fmt.Fprintf(w, `[{"tag_name":"v99.0.0","assets":[{"name":"CLI-SHA256SUMS"},{"name":"selfhost-skills-99.0.0.zip"}]},{"tag_name":%q,"assets":[{"id":1,"name":"checksums.txt"},{"id":2,"name":%q}]}]`, f.tag, name)
		case "/web/releases/latest":
			if f.noRedirect {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			http.Redirect(w, r, "/web/releases/tag/"+f.tag, http.StatusFound)
		case "/web/releases/tag/" + f.tag:
			w.WriteHeader(http.StatusOK)
		case download + "checksums.txt":
			fmt.Fprintf(w, "%s  other_file.tar.gz\n%s  %s\n", strings.Repeat("0", 64), digest, name)
		case download + name:
			if f.noAsset {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			f.archives++
			f.downloadAccept = r.Header.Get("Accept")
			time.Sleep(f.archiveDelay)
			w.Write(archive)
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	t.Cleanup(server.Close)
	return server
}

// updateDeps is a Linux/amd64 host whose binary is a file in a temp dir.
func updateDeps(t *testing.T, version string, server *httptest.Server) (*system.Deps, string) {
	t.Helper()
	deps := systemtest.NewDeps(t)
	deps.Version = version
	deps.GOARCH = "amd64"
	exe := filepath.Join(t.TempDir(), "self-host")
	if err := os.WriteFile(exe, []byte("old-binary"), 0o755); err != nil {
		t.Fatal(err)
	}
	deps.Executable = func() (string, error) { return exe, nil }
	systemtest.SetEnv(deps, map[string]string{
		"SELF_HOST_RELEASES_URL": server.URL + "/api",
		"SELF_HOST_WEB_URL":      server.URL + "/web",
	})
	return deps, exe
}

func TestSelfUpdateReplacesTheBinaryAndReportsBothVersions(t *testing.T) {
	rel := &fakeRelease{tag: "new-cli-v1.2.0", binary: "new-binary"}
	deps, exe := updateDeps(t, "1.0.0", rel.server(t, "linux", "amd64"))

	r := clitest.Run(t, deps, catalog.Default(), "self-update")

	if r.Code != 0 {
		t.Fatalf("exit %d:\n%s", r.Code, r.Out)
	}
	if got := clitest.Read(t, exe); got != "new-binary" {
		t.Errorf("binary = %q", got)
	}
	info, _ := os.Stat(exe)
	if info.Mode().Perm() != 0o755 {
		t.Errorf("mode = %v", info.Mode().Perm())
	}
	if !strings.Contains(r.Out, "1.0.0") || !strings.Contains(r.Out, "1.2.0") {
		t.Errorf("output lacks old and new versions:\n%s", r.Out)
	}
	entries, _ := os.ReadDir(filepath.Dir(exe))
	if len(entries) != 1 {
		t.Errorf("temp files left behind: %v", entries)
	}
}

func TestSelfUpdateEmitsJSONEvents(t *testing.T) {
	rel := &fakeRelease{tag: "new-cli-v1.2.0", binary: "new-binary"}
	deps, _ := updateDeps(t, "1.0.0", rel.server(t, "linux", "amd64"))

	r := clitest.Run(t, deps, catalog.Default(), "self-update", "--json")

	if r.Code != 0 || len(r.Events) == 0 {
		t.Fatalf("exit %d, events %v\n%s", r.Code, r.Events, r.Out)
	}
	if last := r.Events[len(r.Events)-1]; last["event"] != "run.end" || !strings.Contains(last["msg"].(string), "1.2.0") {
		t.Errorf("last event = %v", last)
	}
}

func TestSelfUpdateRefusesAChecksumMismatch(t *testing.T) {
	rel := &fakeRelease{tag: "new-cli-v1.2.0", binary: "new-binary", checksum: strings.Repeat("ab", 32)}
	deps, exe := updateDeps(t, "1.0.0", rel.server(t, "linux", "amd64"))

	r := clitest.Run(t, deps, catalog.Default(), "self-update")

	if r.Code != 1 {
		t.Fatalf("exit %d:\n%s", r.Code, r.Out)
	}
	if !strings.Contains(r.Out, "checksum") {
		t.Errorf("output does not explain the refusal:\n%s", r.Out)
	}
	if got := clitest.Read(t, exe); got != "old-binary" {
		t.Errorf("binary was replaced despite the mismatch: %q", got)
	}
}

func TestSelfUpdateDoesNothingWhenAlreadyCurrent(t *testing.T) {
	rel := &fakeRelease{tag: "new-cli-v1.10.0", binary: "new-binary"}
	deps, exe := updateDeps(t, "v1.10.0", rel.server(t, "linux", "amd64"))

	r := clitest.Run(t, deps, catalog.Default(), "self-update")

	if r.Code != 0 || !strings.Contains(r.Out, "up to date") {
		t.Fatalf("exit %d:\n%s", r.Code, r.Out)
	}
	if got := clitest.Read(t, exe); got != "old-binary" || rel.archives != 0 {
		t.Errorf("binary %q, archives downloaded %d", got, rel.archives)
	}
}

func TestSelfUpdateComparesVersionsNumerically(t *testing.T) {
	rel := &fakeRelease{tag: "new-cli-v1.10.0", binary: "new-binary"}
	deps, exe := updateDeps(t, "1.9.0", rel.server(t, "linux", "amd64"))

	r := clitest.Run(t, deps, catalog.Default(), "self-update")

	if r.Code != 0 || clitest.Read(t, exe) != "new-binary" {
		t.Fatalf("1.9.0 was not updated to 1.10.0 (exit %d):\n%s", r.Code, r.Out)
	}
}

func TestSelfUpdateTellsADevBuildToInstallARelease(t *testing.T) {
	rel := &fakeRelease{tag: "new-cli-v1.2.0", binary: "new-binary"}
	deps, exe := updateDeps(t, "dev", rel.server(t, "linux", "amd64"))

	r := clitest.Run(t, deps, catalog.Default(), "self-update")

	if r.Code != 1 || !strings.Contains(r.Out, "self-host.fyi/install") {
		t.Fatalf("exit %d:\n%s", r.Code, r.Out)
	}
	if got := clitest.Read(t, exe); got != "old-binary" {
		t.Errorf("dev binary was replaced: %q", got)
	}
}

func TestSelfUpdateNamesTheMissingPlatformAsset(t *testing.T) {
	rel := &fakeRelease{tag: "new-cli-v1.2.0", binary: "new-binary", noAsset: true}
	deps, _ := updateDeps(t, "1.0.0", rel.server(t, "linux", "amd64"))

	r := clitest.Run(t, deps, catalog.Default(), "self-update")

	if r.Code != 1 || !strings.Contains(r.Out, "self-host_1.2.0_linux_amd64.tar.gz") {
		t.Fatalf("exit %d:\n%s", r.Code, r.Out)
	}
}

func TestSelfUpdateReportsAnUnreachableReleaseServer(t *testing.T) {
	rel := &fakeRelease{tag: "new-cli-v1.2.0", noRedirect: true, apiError: http.StatusForbidden}
	deps, _ := updateDeps(t, "1.0.0", rel.server(t, "linux", "amd64"))

	r := clitest.Run(t, deps, catalog.Default(), "self-update")

	if r.Code != 1 || !strings.Contains(r.Out, "403") {
		t.Fatalf("exit %d:\n%s", r.Code, r.Out)
	}
}

func TestSelfUpdateSelectsCLIReleaseInsteadOfLegacyPluginLatest(t *testing.T) {
	rel := &fakeRelease{tag: "new-cli-v1.2.0", binary: "new-binary"}
	deps, exe := updateDeps(t, "1.0.0", rel.server(t, "linux", "amd64"))

	r := clitest.Run(t, deps, catalog.Default(), "self-update")

	if r.Code != 0 || clitest.Read(t, exe) != "new-binary" {
		t.Fatalf("exit %d:\n%s", r.Code, r.Out)
	}
	if rel.apiCalls != 1 {
		t.Errorf("the release list was called %d times", rel.apiCalls)
	}
}

func TestSelfUpdateUsesCLIReleaseListWhenWebLatestIsUnavailable(t *testing.T) {
	rel := &fakeRelease{tag: "new-cli-v1.2.0", binary: "new-binary", noRedirect: true}
	deps, exe := updateDeps(t, "1.0.0", rel.server(t, "linux", "amd64"))

	r := clitest.Run(t, deps, catalog.Default(), "self-update")

	if r.Code != 0 || clitest.Read(t, exe) != "new-binary" || rel.apiCalls != 1 {
		t.Fatalf("exit %d, api calls %d:\n%s", r.Code, rel.apiCalls, r.Out)
	}
}

func TestSelfUpdateDownloadsAreNotCutOffByTheShortAPITimeout(t *testing.T) {
	rel := &fakeRelease{tag: "new-cli-v1.2.0", binary: "new-binary", archiveDelay: 300 * time.Millisecond}
	deps, exe := updateDeps(t, "1.0.0", rel.server(t, "linux", "amd64"))
	deps.HTTP = &http.Client{Timeout: 100 * time.Millisecond}

	r := clitest.Run(t, deps, catalog.Default(), "self-update")

	if r.Code != 0 || clitest.Read(t, exe) != "new-binary" {
		t.Fatalf("slow download failed (exit %d):\n%s", r.Code, r.Out)
	}
}

func TestSelfUpdateDoesNotSendTheAPIAcceptHeaderOnDownloads(t *testing.T) {
	rel := &fakeRelease{tag: "new-cli-v1.2.0", binary: "new-binary", downloadAccept: "unset"}
	deps, _ := updateDeps(t, "1.0.0", rel.server(t, "linux", "amd64"))

	clitest.Run(t, deps, catalog.Default(), "self-update")

	if strings.Contains(rel.downloadAccept, "json") || rel.downloadAccept == "unset" {
		t.Errorf("archive download Accept = %q", rel.downloadAccept)
	}
}

func TestSelfUpdateExplainsAnUnwritableInstallDirectory(t *testing.T) {
	if os.Geteuid() == 0 {
		t.Skip("root can write anywhere")
	}
	rel := &fakeRelease{tag: "new-cli-v1.2.0", binary: "new-binary"}
	deps, exe := updateDeps(t, "1.0.0", rel.server(t, "linux", "amd64"))
	dir := filepath.Dir(exe)
	if err := os.Chmod(dir, 0o555); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { os.Chmod(dir, 0o755) })

	r := clitest.Run(t, deps, catalog.Default(), "self-update")

	if r.Code != 1 || !strings.Contains(r.Out, "rerun with sudo") {
		t.Fatalf("exit %d:\n%s", r.Code, r.Out)
	}
	if got := clitest.Read(t, exe); got != "old-binary" {
		t.Errorf("binary = %q", got)
	}
}

func TestSelfUpdateInstallsAPlainVersionTagRelease(t *testing.T) {
	rel := &fakeRelease{tag: "v1.3.0", binary: "plain-tag-binary"}
	deps, exe := updateDeps(t, "1.2.0", rel.server(t, "linux", "amd64"))

	r := clitest.Run(t, deps, catalog.Default(), "self-update")

	if r.Code != 0 || clitest.Read(t, exe) != "plain-tag-binary" || !strings.Contains(r.Out, "1.3.0") {
		t.Fatalf("exit %d:\n%s", r.Code, r.Out)
	}
}
