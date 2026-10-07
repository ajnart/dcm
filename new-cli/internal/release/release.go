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
	"time"

	"github.com/ajnart/self-host/internal/system"
)

// DefaultAPI is the GitHub API root of the repository that publishes releases.
const DefaultAPI = "https://api.github.com/repos/ajnart/self-host"

// DefaultWeb is the github.com root of the same repository. Looking up the
// latest tag through its redirect is not subject to API rate limits.
const DefaultWeb = "https://github.com/ajnart/self-host"

// Environment overrides for the two roots, for tests and mirrors.
const (
	EnvAPI = "SELF_HOST_RELEASES_URL"
	EnvWeb = "SELF_HOST_WEB_URL"
)

// InstallCommand is the one-line installer, for messages that point at it.
const InstallCommand = "curl -fsSL https://raw.githubusercontent.com/ajnart/self-host/main/install.sh | bash"

const (
	binaryName    = "self-host"
	checksumsName = "checksums.txt"
	maxArchive    = 200 << 20
	maxChecksums  = 1 << 20

	lookupTimeout   = 15 * time.Second
	downloadTimeout = 5 * time.Minute
)

// Release is one published version.
type Release struct {
	Tag string
}

// Version is the tag without its leading "v".
func (r Release) Version() string { return strings.TrimPrefix(r.Tag, "v") }

// ArchiveName is the goreleaser archive for a platform.
func (r Release) ArchiveName(goos, goarch string) string {
	return fmt.Sprintf("%s_%s_%s_%s.tar.gz", binaryName, r.Version(), goos, goarch)
}

type Client struct {
	// HTTP must have no total Timeout: downloads are bounded per request.
	HTTP *http.Client
	// APIURL and WebURL default to DefaultAPI and DefaultWeb.
	APIURL string
	WebURL string
}

// NewClient builds the Client for a binary's dependencies. The shared HTTP
// client's total timeout would cut off a slow download, so it is copied
// without one and every request gets its own deadline instead.
func NewClient(deps *system.Deps) Client {
	httpClient := http.Client{}
	if deps.HTTP != nil {
		httpClient = *deps.HTTP
	}
	httpClient.Timeout = 0
	return Client{HTTP: &httpClient, APIURL: deps.Getenv(EnvAPI), WebURL: deps.Getenv(EnvWeb)}
}

func orDefault(value, fallback string) string {
	if value == "" {
		return fallback
	}
	return strings.TrimSuffix(value, "/")
}

func (c Client) api() string { return orDefault(c.APIURL, DefaultAPI) }
func (c Client) web() string { return orDefault(c.WebURL, DefaultWeb) }

func (c Client) do(ctx context.Context, method, url, accept string, timeout time.Duration) (*http.Response, context.CancelFunc, error) {
	ctx, cancel := context.WithTimeout(ctx, timeout)
	req, err := http.NewRequestWithContext(ctx, method, url, nil)
	if err != nil {
		cancel()
		return nil, nil, err
	}
	req.Header.Set("User-Agent", "self-host")
	if accept != "" {
		req.Header.Set("Accept", accept)
	}
	resp, err := c.HTTP.Do(req)
	if err != nil {
		cancel()
		return nil, nil, err
	}
	return resp, cancel, nil
}

func (c Client) get(ctx context.Context, url, accept string, limit int64, timeout time.Duration) ([]byte, error) {
	resp, cancel, err := c.do(ctx, http.MethodGet, url, accept, timeout)
	if err != nil {
		return nil, err
	}
	defer cancel()
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

// Latest returns the newest published release. It follows the redirect of
// github.com/<repo>/releases/latest first, and asks the API only when that
// fails, because the API is rate limited per IP address.
func (c Client) Latest(ctx context.Context) (Release, error) {
	if tag, err := c.latestFromRedirect(ctx); err == nil {
		return Release{Tag: tag}, nil
	}
	body, err := c.get(ctx, c.api()+"/releases/latest", "application/vnd.github+json", maxChecksums, lookupTimeout)
	if err != nil {
		return Release{}, fmt.Errorf("look up the latest release: %w", err)
	}
	var rel struct {
		Tag string `json:"tag_name"`
	}
	if err := json.Unmarshal(body, &rel); err != nil || rel.Tag == "" {
		return Release{}, errors.New("look up the latest release: unexpected response")
	}
	return Release{Tag: rel.Tag}, nil
}

func (c Client) latestFromRedirect(ctx context.Context) (string, error) {
	resp, cancel, err := c.do(ctx, http.MethodHead, c.web()+"/releases/latest", "", lookupTimeout)
	if err != nil {
		return "", err
	}
	defer cancel()
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("releases/latest: %s", resp.Status)
	}
	dir, tag := path.Split(resp.Request.URL.Path)
	if tag == "" || path.Base(dir) != "tag" {
		return "", errors.New("releases/latest did not redirect to a tag")
	}
	return tag, nil
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
	base := c.web() + "/releases/download/" + rel.Tag + "/"
	sumsBody, err := c.get(ctx, base+checksumsName, "", maxChecksums, downloadTimeout)
	if err != nil {
		return fmt.Errorf("download %s: %w", checksumsName, err)
	}
	want, ok := checksumFor(sumsBody, name)
	if !ok {
		return fmt.Errorf("%s does not list %s: release %s has no build for %s/%s", checksumsName, name, rel.Tag, goos, goarch)
	}
	data, err := c.get(ctx, base+name, "", maxArchive, downloadTimeout)
	if err != nil {
		return fmt.Errorf("download %s: %w", name, err)
	}
	sum := sha256.Sum256(data)
	if got := hex.EncodeToString(sum[:]); got != want {
		return fmt.Errorf("checksum mismatch for %s: expected %s, got %s; nothing was installed", name, want, got)
	}
	binary, err := extract(data, maxArchive)
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

func extract(archive []byte, limit int64) ([]byte, error) {
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
			binary, err := io.ReadAll(io.LimitReader(tr, limit+1))
			if err != nil {
				return nil, err
			}
			if int64(len(binary)) > limit {
				return nil, fmt.Errorf("%s is larger than %d bytes", binaryName, limit)
			}
			return binary, nil
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
