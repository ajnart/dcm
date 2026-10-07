//go:build e2e

package e2e

import (
	"context"
	"crypto/x509"
	"errors"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strings"
	"time"
)

type netBirdFixture struct {
	route       *netBirdRoute
	backendPort int
	realDocker  string
}

func (r *runner) prepareNetBirdFixture(reservation *portReservation) {
	if !slices.Contains(r.spec.Apps, "netbird") {
		return
	}
	backend, listener, err := reserveNetBirdFixturePorts(reservation)
	if err != nil {
		r.t.Fatal("reserve owned NetBird route")
	}
	real, err := exec.LookPath("docker")
	if err != nil {
		listener.Close()
		r.t.Fatal("owned Docker executable unavailable")
	}
	route, err := newNetBirdRoute(r.root, listener, fmt.Sprintf("http://127.0.0.1:%d", backend))
	if err != nil {
		r.t.Fatal("prepare owned NetBird verified TLS")
	}
	r.netbird = &netBirdFixture{route: route, backendPort: backend, realDocker: real}
	r.netbirdOwner = true
	r.attachNetBirdFixture(r.netbird)
	var stages []stageEvidence
	for _, stage := range r.evidence.Stages {
		stages = append(stages, stage)
		name := ""
		if stage.Name == "setup-check" {
			name = "management-tls"
		}
		if stage.Name == "restored-check" {
			name = "restored-management-tls"
		}
		if name != "" {
			stages = append(stages, stageEvidence{Name: name, Outcome: "not-run", Apps: map[string]string{"netbird": "not-run"}})
		}
	}
	r.evidence.Stages = stages
	r.evidence.Probe += "; real NetBird owner and protected management API through owned verified loopback HTTPS before backup and after isolated restore; no peer/VPN/browser claim"
}

func (r *runner) attachNetBirdFixture(fixture *netBirdFixture) {
	wrapper, err := writeNetBirdDockerWrapper(r.root, r.project, r.name, fixture.realDocker, fixture.backendPort)
	if err != nil {
		r.t.Fatal("prepare owned NetBird Compose route override")
	}
	r.netbird = fixture
	path := ""
	for _, item := range r.env {
		if strings.HasPrefix(item, "PATH=") {
			path = strings.TrimPrefix(item, "PATH=")
		}
	}
	r.env = append(r.env, "PATH="+filepath.Dir(wrapper)+string(os.PathListSeparator)+path, "SSL_CERT_FILE="+fixture.route.caFile)
}

func (r *runner) netBirdManagementProbe() result {
	fail := func(reason string) result {
		return result{code: 1, events: []event{{Event: "step.fail", App: "netbird", Step: "management-tls", Error: reason}}}
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	request, _ := http.NewRequestWithContext(ctx, http.MethodGet, r.netbird.route.origin+"/api/users/current", nil)
	untrusted := &http.Client{Timeout: 10 * time.Second, Transport: &http.Transport{Proxy: nil}, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	if response, err := untrusted.Do(request); err == nil {
		response.Body.Close()
		return fail("management route accepted untrusted TLS")
	} else {
		var authority x509.UnknownAuthorityError
		if !errors.As(err, &authority) {
			return fail("untrusted probe did not prove fixture CA rejection")
		}
	}
	response, err := r.netbird.route.client().Do(request)
	if err != nil {
		return fail("management route did not establish verified fixture TLS")
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusUnauthorized && response.StatusCode != http.StatusForbidden {
		return fail("management API did not deny anonymous access")
	}
	// The normal CLI setup/check already proves saved PAT owner identity.
	return result{}
}
