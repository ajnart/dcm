package e2e

import (
	"errors"
	"net"
	"strings"
)

func autheliaChildEnvironment(env []string, proxy, caFile string) []string {
	var child []string
	for _, item := range env {
		key, _, _ := strings.Cut(item, "=")
		switch strings.ToUpper(key) {
		case "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY", "SSL_CERT_FILE", "SSL_CERT_DIR":
			continue
		}
		child = append(child, item)
	}
	return append(child, "HTTPS_PROXY="+proxy, "NO_PROXY=", "SSL_CERT_FILE="+caFile)
}

// Active route listeners belong to the fixture, not install socket leases.
// Their registry ownership survives source and restore until successful teardown.
func reserveAutheliaFixturePorts(r *portReservation) (net.Listener, net.Listener, error) {
	r.pool.mu.Lock()
	defer r.pool.mu.Unlock()
	claim := func() (net.Listener, error) {
		for attempts := 0; attempts < 1024; attempts++ {
			listener, err := net.Listen("tcp4", "127.0.0.1:0")
			if err != nil {
				return nil, errors.New("owned Authelia loopback route unavailable")
			}
			port := publishedPort{listener.Addr().(*net.TCPAddr).Port, "tcp"}
			if r.pool.used[port] != nil {
				listener.Close()
				continue
			}
			r.pool.used[port] = r
			r.owned = append(r.owned, port)
			return listener, nil
		}
		return nil, errors.New("owned Authelia route port budget exhausted")
	}
	front, err := claim()
	if err != nil {
		return nil, nil, err
	}
	proxy, err := claim()
	if err != nil {
		front.Close()
		return nil, nil, err
	}
	return front, proxy, nil
}
