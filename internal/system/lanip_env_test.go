package system

import (
	"errors"
	"testing"
)

func TestSelfHostLANIPOverridesDetection(t *testing.T) {
	detected := func() (string, error) { return "172.17.0.2", nil }
	env := func(v string) func(string) string {
		return func(k string) string {
			if k == EnvLANIP {
				return v
			}
			return ""
		}
	}
	if ip, _ := lanIPFrom(env("192.168.1.186"), detected)(); ip != "192.168.1.186" {
		t.Fatalf("LANIP = %q, want the override", ip)
	}
	if ips, _ := hostIPsFrom(env("192.168.1.186"), func() ([]string, error) { return nil, errors.New("unused") })(); len(ips) != 1 || ips[0] != "192.168.1.186" {
		t.Fatalf("HostIPs = %v, want the override", ips)
	}
	for _, bad := range []string{"", "not-an-ip", "::1"} {
		if ip, _ := lanIPFrom(env(bad), detected)(); ip != "172.17.0.2" {
			t.Fatalf("LANIP with %q = %q, want detected", bad, ip)
		}
	}
}
