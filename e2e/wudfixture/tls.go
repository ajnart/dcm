package wudfixture

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"math/big"
	"time"
)

const Host = "wud-facade.e2e.selfhost.test"

type Material struct{ CA, ServerCertificate, ServerKey, ClientCertificate, ClientKey []byte }

func Certificates() (Material, error) {
	var m Material
	caKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return m, err
	}
	now := time.Now()
	ca := &x509.Certificate{SerialNumber: big.NewInt(1), Subject: pkix.Name{CommonName: "owned WUD fixture CA"}, NotBefore: now.Add(-time.Minute), NotAfter: now.Add(24 * time.Hour), IsCA: true, BasicConstraintsValid: true, KeyUsage: x509.KeyUsageCertSign}
	der, err := x509.CreateCertificate(rand.Reader, ca, ca, &caKey.PublicKey, caKey)
	if err != nil {
		return m, err
	}
	m.CA = pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})
	for i := 0; i < 2; i++ {
		key, e := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
		if e != nil {
			return m, e
		}
		cert := &x509.Certificate{SerialNumber: big.NewInt(int64(i + 2)), NotBefore: now.Add(-time.Minute), NotAfter: now.Add(24 * time.Hour), KeyUsage: x509.KeyUsageDigitalSignature}
		if i == 0 {
			cert.DNSNames = []string{Host}
			cert.ExtKeyUsage = []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth}
		} else {
			cert.Subject = pkix.Name{CommonName: "owned WUD watcher"}
			cert.ExtKeyUsage = []x509.ExtKeyUsage{x509.ExtKeyUsageClientAuth}
		}
		leaf, e := x509.CreateCertificate(rand.Reader, cert, ca, &key.PublicKey, caKey)
		if e != nil {
			return m, e
		}
		raw, e := x509.MarshalPKCS8PrivateKey(key)
		if e != nil {
			return m, e
		}
		c := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: leaf})
		k := pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: raw})
		if i == 0 {
			m.ServerCertificate = c
			m.ServerKey = k
		} else {
			m.ClientCertificate = c
			m.ClientKey = k
		}
	}
	return m, nil
}
func ServerTLS(m Material) (*tls.Config, error) {
	cert, err := tls.X509KeyPair(m.ServerCertificate, m.ServerKey)
	if err != nil {
		return nil, err
	}
	pool := x509.NewCertPool()
	if !pool.AppendCertsFromPEM(m.CA) {
		return nil, x509.UnknownAuthorityError{}
	}
	return &tls.Config{MinVersion: tls.VersionTLS12, Certificates: []tls.Certificate{cert}, ClientCAs: pool, ClientAuth: tls.RequireAndVerifyClientCert}, nil
}
