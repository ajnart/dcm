package netdata_test

import (
	"reflect"
	"strings"
	"testing"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/apps/netdata"
)

func TestNetdataDeclaresOnlyPinnedSleepTimerFIFO(t *testing.T) {
	var adapter app.App = netdata.App{}
	declarer, ok := adapter.(app.EphemeralFIFODeclarer)
	if !ok {
		t.Fatal("Netdata sleep timer FIFO is included as persistent backup state")
	}
	if !reflect.DeepEqual(declarer.EphemeralFIFOs(), []string{"cache/.netdata_bash_sleep_timer_fifo"}) {
		t.Fatal("Netdata exclusion differs from the pinned sleep timer and cache bind")
	}
	if !strings.Contains(adapter.Compose(app.RenderContext{Port: 19999}), "./cache:/var/cache/netdata") {
		t.Fatal("declared sleep timer no longer matches cache persistence mapping")
	}
}
