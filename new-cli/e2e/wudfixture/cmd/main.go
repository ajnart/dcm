package main

import (
	"context"
	"crypto/tls"
	"flag"
	"github.com/ajnart/self-host/e2e/wudfixture"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"time"
)

func main() {
	project := flag.String("project", "", "exact owned Compose project")
	healthcheck := flag.Bool("healthcheck", false, "verify owned mutual TLS inventory readiness")
	flag.Parse()
	read := func(name string) []byte {
		b, err := os.ReadFile("/fixture/" + name)
		if err != nil {
			os.Exit(1)
		}
		return b
	}
	if *healthcheck {
		snapshot, err := wudfixture.ReadSnapshot("/observed/snapshot.json")
		if err != nil {
			os.Exit(1)
		}
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		material := wudfixture.Material{CA: read("ca.pem"), ClientCertificate: read("client-cert.pem"), ClientKey: read("client-key.pem")}
		if wudfixture.Probe(ctx, "127.0.0.1:2376", *project, material, snapshot) != nil {
			os.Exit(1)
		}
		return
	}
	config, err := wudfixture.ServerTLS(wudfixture.Material{CA: read("ca.pem"), ServerCertificate: read("server.pem"), ServerKey: read("server.key")})
	if err != nil {
		os.Exit(1)
	}
	listener, err := net.Listen("tcp", ":2376")
	if err != nil {
		os.Exit(1)
	}
	server := &http.Server{Handler: wudfixture.NewHandler(func() (wudfixture.Snapshot, error) { return wudfixture.ReadSnapshot("/observed/snapshot.json") }, *project), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 10 * time.Second, WriteTimeout: 10 * time.Second, IdleTimeout: 15 * time.Second, MaxHeaderBytes: 8192, ErrorLog: log.New(io.Discard, "", 0)}
	if server.Serve(tls.NewListener(listener, config)) != nil {
		os.Exit(1)
	}
}
