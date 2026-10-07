//go:build e2e

package e2e

import (
	"crypto/x509"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"slices"
)

func (r *runner) autheliaFixtureFailure() {
	r.evidence.Outcome = "failed"
	r.evidence.BlockerReason = "authelia: owned verified TLS route preparation failed"
	r.saveEvidence()
	r.t.Fatal(r.evidence.BlockerReason)
}

func (r *runner) prepareAutheliaFixture(reservation *portReservation) {
	if !slices.Contains(r.spec.Apps, "authelia") {
		return
	}
	port := reservation.primary["authelia"]
	if port <= 0 {
		r.autheliaFixtureFailure()
		return
	}
	front, proxy, err := reserveAutheliaFixturePorts(reservation)
	if err != nil {
		r.autheliaFixtureFailure()
		return
	}
	route, err := newAutheliaRoute(r.root, front, proxy, fmt.Sprintf("http://127.0.0.1:%d", port))
	if err != nil {
		r.autheliaFixtureFailure()
		return
	}
	r.authelia, r.autheliaOwner = route, true
	if err := r.attachAutheliaFixture(route); err != nil {
		r.autheliaFixtureFailure()
		return
	}
	r.evidence.Probe += "; Authelia canonical-origin administrator login and session identity through owned verified TLS during source and restored Setup/Check; no MFA/browser claim"
}

func (r *runner) attachAutheliaFixture(route *autheliaRoute) error {
	caFile := route.caFile
	if r.netbird != nil {
		// These are generated public fixture certificates, never runtime secrets.
		var combined []byte
		pool := x509.NewCertPool()
		for _, path := range []string{route.caFile, r.netbird.route.caFile} {
			data, err := os.ReadFile(path)
			if err != nil || len(data) > 16*1024 || !pool.AppendCertsFromPEM(data) {
				return errors.New("owned fixture certificate unavailable")
			}
			combined = append(combined, data...)
			combined = append(combined, '\n')
		}
		caFile = filepath.Join(r.root, "acceptance-fixture-ca.pem")
		if os.WriteFile(caFile, combined, 0o600) != nil {
			return errors.New("owned fixture trust could not be prepared")
		}
	}
	r.authelia = route
	r.env = autheliaChildEnvironment(r.env, route.proxyURL, caFile)
	return nil
}
