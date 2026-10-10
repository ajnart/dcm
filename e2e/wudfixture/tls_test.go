package wudfixture

import (
	"crypto/tls"
	"crypto/x509"
	"io"
	"log"
	"net"
	"net/http"
	"testing"
	"time"
)

func TestVerifiedMutualTLS(t *testing.T) {
	m, err := Certificates()
	if err != nil {
		t.Fatal("generate material")
	}
	config, err := ServerTLS(m)
	if err != nil {
		t.Fatal("server material")
	}
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	s := &http.Server{Handler: NewHandler(func() (Snapshot, error) { return sample(), nil }, "owned-test"), ErrorLog: log.New(io.Discard, "", 0)}
	defer s.Close()
	go s.Serve(tls.NewListener(listener, config))
	pool := x509.NewCertPool()
	pool.AppendCertsFromPEM(m.CA)
	cert, err := tls.X509KeyPair(m.ClientCertificate, m.ClientKey)
	if err != nil {
		t.Fatal("client material")
	}
	for _, tc := range []struct {
		name  string
		roots *x509.CertPool
		certs []tls.Certificate
		pass  bool
	}{{"trusted mutual", pool, []tls.Certificate{cert}, true}, {"untrusted CA", nil, []tls.Certificate{cert}, false}, {"missing client", pool, nil, false}} {
		t.Run(tc.name, func(t *testing.T) {
			transport := &http.Transport{Proxy: nil, TLSClientConfig: &tls.Config{MinVersion: tls.VersionTLS12, ServerName: Host, RootCAs: tc.roots, Certificates: tc.certs}}
			defer transport.CloseIdleConnections()
			client := &http.Client{Transport: transport, Timeout: 3 * time.Second}
			res, e := client.Get("https://" + listener.Addr().String() + "/containers/json")
			if tc.pass {
				if e != nil || res.StatusCode != 200 {
					t.Fatal("verified request failed")
				}
				res.Body.Close()
			} else if e == nil {
				res.Body.Close()
				t.Fatal("TLS boundary bypassed")
			}
		})
	}
}
