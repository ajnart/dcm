package release_test

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/ajnart/self-host/internal/release"
)

func cliAssets(version string) string {
	return fmt.Sprintf(`[{"id":1,"name":"checksums.txt"},{"id":2,"name":"self-host_%[1]s_darwin_amd64.tar.gz"},{"id":3,"name":"self-host_%[1]s_darwin_arm64.tar.gz"},{"id":4,"name":"self-host_%[1]s_linux_amd64.tar.gz"},{"id":5,"name":"self-host_%[1]s_linux_arm64.tar.gz"}]`, version)
}

func legacyAssets(version string) string {
	return fmt.Sprintf(`[{"name":"ajnart-selfhost-%[1]s.tgz"},{"name":"CLI-SHA256SUMS"},{"name":"RELEASE-MANIFEST.json"},{"name":"selfhost-skills-%[1]s.zip"},{"name":"SHA256SUMS"}]`, version)
}

func latestFrom(t *testing.T, list string) (release.Release, error) {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/releases" {
			http.Error(w, "wrong path", http.StatusNotFound)
			return
		}
		w.Write([]byte(list))
	}))
	defer server.Close()
	client := release.Client{HTTP: server.Client(), APIURL: server.URL, WebURL: server.URL}
	return client.Latest(context.Background())
}

func TestLatestSelectsStableCLIChannelInsteadOfPluginRelease(t *testing.T) {
	list := fmt.Sprintf(`[{"tag_name":"v99.0.0","assets":%s},{"tag_name":"new-cli-v1.9.0","assets":%s},{"tag_name":"new-cli-v1.10.0","assets":%s},{"tag_name":"new-cli-v2.0.0","draft":true,"assets":%s},{"tag_name":"new-cli-v3.0.0-rc1","prerelease":true,"assets":%s},{"tag_name":"new-cli-v01.11.0","assets":%s}]`,
		legacyAssets("99.0.0"), cliAssets("1.9.0"), cliAssets("1.10.0"), cliAssets("2.0.0"), cliAssets("3.0.0"), cliAssets("1.11.0"))
	got, err := latestFrom(t, list)
	if err != nil || got.Tag != "new-cli-v1.10.0" || got.ArchiveName("linux", "amd64") != "self-host_1.10.0_linux_amd64.tar.gz" {
		t.Fatalf("Latest = %+v, %v", got, err)
	}
}

func TestLatestNeverChoosesTheLegacySkillPackReleases(t *testing.T) {
	list := fmt.Sprintf(`[{"tag_name":"v1.1.2","assets":%s},{"tag_name":"v1.1.1","assets":%s},{"tag_name":"v1.0.0","assets":[{"name":"RELEASE-MANIFEST.json"},{"name":"selfhost-skills-1.0.0.zip"},{"name":"SHA256SUMS"}]},{"tag_name":"new-cli-v0.2.0","assets":%s},{"tag_name":"new-cli-v0.1.2","assets":%s}]`,
		legacyAssets("1.1.2"), legacyAssets("1.1.1"), cliAssets("0.2.0"), cliAssets("0.1.2"))
	got, err := latestFrom(t, list)
	if err != nil || got.Tag != "new-cli-v0.2.0" {
		t.Fatalf("Latest = %+v, %v", got, err)
	}
}

func TestLatestFailsWhenOnlyLegacyReleasesExist(t *testing.T) {
	list := fmt.Sprintf(`[{"tag_name":"v1.1.2","assets":%s}]`, legacyAssets("1.1.2"))
	if got, err := latestFrom(t, list); err == nil {
		t.Fatalf("Latest = %+v, want an error", got)
	}
}

func TestLatestAcceptsPlainVersionTagsWithCLIAssets(t *testing.T) {
	list := fmt.Sprintf(`[{"tag_name":"v0.3.0","assets":%s},{"tag_name":"new-cli-v0.2.0","assets":%s},{"tag_name":"v0.4.0","draft":true,"assets":%s},{"tag_name":"v0.5.0","prerelease":true,"assets":%s}]`,
		cliAssets("0.3.0"), cliAssets("0.2.0"), cliAssets("0.4.0"), cliAssets("0.5.0"))
	got, err := latestFrom(t, list)
	if err != nil || got.Tag != "v0.3.0" || got.Version() != "0.3.0" || got.ArchiveName("darwin", "arm64") != "self-host_0.3.0_darwin_arm64.tar.gz" {
		t.Fatalf("Latest = %+v, %v", got, err)
	}
}

func TestLatestSkipsAReleaseWithoutChecksumsOrArchives(t *testing.T) {
	list := fmt.Sprintf(`[{"tag_name":"v0.9.0","assets":[{"name":"self-host_0.9.0_linux_amd64.tar.gz"}]},{"tag_name":"v0.8.0","assets":[{"name":"checksums.txt"}]},{"tag_name":"v0.7.0","assets":[{"name":"checksums.txt"},{"name":"self-host_0.6.0_linux_amd64.tar.gz"}]},{"tag_name":"new-cli-v0.2.0","assets":%s}]`, cliAssets("0.2.0"))
	got, err := latestFrom(t, list)
	if err != nil || got.Tag != "new-cli-v0.2.0" {
		t.Fatalf("Latest = %+v, %v", got, err)
	}
}

func TestLatestFollowsARepositoryRenameRedirectKeepingTheToken(t *testing.T) {
	var final string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/repos/ajnart/selfhost-skills/releases":
			http.Redirect(w, r, "/repos/ajnart/self-host/releases?"+r.URL.RawQuery, http.StatusMovedPermanently)
		case "/repos/ajnart/self-host/releases":
			final = r.Header.Get("Authorization")
			fmt.Fprintf(w, `[{"tag_name":"v0.3.0","assets":%s}]`, cliAssets("0.3.0"))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	client := release.Client{HTTP: server.Client(), APIURL: server.URL + "/repos/ajnart/selfhost-skills", Token: "fixture-token"}

	got, err := client.Latest(context.Background())

	if err != nil || got.Tag != "v0.3.0" {
		t.Fatalf("Latest = %+v, %v", got, err)
	}
	if final != "Bearer fixture-token" {
		t.Errorf("Authorization after the redirect = %q", final)
	}
}

func TestAuthenticatedUpdateUsesExactAPIAssetsWithoutForwardingToken(t *testing.T) {
	var archive bytes.Buffer
	gz := gzip.NewWriter(&archive)
	tw := tar.NewWriter(gz)
	tw.WriteHeader(&tar.Header{Name: "self-host", Mode: 0755, Size: 3})
	tw.Write([]byte("new"))
	tw.Close()
	gz.Close()
	external := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "" {
			t.Error("token forwarded to download host")
		}
		w.Write(archive.Bytes())
	}))
	defer external.Close()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer fixture-token" {
			t.Error("missing private repository authentication")
		}
		switch r.URL.Path {
		case "/releases/tags/new-cli-v1.2.0":
			w.Write([]byte(`{"tag_name":"new-cli-v1.2.0","assets":[{"id":11,"name":"checksums.txt"},{"id":12,"name":"self-host_1.2.0_linux_amd64.tar.gz"}]}`))
		case "/releases/assets/11":
			fmt.Fprintf(w, "%x  self-host_1.2.0_linux_amd64.tar.gz\n", sha256.Sum256(archive.Bytes()))
		case "/releases/assets/12":
			http.Redirect(w, r, external.URL, http.StatusFound)
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	exe := filepath.Join(t.TempDir(), "self-host")
	os.WriteFile(exe, []byte("old"), 0755)
	client := release.Client{HTTP: server.Client(), APIURL: server.URL, WebURL: server.URL, Token: "fixture-token"}
	if err := client.Install(context.Background(), release.Release{Tag: "new-cli-v1.2.0"}, "linux", "amd64", exe); err != nil {
		t.Fatal(err)
	}
	got, _ := os.ReadFile(exe)
	if string(got) != "new" {
		t.Fatalf("installed %q", got)
	}
}

func TestUpdateRejectsDuplicateChecksumEntriesBeforeReplacement(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/releases/download/new-cli-v1.2.0/checksums.txt" {
			fmt.Fprint(w, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa  self-host_1.2.0_linux_amd64.tar.gz\naaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa  self-host_1.2.0_linux_amd64.tar.gz\n")
			return
		}
		t.Error("downloaded archive after ambiguous checksum")
		http.NotFound(w, r)
	}))
	defer server.Close()
	exe := filepath.Join(t.TempDir(), "self-host")
	os.WriteFile(exe, []byte("old"), 0755)
	client := release.Client{HTTP: server.Client(), WebURL: server.URL, APIURL: server.URL}
	if err := client.Install(context.Background(), release.Release{Tag: "new-cli-v1.2.0"}, "linux", "amd64", exe); err == nil {
		t.Fatal("accepted duplicate checksum")
	}
	if data, _ := os.ReadFile(exe); string(data) != "old" {
		t.Fatalf("changed executable: %q", data)
	}
}

func TestInstallSupportsDarwinAMD64Release(t *testing.T) {
	var archive bytes.Buffer
	gz := gzip.NewWriter(&archive)
	tw := tar.NewWriter(gz)
	tw.WriteHeader(&tar.Header{Name: "self-host", Mode: 0755, Size: 5})
	tw.Write([]byte("intel"))
	tw.Close()
	gz.Close()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/releases/download/new-cli-v1.2.0/checksums.txt":
			fmt.Fprintf(w, "%x  self-host_1.2.0_darwin_amd64.tar.gz\n", sha256.Sum256(archive.Bytes()))
		case "/releases/download/new-cli-v1.2.0/self-host_1.2.0_darwin_amd64.tar.gz":
			w.Write(archive.Bytes())
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	exe := filepath.Join(t.TempDir(), "self-host")
	os.WriteFile(exe, []byte("old"), 0755)
	client := release.Client{HTTP: server.Client(), WebURL: server.URL, APIURL: server.URL}
	if err := client.Install(context.Background(), release.Release{Tag: "new-cli-v1.2.0"}, "darwin", "amd64", exe); err != nil {
		t.Fatal(err)
	}
	if data, _ := os.ReadFile(exe); string(data) != "intel" {
		t.Fatalf("installed %q", data)
	}
}

func TestInstallFollowsARepositoryRenameRedirectOnPublicDownloads(t *testing.T) {
	var archive bytes.Buffer
	gz := gzip.NewWriter(&archive)
	tw := tar.NewWriter(gz)
	tw.WriteHeader(&tar.Header{Name: "self-host", Mode: 0755, Size: 3})
	tw.Write([]byte("new"))
	tw.Close()
	gz.Close()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/ajnart/selfhost-skills/releases/download/v1.2.0/checksums.txt":
			http.Redirect(w, r, "/ajnart/self-host/releases/download/v1.2.0/checksums.txt", http.StatusMovedPermanently)
		case "/ajnart/selfhost-skills/releases/download/v1.2.0/self-host_1.2.0_linux_amd64.tar.gz":
			http.Redirect(w, r, "/ajnart/self-host/releases/download/v1.2.0/self-host_1.2.0_linux_amd64.tar.gz", http.StatusMovedPermanently)
		case "/ajnart/self-host/releases/download/v1.2.0/checksums.txt":
			fmt.Fprintf(w, "%x  self-host_1.2.0_linux_amd64.tar.gz\n", sha256.Sum256(archive.Bytes()))
		case "/ajnart/self-host/releases/download/v1.2.0/self-host_1.2.0_linux_amd64.tar.gz":
			w.Write(archive.Bytes())
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	exe := filepath.Join(t.TempDir(), "self-host")
	os.WriteFile(exe, []byte("old"), 0755)
	client := release.Client{HTTP: server.Client(), WebURL: server.URL + "/ajnart/selfhost-skills", APIURL: server.URL}

	if err := client.Install(context.Background(), release.Release{Tag: "v1.2.0"}, "linux", "amd64", exe); err != nil {
		t.Fatal(err)
	}
	if data, _ := os.ReadFile(exe); string(data) != "new" {
		t.Fatalf("installed %q", data)
	}
}
