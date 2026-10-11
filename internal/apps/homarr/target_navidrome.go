package homarr

import (
	"context"
	"errors"
	"time"

	"github.com/ajnart/self-host/internal/apps/navidrome"
	"github.com/ajnart/self-host/internal/helpers"
)

func navidromeTarget() target {
	return target{
		id: "navidrome", name: "Navidrome", kind: "navidrome", internal: fixed("http://navidrome:4533"),
		secrets: func(_, to *helpers.H) []secret {
			return []secret{{Kind: "username", Value: to.AdminUser()}, {Kind: "password", Value: to.AdminPassword()}}
		},
		widgets: []widget{
			{kind: "audioStats", options: map[string]any{"showArtists": true, "showAlbums": true, "showSongs": true, "compactMode": false}},
			{kind: "mediaServer", options: map[string]any{"showOnlyPlaying": false, "showBitrate": false, "showLocation": false}},
			statWidget("artistCount", "albumCount", "songCount"),
		},
		preflight: func(ctx context.Context, _, to *helpers.H) error {
			_, err := navidrome.ReadHomarrData(ctx, to)
			return err
		},
		verify: verifyNavidrome,
	}
}

func verifyNavidrome(ctx context.Context, from, to *helpers.H, integrationID string) error {
	ctx, cancel := context.WithTimeout(ctx, time.Minute)
	defer cancel()
	expected, err := navidrome.ReadHomarrData(ctx, to)
	if err != nil {
		return err
	}
	const failure = "Homarr Navidrome data is incomplete or unavailable; run self-host setup navidrome, then self-host setup homarr"
	value, err := apiKeyProcedure(ctx, from, "widget.audioStats.getStats", map[string]any{"integrationId": integrationID})
	if err != nil {
		return errors.New(failure)
	}
	result, ok := value.(map[string]any)
	if !ok || stringField(result, "kind") != "navidrome" {
		return errors.New(failure)
	}
	statistics, _ := result["data"].(map[string]any)
	if !navidromeCountsMatch(statistics, expected) {
		return errors.New(failure)
	}
	value, err = apiKeyWrite(ctx, from, "widget.stats.refresh", map[string]any{"integrationId": integrationID, "force": true})
	if err != nil {
		return errors.New(failure)
	}
	snapshot, ok := value.(map[string]any)
	if !ok || snapshot["error"] != false || snapshot["stale"] != false {
		return errors.New(failure)
	}
	updatedAt, ok := snapshot["updatedAt"].(float64)
	statistics, _ = snapshot["values"].(map[string]any)
	if !ok || updatedAt <= 0 || !navidromeCountsMatch(statistics, expected) {
		return errors.New(failure)
	}
	value, err = apiKeyProcedure(ctx, from, "widget.mediaServer.getCurrentStreams", map[string]any{"integrationIds": []string{integrationID}, "showOnlyPlaying": false})
	if err != nil {
		return errors.New(failure)
	}
	streams, ok := value.([]any)
	if !ok || len(streams) != 1 {
		return errors.New(failure)
	}
	stream, ok := streams[0].(map[string]any)
	if !ok || stringField(stream, "integrationId") != integrationID || stringField(stream, "integrationKind") != "navidrome" || stream["error"] != nil {
		return errors.New(failure)
	}
	sessions, ok := stream["sessions"].([]any)
	if !ok || len(sessions) != expected.Sessions {
		return errors.New(failure)
	}
	for _, raw := range sessions {
		session, ok := raw.(map[string]any)
		if !ok || stringField(session, "sessionId") == "" {
			return errors.New(failure)
		}
		user, _ := session["user"].(map[string]any)
		playing, _ := session["currentlyPlaying"].(map[string]any)
		if stringField(user, "username") == "" || stringField(playing, "type") != "audio" || stringField(playing, "name") == "" {
			return errors.New(failure)
		}
	}
	return nil
}

func navidromeCountsMatch(statistics map[string]any, expected navidrome.HomarrData) bool {
	for key, expectedCount := range map[string]int{"artistCount": expected.ArtistCount, "albumCount": expected.AlbumCount, "songCount": expected.SongCount} {
		count, ok := statistics[key].(float64)
		if !ok || count != float64(expectedCount) {
			return false
		}
	}
	return true
}
