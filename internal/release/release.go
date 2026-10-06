// Package release finds the latest self-host release on GitHub and replaces
// the running binary with it after checking the published sha256 checksum.
package release

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strconv"
	"strings"
)

// DefaultAPI is the GitHub API root of the repository that publishes releases.
const DefaultAPI = "https://api.github.com/repos/ajnart/self-host"

// EnvAPI overrides DefaultAPI, for tests and mirrors.
const EnvAPI = "SELF_HOST_RELEASES_URL"

const (
	binaryName    = "self-host"
	checksumsName = "checksums.txt"
	maxArchive    = 200 << 20
	maxChecksums  = 1 << 20
)

type Asset struct {
	Name string `json:"name"`
	URL  string `json:"browser_download_url"`
}

type Release struct {
	Tag    string  `json:"tag_name"`
	Assets []Asset `json:"assets"`
}

// Version is the tag without its leading "v".
func (r Release) Version() string { return strings.TrimPrefix(r.Tag, "v") }

// ArchiveName is the goreleaser archive for a platform.
func (r Release) ArchiveName(goos, goarch string) string {
	return fmt.Sprintf("%s_%s_%s_%s.tar.gz", binaryName, r.Version(), goos, goarch)
}

func (r Release) asset(name string) (Asset, bool) {
	for _, a := range r.Assets {
		if a.Name == name {
			return a, true
		}
	}
	return Asset{}, false
}

type Client struct {
	HTTP *http.Client
	// BaseURL is the repository API root; empty means DefaultAPI.
	BaseURL string
}

func (c Client) base() string {
	if c.BaseURL == "" {
		return DefaultAPI
	}
	return strings.TrimSuffix(c.BaseURL, "/")
}

func (c Client) get(ctx context.Context, url string, limit int64) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("User-Agent", "self-host")
	resp, err := c.HTTP.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("GET %s: %s", url, resp.Status)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, limit+1))
	if err != nil {
		return nil, err
	}
	if int64(len(body)) > limit {
		return nil, fmt.Errorf("GET %s: response larger than %d bytes", url, limit)
	}
	return body, nil
}

// Latest returns the newest published release.
func (c Client) Latest(ctx context.Context) (Release, error) {
	body, err := c.get(ctx, c.base()+"/releases/latest", maxChecksums)
	if err != nil {
		return Release{}, fmt.Errorf("look up the latest release: %w", err)
	}
	var rel Release
	if err := json.Unmarshal(body, &rel); err != nil || rel.Tag == "" {
		return Release{}, errors.New("look up the latest release: unexpected response")
	}
	return rel, nil
}

// Newer reports whether latest is a higher version than current. It fails when
// current is not a release version, such as a "dev" build.
func Newer(current, latest string) (bool, error) {
	cur, err := parseVersion(current)
	if err != nil {
		return false, err
	}
	lat, err := parseVersion(latest)
	if err != nil {
		return false, err
	}
	for i := range cur {
		if lat[i] != cur[i] {
			return lat[i] > cur[i], nil
		}
	}
	return false, nil
}

// IsRelease reports whether v looks like a release version rather than "dev".
func IsRelease(v string) bool {
	_, err := parseVersion(v)
	return err == nil
}

func parseVersion(v string) ([3]int, error) {
	var out [3]int
	core := strings.TrimPrefix(strings.TrimSpace(v), "v")
	core, _, _ = strings.Cut(core, "-")
	core, _, _ = strings.Cut(core, "+")
	parts := strings.Split(core, ".")
	if len(parts) > 3 {
		return out, fmt.Errorf("%q is not a release version", v)
	}
	for i, part := range parts {
		n, err := strconv.Atoi(part)
		if err != nil || n < 0 {
			return out, fmt.Errorf("%q is not a release version", v)
		}
		out[i] = n
	}
	return out, nil
}

// Install downloads rel's archive for the platform, verifies its checksum and
// atomically replaces the file at exe with the binary inside. exe is left
// untouched on any failure.
func (c Client) Install(ctx context.Context, rel Release, goos, goarch, exe string) error {
	name := rel.ArchiveName(goos, goarch)
	archive, ok := rel.asset(name)
	if !ok {
		return fmt.Errorf("release %s has no asset %s for %s/%s", rel.Tag, name, goos, goarch)
	}
	sums, ok := rel.asset(checksumsName)
	if !ok {
		return fmt.Errorf("release %s has no %s", rel.Tag, checksumsName)
	}
	sumsBody, err := c.get(ctx, sums.URL, maxChecksums)
	if err != nil {
		return fmt.Errorf("download %s: %w", checksumsName, err)
	}
	want, ok := checksumFor(sumsBody, name)
	if !ok {
		return fmt.Errorf("%s does not list %s", checksumsName, name)
	}
	data, err := c.get(ctx, archive.URL, maxArchive)
	if err != nil {
		return fmt.Errorf("download %s: %w", name, err)
	}
	sum := sha256.Sum256(data)
	if got := hex.EncodeToString(sum[:]); got != want {
		return fmt.Errorf("checksum mismatch for %s: expected %s, got %s; nothing was installed", name, want, got)
	}
	binary, err := extract(data)
	if err != nil {
		return fmt.Errorf("unpack %s: %w", name, err)
	}
	return replace(exe, binary)
}

func checksumFor(sums []byte, name string) (string, bool) {
	for _, line := range strings.Split(string(sums), "\n") {
		fields := strings.Fields(line)
		if len(fields) == 2 && strings.TrimPrefix(fields[1], "*") == name {
			return strings.ToLower(fields[0]), true
		}
	}
	return "", false
}

func extract(archive []byte) ([]byte, error) {
	gz, err := gzip.NewReader(bytes.NewReader(archive))
	if err != nil {
		return nil, err
	}
	defer gz.Close()
	tr := tar.NewReader(gz)
	for {
		header, err := tr.Next()
		if errors.Is(err, io.EOF) {
			return nil, fmt.Errorf("no %s binary inside", binaryName)
		}
		if err != nil {
			return nil, err
		}
		if header.Typeflag == tar.TypeReg && path.Base(header.Name) == binaryName {
			return io.ReadAll(io.LimitReader(tr, maxArchive))
		}
	}
}

// replace writes binary next to exe and renames it over exe.
func replace(exe string, binary []byte) error {
	target, err := filepath.EvalSymlinks(exe)
	if err != nil {
		return err
	}
	dir := filepath.Dir(target)
	tmp, err := os.CreateTemp(dir, ".self-host-update-*")
	if err != nil {
		return fmt.Errorf("cannot write to %s (rerun with sudo if it is a system directory): %w", dir, err)
	}
	defer os.Remove(tmp.Name())
	if _, err := tmp.Write(binary); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	if err := os.Chmod(tmp.Name(), 0o755); err != nil {
		return err
	}
	return os.Rename(tmp.Name(), target)
}
