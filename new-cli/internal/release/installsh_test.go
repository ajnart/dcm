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
	case "linux_amd64", "linux_arm64", "darwin_amd64", "darwin_arm64":
		return fmt.Sprintf("self-host_%s_%s_%s.tar.gz", version, runtime.GOOS, runtime.GOARCH)
	}
	return ""
}

// installFake serves the redirect, the API and the downloads install.sh uses.
type installFake struct {
	platform          string
	memberType        byte
	linkName          string
	tag, binary       string
	token             string
	malformedMetadata bool
	checksum          string // overrides the real sha256 when set
	noRedirect        bool   // github.com/.../releases/latest answers 404
	apiError          int
	apiCalls          int
}

func (f *installFake) server(t *testing.T) *httptest.Server {
	t.Helper()
	version := strings.TrimPrefix(f.tag, "new-cli-v")
	name := hostAsset(version)
	if f.platform != "" {
		name = "self-host_" + version + "_" + f.platform + ".tar.gz"
	}
	var buf bytes.Buffer
	gz := gzip.NewWriter(&buf)
	tw := tar.NewWriter(gz)
	header := &tar.Header{Name: "self-host", Mode: 0o755, Size: int64(len(f.binary))}
	if f.memberType != 0 {
		header.Typeflag = f.memberType
		header.Linkname = f.linkName
		header.Size = 0
	}
	tw.WriteHeader(header)
	if f.memberType == 0 {
		tw.Write([]byte(f.binary))
	}
	tw.Close()
	gz.Close()
	sum := sha256.Sum256(buf.Bytes())
	digest := hex.EncodeToString(sum[:])
	if f.checksum != "" {
		digest = f.checksum
	}
	download := "/web/releases/download/" + f.tag + "/"
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if f.token != "" && r.Header.Get("Authorization") != "Bearer "+f.token {
			http.Error(w, "authentication required", http.StatusUnauthorized)
			return
		}
		switch r.URL.Path {
		case "/api/releases":
			f.apiCalls++
			if f.apiError != 0 {
				w.WriteHeader(f.apiError)
				return
			}
			fmt.Fprintf(w, `[{"tag_name":"v99.0.0"},{"tag_name":"new-cli-v99.0.0","draft":true},{"tag_name":"new-cli-v98.0.0","prerelease":true},{"tag_name":"new-cli-v01.2.0"},{"tag_name":%q,"assets":[]}]`, f.tag)
		case "/api/releases/tags/" + f.tag:
			if f.malformedMetadata {
				fmt.Fprintf(w, `{"tag_name":%q} trailing garbage`, f.tag)
				return
			}
			fmt.Fprintf(w, `{"tag_name":%q,"assets":[{"id":11,"name":"checksums.txt"},{"id":12,"name":%q}]}`, f.tag, name)
		case "/web/releases/latest":
			if f.noRedirect {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			http.Redirect(w, r, "/web/releases/tag/"+f.tag, http.StatusFound)
		case "/web/releases/tag/" + f.tag:
			w.WriteHeader(http.StatusOK)
		case download + "checksums.txt", "/api/releases/assets/11":
			fmt.Fprintf(w, "%s  %s\n", digest, name)
		case download + name, "/api/releases/assets/12":
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
	server := (&installFake{tag: "new-cli-v1.2.0", binary: "#!/bin/sh\necho new\n"}).server(t)

	out, err := runInstaller(t, server, "HOME="+home)

	if err != nil {
		t.Fatalf("install failed: %v\n%s", err, out)
	}
	target := filepath.Join(home, ".local", "bin", "self-host")
	info, statErr := os.Stat(target)
	if statErr != nil || info.Mode().Perm() != 0o755 {
		t.Fatalf("expected an executable at %s: %v %v\n%s", target, statErr, info, out)
	}
	if got, err := exec.Command(target).Output(); err != nil || string(got) != "new\n" {
		t.Fatalf("installed executable: %q, %v", got, err)
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
	server := (&installFake{tag: "new-cli-v1.1.0", binary: "binary-1.1.0"}).server(t)

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
	server := (&installFake{tag: "new-cli-v1.2.0", binary: "tampered", checksum: strings.Repeat("0", 64)}).server(t)

	out, err := runInstaller(t, server, "HOME="+t.TempDir(), "SELF_HOST_INSTALL_DIR="+dir)

	if err == nil || !strings.Contains(out, "checksum mismatch") {
		t.Fatalf("expected a checksum failure, got %v\n%s", err, out)
	}
	if _, statErr := os.Stat(filepath.Join(dir, "self-host")); statErr == nil {
		t.Error("binary was installed despite the mismatch")
	}
}

func TestInstallScriptSelectsCLIReleaseInsteadOfLegacyPluginLatest(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "bin")
	fake := &installFake{tag: "new-cli-v1.2.0", binary: "binary-1.2.0"}

	out, err := runInstaller(t, fake.server(t), "HOME="+t.TempDir(), "SELF_HOST_INSTALL_DIR="+dir)

	if err != nil || fake.apiCalls != 1 {
		t.Fatalf("install failed (API calls %d): %v\n%s", fake.apiCalls, err, out)
	}
	if data, _ := os.ReadFile(filepath.Join(dir, "self-host")); string(data) != "binary-1.2.0" {
		t.Errorf("installed %q", data)
	}
}

func TestInstallScriptUsesReleaseListWhenWebLatestIsUnavailable(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "bin")
	fake := &installFake{tag: "new-cli-v1.2.0", binary: "binary-1.2.0", noRedirect: true}

	out, err := runInstaller(t, fake.server(t), "HOME="+t.TempDir(), "SELF_HOST_INSTALL_DIR="+dir)

	if err != nil || fake.apiCalls != 1 {
		t.Fatalf("install failed (API calls %d): %v\n%s", fake.apiCalls, err, out)
	}
}

func TestInstallScriptExplainsAnUnwritableInstallDirectory(t *testing.T) {
	if os.Geteuid() == 0 {
		t.Skip("root can write read-only directories")
	}
	dir := filepath.Join(t.TempDir(), "bin")
	if err := os.MkdirAll(dir, 0555); err != nil {
		t.Fatal(err)
	}
	defer os.Chmod(dir, 0755)
	out, err := runInstaller(t, (&installFake{tag: "new-cli-v1.2.0", binary: "new"}).server(t), "HOME="+t.TempDir(), "SELF_HOST_INSTALL_DIR="+dir)
	if err == nil || !strings.Contains(out, "cannot write") {
		t.Fatalf("expected write failure: %v\n%s", err, out)
	}
	entries, _ := os.ReadDir(dir)
	if len(entries) != 0 {
		t.Fatal("failed install left files")
	}
}

func TestInstallScriptDownloadsPrivateReleaseWithoutExposingToken(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "bin")
	fake := &installFake{tag: "new-cli-v1.2.0", binary: "#!/bin/sh\necho private\n", token: "fixture-token"}
	out, err := runInstaller(t, fake.server(t), "HOME="+t.TempDir(), "SELF_HOST_INSTALL_DIR="+dir, "SELF_HOST_GITHUB_TOKEN=fixture-token")
	if err != nil {
		t.Fatalf("private install failed: %v\n%s", err, out)
	}
	if strings.Contains(out, "fixture-token") {
		t.Fatal("installer printed token")
	}
	if data, _ := os.ReadFile(filepath.Join(dir, "self-host")); string(data) != "#!/bin/sh\necho private\n" {
		t.Fatalf("installed %q", data)
	}
}

func TestInstallScriptRejectsMalformedVersionBeforeDownloading(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "bin")
	out, err := runInstaller(t, (&installFake{tag: "new-cli-v1.2.0"}).server(t), "HOME="+t.TempDir(), "SELF_HOST_INSTALL_DIR="+dir, "SELF_HOST_VERSION=new-cli-v1.2.0/path")
	if err == nil || !strings.Contains(out, "expected a stable") {
		t.Fatalf("accepted malformed version: %v\n%s", err, out)
	}
	if _, err := os.Stat(filepath.Join(dir, "self-host")); err == nil {
		t.Fatal("installed malformed version")
	}
}

func TestInstallScriptRejectsMalformedReleaseMetadata(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "bin")
	fake := &installFake{tag: "new-cli-v1.2.0", binary: "new", malformedMetadata: true}
	out, err := runInstaller(t, fake.server(t), "HOME="+t.TempDir(), "SELF_HOST_INSTALL_DIR="+dir)
	if err == nil {
		t.Fatalf("accepted malformed JSON:\n%s", out)
	}
	if _, err := os.Stat(filepath.Join(dir, "self-host")); err == nil {
		t.Fatal("installed malformed metadata")
	}
}

func TestInstallScriptPreservesUnrelatedStagingSymlink(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "bin")
	os.MkdirAll(dir, 0755)
	sentinel := filepath.Join(t.TempDir(), "sentinel")
	os.WriteFile(sentinel, []byte("unrelated"), 0600)
	os.Symlink(sentinel, filepath.Join(dir, ".self-host.new"))
	out, err := runInstaller(t, (&installFake{tag: "new-cli-v1.2.0", binary: "new"}).server(t), "HOME="+t.TempDir(), "SELF_HOST_INSTALL_DIR="+dir)
	if err != nil {
		t.Fatalf("install failed: %v\n%s", err, out)
	}
	if data, _ := os.ReadFile(sentinel); string(data) != "unrelated" {
		t.Fatalf("overwrote unrelated staging target: %q", data)
	}
	if _, err := os.Lstat(filepath.Join(dir, ".self-host.new")); err != nil {
		t.Fatal("removed unrelated symlink")
	}
}

func TestInstallScriptRejectsLinkedBinaryAndPreservesExistingInstall(t *testing.T) {
	for _, tc := range []struct {
		name string
		kind byte
	}{{"symlink", tar.TypeSymlink}, {"hardlink", tar.TypeLink}, {"directory", tar.TypeDir}} {
		t.Run(tc.name, func(t *testing.T) {
			dir := filepath.Join(t.TempDir(), "bin")
			os.MkdirAll(dir, 0755)
			target := filepath.Join(dir, "self-host")
			os.WriteFile(target, []byte("old-install"), 0755)
			sentinel := filepath.Join(t.TempDir(), "unrelated")
			os.WriteFile(sentinel, []byte("unrelated-content"), 0600)
			fake := &installFake{tag: "new-cli-v1.2.0", memberType: tc.kind, linkName: sentinel}
			out, err := runInstaller(t, fake.server(t), "HOME="+t.TempDir(), "SELF_HOST_INSTALL_DIR="+dir)
			if err == nil {
				t.Fatalf("accepted linked/nonregular binary:\n%s", out)
			}
			if data, _ := os.ReadFile(target); string(data) != "old-install" {
				t.Fatalf("changed existing install: %q", data)
			}
			if data, _ := os.ReadFile(sentinel); string(data) != "unrelated-content" {
				t.Fatalf("changed link target: %q", data)
			}
		})
	}
}

func TestInstallScriptSelectsDarwinAMD64Archive(t *testing.T) {
	tools := t.TempDir()
	uname := filepath.Join(tools, "uname")
	if err := os.WriteFile(uname, []byte("#!/bin/sh\ncase \"$1\" in -s) echo Darwin ;; -m) echo x86_64 ;; esac\n"), 0755); err != nil {
		t.Fatal(err)
	}
	dir := filepath.Join(t.TempDir(), "bin")
	fake := &installFake{tag: "new-cli-v1.2.0", platform: "darwin_amd64", binary: "intel-binary"}
	out, err := runInstaller(t, fake.server(t), "SELF_HOST_VERSION=1.2.0", "SELF_HOST_INSTALL_DIR="+dir, "PATH="+tools+":"+os.Getenv("PATH"))
	if err != nil {
		t.Fatalf("Intel archive install failed: %v\n%s", err, out)
	}
	if data, _ := os.ReadFile(filepath.Join(dir, "self-host")); string(data) != "intel-binary" {
		t.Fatalf("installed %q", data)
	}
	if !strings.Contains(out, "darwin/amd64") {
		t.Fatalf("wrong platform: %s", out)
	}
}
