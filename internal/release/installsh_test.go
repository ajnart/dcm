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

func installServer(t *testing.T, tag, binary, checksum string) *httptest.Server {
	t.Helper()
	version := strings.TrimPrefix(tag, "v")
	name := hostAsset(version)
	var buf bytes.Buffer
	gz := gzip.NewWriter(&buf)
	tw := tar.NewWriter(gz)
	tw.WriteHeader(&tar.Header{Name: "self-host", Mode: 0o755, Size: int64(len(binary))})
	tw.Write([]byte(binary))
	tw.Close()
	gz.Close()
	sum := sha256.Sum256(buf.Bytes())
	digest := hex.EncodeToString(sum[:])
	if checksum != "" {
		digest = checksum
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/releases/latest":
			fmt.Fprintf(w, `{"tag_name": %q, "assets": []}`, tag)
		case "/download/" + tag + "/checksums.txt":
			fmt.Fprintf(w, "%s  %s\n", digest, name)
		case "/download/" + tag + "/" + name:
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
		"SELF_HOST_DOWNLOAD_URL=" + server.URL + "/download",
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
	server := installServer(t, "v1.2.0", "#!/bin/sh\necho new\n", "")

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
	server := installServer(t, "v1.1.0", "binary-1.1.0", "")

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
	server := installServer(t, "v1.2.0", "tampered", strings.Repeat("0", 64))

	out, err := runInstaller(t, server, "HOME="+t.TempDir(), "SELF_HOST_INSTALL_DIR="+dir)

	if err == nil || !strings.Contains(out, "checksum mismatch") {
		t.Fatalf("expected a checksum failure, got %v\n%s", err, out)
	}
	if _, statErr := os.Stat(filepath.Join(dir, "self-host")); statErr == nil {
		t.Error("binary was installed despite the mismatch")
	}
}
