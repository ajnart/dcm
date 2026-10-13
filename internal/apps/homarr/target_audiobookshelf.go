package homarr

import (
	"context"
	"errors"
	"fmt"
	"math"
	"net/http"

	"github.com/ajnart/self-host/internal/apps/audiobookshelf"
	"github.com/ajnart/self-host/internal/helpers"
)

func audiobookshelfTarget() target {
	return target{
		id: "audiobookshelf", name: "Audiobookshelf", kind: "audiobookshelf",
		internal: fixed("http://audiobookshelf:80"), secrets: apiKeySecret,
		widgets: []widget{{
			kind: "audioStats",
			options: map[string]any{
				"showLibraryCount": true, "showAudiobooks": true, "showPodcasts": true,
				"showListeningTime": false, "showActiveSessions": true, "compactMode": false,
				"showArtists": false, "showAlbums": false, "showSongs": false,
			},
		}, statWidget("libraryCount", "totalAudiobooks", "totalPodcasts", "activeSessions")},
		preflight: func(ctx context.Context, _, to *helpers.H) error {
			_, err := audiobookshelf.VerifyHomarrCredential(ctx, to)
			return err
		},
		stats: verifyAudiobookshelfStats,
		verify: func(ctx context.Context, from, to *helpers.H, integrationID string) error {
			if integrationID == "" || integrationID != from.Secret(from.Key("linked_audiobookshelf")) {
				return errors.New("Homarr did not retain its owned Audiobookshelf integration ID")
			}
			value, err := apiKeyProcedure(ctx, from, "integration.byId", map[string]any{"id": integrationID})
			if err != nil {
				return err
			}
			integration, ok := value.(map[string]any)
			if !ok || stringField(integration, "id") != integrationID || stringField(integration, "kind") != "audiobookshelf" || stringField(integration, "url") != "http://audiobookshelf:80" {
				return errors.New("Homarr's saved Audiobookshelf integration does not match its owned destination")
			}
			expected, err := audiobookshelf.VerifyHomarrCredential(ctx, to)
			if err != nil {
				return err
			}
			value, err = apiKeyWrite(ctx, from, "integration.request", map[string]any{
				"integrationId": integrationID, "method": http.MethodPost, "path": "/api/authorize",
			})
			if err != nil {
				return err
			}
			authorization, ok := value.(map[string]any)
			if !ok || authorization["ok"] != true || authorization["status"] != float64(http.StatusOK) {
				return errors.New("Homarr could not authenticate its saved Audiobookshelf credential")
			}
			destination, _ := authorization["integration"].(map[string]any)
			if stringField(destination, "id") != integrationID || stringField(destination, "kind") != "audiobookshelf" {
				return errors.New("Homarr authenticated a different Audiobookshelf integration")
			}
			body, _ := authorization["data"].(map[string]any)
			user, _ := body["user"].(map[string]any)
			if stringField(user, "id") != to.Secret(to.Key("homarr_user_id")) || stringField(user, "type") != "admin" || user["isActive"] != true {
				return errors.New("Homarr's saved Audiobookshelf credential does not belong to the dedicated active administrator")
			}
			value, err = apiKeyProcedure(ctx, from, "widget.audioStats.getStats", map[string]any{"integrationId": integrationID})
			if err != nil {
				return err
			}
			native, ok := value.(map[string]any)
			if !ok || stringField(native, "kind") != "audiobookshelf" {
				return errors.New("Homarr did not return native Audiobookshelf Audio Stats")
			}
			statistics, ok := native["data"].(map[string]any)
			if !ok {
				return errors.New("Homarr did not return native Audiobookshelf statistics")
			}
			return verifyAudiobookshelfNative(statistics, expected)
		},
	}
}

func verifyAudiobookshelfStats(sample statsSample) error {
	for _, metric := range []string{"libraryCount", "totalAudiobooks", "totalPodcasts", "activeSessions"} {
		if sample.units[metric] != "count" || !audiobookshelfNumber(sample.values[metric], true) {
			return fmt.Errorf("Homarr Audiobookshelf %s Stats is not a nonnegative integral count; retry self-host setup homarr", metric)
		}
	}
	if sample.values["libraryCount"] == float64(0) && (sample.values["totalAudiobooks"] != float64(0) || sample.values["totalPodcasts"] != float64(0)) {
		return errors.New("Homarr Audiobookshelf Stats reports media without a library; retry self-host setup homarr")
	}
	return nil
}

func audiobookshelfNumber(value any, integral bool) bool {
	number, ok := value.(float64)
	return ok && !math.IsNaN(number) && !math.IsInf(number, 0) && number >= 0 && (!integral || math.Trunc(number) == number)
}

func verifyAudiobookshelfNative(statistics, expected map[string]any) error {
	const failure = "Homarr Audiobookshelf native statistics are incomplete or inconsistent; retry self-host setup homarr"
	for _, metric := range []string{"libraryCount", "totalAudiobooks", "totalPodcasts", "activeSessions"} {
		if !audiobookshelfNumber(statistics[metric], true) {
			return errors.New(failure)
		}
	}
	if !audiobookshelfNumber(statistics["totalListeningTimeSeconds"], false) {
		return errors.New(failure)
	}
	libraries, ok := statistics["libraries"].([]any)
	if !ok || statistics["libraryCount"] != float64(len(libraries)) {
		return errors.New(failure)
	}
	known := map[string]map[string]any{}
	expectedLibraries, ok := expected["libraries"].([]any)
	if !ok {
		return errors.New(failure)
	}
	for _, raw := range expectedLibraries {
		library, ok := raw.(map[string]any)
		if !ok {
			return errors.New(failure)
		}
		known[stringField(library, "id")] = library
	}
	seen := map[string]bool{}
	audiobooks, podcasts := float64(0), float64(0)
	for _, raw := range libraries {
		library, ok := raw.(map[string]any)
		id := stringField(library, "id")
		name, named := library["name"].(string)
		mediaType := stringField(library, "mediaType")
		if !ok || id == "" || seen[id] || !named || known[id] == nil || name != known[id]["name"] || mediaType != known[id]["mediaType"] || !audiobookshelfNumber(library["totalItems"], true) {
			return errors.New(failure)
		}
		seen[id] = true
		for _, field := range []string{"totalDurationSeconds", "totalSizeBytes"} {
			value, present := library[field]
			if !present || value != nil && !audiobookshelfNumber(value, field == "totalSizeBytes") {
				return errors.New(failure)
			}
		}
		if mediaType == "book" {
			audiobooks += library["totalItems"].(float64)
		} else {
			podcasts += library["totalItems"].(float64)
		}
	}
	if len(seen) != len(known) || statistics["totalAudiobooks"] != audiobooks || statistics["totalPodcasts"] != podcasts {
		return errors.New(failure)
	}
	return nil
}
