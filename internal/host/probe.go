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
	addresses := []struct {
		network string
		address string
		bind    string
	}{
		{network: "tcp4", address: "0.0.0.0", bind: "0.0.0.0:" + strconv.Itoa(port)},
		{network: "tcp4", address: "127.0.0.1", bind: "127.0.0.1:" + strconv.Itoa(port)},
		{network: "tcp6", address: "::", bind: "[::]:" + strconv.Itoa(port)},
	}
	probes := make([]PortProbe, 0, len(addresses))
	for _, address := range addresses {
		result, class := classifyBind(deps.BindTCP(address.network, address.bind))
		probes = append(probes, PortProbe{Network: address.network, Address: address.address,
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
