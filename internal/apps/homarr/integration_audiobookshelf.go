package homarr

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"reflect"

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
			for field, expectedValue := range expected {
				if !reflect.DeepEqual(statistics[field], expectedValue) {
					return fmt.Errorf("Homarr Audiobookshelf %s does not match fresh authenticated peer data; retry self-host setup homarr", field)
				}
			}
			values, err := freshStatsSnapshot(ctx, from, integrationID)
			if err != nil {
				return err
			}
			for _, metric := range []string{"libraryCount", "totalAudiobooks", "totalPodcasts", "activeSessions"} {
				if !reflect.DeepEqual(values[metric], expected[metric]) {
					return fmt.Errorf("Homarr Audiobookshelf %s Stats does not match fresh authenticated peer data; retry self-host setup homarr", metric)
				}
			}
			return nil
		},
	}
}
