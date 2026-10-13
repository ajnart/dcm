package host

import (
	"errors"
	"fmt"
	"strconv"
	"syscall"

	"github.com/ajnart/self-host/internal/system"
)

type PortResult string

const (
	PortOK          PortResult = "ok"
	PortPermission  PortResult = "permission"
	PortInUse       PortResult = "in_use"
	PortUnsupported PortResult = "unsupported"
)

// PortProbe is the result of trying one address for one host port.
type PortProbe struct {
	Network    string     `json:"network"`
	Address    string     `json:"address"`
	Port       int        `json:"port"`
	Result     PortResult `json:"result"`
	ErrorClass string     `json:"error_class,omitempty"`
}

// ProbePort tries the wildcard, loopback and IPv6 wildcard addresses used by
// Docker port publishing. Each successful bind is closed immediately.
func ProbePort(deps *system.Deps, port int) []PortProbe {
	return probePort("tcp", deps.BindTCP, port)
}

// ProbeUDPPort tries the UDP wildcard and loopback addresses Docker may bind.
func ProbeUDPPort(deps *system.Deps, port int) []PortProbe {
	return probePort("udp", deps.BindUDP, port)
}

func probePort(protocol string, bind func(network, address string) error, port int) []PortProbe {
	portText := strconv.Itoa(port)
	addresses := []struct {
		family  string
		address string
		bind    string
	}{
		{family: "4", address: "0.0.0.0", bind: "0.0.0.0:" + portText},
		{family: "4", address: "127.0.0.1", bind: "127.0.0.1:" + portText},
		{family: "6", address: "::", bind: "[::]:" + portText},
	}
	probes := make([]PortProbe, 0, len(addresses))
	for _, address := range addresses {
		network := protocol + address.family
		result, class := classifyBind(bind(network, address.bind))
		probes = append(probes, PortProbe{Network: network, Address: address.address,
			Port: port, Result: result, ErrorClass: class})
	}
	return probes
}

// PortAvailable reports whether the probes found no address already held by
// another listener. Permission and unsupported results are inconclusive.
func PortAvailable(probes []PortProbe) bool {
	for _, probe := range probes {
		if probe.Result == PortInUse {
			return false
		}
	}
	return true
}

func classifyBind(err error) (PortResult, string) {
	if err == nil {
		return PortOK, ""
	}
	switch {
	case errors.Is(err, syscall.EACCES):
		return PortPermission, "EACCES"
	case errors.Is(err, syscall.EPERM):
		return PortPermission, "EPERM"
	case errors.Is(err, syscall.EADDRINUSE):
		return PortInUse, "EADDRINUSE"
	case errors.Is(err, syscall.EAFNOSUPPORT):
		return PortUnsupported, "EAFNOSUPPORT"
	case errors.Is(err, syscall.EPROTONOSUPPORT):
		return PortUnsupported, "EPROTONOSUPPORT"
	case errors.Is(err, syscall.EADDRNOTAVAIL):
		return PortUnsupported, "EADDRNOTAVAIL"
	default:
		return PortUnsupported, fmt.Sprintf("ERRNO_%d", errno(err))
	}
}

func errno(err error) int {
	var value syscall.Errno
	if errors.As(err, &value) {
		return int(value)
	}
	return 0
}
