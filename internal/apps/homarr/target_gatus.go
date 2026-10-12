package homarr

import (
	"context"
	"errors"
	"math"

	"github.com/ajnart/self-host/internal/apps/gatus"
	"github.com/ajnart/self-host/internal/helpers"
)

func gatusTarget() target {
	return target{
		id: "gatus", name: "Gatus", kind: "gatus", internal: fixed("http://gatus:8080"),
		secrets: func(_, _ *helpers.H) []secret { return []secret{} },
		widgets: []widget{statWidget("up", "down", "unknown", "total")},
		verify:  verifyGatus,
	}
}

func verifyGatus(ctx context.Context, from, to *helpers.H, integrationID string) error {
	if err := gatus.VerifyHomarr(ctx, to); err != nil {
		return err
	}
	values, err := freshStatsSnapshot(ctx, from, integrationID)
	if err != nil {
		return err
	}
	counts := map[string]float64{}
	for _, key := range []string{"up", "down", "unknown", "total"} {
		count, ok := values[key].(float64)
		if !ok || count < 0 || math.Trunc(count) != count || math.IsNaN(count) || math.IsInf(count, 0) {
			return errors.New("Homarr returned incomplete Gatus statistics; retry self-host setup homarr")
		}
		counts[key] = count
	}
	if counts["up"]+counts["down"]+counts["unknown"] != counts["total"] {
		return errors.New("Homarr returned inconsistent Gatus endpoint counts; retry self-host setup homarr")
	}
	if counts["total"] == 0 || counts["up"] == 0 {
		return errors.New("Homarr's Gatus data has no successful endpoint; wait for the local health check, then retry self-host setup homarr")
	}
	return nil
}
