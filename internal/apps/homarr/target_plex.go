package homarr

import (
	"context"
	"errors"
	"math"

	"github.com/ajnart/self-host/internal/apps/plex"
	"github.com/ajnart/self-host/internal/helpers"
)

func plexTarget() target {
	return target{
		id: "plex", name: "Plex", kind: "plex", internal: fixed("http://plex:32400"),
		secrets: apiKeySecret,
		widgets: []widget{{kind: "mediaServer", options: map[string]any{
			"showOnlyPlaying": false, "showBitrate": true, "showLocation": true,
		}}, plain("mediaReleases"), statWidget("sessions")},
		preflight: func(ctx context.Context, from, to *helpers.H) error {
			if err := plex.VerifyHomarr(ctx, to); err != nil {
				if errors.Is(err, helpers.ErrManual) {
					from.Info("Plex needs its server claim, saved server token and account ownership verified first; follow self-host setup plex before retrying Homarr.")
				}
				return err
			}
			return nil
		},
		verify: verifyPlex,
	}
}

func verifyPlex(ctx context.Context, from, to *helpers.H, integrationID string) error {
	if err := plex.VerifyHomarr(ctx, to); err != nil {
		return err
	}
	value, err := apiKeyProcedure(ctx, from, "widget.mediaServer.getCurrentStreams", map[string]any{
		"integrationIds": []string{integrationID}, "showOnlyPlaying": false,
	})
	if err != nil {
		return err
	}
	streams, ok := value.([]any)
	if !ok || len(streams) != 1 {
		return errors.New("Homarr did not return the requested Plex streams; retry self-host setup homarr")
	}
	stream, ok := streams[0].(map[string]any)
	if !ok || stringField(stream, "integrationId") != integrationID || stringField(stream, "integrationKind") != "plex" || stream["error"] != nil {
		return errors.New("Homarr could not read this Plex server's streams")
	}
	sessions, ok := stream["sessions"].([]any)
	if !ok {
		return errors.New("Homarr returned incomplete Plex stream data")
	}
	for _, item := range sessions {
		session, ok := item.(map[string]any)
		if !ok || stringField(session, "sessionId") == "" || stringField(session, "sessionId") == "unknown" {
			return errors.New("Homarr Plex streams lack native session identifiers")
		}
		user, ok := session["user"].(map[string]any)
		if !ok || stringField(user, "userId") == "" || stringField(user, "userId") == "Anonymous" {
			return errors.New("Homarr Plex streams lack native user identifiers")
		}
	}
	value, err = apiKeyProcedure(ctx, from, "widget.mediaRelease.getMediaReleases", map[string]any{"integrationIds": []string{integrationID}})
	if err != nil {
		return err
	}
	releases, ok := value.(map[string]any)
	if !ok {
		return errors.New("Homarr did not return Plex media releases")
	}
	failed, ok := releases["failedIntegrations"].([]any)
	if !ok || len(failed) != 0 {
		return errors.New("Homarr could not read Plex media releases")
	}
	items, ok := releases["releases"].([]any)
	if !ok {
		return errors.New("Homarr returned incomplete Plex media releases")
	}
	for _, item := range items {
		release, ok := item.(map[string]any)
		if !ok || stringField(release, "id") == "" || stringField(release, "title") == "" {
			return errors.New("Homarr Plex releases lack native media identifiers or titles")
		}
		integration, ok := release["integration"].(map[string]any)
		if !ok || stringField(integration, "id") != integrationID || stringField(integration, "kind") != "plex" {
			return errors.New("Homarr returned media releases from a different integration")
		}
	}
	started := from.Now().UnixMilli()
	value, err = apiKeyWrite(ctx, from, "widget.stats.refresh", map[string]any{"integrationId": integrationID, "force": true})
	if err != nil {
		return err
	}
	snapshot, ok := value.(map[string]any)
	if !ok || snapshot["error"] != false || snapshot["stale"] != false {
		return errors.New("Homarr could not refresh Plex playback statistics; retry self-host setup homarr")
	}
	updatedAt, ok := snapshot["updatedAt"].(float64)
	if !ok || updatedAt < float64(started) {
		return errors.New("Homarr Plex playback statistics were not freshly verified; retry self-host setup homarr")
	}
	statistics, ok := snapshot["values"].(map[string]any)
	if !ok {
		return errors.New("Homarr returned incomplete Plex playback statistics")
	}
	count, ok := statistics["sessions"].(float64)
	if !ok || count < 0 || math.Trunc(count) != count {
		return errors.New("Homarr did not return a valid Plex playback session count")
	}
	return nil
}
