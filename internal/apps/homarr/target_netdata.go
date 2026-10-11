package homarr

import (
	"context"
	"errors"
	"math"

	"github.com/ajnart/self-host/internal/apps/netdata"
	"github.com/ajnart/self-host/internal/helpers"
)

func netdataTarget() target {
	return target{
		id: "netdata", name: "Netdata", kind: "netdata", internal: fixed("http://netdata:19999"),
		widgets:   []widget{statWidget("warnings", "criticals")},
		preflight: preflightNetdata,
		verify:    verifyNetdata,
	}
}

func preflightNetdata(ctx context.Context, from, to *helpers.H) error {
	err := netdata.VerifyHomarr(ctx, to)
	if errors.Is(err, helpers.ErrManual) {
		from.Info("Netdata local API access is denied. Preserve its authentication; Homarr 2.4.1 cannot supply a Netdata credential. Review compatible local access, then retry self-host setup netdata and self-host setup homarr.")
	}
	return err
}

func verifyNetdata(ctx context.Context, from, _ *helpers.H, integrationID string) error {
	started := from.Now().UnixMilli()
	value, err := apiKeyWrite(ctx, from, "widget.stats.refresh", map[string]any{"integrationId": integrationID, "force": true})
	if err != nil {
		return err
	}
	snapshot, ok := value.(map[string]any)
	if !ok || snapshot["error"] != false || snapshot["stale"] != false {
		return errors.New("Homarr could not refresh Netdata alarm counts; check local API access and retry self-host setup homarr")
	}
	updatedAt, ok := snapshot["updatedAt"].(float64)
	if !ok || math.IsNaN(updatedAt) || math.IsInf(updatedAt, 0) || updatedAt < float64(started) || updatedAt > float64(from.Now().UnixMilli()+30_000) {
		return errors.New("Homarr did not return freshly collected Netdata statistics; check its refresh queue and clock, then retry self-host setup homarr")
	}
	counts, ok := snapshot["values"].(map[string]any)
	if !ok {
		return errors.New("Homarr did not return Netdata alarm counts")
	}
	for _, key := range []string{"warnings", "criticals"} {
		count, ok := counts[key].(float64)
		if !ok || math.IsNaN(count) || math.IsInf(count, 0) || count < 0 || math.Trunc(count) != count {
			return errors.New("Homarr returned incomplete Netdata alarm counts; retry self-host setup homarr")
		}
	}
	return nil
}
