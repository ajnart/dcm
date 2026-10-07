package e2e

import (
	"context"
	"errors"
	"io"
	"log"
	"net"
	"net/http"
	"strconv"
	"sync"
	"time"
)

// fixtureConnect routes one approved canonical authority to an owned loopback
// TLS listener. It never performs DNS or chooses a destination from a request.
type fixtureConnect struct {
	proxyURL string
	server   *http.Server
	tunnels  map[net.Conn]struct{}
	mu       sync.Mutex
	closed   bool
}

func newFixtureConnect(listener net.Listener, authority, target string) (*fixtureConnect, error) {
	fail := func() (*fixtureConnect, error) {
		listener.Close()
		return nil, errors.New("invalid owned fixture CONNECT route")
	}
	addr, ok := listener.Addr().(*net.TCPAddr)
	host, port, err := net.SplitHostPort(authority)
	if err != nil || !ok || !addr.IP.Equal(net.ParseIP("127.0.0.1")) {
		return fail()
	}
	if host != "auth.e2e.selfhost.test" && host != "passbolt.e2e.selfhost.test" {
		return fail()
	}
	portNumber, err := strconv.Atoi(port)
	if err != nil || portNumber < 1 || portNumber > 65535 {
		return fail()
	}
	destination, destinationPort, err := net.SplitHostPort(target)
	targetPort, portErr := strconv.Atoi(destinationPort)
	if err != nil || destination != "127.0.0.1" || portErr != nil || targetPort < 1 || targetPort > 65535 {
		return fail()
	}
	route := &fixtureConnect{proxyURL: "http://" + listener.Addr().String(), tunnels: make(map[net.Conn]struct{})}
	route.server = &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { route.tunnel(w, r, authority, target) }), ReadHeaderTimeout: 10 * time.Second, ErrorLog: log.New(io.Discard, "", 0)}
	go route.server.Serve(listener)
	return route, nil
}

func (n *fixtureConnect) close() {
	n.mu.Lock()
	n.closed = true
	for c := range n.tunnels {
		c.Close()
	}
	n.mu.Unlock()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	n.server.Shutdown(ctx)
	n.server.Close()
}

func (n *fixtureConnect) tunnel(w http.ResponseWriter, r *http.Request, authority, target string) {
	if r.Method != http.MethodConnect || r.Host != authority || r.URL.Host != authority {
		w.WriteHeader(http.StatusForbidden)
		return
	}
	upstream, err := net.DialTimeout("tcp4", target, 5*time.Second)
	if err != nil {
		w.WriteHeader(http.StatusBadGateway)
		return
	}
	defer upstream.Close()
	n.mu.Lock()
	if n.closed || len(n.tunnels) >= 16 {
		n.mu.Unlock()
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	hijacker, ok := w.(http.Hijacker)
	if !ok {
		n.mu.Unlock()
		w.WriteHeader(http.StatusInternalServerError)
		return
	}
	client, buffer, err := hijacker.Hijack()
	if err != nil {
		n.mu.Unlock()
		return
	}
	n.tunnels[client] = struct{}{}
	n.tunnels[upstream] = struct{}{}
	n.mu.Unlock()
	defer func() {
		client.Close()
		n.mu.Lock()
		delete(n.tunnels, client)
		delete(n.tunnels, upstream)
		n.mu.Unlock()
	}()
	if _, err := buffer.WriteString("HTTP/1.1 200 Connection Established\r\n\r\n"); err != nil {
		return
	}
	if err := buffer.Flush(); err != nil {
		return
	}
	finished := make(chan struct{})
	go func() { io.Copy(upstream, buffer); upstream.Close(); close(finished) }()
	io.Copy(client, upstream)
	client.Close()
	<-finished
}
