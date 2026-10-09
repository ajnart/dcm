package e2e

import (
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
	"strings"
	"time"
)

type fixtureTLSRoute struct {
	origin    string
	caFile    string
	roots     *x509.CertPool
	proxyURL  string
	connect   *fixtureConnect
	server    *http.Server
	transport *http.Transport
}

func newFixtureTLSRoute(root string, listener net.Listener, backend, name, hostname string) (*fixtureTLSRoute, error) {
	fail := func() (*fixtureTLSRoute, error) {
		listener.Close()
		return nil, errors.New("prepare owned " + name + " TLS route")
	}
	destination, err := url.Parse(backend)
	if err != nil || destination.Scheme != "http" || destination.Hostname() != "127.0.0.1" || destination.Port() == "" {
		return fail()
	}
	addr, ok := listener.Addr().(*net.TCPAddr)
	if !ok || !addr.IP.Equal(net.ParseIP("127.0.0.1")) {
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
	ca := &x509.Certificate{SerialNumber: big.NewInt(1), Subject: pkix.Name{CommonName: "owned " + name + " fixture CA"}, NotBefore: now.Add(-time.Minute), NotAfter: now.Add(24 * time.Hour), IsCA: true, BasicConstraintsValid: true, KeyUsage: x509.KeyUsageCertSign}
	caDER, err := x509.CreateCertificate(rand.Reader, ca, ca, &caKey.PublicKey, caKey)
	if err != nil {
		return fail()
	}
	leaf := &x509.Certificate{SerialNumber: big.NewInt(2), Subject: pkix.Name{CommonName: "owned " + name + " loopback"}, NotBefore: now.Add(-time.Minute), NotAfter: now.Add(24 * time.Hour), KeyUsage: x509.KeyUsageDigitalSignature, ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth}}
	if hostname == "127.0.0.1" {
		leaf.IPAddresses = []net.IP{net.ParseIP(hostname)}
	} else {
		leaf.DNSNames = []string{hostname}
	}
	leafDER, err := x509.CreateCertificate(rand.Reader, leaf, ca, &leafKey.PublicKey, caKey)
	if err != nil {
		return fail()
	}
	caPEM := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: caDER})
	caFile := filepath.Join(root, strings.ToLower(name)+"-fixture-ca.pem")
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
	authority := net.JoinHostPort(hostname, fmt.Sprint(addr.Port))
	roots := x509.NewCertPool()
	if !roots.AppendCertsFromPEM(caPEM) {
		return fail()
	}
	go server.Serve(tlsListener)
	return &fixtureTLSRoute{origin: "https://" + authority, caFile: caFile, roots: roots, server: server, transport: transport}, nil
}

func (n *fixtureTLSRoute) client() *http.Client {
	return &http.Client{Timeout: 15 * time.Second, Transport: &http.Transport{Proxy: nil, TLSClientConfig: &tls.Config{MinVersion: tls.VersionTLS12, RootCAs: n.roots}}, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
}
func (n *fixtureTLSRoute) close() {
	if n.connect != nil {
		n.connect.close()
	}
	closeFixtureServer(n.server)
	n.transport.CloseIdleConnections()
}
