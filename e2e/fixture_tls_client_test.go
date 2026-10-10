package e2e

import (
	"crypto/tls"
	"crypto/x509"
	"net/http"
	"os"
	"runtime"
	"testing"
	"time"
)

// ownedFixtureTLSClient uses the platform trust store where it honors
// SSL_CERT_FILE. Darwin verifies through the system keychain and ignores that
// variable, so the owned CA is loaded explicitly to keep a verified handshake.
func ownedFixtureTLSClient(t *testing.T) *http.Client {
	caFile := os.Getenv("SSL_CERT_FILE")
	if runtime.GOOS != "darwin" || caFile == "" {
		return &http.Client{Timeout: 15 * time.Second}
	}
	pem, err := os.ReadFile(caFile)
	if err != nil {
		t.Fatal(err)
	}
	pool := x509.NewCertPool()
	if !pool.AppendCertsFromPEM(pem) {
		t.Fatal("owned fixture CA unreadable")
	}
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.TLSClientConfig = &tls.Config{MinVersion: tls.VersionTLS12, RootCAs: pool}
	return &http.Client{Timeout: 15 * time.Second, Transport: transport}
}
