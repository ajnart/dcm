package telemetry

import (
	"errors"
	"net"
	"net/url"
	"regexp"
	"strings"
)

// AppRequest is an agent's note that a person wants an App the Catalog lacks.
type AppRequest struct {
	// Name is the normalised App name; URLHost is the host of its homepage, or "".
	Name, URLHost string
}

const maxRequestName = 64

var (
	requestName = regexp.MustCompile(`^[a-z0-9][a-z0-9 ._+-]*$`)
	hostPattern = regexp.MustCompile(`^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$`)
)

// NewAppRequest normalises name (trimmed, lowercase, at most 64 characters of
// a-z 0-9 space . _ + -) and keeps only the host of the optional http or https
// homepage. It rejects anything else, so no free text can travel.
func NewAppRequest(name, homepage string) (AppRequest, error) {
	name = strings.ToLower(strings.TrimSpace(name))
	if len(name) > maxRequestName || !requestName.MatchString(name) {
		return AppRequest{}, errors.New("the App name must be 1 to 64 characters of letters a-z, digits, space and . _ + -")
	}
	r := AppRequest{Name: name}
	if homepage = strings.TrimSpace(homepage); homepage != "" {
		u, err := url.Parse(homepage)
		host := ""
		if err == nil {
			host = strings.ToLower(u.Hostname())
		}
		if err != nil || (u.Scheme != "http" && u.Scheme != "https") || len(host) > 253 || net.ParseIP(host) != nil || !hostPattern.MatchString(host) {
			return AppRequest{}, errors.New("the homepage must be an http or https URL with a public host name")
		}
		r.URLHost = host
	}
	return r, nil
}
