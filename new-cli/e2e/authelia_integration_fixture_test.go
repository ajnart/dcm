package e2e

import (
	"net"
	"slices"
	"strings"
	"testing"
)

func TestAutheliaIntegrationUsesOnlyChildTrustAndProxy(t *testing.T) {
	env := autheliaChildEnvironment([]string{"PATH=/owned/bin", "https_proxy=private-ambient-proxy", "HTTP_PROXY=private-ambient-proxy", "all_proxy=private-ambient-proxy", "no_proxy=*", "SSL_CERT_FILE=private-ambient-ca", "ssl_cert_dir=private-ambient-dir"}, "http://127.0.0.1:1234", "/owned/fixture-ca.pem")
	if !slices.Contains(env, "PATH=/owned/bin") || !slices.Contains(env, "HTTPS_PROXY=http://127.0.0.1:1234") || !slices.Contains(env, "SSL_CERT_FILE=/owned/fixture-ca.pem") || !slices.Contains(env, "NO_PROXY=") || strings.Contains(strings.Join(env, ","), "private-ambient") {
		t.Fatal("child TLS route inherited ambient trust/proxy bypass")
	}
}

func TestAutheliaRoutePortsStayReservedThroughSourceAndRestore(t *testing.T) {
	pool := &portRegistry{used: map[publishedPort]*portReservation{}}
	reservation := &portReservation{pool: pool}
	front, proxy, err := reserveAutheliaFixturePorts(reservation)
	if err != nil {
		t.Fatal("reserve owned fixture ports")
	}
	defer front.Close()
	defer proxy.Close()
	defer reservation.release()
	reservation.closeSockets()
	for _, listener := range []net.Listener{front, proxy} {
		port := publishedPort{listener.Addr().(*net.TCPAddr).Port, "tcp"}
		if !pool.owns(reservation, port) {
			t.Fatal("live source/restore fixture port lost its ownership")
		}
		if replacement, err := net.Listen("tcp4", listener.Addr().String()); err == nil {
			replacement.Close()
			t.Fatal("source install closed the active TLS/proxy listener")
		}
	}
	front.Close()
	proxy.Close()
	reservation.release()
	if len(pool.used) != 0 {
		t.Fatal("successful source+restore cleanup did not release fixture ports")
	}
}
