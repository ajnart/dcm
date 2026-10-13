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
		stats:     verifyNetdataStats,
	}
}

func preflightNetdata(ctx context.Context, from, to *helpers.H) error {
	err := netdata.VerifyHomarr(ctx, to)
	if errors.Is(err, helpers.ErrManual) {
		from.Info("Netdata local API access is denied. Preserve its authentication; Homarr 2.4.1 cannot supply a Netdata credential. Review compatible local access, then retry self-host setup netdata and self-host setup homarr.")
	}
	return err
}

func verifyNetdata(ctx context.Context, from, to *helpers.H, _ string) error {
	return preflightNetdata(ctx, from, to)
}

func verifyNetdataStats(sample statsSample) error {
	if sample.updatedAt < sample.startedAt || sample.updatedAt > sample.completedAt+30_000 {
		return errors.New("Homarr did not return freshly collected Netdata statistics; check its refresh queue and clock, then retry self-host setup homarr")
	}
	for _, key := range []string{"warnings", "criticals"} {
		count, ok := sample.values[key].(float64)
		if sample.units[key] != "count" || !ok || math.IsNaN(count) || math.IsInf(count, 0) || count < 0 || math.Trunc(count) != count {
			return errors.New("Homarr returned incomplete Netdata alarm counts; retry self-host setup homarr")
		}
	}
	return nil
}
