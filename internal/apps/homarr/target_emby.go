package homarr

import (
	"context"
	"errors"
	"math"
	"time"

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
		stats:  verifyEmbyStats,
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
	if !ok || source["integrationId"] != integrationID || source["integrationKind"] != "emby" || source["error"] != nil {
		return errors.New("Homarr could not read Emby sessions")
	}
	sessions, ok := source["sessions"].([]any)
	if !ok {
		return errors.New("Homarr did not return Emby sessions")
	}
	for _, raw := range sessions {
		session, ok := raw.(map[string]any)
		user, hasUser := session["user"].(map[string]any)
		if !ok || stringField(session, "sessionId") == "" || !hasUser || stringField(user, "userId") == "" {
			return errors.New("Homarr returned incomplete Emby session identity")
		}
		playing, present := session["currentlyPlaying"]
		if !present {
			return errors.New("Homarr did not return Emby playback data")
		}
		if playing == nil {
			continue
		}
		item, ok := playing.(map[string]any)
		playback, hasPlayback := item["playback"].(map[string]any)
		if !ok || !hasPlayback {
			return errors.New("Homarr returned incomplete Emby playback data")
		}
		for _, key := range []string{"positionMs", "durationMs"} {
			value, present := playback[key]
			if !present {
				return errors.New("Homarr returned incomplete Emby playback timing")
			}
			if value == nil {
				continue
			}
			number, ok := value.(float64)
			if !ok || number < 0 || math.IsNaN(number) || math.IsInf(number, 0) {
				return errors.New("Homarr returned invalid Emby playback timing")
			}
		}
	}
	value, err = apiKeyProcedure(ctx, from, "widget.mediaRelease.getMediaReleases", map[string]any{"integrationIds": []string{integrationID}})
	if err != nil {
		return err
	}
	releases, ok := value.(map[string]any)
	if !ok {
		return errors.New("Homarr did not return Emby media releases")
	}
	items, ok := releases["releases"].([]any)
	if !ok {
		return errors.New("Homarr returned incomplete Emby media releases")
	}
	failures, ok := releases["failedIntegrations"].([]any)
	if !ok || len(failures) != 0 {
		return errors.New("Homarr could not read Emby media releases")
	}
	for _, raw := range items {
		item, ok := raw.(map[string]any)
		integration, hasIntegration := item["integration"].(map[string]any)
		if !ok || stringField(item, "id") == "" || stringField(item, "title") == "" || !hasIntegration || integration["id"] != integrationID || integration["kind"] != "emby" {
			return errors.New("Homarr returned incomplete Emby media identity")
		}
		if _, err := time.Parse(time.RFC3339Nano, stringField(item, "releaseDate")); err != nil {
			return errors.New("Homarr returned an invalid Emby media release date")
		}
	}
	return nil
}

func verifyEmbyStats(sample statsSample) error {
	sessions, ok := sample.values["sessions"].(float64)
	if sample.units["sessions"] != "count" || !ok || sessions < 0 || math.IsNaN(sessions) || math.IsInf(sessions, 0) || math.Trunc(sessions) != sessions {
		return errors.New("Homarr did not return the Emby session count")
	}
	return nil
}
