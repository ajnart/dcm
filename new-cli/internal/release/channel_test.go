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

func TestLatestSelectsStableCLIChannelInsteadOfPluginRelease(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/releases" {
			http.Error(w, "wrong channel", http.StatusNotFound)
			return
		}
		w.Write([]byte(`[{"tag_name":"v99.0.0"},{"tag_name":"new-cli-v1.9.0"},{"tag_name":"new-cli-v1.10.0"},{"tag_name":"new-cli-v2.0.0","draft":true},{"tag_name":"new-cli-v3.0.0-rc1","prerelease":true},{"tag_name":"new-cli-v01.11.0"}]`))
	}))
	defer server.Close()
	client := release.Client{HTTP: server.Client(), APIURL: server.URL, WebURL: server.URL}
	got, err := client.Latest(context.Background())
	if err != nil || got.Tag != "new-cli-v1.10.0" || got.ArchiveName("linux", "amd64") != "self-host_1.10.0_linux_amd64.tar.gz" {
		t.Fatalf("Latest = %+v, %v", got, err)
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
