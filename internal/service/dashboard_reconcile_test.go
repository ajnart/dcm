package service

import (
	"context"
	"testing"
)

func TestDashboardSeesAppsAfterInstallRemoveAndAddressChange(t *testing.T) {
	dashboard := &inventoryProbeApp{testApp: &testApp{id: "homarr", done: map[string]bool{}}, inspect: true}
	h := newHarness(t, dashboard, &testApp{id: "one", done: map[string]bool{}})
	if err := h.install("homarr"); err != nil {
		t.Fatal(err)
	}
	if err := h.install("one"); err != nil {
		t.Fatal(err)
	}
	if len(dashboard.installed) != 2 {
		t.Errorf("dashboard did not see added App: %+v", dashboard.installed)
	}
	if err := h.svc.ConfigSet(context.Background(), []string{"LAN_IP=192.168.1.42"}); err != nil {
		t.Fatal(err)
	}
	for _, item := range dashboard.installed {
		if item.URL != "http://192.168.1.42:9000" && item.URL != "http://192.168.1.42:9001" {
			t.Errorf("dashboard kept stale browser address: %+v", item)
		}
	}
	if err := h.svc.Remove(context.Background(), []string{"one"}, false); err != nil {
		t.Fatal(err)
	}
	if len(dashboard.installed) != 1 || dashboard.installed[0].ID != "homarr" {
		t.Errorf("dashboard kept removed App: %+v", dashboard.installed)
	}
}
