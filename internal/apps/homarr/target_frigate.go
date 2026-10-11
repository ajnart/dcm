package homarr

import (
	"context"
	"errors"
	"math"

	"github.com/ajnart/self-host/internal/apps/frigate"
	"github.com/ajnart/self-host/internal/helpers"
)

func frigateTarget() target {
	return target{
		id: "frigate", name: "Frigate", kind: "frigate", internal: fixed("https://frigate:8971"),
		secrets: func(_, to *helpers.H) []secret {
			return []secret{{Kind: "username", Value: to.AdminUser()}, {Kind: "password", Value: to.AdminPassword()}}
		},
		widgets: []widget{statWidget("cameras", "uptime", "version")},
		verify:  verifyFrigate,
	}
}

func verifyFrigate(ctx context.Context, from, to *helpers.H, integrationID string) error {
	statistics, err := frigate.VerifyHomarr(ctx, to)
	if err != nil || integrationID == "" {
		return err
	}
	previous, err := apiKeyProcedure(ctx, from, "widget.stats.snapshot", map[string]any{"integrationId": integrationID})
	if err != nil {
		return err
	}
	oldSnapshot, ok := previous.(map[string]any)
	if !ok {
		return errors.New("Homarr did not return its Frigate statistics snapshot")
	}
	oldUpdate, _ := oldSnapshot["updatedAt"].(float64)
	value, err := apiKeyWrite(ctx, from, "widget.stats.refresh", map[string]any{"integrationId": integrationID, "force": true})
	if err != nil {
		return err
	}
	snapshot, ok := value.(map[string]any)
	if !ok || snapshot["error"] != false || snapshot["stale"] != false {
		return errors.New("Homarr did not return fresh authenticated Frigate statistics; verify certificate trust and the Admin login, then retry self-host setup homarr")
	}
	updatedAt, ok := snapshot["updatedAt"].(float64)
	if !ok || updatedAt <= 0 || updatedAt <= oldUpdate || math.IsNaN(updatedAt) || math.IsInf(updatedAt, 0) {
		return errors.New("Homarr did not complete a fresh Frigate statistics refresh; retry self-host setup homarr when its statistics queue is available")
	}
	values, _ := snapshot["values"].(map[string]any)
	cameras, camerasOK := values["cameras"].(float64)
	uptime, uptimeOK := values["uptime"].(float64)
	if !camerasOK || cameras != float64(statistics.Cameras) || !uptimeOK || uptime < 0 || math.IsNaN(uptime) || math.IsInf(uptime, 0) || values["version"] != statistics.Version {
		return errors.New("Homarr returned incomplete or mismatched Frigate cameras, uptime or version; retry self-host setup homarr")
	}
	return nil
}
