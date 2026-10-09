package e2e

import (
	"errors"
	"net"
	"strings"
)

// The canonical Authelia authority is reached only through the owned CONNECT route.
type autheliaRoute = fixtureTLSRoute

func newAutheliaRoute(root string, listener, connectListener net.Listener, backend string) (*autheliaRoute, error) {
	addr, ok := connectListener.Addr().(*net.TCPAddr)
	if !ok || !addr.IP.Equal(net.ParseIP("127.0.0.1")) {
		listener.Close()
		connectListener.Close()
		return nil, errors.New("prepare owned Authelia TLS route")
	}
	route, err := newFixtureTLSRoute(root, listener, backend, "Authelia", "auth.e2e.selfhost.test")
	if err != nil {
		connectListener.Close()
		return nil, err
	}
	connect, err := newFixtureConnect(connectListener, strings.TrimPrefix(route.origin, "https://"), listener.Addr().String())
	if err != nil {
		route.close()
		return nil, errors.New("prepare owned Authelia TLS route")
	}
	route.connect, route.proxyURL = connect, connect.proxyURL
	return route, nil
}
