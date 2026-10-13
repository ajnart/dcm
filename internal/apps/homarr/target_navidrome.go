package homarr

import (
	"context"
	"errors"
	"math"
	"time"

	"github.com/ajnart/self-host/internal/apps/navidrome"
	"github.com/ajnart/self-host/internal/helpers"
)

const navidromePrivacyHoldHint = "Homarr Navidrome credential-safety hold #363: this Link requires verified Homarr 2.5.1 or 2.5.2, which include the diagnostic Address fix from PR #7170. Back up Homarr before changing its version, then run self-host setup homarr. Older, unknown or unreadable versions stay inactive; do not create a manual integration or bypass this hold. Standalone Navidrome Setup and owned Link removal remain separate."

func navidromeTarget() target {
	return target{
		id: "navidrome", name: "Navidrome", kind: "navidrome", internal: fixed("http://navidrome:4533"),
		secrets: func(_, to *helpers.H) []secret {
			return []secret{{Kind: "username", Value: to.Secret(to.Key("homarr_username"))}, {Kind: "password", Value: to.Secret(to.Key("homarr_password"))}}
		},
		widgets: []widget{
			{kind: "audioStats", options: map[string]any{"showArtists": true, "showAlbums": true, "showSongs": true, "compactMode": false}},
			{kind: "mediaServer", options: map[string]any{"showOnlyPlaying": false, "showBitrate": false, "showLocation": false}},
			statWidget("artistCount", "albumCount", "songCount"),
		},
		preflight: func(ctx context.Context, from, to *helpers.H) error {
			if err := requireCredentialSafeHomarr(ctx, from, navidromePrivacyHoldHint); err != nil {
				return err
			}
			_, err := navidrome.ReadHomarrData(ctx, to)
			return err
		},
		verify: verifyNavidrome,
		stats:  verifyNavidromeStats,
	}
}

func verifyNavidrome(ctx context.Context, from, to *helpers.H, integrationID string) error {
	ctx, cancel := context.WithTimeout(ctx, time.Minute)
	defer cancel()
	value, err := apiKeyProcedure(ctx, from, "integration.byId", map[string]any{"id": integrationID})
	if err != nil {
		return errors.New("Homarr could not verify its saved Navidrome account; review access to this Link's owned integration, then run self-host setup homarr")
	}
	if integrationID != from.Secret(from.Key("linked_navidrome")) || !navidromeIdentityMatches(value, integrationID, to.Secret(to.Key("homarr_username"))) {
		from.Info("Open Homarr's Integrations page and restore this Link's owned Navidrome integration to the saved regular Homarr account; run self-host setup navidrome to verify that account, then run self-host setup homarr. Do not change Navidrome accounts or adopt another account.")
		return helpers.ErrManual
	}
	_, err = navidrome.ReadHomarrData(ctx, to)
	if err != nil {
		return err
	}
	const failure = "Homarr Navidrome data is incomplete or unavailable; run self-host setup navidrome, then self-host setup homarr"
	value, err = apiKeyProcedure(ctx, from, "widget.audioStats.getStats", map[string]any{"integrationId": integrationID})
	if err != nil {
		return errors.New(failure)
	}
	result, ok := value.(map[string]any)
	if !ok || stringField(result, "kind") != "navidrome" {
		return errors.New(failure)
	}
	statistics, _ := result["data"].(map[string]any)
	if !navidromeCountsValid(statistics) {
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
	if !ok {
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

func navidromeIdentityMatches(value any, integrationID, username string) bool {
	integration, ok := value.(map[string]any)
	if !ok || integrationID == "" || username == "" || stringField(integration, "id") != integrationID || stringField(integration, "kind") != "navidrome" || stringField(integration, "url") != "http://navidrome:4533" {
		return false
	}
	credentials, ok := integration["secrets"].([]any)
	if !ok || len(credentials) != 2 {
		return false
	}
	usernameFound, passwordFound := false, false
	for _, raw := range credentials {
		credential, ok := raw.(map[string]any)
		if !ok {
			return false
		}
		value, present := credential["value"]
		switch stringField(credential, "kind") {
		case "username":
			usernameFound = stringField(credential, "value") == username
		case "password":
			passwordFound = present && value == nil
		default:
			return false
		}
	}
	return usernameFound && passwordFound
}

func navidromeCountsValid(statistics map[string]any) bool {
	for _, key := range []string{"artistCount", "albumCount", "songCount"} {
		count, ok := statistics[key].(float64)
		if !ok || math.IsNaN(count) || math.IsInf(count, 0) || count < 0 || math.Trunc(count) != count {
			return false
		}
	}
	albums := statistics["albumCount"].(float64)
	if albums > 10000 || albums == 0 && statistics["songCount"] != float64(0) || albums > 0 && statistics["artistCount"] == float64(0) {
		return false
	}
	return true
}

func verifyNavidromeStats(sample statsSample) error {
	for _, metric := range []string{"artistCount", "albumCount", "songCount"} {
		if sample.units[metric] != "count" {
			return errors.New("Homarr Navidrome Stats catalog has unexpected units; retry self-host setup homarr")
		}
	}
	if !navidromeCountsValid(sample.values) {
		return errors.New("Homarr Navidrome Stats counts are incomplete or invalid; retry self-host setup homarr")
	}
	return nil
}
