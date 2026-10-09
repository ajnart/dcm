package wudfixture

import (
	"context"
	"crypto/tls"
	"io"
	"log"
	"net"
	"net/http"
	"strings"
	"testing"
	"time"
)

func TestReadinessRequiresVerifiedMutualTLSAndExactOwnedInventory(t *testing.T) {
	material, err := Certificates()
	if err != nil {
		t.Fatal(err)
	}
	config, err := ServerTLS(material)
	if err != nil {
		t.Fatal(err)
	}
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	snapshot := sample()
	server := &http.Server{Handler: NewHandler(func() (Snapshot, error) { return snapshot, nil }, "owned-test"), ErrorLog: log.New(io.Discard, "", 0)}
	defer server.Close()
	go server.Serve(tls.NewListener(listener, config))
	for _, tc := range []struct {
		name     string
		material Material
		project  string
		expected Snapshot
		pass     bool
	}{
		{"trusted exact", material, "owned-test", snapshot, true},
		{"wrong project", material, "other", snapshot, false},
		{"missing client", Material{CA: material.CA}, "owned-test", snapshot, false},
		{"untrusted server", Material{ClientCertificate: material.ClientCertificate, ClientKey: material.ClientKey}, "owned-test", snapshot, false},
		{"wrong image", material, "owned-test", func() Snapshot { s := snapshot; s.ImageID = "sha256:" + strings.Repeat("c", 64); return s }(), false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
			defer cancel()
			err := Probe(ctx, listener.Addr().String(), tc.project, tc.material, tc.expected)
			if (err == nil) != tc.pass {
				t.Fatal("readiness accepted invalid trust or owned inventory")
			}
		})
	}
}
