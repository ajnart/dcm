package homarr

import (
	"context"
	"errors"
	"math"

	"github.com/ajnart/self-host/internal/apps/emby"
	"github.com/ajnart/self-host/internal/helpers"
)

func embyTarget() target {
	return target{
		id: "emby", name: "Emby", kind: "emby", internal: fixed("http://emby:8096"),
		secrets: func(_, to *helpers.H) []secret {
			return []secret{{Kind: "apiKey", Value: emby.APIKey(to)}}
		},
		widgets: []widget{
			plain("mediaServer"),
			{kind: "mediaReleases", bind: func(ctx context.Context, to *helpers.H, _ string) (map[string]any, error) {
				if err := emby.VerifyReleases(ctx, to); err != nil {
					return nil, err
				}
				return map[string]any{}, nil
			}},
			statWidget("sessions"),
		},
		verify: verifyEmby,
	}
}

func verifyEmby(ctx context.Context, from, to *helpers.H, integrationID string) error {
	if err := emby.VerifyReleases(ctx, to); err != nil {
		return err
	}
	value, err := apiKeyProcedure(ctx, from, "widget.mediaServer.getCurrentStreams", map[string]any{
		"integrationIds": []string{integrationID}, "showOnlyPlaying": false,
	})
	if err != nil {
		return err
	}
	sources, ok := value.([]any)
	if !ok || len(sources) != 1 {
		return errors.New("Homarr did not return the Emby stream source")
	}
	source, ok := sources[0].(map[string]any)
	if !ok || source["integrationId"] != integrationID || source["error"] != nil {
		return errors.New("Homarr could not read Emby sessions")
	}
	if _, ok := source["sessions"].([]any); !ok {
		return errors.New("Homarr did not return Emby sessions")
	}
	value, err = apiKeyProcedure(ctx, from, "widget.mediaRelease.getMediaReleases", map[string]any{"integrationIds": []string{integrationID}})
	if err != nil {
		return err
	}
	releases, ok := value.(map[string]any)
	if !ok {
		return errors.New("Homarr did not return Emby media releases")
	}
	if _, ok := releases["releases"].([]any); !ok {
		return errors.New("Homarr returned incomplete Emby media releases")
	}
	failures, ok := releases["failedIntegrations"].([]any)
	if !ok || len(failures) != 0 {
		return errors.New("Homarr could not read Emby media releases")
	}
	value, err = apiKeyProcedure(ctx, from, "widget.stats.catalog", map[string]any{"integrationId": integrationID})
	if err != nil {
		return err
	}
	catalog, ok := value.(map[string]any)
	if !ok {
		return errors.New("Homarr did not return the Emby Stats catalog")
	}
	metrics, ok := catalog["metrics"].([]any)
	supported := false
	for _, raw := range metrics {
		metric, ok := raw.(map[string]any)
		if ok && metric["key"] == "sessions" && metric["unit"] == "count" {
			supported = true
		}
	}
	if !ok || !supported {
		return errors.New("Homarr does not expose the supported Emby sessions metric")
	}
	value, err = apiKeyWrite(ctx, from, "widget.stats.refresh", map[string]any{"integrationId": integrationID, "force": false})
	if err != nil {
		return err
	}
	snapshot, ok := value.(map[string]any)
	if !ok || snapshot["error"] != false || snapshot["stale"] != false {
		return errors.New("Homarr Emby Stats are unavailable or stale; retry self-host setup homarr")
	}
	values, ok := snapshot["values"].(map[string]any)
	if !ok {
		return errors.New("Homarr did not return Emby Stats values")
	}
	sessions, ok := values["sessions"].(float64)
	if !ok || sessions < 0 || math.Trunc(sessions) != sessions {
		return errors.New("Homarr did not return the Emby session count")
	}
	return nil
}
