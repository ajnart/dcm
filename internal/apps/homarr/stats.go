package homarr

import (
	"context"
	"errors"
	"fmt"
	"math"

	"github.com/ajnart/self-host/internal/helpers"
)

// statsSample carries one completed refresh and its catalog. Timestamps are
// Unix milliseconds; leaves may enforce their own clock limits and units.
type statsSample struct {
	values    map[string]any
	units     map[string]string
	startedAt float64
	updatedAt float64
}

func (t target) statsMetrics() []string {
	selected := []string{}
	seen := map[string]bool{}
	for _, w := range t.widgets {
		if w.kind != "stats" {
			continue
		}
		for _, metric := range w.metrics {
			if !seen[metric] {
				selected = append(selected, metric)
				seen[metric] = true
			}
		}
	}
	return selected
}

func readStatsSample(ctx context.Context, h *helpers.H, integrationID string, selected []string) (statsSample, error) {
	value, err := apiKeyProcedure(ctx, h, "widget.stats.catalog", map[string]any{"integrationId": integrationID})
	if err != nil {
		return statsSample{}, err
	}
	catalog, ok := value.(map[string]any)
	metrics, valid := catalog["metrics"].([]any)
	if !ok || !valid {
		return statsSample{}, errors.New("Homarr did not return a Stats catalog; retry self-host setup homarr")
	}
	units := map[string]string{}
	for _, raw := range metrics {
		metric, ok := raw.(map[string]any)
		key := stringField(metric, "key")
		unit := stringField(metric, "unit")
		if !ok || key == "" || unit == "" {
			return statsSample{}, errors.New("Homarr returned an invalid Stats catalog; retry self-host setup homarr")
		}
		if _, present := units[key]; present {
			return statsSample{}, errors.New("Homarr returned duplicate Stats catalog metrics; retry self-host setup homarr")
		}
		units[key] = unit
	}
	for _, metric := range selected {
		if _, present := units[metric]; !present {
			return statsSample{}, fmt.Errorf("Homarr does not expose %s Stats; use Homarr 2.4.1 and retry Setup", metric)
		}
	}
	sample, err := refreshStatsSample(ctx, h, integrationID)
	if err != nil {
		return statsSample{}, err
	}
	for _, metric := range selected {
		if sample.values[metric] == nil {
			return statsSample{}, fmt.Errorf("Homarr did not return refreshed %s Stats; retry self-host setup homarr", metric)
		}
	}
	sample.units = units
	return sample, nil
}

func refreshStatsSample(ctx context.Context, h *helpers.H, integrationID string) (statsSample, error) {
	input := map[string]any{"integrationId": integrationID}
	value, err := apiKeyProcedure(ctx, h, "widget.stats.snapshot", input)
	if err != nil {
		return statsSample{}, err
	}
	before, ok := value.(map[string]any)
	if !ok {
		return statsSample{}, errors.New("Homarr did not return a Stats snapshot")
	}
	previous, present := before["updatedAt"]
	timestamp, numeric := previous.(float64)
	if !present || previous != nil && (!numeric || !validStatsTimestamp(timestamp)) {
		return statsSample{}, errors.New("Homarr did not return a valid Stats refresh timestamp")
	}
	input["force"] = true
	started := float64(h.Now().UnixMilli())
	value, err = apiKeyWrite(ctx, h, "widget.stats.refresh", input)
	if err != nil {
		return statsSample{}, err
	}
	after, ok := value.(map[string]any)
	if !ok || after["error"] != false || after["stale"] != false {
		return statsSample{}, errors.New("Homarr Stats refresh failed; retry self-host setup homarr")
	}
	updated, ok := after["updatedAt"].(float64)
	if !ok || !validStatsTimestamp(updated) || updated <= timestamp {
		return statsSample{}, errors.New("Homarr Stats refresh did not advance; retry self-host setup homarr")
	}
	values, ok := after["values"].(map[string]any)
	if !ok {
		return statsSample{}, errors.New("Homarr did not return refreshed Stats values")
	}
	return statsSample{values: values, startedAt: started, updatedAt: updated}, nil
}

func validStatsTimestamp(timestamp float64) bool {
	return timestamp > 0 && !math.IsNaN(timestamp) && !math.IsInf(timestamp, 0)
}
