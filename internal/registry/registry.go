// Package registry asks image registries for the current digest of a tag,
// so floating tags like :latest can be compared with what is pulled locally.
package registry

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"
)

// Ref is a parsed image reference.
type Ref struct {
	Registry   string // host[:port] used for the API
	Repository string // e.g. library/nginx
	Tag        string
}

// Parse splits an image reference like lscr.io/linuxserver/sonarr:latest.
func Parse(image string) Ref {
	name, tag := image, "latest"
	if at := strings.Index(name, "@"); at >= 0 {
		name = name[:at]
	}
	if colon := strings.LastIndex(name, ":"); colon > strings.LastIndex(name, "/") {
		name, tag = name[:colon], name[colon+1:]
	}
	host, rest, found := strings.Cut(name, "/")
	if !found || (!strings.ContainsAny(host, ".:") && host != "localhost") {
		host, rest = "registry-1.docker.io", name
		if !strings.Contains(rest, "/") {
			rest = "library/" + rest
		}
	}
	if host == "docker.io" || host == "index.docker.io" {
		host = "registry-1.docker.io"
	}
	return Ref{Registry: host, Repository: rest, Tag: tag}
}

func (r Ref) scheme() string {
	host := strings.Split(r.Registry, ":")[0]
	if host == "localhost" || host == "127.0.0.1" {
		return "http"
	}
	return "https"
}

var accept = strings.Join([]string{
	"application/vnd.oci.image.index.v1+json",
	"application/vnd.docker.distribution.manifest.list.v2+json",
	"application/vnd.docker.distribution.manifest.v2+json",
	"application/vnd.oci.image.manifest.v1+json",
}, ", ")

// Digest returns the registry's current digest for ref's tag, answering an
// anonymous bearer-token challenge when the registry asks for one.
func Digest(ctx context.Context, client *http.Client, ref Ref) (string, error) {
	manifest := fmt.Sprintf("%s://%s/v2/%s/manifests/%s", ref.scheme(), ref.Registry, ref.Repository, ref.Tag)
	resp, err := head(ctx, client, manifest, "")
	if err != nil {
		return "", err
	}
	if resp.StatusCode == http.StatusUnauthorized {
		token, err := anonymousToken(ctx, client, resp.Header.Get("WWW-Authenticate"))
		if err != nil {
			return "", err
		}
		if resp, err = head(ctx, client, manifest, token); err != nil {
			return "", err
		}
	}
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("%s: HTTP %d", manifest, resp.StatusCode)
	}
	digest := resp.Header.Get("Docker-Content-Digest")
	if digest == "" {
		return "", errors.New(manifest + ": no Docker-Content-Digest header")
	}
	return digest, nil
}

func head(ctx context.Context, client *http.Client, target, token string) (*http.Response, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodHead, target, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", accept)
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	resp.Body.Close()
	return resp, nil
}

func anonymousToken(ctx context.Context, client *http.Client, challenge string) (string, error) {
	scheme, params, _ := strings.Cut(challenge, " ")
	if !strings.EqualFold(scheme, "Bearer") {
		return "", fmt.Errorf("unsupported registry auth %q", scheme)
	}
	values := map[string]string{}
	for _, part := range strings.Split(params, ",") {
		key, value, _ := strings.Cut(strings.TrimSpace(part), "=")
		values[key] = strings.Trim(value, `"`)
	}
	realm, err := url.Parse(values["realm"])
	if err != nil || values["realm"] == "" {
		return "", fmt.Errorf("bad registry realm %q", values["realm"])
	}
	q := realm.Query()
	for _, key := range []string{"service", "scope"} {
		if values[key] != "" {
			q.Set(key, values[key])
		}
	}
	realm.RawQuery = q.Encode()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, realm.String(), nil)
	if err != nil {
		return "", err
	}
	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("registry token: HTTP %d", resp.StatusCode)
	}
	var body struct {
		Token       string `json:"token"`
		AccessToken string `json:"access_token"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return "", err
	}
	if body.Token != "" {
		return body.Token, nil
	}
	return body.AccessToken, nil
}
