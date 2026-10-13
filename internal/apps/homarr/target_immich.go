package homarr

import (
	"context"
	"errors"

	"github.com/ajnart/self-host/internal/apps/immich"
	"github.com/ajnart/self-host/internal/helpers"
)

func immichTarget() target {
	return target{
		id: "immich", name: "Immich", kind: "immich", internal: (*helpers.H).InternalURL,
		secrets: func(_, to *helpers.H) []secret {
			return []secret{{Kind: "apiKey", Value: to.Secret(to.Key("homarr_api_key"))}}
		},
		widgets: []widget{{kind: "immich-serverStats", options: map[string]any{
			"showUsers": true, "showPhotos": true, "showVideos": true, "showStorage": true,
		}}, statWidget("userCount", "photoCount", "videoCount", "totalLibraryUsageInBytes")},
		verify: verifyImmich,
	}
}

func verifyImmich(ctx context.Context, from, to *helpers.H, integrationID string) error {
	if err := immich.VerifyHomarr(ctx, to); err != nil {
		return err
	}
	value, err := apiKeyProcedure(ctx, from, "widget.immich.getServerStats", map[string]any{"integrationId": integrationID})
	if err != nil {
		return err
	}
	statistics, ok := value.(map[string]any)
	if !ok {
		return errors.New("Homarr did not return Immich server statistics")
	}
	for _, key := range []string{"userCount", "photoCount", "videoCount", "totalLibraryUsageInBytes"} {
		count, ok := statistics[key].(float64)
		if !ok || count < 0 || key == "userCount" && count == 0 {
			return errors.New("Homarr returned incomplete Immich statistics; retry self-host setup homarr")
		}
	}
	return nil
}
