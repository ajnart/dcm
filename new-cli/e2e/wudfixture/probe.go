package wudfixture

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"time"
)

// Probe proves readiness through the same verified mutual TLS endpoint and
// exact owned inventory WUD will use; it never connects to a Docker socket.
func Probe(ctx context.Context, address, project string, material Material, expected Snapshot) error {
	fail := errors.New("owned WUD mutual TLS inventory is not ready")
	if !expected.Valid(project, time.Now()) {
		return fail
	}
	roots := x509.NewCertPool()
	if !roots.AppendCertsFromPEM(material.CA) {
		return fail
	}
	cert, err := tls.X509KeyPair(material.ClientCertificate, material.ClientKey)
	if err != nil {
		return fail
	}
	transport := &http.Transport{Proxy: nil, TLSClientConfig: &tls.Config{MinVersion: tls.VersionTLS12, ServerName: Host, RootCAs: roots, Certificates: []tls.Certificate{cert}}}
	defer transport.CloseIdleConnections()
	client := &http.Client{Transport: transport, Timeout: 2 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	request, err := http.NewRequestWithContext(ctx, "GET", "https://"+address+"/containers/json", nil)
	if err != nil {
		return fail
	}
	response, err := client.Do(request)
	if err != nil {
		return fail
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return fail
	}
	var containers []struct {
		ID                    string `json:"Id"`
		Image, ImageID, State string
		Labels                map[string]string
	}
	if json.NewDecoder(io.LimitReader(response.Body, MaxSnapshotBytes)).Decode(&containers) != nil || len(containers) != 1 {
		return fail
	}
	container := containers[0]
	if container.ID != expected.ContainerID || container.ImageID != expected.ImageID || container.Image != expected.Image || container.State != "running" || container.Labels["com.docker.compose.project"] != project || container.Labels["com.docker.compose.service"] != "ntfy" || container.Labels["wud.watch"] != "true" || container.Labels["wud.watch.digest"] != "false" {
		return fail
	}
	return nil
}
