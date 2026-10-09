// Package passboltfixture supplies local HTTPS and STARTTLS prerequisites only.
// It discards bounded fixture mail and never enrolls an OpenPGP owner.
package passboltfixture

import (
	"bufio"
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/json"
	"encoding/pem"
	"errors"
	"io"
	"log"
	"math/big"
	"net"
	"net/http"
	"net/http/httputil"
	"net/textproto"
	"net/url"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

func Certificate() (tls.Certificate, []byte, error) {
	caKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return tls.Certificate{}, nil, err
	}
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return tls.Certificate{}, nil, err
	}
	now := time.Now()
	ca := &x509.Certificate{SerialNumber: big.NewInt(1), Subject: pkix.Name{CommonName: "owned Passbolt prerequisite CA"}, NotBefore: now.Add(-time.Minute), NotAfter: now.Add(24 * time.Hour), IsCA: true, BasicConstraintsValid: true, KeyUsage: x509.KeyUsageCertSign}
	caDER, err := x509.CreateCertificate(rand.Reader, ca, ca, &caKey.PublicKey, caKey)
	if err != nil {
		return tls.Certificate{}, nil, err
	}
	leaf := &x509.Certificate{SerialNumber: big.NewInt(2), DNSNames: []string{"passbolt.e2e.selfhost.test", "smtp.e2e.selfhost.test"}, NotBefore: now.Add(-time.Minute), NotAfter: now.Add(24 * time.Hour), KeyUsage: x509.KeyUsageDigitalSignature, ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth}}
	leafDER, err := x509.CreateCertificate(rand.Reader, leaf, ca, &key.PublicKey, caKey)
	if err != nil {
		return tls.Certificate{}, nil, err
	}
	return tls.Certificate{Certificate: [][]byte{leafDER, caDER}, PrivateKey: key}, pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: caDER}), nil
}

type Server struct {
	http        *http.Server
	transport   *http.Transport
	smtp        net.Listener
	tls         *tls.Config
	mu          sync.Mutex
	connections map[net.Conn]bool
	closed      bool
	deliveries  atomic.Uint64
}

func Start(https, smtp net.Listener, backend string, certificate tls.Certificate) (*Server, error) {
	target, err := url.Parse(backend)
	if err != nil || target.Scheme != "http" || (target.Hostname() != "passbolt" && target.Hostname() != "127.0.0.1") || target.Port() == "" {
		https.Close()
		smtp.Close()
		return nil, errors.New("invalid owned Passbolt backend")
	}
	transport := &http.Transport{Proxy: nil}
	proxy := httputil.NewSingleHostReverseProxy(target)
	proxy.Transport = transport
	director := proxy.Director
	proxy.Director = func(r *http.Request) { director(r); r.Header.Set("X-Forwarded-Proto", "https") }
	proxy.ErrorLog = log.New(io.Discard, "", 0)
	proxy.ErrorHandler = func(w http.ResponseWriter, _ *http.Request, _ error) { w.WriteHeader(http.StatusBadGateway) }
	s := &Server{smtp: smtp, transport: transport, tls: &tls.Config{MinVersion: tls.VersionTLS12, Certificates: []tls.Certificate{certificate}}, connections: make(map[net.Conn]bool)}
	s.http = &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/__selfhost_fixture/smtp-count" {
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]uint64{"deliveries": s.Deliveries()})
			return
		}
		proxy.ServeHTTP(w, r)
	}), ReadHeaderTimeout: 10 * time.Second, ErrorLog: log.New(io.Discard, "", 0)}
	go s.http.Serve(tls.NewListener(https, s.tls))
	go s.accept()
	return s, nil
}

func (s *Server) Deliveries() uint64 { return s.deliveries.Load() }
func (s *Server) Close() {
	s.mu.Lock()
	s.closed = true
	s.smtp.Close()
	for c := range s.connections {
		c.Close()
	}
	s.mu.Unlock()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	s.http.Shutdown(ctx)
	s.http.Close()
	s.transport.CloseIdleConnections()
}
func (s *Server) accept() {
	for {
		conn, err := s.smtp.Accept()
		if err != nil {
			return
		}
		s.mu.Lock()
		if s.closed || len(s.connections) >= 8 {
			s.mu.Unlock()
			conn.Close()
			continue
		}
		s.connections[conn] = true
		s.mu.Unlock()
		go s.session(conn)
	}
}
func (s *Server) session(conn net.Conn) {
	original := conn
	defer func() { conn.Close(); s.mu.Lock(); delete(s.connections, original); s.mu.Unlock() }()
	conn.SetDeadline(time.Now().Add(30 * time.Second))
	reader := textproto.NewReader(bufio.NewReader(io.LimitReader(conn, 2<<20)))
	writer := textproto.NewWriter(bufio.NewWriter(conn))
	reply := func(message string) bool { return writer.PrintfLine("%s", message) == nil }
	if !reply("220 smtp.e2e.selfhost.test owned STARTTLS fixture") {
		return
	}
	secure, sender, recipient := false, false, false
	for {
		line, err := reader.ReadLine()
		if err != nil {
			return
		}
		command, argument, _ := strings.Cut(line, " ")
		switch strings.ToUpper(command) {
		case "EHLO", "HELO":
			if secure {
				if !reply("250 smtp.e2e.selfhost.test") {
					return
				}
			} else {
				if !reply("250-smtp.e2e.selfhost.test") || !reply("250 STARTTLS") {
					return
				}
			}
		case "STARTTLS":
			if secure {
				if !reply("503 already encrypted") {
					return
				}
				continue
			}
			if !reply("220 begin TLS") {
				return
			}
			encrypted := tls.Server(conn, s.tls)
			if encrypted.Handshake() != nil {
				return
			}
			conn = encrypted
			secure = true
			sender = false
			recipient = false
			reader = textproto.NewReader(bufio.NewReader(io.LimitReader(conn, 2<<20)))
			writer = textproto.NewWriter(bufio.NewWriter(conn))
		case "MAIL":
			if !secure {
				if !reply("530 STARTTLS required") {
					return
				}
				continue
			}
			sender = strings.HasPrefix(strings.ToUpper(argument), "FROM:")
			recipient = false
			if !sender {
				if !reply("501 invalid sender") {
					return
				}
			} else if !reply("250 sender accepted") {
				return
			}
		case "RCPT":
			if !secure || !sender {
				if !reply("503 encrypted sender required") {
					return
				}
				continue
			}
			if !strings.EqualFold(argument, "TO:<fixture@selfhost.local>") {
				if !reply("550 only local fixture recipient is accepted") {
					return
				}
				continue
			}
			recipient = true
			if !reply("250 local recipient accepted") {
				return
			}
		case "DATA":
			if !secure || !sender || !recipient {
				if !reply("503 encrypted local recipient required") {
					return
				}
				continue
			}
			if !reply("354 end with dot") {
				return
			}
			count, err := io.Copy(io.Discard, io.LimitReader(reader.DotReader(), (1<<20)+1))
			if err != nil || count > 1<<20 {
				reply("552 message too large")
				return
			}
			s.deliveries.Add(1)
			sender = false
			recipient = false
			if !reply("250 fixture message discarded") {
				return
			}
		case "RSET":
			sender = false
			recipient = false
			if !reply("250 reset") {
				return
			}
		case "NOOP":
			if !reply("250 ok") {
				return
			}
		case "QUIT":
			reply("221 bye")
			return
		default:
			if !reply("502 command unavailable") {
				return
			}
		}
	}
}
