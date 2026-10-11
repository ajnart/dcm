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
	before, err := apiKeyProcedure(ctx, from, "widget.stats.snapshot", map[string]any{"integrationId": integrationID})
	if err != nil {
		return err
	}
	previous, ok := before.(map[string]any)
	if !ok {
		return errors.New("Homarr did not return the previous Gatus statistics snapshot; retry self-host setup homarr")
	}
	previousTime := float64(0)
	previousValue, exists := previous["updatedAt"]
	if !exists {
		return errors.New("Homarr returned Gatus statistics without their timestamp; retry self-host setup homarr")
	}
	if previousValue != nil {
		previousTime, ok = previousValue.(float64)
		if !ok || previousTime <= 0 || math.IsNaN(previousTime) || math.IsInf(previousTime, 0) {
			return errors.New("Homarr returned an invalid Gatus statistics timestamp; retry self-host setup homarr")
		}
	}
	value, err := apiKeyWrite(ctx, from, "widget.stats.refresh", map[string]any{"integrationId": integrationID, "force": true})
	if err != nil {
		return err
	}
	snapshot, ok := value.(map[string]any)
	if !ok {
		return errors.New("Homarr did not return Gatus statistics; retry self-host setup homarr")
	}
	failed, hasError := snapshot["error"].(bool)
	stale, hasStale := snapshot["stale"].(bool)
	updatedAt, hasTime := snapshot["updatedAt"].(float64)
	if !hasError || failed || !hasStale || stale || !hasTime || updatedAt <= 0 || math.IsNaN(updatedAt) || math.IsInf(updatedAt, 0) {
		return errors.New("Homarr has no current successful Gatus statistics; retry self-host setup homarr")
	}
	if updatedAt <= previousTime {
		return errors.New("Homarr has not refreshed Gatus statistics yet; its refresh may be busy, wait and retry self-host setup homarr")
	}
	values, ok := snapshot["values"].(map[string]any)
	if !ok {
		return errors.New("Homarr returned incomplete Gatus statistics; retry self-host setup homarr")
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
