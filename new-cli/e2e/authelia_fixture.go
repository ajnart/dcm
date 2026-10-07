package e2e

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"errors"
	"fmt"
	"io"
	"log"
	"math/big"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"path/filepath"
	"time"
)

// This child-local acceptance route provides genuine TLS for the canonical
// Authelia hostname and reaches only its owned loopback backend.
type autheliaRoute struct {
	origin    string
	caFile    string
	proxyURL  string
	connect   *fixtureConnect
	server    *http.Server
	transport *http.Transport
}

func newAutheliaRoute(root string, listener, connectListener net.Listener, backend string) (*autheliaRoute, error) {
	fail := func() (*autheliaRoute, error) {
		listener.Close()
		connectListener.Close()
		return nil, errors.New("prepare owned Authelia TLS route")
	}
	destination, err := url.Parse(backend)
	if err != nil || destination.Scheme != "http" || destination.Hostname() != "127.0.0.1" || destination.Port() == "" {
		return fail()
	}
	addr, ok := listener.Addr().(*net.TCPAddr)
	connectAddr, connectOK := connectListener.Addr().(*net.TCPAddr)
	if !ok || !addr.IP.Equal(net.ParseIP("127.0.0.1")) || !connectOK || !connectAddr.IP.Equal(net.ParseIP("127.0.0.1")) {
		return fail()
	}
	caKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return fail()
	}
	leafKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return fail()
	}
	now := time.Now()
	ca := &x509.Certificate{SerialNumber: big.NewInt(1), Subject: pkix.Name{CommonName: "owned Authelia fixture CA"}, NotBefore: now.Add(-time.Minute), NotAfter: now.Add(24 * time.Hour), IsCA: true, BasicConstraintsValid: true, KeyUsage: x509.KeyUsageCertSign}
	caDER, err := x509.CreateCertificate(rand.Reader, ca, ca, &caKey.PublicKey, caKey)
	if err != nil {
		return fail()
	}
	leaf := &x509.Certificate{SerialNumber: big.NewInt(2), Subject: pkix.Name{CommonName: "owned Authelia loopback"}, DNSNames: []string{"auth.e2e.selfhost.test"}, NotBefore: now.Add(-time.Minute), NotAfter: now.Add(24 * time.Hour), KeyUsage: x509.KeyUsageDigitalSignature, ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth}}
	leafDER, err := x509.CreateCertificate(rand.Reader, leaf, ca, &leafKey.PublicKey, caKey)
	if err != nil {
		return fail()
	}
	caPEM := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: caDER})
	caFile := filepath.Join(root, "authelia-fixture-ca.pem")
	if err := os.WriteFile(caFile, caPEM, 0o600); err != nil {
		return fail()
	}
	proxy := httputil.NewSingleHostReverseProxy(destination)
	transport := &http.Transport{Proxy: nil}
	proxy.Transport = transport
	director := proxy.Director
	proxy.Director = func(r *http.Request) {
		director(r)
		r.Header.Set("X-Forwarded-Proto", "https")
	}
	proxy.ErrorLog = log.New(io.Discard, "", 0)
	proxy.ErrorHandler = func(w http.ResponseWriter, _ *http.Request, _ error) { w.WriteHeader(http.StatusBadGateway) }
	server := &http.Server{Handler: proxy, ReadHeaderTimeout: 10 * time.Second, ErrorLog: log.New(io.Discard, "", 0)}
	tlsListener := tls.NewListener(listener, &tls.Config{MinVersion: tls.VersionTLS12, Certificates: []tls.Certificate{{Certificate: [][]byte{leafDER, caDER}, PrivateKey: leafKey}}})
	authority := net.JoinHostPort("auth.e2e.selfhost.test", fmt.Sprint(addr.Port))
	connect, err := newFixtureConnect(connectListener, authority, listener.Addr().String())
	if err != nil {
		return fail()
	}
	go server.Serve(tlsListener)
	route := &autheliaRoute{origin: "https://" + authority, caFile: caFile, server: server, transport: transport, proxyURL: connect.proxyURL, connect: connect}
	return route, nil
}

func (n *autheliaRoute) close() {
	n.connect.close()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	n.server.Shutdown(ctx)
	n.server.Close()
	n.transport.CloseIdleConnections()
}
