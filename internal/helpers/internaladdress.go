package helpers

import "strconv"

func InternalAddress(service string, containerPort int) string {
	if service == "" || containerPort <= 0 {
		return ""
	}
	return service + ":" + strconv.Itoa(containerPort)
}

func (h *H) InternalURL() string {
	address := InternalAddress(h.Service, h.ContainerPort)
	if address == "" {
		return ""
	}
	return "http://" + address
}

func (a InstalledApp) InternalURL() string {
	address := InternalAddress(a.Service, a.ContainerPort)
	if address == "" {
		return ""
	}
	return "http://" + address
}
