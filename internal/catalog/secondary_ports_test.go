package catalog_test

import (
	"reflect"
	"testing"

	"github.com/ajnart/self-host/internal/catalog"
)

func TestSecondaryHostPortsAreDeclaredByTheCatalog(t *testing.T) {
	want := map[string]struct {
		key          string
		defaultValue string
	}{
		"qbittorrent":    {key: "torrent-port", defaultValue: "6881"},
		"pihole":         {key: "dns-port", defaultValue: "53"},
		"technitium-dns": {key: "dns-port", defaultValue: "53"},
	}
	for id, expected := range want {
		a, found := catalog.Default().App(id)
		if !found {
			t.Fatalf("catalog lacks %s", id)
		}
		var declarations int
		for _, input := range a.Inputs() {
			if len(input.HostPortProtocols) == 0 {
				continue
			}
			declarations++
			if input.Key != expected.key || input.Default != expected.defaultValue {
				t.Errorf("%s secondary port = %s/%s, want %s/%s", id, input.Key, input.Default, expected.key, expected.defaultValue)
			}
			if !reflect.DeepEqual(input.HostPortProtocols, []string{"tcp", "udp"}) {
				t.Errorf("%s protocols = %v, want tcp and udp", id, input.HostPortProtocols)
			}
		}
		if declarations != 1 {
			t.Errorf("%s secondary port declarations = %d, want 1", id, declarations)
		}
	}
}
