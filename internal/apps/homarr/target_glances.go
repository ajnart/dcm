package homarr

import (
	"context"
	"encoding/json"
	"errors"
	"math"

	"github.com/ajnart/self-host/internal/apps/glances"
	"github.com/ajnart/self-host/internal/helpers"
)

func glancesTarget() target {
	return target{
		id: "glances", name: "Glances", kind: "glances", internal: fixed("http://glances:61208"),
		widgets: []widget{
			{kind: "systemResources", options: map[string]any{"visibleCharts": []string{"cpu", "memory", "network"}}},
			{kind: "healthMonitoring", options: map[string]any{"cpu": true, "memory": true, "gpu": false, "fileSystem": false}},
			statWidget("cpu", "memoryUsed", "memoryAvailable", "uptime"),
		},
		preflight: preflightGlances,
		verify:    verifyGlances,
		stats:     verifyGlancesStats,
	}
}

func preflightGlances(ctx context.Context, from, to *helpers.H) error {
	err := glances.VerifyHomarr(ctx, to)
	if errors.Is(err, helpers.ErrManual) {
		from.Info("Keep Glances authentication enabled. Homarr 2.4.1 cannot authenticate its native Glances integration; this Link must wait for a supported authenticated adapter, then retry self-host setup glances and self-host setup homarr.")
	}
	return err
}

func verifyGlances(ctx context.Context, from, to *helpers.H, integrationID string) error {
	if err := glances.VerifyHomarr(ctx, to); err != nil {
		return err
	}
	value, err := apiKeyProcedure(ctx, from, "widget.healthMonitoring.getSystemHealthStatus", map[string]any{"integrationIds": []string{integrationID}})
	if err != nil {
		return err
	}
	const failure = "Homarr returned incomplete Glances resource data; retry self-host setup glances, then self-host setup homarr"
	results, ok := value.([]any)
	if !ok || len(results) != 1 {
		return errors.New(failure)
	}
	result, ok := results[0].(map[string]any)
	if !ok || stringField(result, "integrationId") != integrationID || result["error"] != nil {
		return errors.New(failure)
	}
	health, ok := result["healthInfo"].(map[string]any)
	if !ok {
		return errors.New(failure)
	}
	var version string
	if json.Unmarshal([]byte(stringField(health, "version")), &version) != nil || version != glances.SupportedVersion {
		return errors.New(failure)
	}
	for _, key := range []string{"cpuUtilization", "memUsedInBytes", "memAvailableInBytes", "uptime"} {
		number, ok := health[key].(float64)
		if !ok || math.IsNaN(number) || math.IsInf(number, 0) || number < 0 || key == "cpuUtilization" && number > 100 ||
			(key == "memUsedInBytes" || key == "memAvailableInBytes") && math.Trunc(number) != number {
			return errors.New(failure)
		}
	}
	network, ok := health["network"].(map[string]any)
	if !ok {
		return errors.New(failure)
	}
	for _, key := range []string{"up", "down"} {
		number, ok := network[key].(float64)
		if !ok || math.IsNaN(number) || math.IsInf(number, 0) || number < 0 {
			return errors.New(failure)
		}
	}
	return nil
}

// Homarr reports total minus used memory, not Glances' free-memory observation.
// Native and Stats samples can change independently; neither proves a physical host.
func verifyGlancesStats(sample statsSample) error {
	const failure = "Homarr returned incomplete Glances resource Stats; retry self-host setup glances, then self-host setup homarr"
	for key, unit := range map[string]string{"cpu": "percent", "memoryUsed": "bytes", "memoryAvailable": "bytes", "uptime": "seconds"} {
		number, ok := sample.values[key].(float64)
		if sample.units[key] != unit || !ok || math.IsNaN(number) || math.IsInf(number, 0) || number < 0 ||
			key == "cpu" && number > 100 ||
			(key == "memoryUsed" || key == "memoryAvailable") && math.Trunc(number) != number {
			return errors.New(failure)
		}
	}
	return nil
}
