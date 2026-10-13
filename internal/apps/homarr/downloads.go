package homarr

import (
	"context"
	"errors"

	"github.com/ajnart/self-host/internal/helpers"
)

// downloadsQueue preserves the native sample for each App's semantic checks.
// An explicit empty items array is valid; rates and item fields are not coerced.
type downloadsQueue struct {
	integration map[string]any
	status      map[string]any
	items       []any
}

func readDownloadsQueue(ctx context.Context, from *helpers.H, integrationID, kind string) (downloadsQueue, error) {
	value, err := apiKeyProcedure(ctx, from, "widget.downloads.getJobsAndStatuses", map[string]any{
		"integrationIds": []string{integrationID}, "limitPerIntegration": 50,
	})
	if err != nil {
		return downloadsQueue{}, errors.New("Homarr could not read Downloads; check its connection and retry self-host setup homarr")
	}
	results, ok := value.([]any)
	if !ok || len(results) != 1 {
		return downloadsQueue{}, errors.New("Homarr did not return one Downloads result; retry self-host setup homarr")
	}
	result, ok := results[0].(map[string]any)
	integration, valid := result["integration"].(map[string]any)
	if !ok || !valid || result["error"] != nil || stringField(result, "integrationId") != integrationID || stringField(integration, "id") != integrationID || stringField(integration, "kind") != kind {
		return downloadsQueue{}, errors.New("Homarr could not read Downloads from the expected integration; check its credentials and retry self-host setup homarr")
	}
	data, ok := result["data"].(map[string]any)
	status, valid := data["status"].(map[string]any)
	items, hasItems := data["items"].([]any)
	if !ok || !valid || !hasItems {
		return downloadsQueue{}, errors.New("Homarr returned incomplete Downloads; an explicit status object and items array are required, including for an empty queue")
	}
	return downloadsQueue{integration: integration, status: status, items: items}, nil
}
