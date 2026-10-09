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
	fixture := &netBirdFixture{route: route, backendPort: backend, realDocker: real}
	r.attachNetBirdFixture(fixture, true)
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

func (r *runner) attachNetBirdFixture(fixture *netBirdFixture, owner bool) {
	wrapper, err := writeNetBirdDockerWrapper(r.root, r.project, r.name, fixture.realDocker, fixture.backendPort)
	if err != nil {
		r.t.Fatal("prepare owned NetBird Compose route override")
	}
	r.addFixture("netbird", fixture, &fixtureHooks{
		override: filepath.Join(r.root, "netbird-override.yml"),
		inputs:   []string{"--set", "netbird.NETBIRD_CANONICAL_ORIGIN=" + fixture.route.origin},
		checkFn: func(phase string) result {
			switch phase {
			case "setup":
				r.stage("management-tls", []string{"verify", "owned-verified-tls-and-protected-management-api"}, func() result { return fixture.managementProbe() })
			case "restored":
				r.evidenceOwner.stage("restored-management-tls", []string{"verify", "owned-verified-tls-and-protected-management-api"}, func() result { return fixture.managementProbe() })
			}
			return result{}
		},
		reattachFn: func(target *runner) error { target.attachNetBirdFixture(fixture, false); return nil },
		closeFn: func(before bool) {
			if !before && owner {
				fixture.route.close()
			}
		},
	})
	path := ""
	for _, item := range r.env {
		if strings.HasPrefix(item, "PATH=") {
			path = strings.TrimPrefix(item, "PATH=")
		}
	}
	r.env = append(r.env, "PATH="+filepath.Dir(wrapper)+string(os.PathListSeparator)+path, "SSL_CERT_FILE="+fixture.route.caFile)
}

func (f *netBirdFixture) managementProbe() result {
	fail := func(reason string) result {
		return result{code: 1, events: []event{{Event: "step.fail", App: "netbird", Step: "management-tls", Error: reason}}}
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	request, _ := http.NewRequestWithContext(ctx, http.MethodGet, f.route.origin+"/api/users/current", nil)
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
	response, err := f.route.client().Do(request)
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
