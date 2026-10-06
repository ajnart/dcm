package release_test

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
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

// hostAsset is the goreleaser archive name for the machine running the test,
// or "" when no release is built for it (the script would refuse too).
func hostAsset(version string) string {
	switch runtime.GOOS + "_" + runtime.GOARCH {
	case "linux_amd64", "linux_arm64", "darwin_arm64":
		return fmt.Sprintf("self-host_%s_%s_%s.tar.gz", version, runtime.GOOS, runtime.GOARCH)
	}
	return ""
}

// installFake serves the redirect, the API and the downloads install.sh uses.
type installFake struct {
	tag, binary string
	checksum    string // overrides the real sha256 when set
	noRedirect  bool   // github.com/.../releases/latest answers 404
	apiError    int
	apiCalls    int
}

func (f *installFake) server(t *testing.T) *httptest.Server {
	t.Helper()
	version := strings.TrimPrefix(f.tag, "v")
	name := hostAsset(version)
	var buf bytes.Buffer
	gz := gzip.NewWriter(&buf)
	tw := tar.NewWriter(gz)
	tw.WriteHeader(&tar.Header{Name: "self-host", Mode: 0o755, Size: int64(len(f.binary))})
	tw.Write([]byte(f.binary))
	tw.Close()
	gz.Close()
	sum := sha256.Sum256(buf.Bytes())
	digest := hex.EncodeToString(sum[:])
	if f.checksum != "" {
		digest = f.checksum
	}
	download := "/web/releases/download/" + f.tag + "/"
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/releases/latest":
			f.apiCalls++
			if f.apiError != 0 {
				w.WriteHeader(f.apiError)
				return
			}
			fmt.Fprintf(w, `{"tag_name": %q, "assets": []}`, f.tag)
		case "/web/releases/latest":
			if f.noRedirect {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			http.Redirect(w, r, "/web/releases/tag/"+f.tag, http.StatusFound)
		case "/web/releases/tag/" + f.tag:
			w.WriteHeader(http.StatusOK)
		case download + "checksums.txt":
			fmt.Fprintf(w, "%s  %s\n", digest, name)
		case download + name:
			w.Write(buf.Bytes())
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	t.Cleanup(server.Close)
	return server
}

func runInstaller(t *testing.T, server *httptest.Server, env ...string) (string, error) {
	t.Helper()
	for _, tool := range []string{"bash", "curl", "tar"} {
		if _, err := exec.LookPath(tool); err != nil {
			t.Skipf("%s not installed", tool)
		}
	}
	if hostAsset("0") == "" {
		t.Skipf("no release is built for %s/%s", runtime.GOOS, runtime.GOARCH)
	}
	cmd := exec.Command("bash", "../../install.sh")
	cmd.Env = append([]string{
		"PATH=" + os.Getenv("PATH"),
		"SELF_HOST_RELEASES_URL=" + server.URL + "/api",
		"SELF_HOST_WEB_URL=" + server.URL + "/web",
	}, env...)
	out, err := cmd.CombinedOutput()
	return string(out), err
}

func TestInstallScriptSyntax(t *testing.T) {
	if _, err := exec.LookPath("bash"); err != nil {
		t.Skip("bash not installed")
	}
	if out, err := exec.Command("bash", "-n", "../../install.sh").CombinedOutput(); err != nil {
		t.Fatalf("bash -n: %v\n%s", err, out)
	}
}

func TestInstallScriptInstallsToHomeLocalBinForANormalUser(t *testing.T) {
	if os.Geteuid() == 0 {
		t.Skip("running as root installs to /usr/local/bin")
	}
	home := t.TempDir()
	server := (&installFake{tag: "v1.2.0", binary: "#!/bin/sh\necho new\n"}).server(t)

	out, err := runInstaller(t, server, "HOME="+home)

	if err != nil {
		t.Fatalf("install failed: %v\n%s", err, out)
	}
	target := filepath.Join(home, ".local", "bin", "self-host")
	info, statErr := os.Stat(target)
	if statErr != nil || info.Mode().Perm() != 0o755 {
		t.Fatalf("expected an executable at %s: %v %v\n%s", target, statErr, info, out)
	}
	if !strings.Contains(out, "not on your PATH") {
		t.Errorf("no PATH warning:\n%s", out)
	}
	if !strings.Contains(out, "self-host install media --yes") {
		t.Errorf("no next step:\n%s", out)
	}
}

func TestInstallScriptHonoursAnInstallDirAndSpecificVersion(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "bin")
	server := (&installFake{tag: "v1.1.0", binary: "binary-1.1.0"}).server(t)

	out, err := runInstaller(t, server, "HOME="+t.TempDir(), "SELF_HOST_INSTALL_DIR="+dir, "SELF_HOST_VERSION=1.1.0", "PATH="+os.Getenv("PATH")+":"+dir)

	if err != nil {
		t.Fatalf("install failed: %v\n%s", err, out)
	}
	data, _ := os.ReadFile(filepath.Join(dir, "self-host"))
	if string(data) != "binary-1.1.0" {
		t.Errorf("installed %q", data)
	}
	if strings.Contains(out, "not on your PATH") {
		t.Errorf("warned although the directory is on PATH:\n%s", out)
	}
}

func TestInstallScriptRefusesAChecksumMismatch(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "bin")
	server := (&installFake{tag: "v1.2.0", binary: "tampered", checksum: strings.Repeat("0", 64)}).server(t)

	out, err := runInstaller(t, server, "HOME="+t.TempDir(), "SELF_HOST_INSTALL_DIR="+dir)

	if err == nil || !strings.Contains(out, "checksum mismatch") {
		t.Fatalf("expected a checksum failure, got %v\n%s", err, out)
	}
	if _, statErr := os.Stat(filepath.Join(dir, "self-host")); statErr == nil {
		t.Error("binary was installed despite the mismatch")
	}
}

func TestInstallScriptFindsTheLatestTagThroughTheRedirectNotTheRateLimitedAPI(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "bin")
	fake := &installFake{tag: "v1.2.0", binary: "binary-1.2.0", apiError: http.StatusForbidden}

	out, err := runInstaller(t, fake.server(t), "HOME="+t.TempDir(), "SELF_HOST_INSTALL_DIR="+dir)

	if err != nil || fake.apiCalls != 0 {
		t.Fatalf("install failed (API calls %d): %v\n%s", fake.apiCalls, err, out)
	}
	if data, _ := os.ReadFile(filepath.Join(dir, "self-host")); string(data) != "binary-1.2.0" {
		t.Errorf("installed %q", data)
	}
}

func TestInstallScriptFallsBackToTheAPIWhenTheRedirectFails(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "bin")
	fake := &installFake{tag: "v1.2.0", binary: "binary-1.2.0", noRedirect: true}

	out, err := runInstaller(t, fake.server(t), "HOME="+t.TempDir(), "SELF_HOST_INSTALL_DIR="+dir)

	if err != nil || fake.apiCalls != 1 {
		t.Fatalf("install failed (API calls %d): %v\n%s", fake.apiCalls, err, out)
	}
}

func TestInstallScriptCleansUpAndExplainsWhenTheCopyFails(t *testing.T) {
	if os.Geteuid() == 0 {
		t.Skip("root can overwrite read-only files")
	}
	dir := filepath.Join(t.TempDir(), "bin")
	staging := filepath.Join(dir, ".self-host.new")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	// A read-only staging file makes the copy fail.
	if err := os.WriteFile(staging, []byte("stale"), 0o444); err != nil {
		t.Fatal(err)
	}
	fake := &installFake{tag: "v1.2.0", binary: "binary-1.2.0"}

	out, err := runInstaller(t, fake.server(t), "HOME="+t.TempDir(), "SELF_HOST_INSTALL_DIR="+dir)

	if err == nil || !strings.Contains(out, "cannot write") {
		t.Fatalf("expected a clear failure, got %v\n%s", err, out)
	}
	if _, statErr := os.Stat(staging); statErr == nil {
		t.Error("the staging file was left behind")
	}
	if _, statErr := os.Stat(filepath.Join(dir, "self-host")); statErr == nil {
		t.Error("a binary was installed")
	}
}
