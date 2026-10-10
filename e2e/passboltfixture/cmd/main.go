package main

import (
	"crypto/tls"
	"flag"
	"net"
	"os"
	"os/signal"
	"syscall"

	"github.com/ajnart/self-host/e2e/passboltfixture"
)

func main() {
	https := flag.String("https", ":8443", "owned HTTPS listener")
	smtp := flag.String("smtp", ":1025", "private SMTP listener")
	backend := flag.String("backend", "http://passbolt:80", "owned Passbolt backend")
	cert := flag.String("cert", "/fixture/server.pem", "fixture certificate")
	key := flag.String("key", "/fixture/server.key", "fixture key")
	flag.Parse()
	certificate, err := tls.LoadX509KeyPair(*cert, *key)
	if err != nil {
		os.Exit(1)
	}
	secure, err := net.Listen("tcp", *https)
	if err != nil {
		os.Exit(1)
	}
	relay, err := net.Listen("tcp", *smtp)
	if err != nil {
		secure.Close()
		os.Exit(1)
	}
	server, err := passboltfixture.Start(secure, relay, *backend, certificate)
	if err != nil {
		os.Exit(1)
	}
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	<-stop
	server.Close()
}
