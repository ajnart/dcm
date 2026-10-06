package cli_test

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/ajnart/self-host/internal/catalog"
	"github.com/ajnart/self-host/internal/clitest"
	"github.com/ajnart/self-host/internal/system"
	"github.com/ajnart/self-host/internal/systemtest"
)

// fakeRelease serves the GitHub Releases API and the assets of one release.
type fakeRelease struct {
	tag      string
	binary   string
	checksum string // overrides the real sha256 when set
	noAsset  bool
	apiError int
	archives int // archive downloads served
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
	version := strings.TrimPrefix(f.tag, "v")
	name := fmt.Sprintf("self-host_%s_%s_%s.tar.gz", version, goos, goarch)
	archive := tarGz(t, map[string]string{"LICENSE": "MIT", "self-host": f.binary})
	sum := sha256.Sum256(archive)
	digest := hex.EncodeToString(sum[:])
	if f.checksum != "" {
		digest = f.checksum
	}
	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/repos/ajnart/self-host/releases/latest":
			if f.apiError != 0 {
				w.WriteHeader(f.apiError)
				return
			}
			assets := []map[string]string{
				{"name": "checksums.txt", "browser_download_url": server.URL + "/dl/checksums.txt"},
				{"name": "self-host_" + version + "_windows_amd64.zip", "browser_download_url": server.URL + "/dl/nope"},
			}
			if !f.noAsset {
				assets = append(assets, map[string]string{"name": name, "browser_download_url": server.URL + "/dl/" + name})
			}
			json.NewEncoder(w).Encode(map[string]any{"tag_name": f.tag, "assets": assets})
		case "/dl/checksums.txt":
			fmt.Fprintf(w, "%s  other_file.tar.gz\n%s  %s\n", strings.Repeat("0", 64), digest, name)
		case "/dl/" + name:
			f.archives++
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
	systemtest.SetEnv(deps, map[string]string{"SELF_HOST_RELEASES_URL": server.URL + "/repos/ajnart/self-host"})
	return deps, exe
}

func TestSelfUpdateReplacesTheBinaryAndReportsBothVersions(t *testing.T) {
	rel := &fakeRelease{tag: "v1.2.0", binary: "new-binary"}
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
	rel := &fakeRelease{tag: "v1.2.0", binary: "new-binary"}
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
	rel := &fakeRelease{tag: "v1.2.0", binary: "new-binary", checksum: strings.Repeat("ab", 32)}
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
	rel := &fakeRelease{tag: "v1.10.0", binary: "new-binary"}
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
	rel := &fakeRelease{tag: "v1.10.0", binary: "new-binary"}
	deps, exe := updateDeps(t, "1.9.0", rel.server(t, "linux", "amd64"))

	r := clitest.Run(t, deps, catalog.Default(), "self-update")

	if r.Code != 0 || clitest.Read(t, exe) != "new-binary" {
		t.Fatalf("1.9.0 was not updated to 1.10.0 (exit %d):\n%s", r.Code, r.Out)
	}
}

func TestSelfUpdateTellsADevBuildToInstallARelease(t *testing.T) {
	rel := &fakeRelease{tag: "v1.2.0", binary: "new-binary"}
	deps, exe := updateDeps(t, "dev", rel.server(t, "linux", "amd64"))

	r := clitest.Run(t, deps, catalog.Default(), "self-update")

	if r.Code != 1 || !strings.Contains(r.Out, "install.sh") {
		t.Fatalf("exit %d:\n%s", r.Code, r.Out)
	}
	if got := clitest.Read(t, exe); got != "old-binary" {
		t.Errorf("dev binary was replaced: %q", got)
	}
}

func TestSelfUpdateNamesTheMissingPlatformAsset(t *testing.T) {
	rel := &fakeRelease{tag: "v1.2.0", binary: "new-binary", noAsset: true}
	deps, _ := updateDeps(t, "1.0.0", rel.server(t, "linux", "amd64"))

	r := clitest.Run(t, deps, catalog.Default(), "self-update")

	if r.Code != 1 || !strings.Contains(r.Out, "self-host_1.2.0_linux_amd64.tar.gz") {
		t.Fatalf("exit %d:\n%s", r.Code, r.Out)
	}
}

func TestSelfUpdateReportsAnUnreachableReleaseServer(t *testing.T) {
	rel := &fakeRelease{tag: "v1.2.0", apiError: http.StatusForbidden}
	deps, _ := updateDeps(t, "1.0.0", rel.server(t, "linux", "amd64"))

	r := clitest.Run(t, deps, catalog.Default(), "self-update")

	if r.Code != 1 || !strings.Contains(r.Out, "403") {
		t.Fatalf("exit %d:\n%s", r.Code, r.Out)
	}
}
