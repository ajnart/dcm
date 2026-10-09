package passboltfixture

import (
	"crypto/tls"
	"crypto/x509"
	"errors"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/smtp"
	"testing"
)

func TestVerifiedHTTPSAndSTARTTLSOnlyLocalDelivery(t *testing.T) {
	cert, ca, err := Certificate()
	if err != nil {
		t.Fatal(err)
	}
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-Forwarded-Proto") != "https" {
			w.WriteHeader(400)
			return
		}
		io.WriteString(w, "owned-passbolt")
	}))
	defer backend.Close()
	listen := func() net.Listener {
		l, e := net.Listen("tcp4", "127.0.0.1:0")
		if e != nil {
			t.Fatal(e)
		}
		return l
	}
	https, smtpListener := listen(), listen()
	server, err := Start(https, smtpListener, backend.URL, cert)
	if err != nil {
		t.Fatal(err)
	}
	defer server.Close()
	roots := x509.NewCertPool()
	roots.AppendCertsFromPEM(ca)
	endpoint := "https://" + https.Addr().String()
	if _, err := http.Get(endpoint); err == nil {
		t.Fatal("untrusted HTTPS accepted")
	}
	client := &http.Client{Transport: &http.Transport{TLSClientConfig: &tls.Config{RootCAs: roots, ServerName: "passbolt.e2e.selfhost.test"}}}
	resp, err := client.Get(endpoint)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if string(body) != "owned-passbolt" {
		t.Fatal("HTTPS route did not reach backend")
	}
	connect := func() *smtp.Client {
		c, e := smtp.Dial(smtpListener.Addr().String())
		if e != nil {
			t.Fatal(e)
		}
		return c
	}
	plain := connect()
	if err := plain.Mail("sender@selfhost.local"); err == nil {
		t.Fatal("plaintext SMTP delivery accepted")
	}
	plain.Close()
	untrusted := connect()
	err = untrusted.StartTLS(&tls.Config{ServerName: "smtp.e2e.selfhost.test"})
	var unknown x509.UnknownAuthorityError
	if !errors.As(err, &unknown) {
		t.Fatal("SMTP did not reject untrusted CA")
	}
	untrusted.Close()
	trusted := connect()
	defer trusted.Close()
	if err := trusted.StartTLS(&tls.Config{RootCAs: roots, ServerName: "smtp.e2e.selfhost.test"}); err != nil {
		t.Fatal(err)
	}
	if err := trusted.Mail("sender@selfhost.local"); err != nil {
		t.Fatal(err)
	}
	if err := trusted.Rcpt("external@example.com"); err == nil {
		t.Fatal("SMTP accepted external recipient")
	}
	if err := trusted.Rcpt("fixture@selfhost.local"); err != nil {
		t.Fatal(err)
	}
	data, err := trusted.Data()
	if err != nil {
		t.Fatal(err)
	}
	io.WriteString(data, "Subject: owned fixture\r\n\r\nsynthetic delivery\r\n")
	if err := data.Close(); err != nil {
		t.Fatal(err)
	}
	if server.Deliveries() != 1 {
		t.Fatal("local STARTTLS delivery was not recorded")
	}
}
