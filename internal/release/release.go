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
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/ajnart/self-host/internal/system"
)

// Repo is the GitHub repository that publishes releases. It is the one place
// the name is written; a repository rename changes only this line (GitHub
// redirects the old name until then) and the REPO variable in install.sh.
const Repo = "ajnart/self-host"

// Environment overrides, for tests, forks and mirrors. EnvRepo swaps the
// repository; EnvAPI and EnvWeb swap the two roots outright.
const (
	EnvRepo   = "SELF_HOST_RELEASE_REPO"
	EnvAPI    = "SELF_HOST_RELEASES_URL"
	EnvWeb    = "SELF_HOST_WEB_URL"
	EnvToken  = "SELF_HOST_GITHUB_TOKEN"
	TagPrefix = "new-cli-v"
)

// InstallCommand is the one-line installer, for messages that point at it.
const InstallCommand = "curl -fsSL https://self-host.fyi/install | bash"

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
	Tag        string  `json:"tag_name"`
	Draft      bool    `json:"draft"`
	Prerelease bool    `json:"prerelease"`
	Assets     []Asset `json:"assets"`
}

// Asset identifies an exact GitHub release download.
type Asset struct {
	ID   int64  `json:"id"`
	Name string `json:"name"`
}

// Version is the stable CLI tag without its prefix, for both tag forms
// (vX.Y.Z and the earlier new-cli-vX.Y.Z).
func (r Release) Version() string { return tagVersion(r.Tag) }

func tagVersion(tag string) string {
	if v, ok := strings.CutPrefix(tag, TagPrefix); ok {
		return v
	}
	return strings.TrimPrefix(tag, "v")
}

// platforms are the archives a CLI release is built for.
var platforms = []struct{ goos, goarch string }{
	{"linux", "amd64"}, {"linux", "arm64"}, {"darwin", "amd64"}, {"darwin", "arm64"},
}

// hasCLIAssets tells a CLI release from the legacy skill-pack releases that
// share the tag namespace: only a CLI release carries checksums.txt and a
// self-host archive named for its own version.
func (r Release) hasCLIAssets() bool {
	var sums, archive bool
	for _, asset := range r.Assets {
		if asset.Name == checksumsName {
			sums = true
		}
		for _, p := range platforms {
			if asset.Name == r.ArchiveName(p.goos, p.goarch) {
				archive = true
			}
		}
	}
	return sums && archive
}

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
	// Repo defaults to the package's Repo.
	Repo  string
	Token string
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
	return Client{HTTP: &httpClient, APIURL: deps.Getenv(EnvAPI), WebURL: deps.Getenv(EnvWeb), Repo: deps.Getenv(EnvRepo), Token: deps.Getenv(EnvToken)}
}

func orDefault(value, fallback string) string {
	if value == "" {
		return fallback
	}
	return strings.TrimSuffix(value, "/")
}

var repoName = regexp.MustCompile(`^[A-Za-z0-9_-][A-Za-z0-9_.-]*/[A-Za-z0-9_.-]+$`)

func (c Client) repo() string { return orDefault(c.Repo, Repo) }

func (c Client) api() string { return orDefault(c.APIURL, "https://api.github.com/repos/"+c.repo()) }
func (c Client) web() string { return orDefault(c.WebURL, "https://github.com/"+c.repo()) }

func (c Client) validate() error {
	if repo := c.repo(); !repoName.MatchString(repo) || strings.Contains(repo, "..") || strings.HasSuffix(repo, "/.") {
		return fmt.Errorf("%s must look like owner/name, not %q", EnvRepo, c.repo())
	}
	return nil
}

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
	if c.Token != "" && strings.HasPrefix(url, c.api()+"/") {
		req.Header.Set("Authorization", "Bearer "+c.Token)
	}
	httpClient := *c.HTTP
	previousRedirect := httpClient.CheckRedirect
	httpClient.CheckRedirect = func(next *http.Request, via []*http.Request) error {
		if next.URL.Scheme != req.URL.Scheme || next.URL.Host != req.URL.Host {
			next.Header.Del("Authorization")
		}
		if previousRedirect != nil {
			return previousRedirect(next, via)
		}
		if len(via) >= 10 {
			return errors.New("too many redirects")
		}
		return nil
	}
	resp, err := httpClient.Do(req)
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

// Latest selects the highest stable CLI release: a vX.Y.Z or new-cli-vX.Y.Z
// tag whose assets are the self-host archives and checksums.txt, which keeps
// the legacy skill-pack releases out whatever their version.
func (c Client) Latest(ctx context.Context) (Release, error) {
	if err := c.validate(); err != nil {
		return Release{}, err
	}
	var latest Release
	for page := 1; page <= 10; page++ {
		body, err := c.get(ctx, fmt.Sprintf("%s/releases?per_page=100&page=%d", c.api(), page), "application/vnd.github+json", maxChecksums, lookupTimeout)
		if err != nil {
			return Release{}, fmt.Errorf("look up CLI releases: %w", err)
		}
		var releases []Release
		if err := json.Unmarshal(body, &releases); err != nil {
			return Release{}, errors.New("look up CLI releases: unexpected response")
		}
		for _, rel := range releases {
			if rel.Draft || rel.Prerelease || !validTag(rel.Tag) || !rel.hasCLIAssets() {
				continue
			}
			newer, _ := Newer(latest.Version(), rel.Version())
			if latest.Tag == "" || newer {
				latest = rel
			}
		}
		if len(releases) < 100 {
			if latest.Tag == "" {
				return Release{}, errors.New("no CLI release is published (a vX.Y.Z tag with the self-host archives and checksums.txt)")
			}
			return latest, nil
		}
	}
	return Release{}, errors.New("CLI release lookup exceeded 1000 releases")
}

func validTag(tag string) bool {
	if !strings.HasPrefix(tag, "v") && !strings.HasPrefix(tag, TagPrefix) {
		return false
	}
	version := tagVersion(tag)
	if strings.HasPrefix(version, "v") {
		return false
	}
	_, err := parseVersion(version)
	return err == nil
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
	core := v
	if strings.HasPrefix(core, TagPrefix) {
		core = strings.TrimPrefix(core, TagPrefix)
	} else {
		core = strings.TrimPrefix(core, "v")
	}
	parts := strings.Split(core, ".")
	if len(parts) != 3 {
		return out, fmt.Errorf("%q is not a stable release version", v)
	}
	for i, part := range parts {
		n, err := strconv.Atoi(part)
		if err != nil || n < 0 || strconv.Itoa(n) != part {
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
	if err := c.validate(); err != nil {
		return err
	}
	if err := CheckSelfManaged(exe); err != nil {
		return err
	}
	if !validTag(rel.Tag) {
		return errors.New("invalid CLI release tag")
	}
	switch goos + "_" + goarch {
	case "linux_amd64", "linux_arm64", "darwin_amd64", "darwin_arm64":
	default:
		return fmt.Errorf("unsupported platform %s/%s", goos, goarch)
	}
	if c.Token != "" {
		body, err := c.get(ctx, c.api()+"/releases/tags/"+rel.Tag, "application/vnd.github+json", maxChecksums, lookupTimeout)
		if err != nil {
			return err
		}
		var detail Release
		if json.Unmarshal(body, &detail) != nil || detail.Tag != rel.Tag || detail.Draft || detail.Prerelease {
			return errors.New("release metadata does not match requested stable CLI tag")
		}
		rel = detail
	}
	name := rel.ArchiveName(goos, goarch)
	sumsBody, err := c.download(ctx, rel, checksumsName, maxChecksums)
	if err != nil {
		return fmt.Errorf("download %s: %w", checksumsName, err)
	}
	want, ok := checksumFor(sumsBody, name)
	if !ok {
		return fmt.Errorf("%s does not list %s: release %s has no build for %s/%s", checksumsName, name, rel.Tag, goos, goarch)
	}
	data, err := c.download(ctx, rel, name, maxArchive)
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

func (c Client) download(ctx context.Context, rel Release, name string, limit int64) ([]byte, error) {
	if c.Token != "" {
		for _, asset := range rel.Assets {
			if asset.Name == name && asset.ID > 0 {
				return c.get(ctx, fmt.Sprintf("%s/releases/assets/%d", c.api(), asset.ID), "application/octet-stream", limit, downloadTimeout)
			}
		}
		return nil, fmt.Errorf("release %s does not list %s", rel.Tag, name)
	}
	return c.get(ctx, c.web()+"/releases/download/"+rel.Tag+"/"+name, "", limit, downloadTimeout)
}

func checksumFor(sums []byte, name string) (string, bool) {
	var digest string
	for _, line := range strings.Split(string(sums), "\n") {
		fields := strings.Fields(line)
		if len(fields) == 2 && strings.TrimPrefix(fields[1], "*") == name {
			decoded, err := hex.DecodeString(fields[0])
			if digest != "" || err != nil || len(decoded) != sha256.Size {
				return "", false
			}
			digest = strings.ToLower(fields[0])
		}
	}
	return digest, digest != ""
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

// CheckSelfManaged refuses to replace a binary that a package manager or the
// Docker image owns, naming the command that updates it instead.
func CheckSelfManaged(exe string) error {
	path := exe
	if resolved, err := filepath.EvalSymlinks(exe); err == nil {
		path = resolved
	}
	path = filepath.ToSlash(path)
	switch {
	case os.Getenv("SELF_HOST_IMAGE") != "":
		return errors.New("the Docker image owns this install; update with: docker pull ghcr.io/ajnart/self-host:latest")
	case strings.Contains(path, "/node_modules/"):
		return errors.New("npm owns this install; update with: npm i -g self-host@latest")
	case strings.Contains(path, "/Caskroom/") || strings.Contains(path, "/Cellar/"):
		return errors.New("Homebrew owns this install; update with: brew upgrade self-host")
	case strings.HasPrefix(path, "/usr/bin/"):
		return fmt.Errorf("a system package manager owns %s; update it with that package manager", path)
	}
	return nil
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
