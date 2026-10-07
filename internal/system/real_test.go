package system

import (
	"net"
	"testing"
)

func TestPortFreeSeesAnIPv4OnlyListener(t *testing.T) {
	listener, err := net.Listen("tcp4", "0.0.0.0:0")
	if err != nil {
		t.Skip(err)
	}
	defer listener.Close()

	if portFree(listener.Addr().(*net.TCPAddr).Port) {
		t.Fatal("a port held on 0.0.0.0 must not be free")
	}
}

func TestPortFreeOnAnUnusedPort(t *testing.T) {
	listener, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		t.Skip(err)
	}
	port := listener.Addr().(*net.TCPAddr).Port
	listener.Close()

	if !portFree(port) {
		t.Fatalf("port %d should be free", port)
	}
}
