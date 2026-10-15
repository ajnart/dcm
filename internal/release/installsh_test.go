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
	"syscall"
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
	releaseList       string
	metadata          string
	checksum          string // overrides the real sha256 when set
	noRedirect        bool   // github.com/.../releases/latest answers 404
	downloadError     int    // status of archive downloads when set
	legacyTag         string // a skill-pack release served by tag, with only legacy assets
	apiError          int
	apiCalls          int
}

func (f *installFake) server(t *testing.T) *httptest.Server {
	t.Helper()
	version := strings.TrimPrefix(strings.TrimPrefix(f.tag, "new-cli-"), "v")
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
	assets := fmt.Sprintf(`[{"id":11,"name":"checksums.txt"},{"id":12,"name":%q}]`, name)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// A repository rename: the old paths answer 301 to the new ones.
		for _, root := range []string{"api", "web"} {
			if rest, ok := strings.CutPrefix(r.URL.Path, "/old"+root+"/"); ok {
				target := "/" + root + "/" + rest
				if r.URL.RawQuery != "" {
					target += "?" + r.URL.RawQuery
				}
				http.Redirect(w, r, target, http.StatusMovedPermanently)
				return
			}
		}
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
			if f.releaseList != "" {
				fmt.Fprint(w, f.releaseList)
				return
			}
			fmt.Fprintf(w, `[{"tag_name":"v99.0.0","assets":[{"name":"CLI-SHA256SUMS"},{"name":"self-host-99.0.0.zip"},{"name":"SHA256SUMS"}]},{"tag_name":"new-cli-v99.0.0","draft":true,"assets":%[2]s},{"tag_name":"new-cli-v98.0.0","prerelease":true,"assets":%[2]s},{"tag_name":"new-cli-v01.2.0","assets":%[2]s},{"tag_name":%[1]q,"assets":%[2]s}]`, f.tag, assets)
		case "/api/releases/tags/" + f.legacyTag:
			if f.legacyTag == "" {
				http.NotFound(w, r)
				return
			}
			fmt.Fprintf(w, `{"tag_name":%q,"assets":[{"id":21,"name":"CLI-SHA256SUMS"},{"id":22,"name":"self-host-1.1.2.zip"},{"id":23,"name":"SHA256SUMS"}]}`, f.legacyTag)
		case "/api/releases/tags/" + f.tag:
			if f.metadata != "" {
				fmt.Fprint(w, f.metadata)
				return
			}
			if f.malformedMetadata {
				fmt.Fprintf(w, `{"tag_name":%q} trailing garbage`, f.tag)
				return
			}
			fmt.Fprintf(w, `{"tag_name":%q,"assets":%s}`, f.tag, assets)
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
			if f.downloadError != 0 {
				w.WriteHeader(f.downloadError)
				return
			}
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
	cmd.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
	cmd.Env = append([]string{
		"PATH=" + os.Getenv("PATH"),
		"LANG=" + os.Getenv("LANG"),
		"LC_ALL=" + os.Getenv("LC_ALL"),
		"LC_CTYPE=" + os.Getenv("LC_CTYPE"),
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

func TestInstallScriptWithUnicodeReleaseMetadata(t *testing.T) {
	locales, err := exec.Command("locale", "-a").Output()
	if err != nil {
		t.Fatal(err)
	}
	utf8Locale := ""
	for _, candidate := range []string{"en_US.UTF-8", "C.UTF-8", "C.utf8"} {
		if strings.Contains("\n"+string(locales), "\n"+candidate+"\n") {
			utf8Locale = candidate
			break
		}
	}
	for index, locale := range []string{"C", utf8Locale, ""} {
		name := locale
		if index == 2 {
			name = "default"
		}
		t.Run(name, func(t *testing.T) {
			if index == 1 && locale == "" {
				t.Skip("no representative UTF-8 locale installed")
			}
			for _, token := range []string{"", "fixture-token"} {
				t.Run("token="+token, func(t *testing.T) {
					metadata := fmt.Sprintf(`{"name":"Café 日本語 🚀","body":"Résumé \u00e9 \ud83d\ude80 before assets","tag_name":"v1.3.0","assets":[{"id":99,"name":"説明.txt"},{"id":11,"name":"checksums.txt"},{"id":12,"name":%q,"label":"更新 \u65e5"}],"description":"Après assets 🎉"}`, hostAsset("1.3.0"))
					list := "[" + metadata + "]"
					for _, tc := range []struct {
						name, list, metadata, failure string
					}{
						{name: "valid", list: list, metadata: metadata},
						{name: "default_release_list", metadata: metadata},
						{name: "truncated_list", list: strings.TrimSuffix(list, "]"), metadata: metadata, failure: "invalid release-list JSON"},
						{name: "malformed_list", list: list + " trailing", metadata: metadata, failure: "invalid release-list JSON"},
						{name: "truncated_metadata", list: list, metadata: strings.TrimSuffix(metadata, "}"), failure: "does not match requested stable CLI tag"},
						{name: "invalid_escape", list: list, metadata: strings.Replace(metadata, `\u00e9`, `\u00xz`, 1), failure: "does not match requested stable CLI tag"},
						{name: "wrong_tag", list: list, metadata: strings.Replace(metadata, `"tag_name":"v1.3.0"`, `"tag_name":"v9.0.0"`, 1), failure: "does not match requested stable CLI tag"},
						{name: "wrong_asset", list: list, metadata: strings.Replace(metadata, hostAsset("1.3.0"), "説明.tar.gz", 1), failure: "not a CLI release"},
						{name: "legacy_only", list: `[{"tag_name":"v99.0.0","name":"旧版 🚀","assets":[{"name":"self-host-99.0.0.zip"},{"name":"checksums.txt"}]}]`, metadata: metadata, failure: "no CLI release is published"},
					} {
						t.Run(tc.name, func(t *testing.T) {
							dir := filepath.Join(t.TempDir(), "bin")
							fake := &installFake{tag: "v1.3.0", binary: "unicode-release", token: token, metadata: tc.metadata, releaseList: tc.list}
							out, err := runInstaller(t, fake.server(t), "HOME="+t.TempDir(), "SELF_HOST_INSTALL_DIR="+dir, "SELF_HOST_GITHUB_TOKEN="+token, "LC_ALL="+locale)
							if tc.failure != "" {
								if err == nil || !strings.Contains(out, tc.failure) {
									t.Fatalf("expected %q under %s: %v\n%s", tc.failure, name, err, out)
								}
								if _, err := os.Stat(filepath.Join(dir, "self-host")); !os.IsNotExist(err) {
									t.Fatalf("failed install wrote a binary: %v", err)
								}
								return
							}
							if err != nil || installedBinary(dir) != "unicode-release" || !strings.Contains(out, "(1.3.0, checksum verified)") {
								t.Fatalf("install under %s: %v\n%s", name, err, out)
							}
						})
					}
				})
			}
		})
	}
}

func TestInstallScriptWithBusyBoxAwk(t *testing.T) {
	busybox, err := exec.LookPath("busybox")
	if err != nil {
		t.Skip("BusyBox not installed")
	}
	tools := t.TempDir()
	// Pass the path as an argument so spaces and shell metacharacters stay literal.
	shim := "#!/bin/sh\nexec \"$SELF_HOST_TEST_BUSYBOX\" awk \"$@\"\n"
	if err := os.WriteFile(filepath.Join(tools, "awk"), []byte(shim), 0755); err != nil {
		t.Fatal(err)
	}
	tag := "new-cli-v1.2.0"
	list := fmt.Sprintf(`[
		{"tag_name":"new-cli-v99.0.0","draft":true,"prerelease":false},
		{"tag_name":"new-cli-v98.0.0","draft":false,"prerelease":true},
		{"tag_name":"v97.0.0","draft":false,"prerelease":false},
		{"tag_name":%q,"draft":false,"prerelease":false,"assets":[{"id":11,"name":"checksums.txt","size":42},{"id":12,"name":%q,"tag_name":"new-cli-v96.0.0","size":42,"labels":[true,false,null,3]}]}
	]`, tag, hostAsset("1.2.0"))
	metadata := fmt.Sprintf(`{"tag_name":%q,"draft":false,"prerelease":false,"assets":[{"id":11,"name":"checksums.txt","size":42},{"id":12,"name":%q,"size":123,"labels":[true,false,null,3]}]}`, tag, hostAsset("1.2.0"))
	for _, tc := range []struct {
		name, token, checksum, metadata, failure string
	}{
		{name: "public_install"},
		{name: "asset_id_download", token: "fixture-token"},
		{name: "checksum_mismatch", checksum: strings.Repeat("0", 64), failure: "checksum mismatch"},
		{name: "draft_metadata", metadata: strings.Replace(metadata, `"draft":false`, `"draft":true`, 1), failure: "does not match requested stable CLI tag"},
		{name: "prerelease_metadata", metadata: strings.Replace(metadata, `"prerelease":false`, `"prerelease":true`, 1), failure: "does not match requested stable CLI tag"},
		{name: "invalid_scalar", metadata: strings.Replace(metadata, `"size":42`, `"size":falsehood`, 1), failure: "does not match requested stable CLI tag"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			dir := filepath.Join(t.TempDir(), "bin")
			fake := &installFake{tag: tag, binary: "busybox-installed", token: tc.token, checksum: tc.checksum, releaseList: list, metadata: metadata}
			if tc.metadata != "" {
				fake.metadata = tc.metadata
			}
			out, err := runInstaller(t, fake.server(t), "HOME="+t.TempDir(), "SELF_HOST_INSTALL_DIR="+dir, "SELF_HOST_GITHUB_TOKEN="+tc.token, "SELF_HOST_TEST_BUSYBOX="+busybox, "PATH="+tools+":"+os.Getenv("PATH"))
			if tc.failure != "" {
				if err == nil || !strings.Contains(out, tc.failure) {
					t.Fatalf("expected %q, got %v\n%s", tc.failure, err, out)
				}
				if _, err := os.Stat(filepath.Join(dir, "self-host")); !os.IsNotExist(err) {
					t.Fatalf("failed install wrote a binary: %v", err)
				}
				return
			}
			if err != nil || fake.apiCalls != 1 {
				t.Fatalf("install failed (API calls %d): %v\n%s", fake.apiCalls, err, out)
			}
			if data, err := os.ReadFile(filepath.Join(dir, "self-host")); err != nil || string(data) != fake.binary {
				t.Fatalf("installed %q: %v", data, err)
			}
			if !strings.Contains(out, "(1.2.0, checksum verified)") {
				t.Fatalf("missing verified stable version: %s", out)
			}
		})
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

func installedBinary(dir string) string {
	data, _ := os.ReadFile(filepath.Join(dir, "self-host"))
	return string(data)
}

func TestInstallScriptSelectsAPlainVersionTagAndTheHighestOfBothForms(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "bin")
	name := hostAsset("1.3.0")
	older := hostAsset("1.2.0")
	list := fmt.Sprintf(`[{"tag_name":"new-cli-v1.2.0","assets":[{"id":1,"name":"checksums.txt"},{"id":2,"name":%q}]},{"tag_name":"v1.3.0","assets":[{"id":11,"name":"checksums.txt"},{"id":12,"name":%q}]},{"tag_name":"v1.1.2","assets":[{"name":"CLI-SHA256SUMS"},{"name":"self-host-1.1.2.zip"}]}]`, older, name)
	fake := &installFake{tag: "v1.3.0", binary: "plain-tag", releaseList: list}

	out, err := runInstaller(t, fake.server(t), "HOME="+t.TempDir(), "SELF_HOST_INSTALL_DIR="+dir)

	if err != nil || installedBinary(dir) != "plain-tag" || !strings.Contains(out, "(1.3.0, checksum verified)") {
		t.Fatalf("install: %v\n%s", err, out)
	}
}

func TestInstallScriptNeverInstallsALegacySkillPackRelease(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "bin")
	list := `[{"tag_name":"v1.1.2","assets":[{"name":"ajnart-selfhost-1.1.2.tgz"},{"name":"CLI-SHA256SUMS"},{"name":"RELEASE-MANIFEST.json"},{"name":"self-host-1.1.2.zip"},{"name":"SHA256SUMS"}]},{"tag_name":"v1.0.0","assets":[{"name":"RELEASE-MANIFEST.json"},{"name":"self-host-1.0.0.zip"},{"name":"SHA256SUMS"}]}]`
	fake := &installFake{tag: "new-cli-v0.2.0", binary: "x", releaseList: list}

	out, err := runInstaller(t, fake.server(t), "HOME="+t.TempDir(), "SELF_HOST_INSTALL_DIR="+dir)

	if err == nil || !strings.Contains(out, "no CLI release is published") {
		t.Fatalf("expected a refusal, got %v\n%s", err, out)
	}
	if installedBinary(dir) != "" {
		t.Error("installed a skill-pack release")
	}
}

func TestInstallScriptPinnedLegacyVersionIsNotACLIRelease(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "bin")
	fake := &installFake{tag: "new-cli-v0.2.0", binary: "x", legacyTag: "v1.1.2"}

	out, err := runInstaller(t, fake.server(t), "HOME="+t.TempDir(), "SELF_HOST_INSTALL_DIR="+dir, "SELF_HOST_VERSION=1.1.2")

	if err == nil || !strings.Contains(out, "not a CLI release") {
		t.Fatalf("expected a refusal, got %v\n%s", err, out)
	}
	if installedBinary(dir) != "" {
		t.Error("installed a skill-pack release")
	}
}

func TestInstallScriptPinsAVersionByPlainTag(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "bin")
	fake := &installFake{tag: "v1.3.0", binary: "pinned-plain"}

	out, err := runInstaller(t, fake.server(t), "HOME="+t.TempDir(), "SELF_HOST_INSTALL_DIR="+dir, "SELF_HOST_VERSION=1.3.0")

	if err != nil || installedBinary(dir) != "pinned-plain" {
		t.Fatalf("install: %v\n%s", err, out)
	}
}

func TestInstallScriptFollowsARepositoryRenameRedirect(t *testing.T) {
	for _, token := range []string{"", "fixture-token"} {
		dir := filepath.Join(t.TempDir(), "bin")
		fake := &installFake{tag: "v1.3.0", binary: "after-rename", token: token}
		server := fake.server(t)

		out, err := runInstaller(t, server, "HOME="+t.TempDir(), "SELF_HOST_INSTALL_DIR="+dir,
			"SELF_HOST_RELEASES_URL="+server.URL+"/oldapi", "SELF_HOST_WEB_URL="+server.URL+"/oldweb", "SELF_HOST_GITHUB_TOKEN="+token)

		if err != nil || installedBinary(dir) != "after-rename" {
			t.Fatalf("token %q: install: %v\n%s", token, err, out)
		}
	}
}

func TestInstallScriptReleaseRepoOverride(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "bin")
	tools := t.TempDir()
	log := filepath.Join(tools, "urls")
	realCurl, err := exec.LookPath("curl")
	if err != nil {
		t.Skip("curl not installed")
	}
	shim := `#!/bin/sh
n=$#
while [ "$n" -gt 0 ]; do
  a=$1; shift
  case "$a" in https://api.github.com/*)
    echo "$a" >> "$SHIM_LOG"
    a=$(printf '%s' "$a" | sed -E "s#^https://api.github.com/repos/[^/]+/[^/]+#$SHIM_API#")
  esac
  set -- "$@" "$a"; n=$((n-1))
done
exec "$REAL_CURL" "$@"
`
	os.WriteFile(filepath.Join(tools, "curl"), []byte(shim), 0755)
	fake := &installFake{tag: "v1.3.0", binary: "forked"}
	server := fake.server(t)

	out, err := runInstaller(t, server, "HOME="+t.TempDir(), "SELF_HOST_INSTALL_DIR="+dir, "SELF_HOST_RELEASES_URL=", "SELF_HOST_GITHUB_TOKEN=",
		"SELF_HOST_RELEASE_REPO=acme/selfhost", "SHIM_LOG="+log, "SHIM_API="+server.URL+"/api", "REAL_CURL="+realCurl, "PATH="+tools+":"+os.Getenv("PATH"))

	if err != nil || installedBinary(dir) != "forked" {
		t.Fatalf("install: %v\n%s", err, out)
	}
	if urls, _ := os.ReadFile(log); !strings.Contains(string(urls), "https://api.github.com/repos/acme/selfhost/releases") {
		t.Errorf("release lookup did not use the override:\n%s", urls)
	}
}

func TestInstallScriptRejectsAMalformedReleaseRepo(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "bin")
	out, err := runInstaller(t, (&installFake{tag: "v1.3.0", binary: "x"}).server(t), "HOME="+t.TempDir(), "SELF_HOST_INSTALL_DIR="+dir, "SELF_HOST_RELEASE_REPO=ajnart/..")
	if err == nil || !strings.Contains(out, "SELF_HOST_RELEASE_REPO") || installedBinary(dir) != "" {
		t.Fatalf("accepted a malformed repository: %v\n%s", err, out)
	}
}

func TestInstallScriptFailsLoudlyWhenADownloadFails(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "bin")
	fake := &installFake{tag: "v1.3.0", binary: "x", downloadError: http.StatusInternalServerError}

	out, err := runInstaller(t, fake.server(t), "HOME="+t.TempDir(), "SELF_HOST_INSTALL_DIR="+dir)

	if err == nil || !strings.Contains(out, "could not download") {
		t.Fatalf("expected a download failure, got %v\n%s", err, out)
	}
	if installedBinary(dir) != "" {
		t.Error("installed after a failed download")
	}
}

func TestInstallScriptTruncatedDownloadInstallsNothing(t *testing.T) {
	if _, err := exec.LookPath("bash"); err != nil {
		t.Skip("bash not installed")
	}
	script, err := os.ReadFile("../../install.sh")
	if err != nil {
		t.Fatal(err)
	}
	lines := strings.Split(strings.TrimRight(string(script), "\n"), "\n")
	if last := lines[len(lines)-1]; last != `main "$@"` {
		t.Fatalf("the last line must be the call to main, got %q", last)
	}
	for name, truncated := range map[string]string{
		"without the call": strings.Join(lines[:len(lines)-1], "\n"),
		"mid function":     strings.Join(lines[:len(lines)*3/4], "\n"),
		"half":             strings.Join(lines[:len(lines)/2], "\n"),
	} {
		t.Run(name, func(t *testing.T) {
			dir := filepath.Join(t.TempDir(), "bin")
			cmd := exec.Command("bash", "-s")
			cmd.Stdin = strings.NewReader(truncated)
			cmd.Env = []string{"PATH=" + os.Getenv("PATH"), "HOME=" + t.TempDir(), "SELF_HOST_INSTALL_DIR=" + dir, "SELF_HOST_RELEASES_URL=http://127.0.0.1:1", "SELF_HOST_WEB_URL=http://127.0.0.1:1"}
			out, _ := cmd.CombinedOutput()
			if strings.Contains(string(out), "Downloading") || strings.Contains(string(out), "Installed") {
				t.Errorf("a truncated script ran the installer:\n%s", out)
			}
			if _, err := os.Stat(dir); err == nil {
				t.Error("a truncated script created the install directory")
			}
		})
	}
}

func TestInstallScriptExplainsHowToAddTheInstallDirToPATH(t *testing.T) {
	bashFile := "~/.bashrc"
	if runtime.GOOS == "darwin" {
		bashFile = "~/.bash_profile"
	}
	for _, tc := range []struct{ shell, want string }{
		{"/bin/bash", `echo 'export PATH="$HOME/.local/bin:$PATH"' >> ` + bashFile},
		{"/usr/bin/zsh", `echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.zshrc`},
		{"/usr/bin/fish", `fish_add_path $HOME/.local/bin`},
		{"/bin/tcsh", `export PATH="$HOME/.local/bin:$PATH"`},
	} {
		t.Run(filepath.Base(tc.shell), func(t *testing.T) {
			home := t.TempDir()
			server := (&installFake{tag: "v1.3.0", binary: "x"}).server(t)

			installDir := filepath.Join(home, ".local", "bin")
			out, err := runInstaller(t, server, "HOME="+home, "SELF_HOST_INSTALL_DIR="+installDir, "SHELL="+tc.shell)

			if err != nil || !strings.Contains(out, "not on your PATH") || !strings.Contains(out, tc.want) {
				t.Fatalf("install: %v; want %q in:\n%s", err, tc.want, out)
			}
		})
	}
}

func fakeDockerPath(t *testing.T, script string) string {
	t.Helper()
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "docker"), []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}
	return "PATH=" + dir + string(os.PathListSeparator) + os.Getenv("PATH")
}

func TestInstallScriptWarnsWhenTheDockerSocketIsDenied(t *testing.T) {
	denied := "#!/bin/sh\necho 'permission denied while trying to connect to the Docker daemon socket' >&2\nexit 1\n"
	for _, tc := range []struct {
		name, docker string
		warn         bool
	}{
		{"denied", denied, true},
		{"reachable", "#!/bin/sh\nexit 0\n", false},
		{"stopped", "#!/bin/sh\necho 'Is the docker daemon running?' >&2\nexit 1\n", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			server := (&installFake{tag: "v1.3.0", binary: "x"}).server(t)

			out, err := runInstaller(t, server, "HOME="+t.TempDir(), fakeDockerPath(t, tc.docker))

			if err != nil {
				t.Fatalf("install failed: %v\n%s", err, out)
			}
			warned := strings.Contains(out, "permission denied") && strings.Contains(out, "sudo usermod -aG docker $USER") && strings.Contains(out, `sudo "$(command -v self-host)"`)
			if warned != tc.warn {
				t.Fatalf("warned = %v, want %v:\n%s", warned, tc.warn, out)
			}
			if strings.Contains(out, "Docker was not found") {
				t.Fatalf("docker is on PATH:\n%s", out)
			}
			if !strings.Contains(out, "self-host install media --yes") {
				t.Fatalf("summary missing:\n%s", out)
			}
		})
	}
}
