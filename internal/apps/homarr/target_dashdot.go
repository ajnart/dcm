package homarr

import (
	"context"
	"errors"
	"math"

	"github.com/ajnart/self-host/internal/apps/dashdot"
	"github.com/ajnart/self-host/internal/helpers"
)

func dashdotTarget() target {
	return target{
		id: "dashdot", name: "Dash. (kernel CPU/RAM)", kind: "dashDot", internal: fixed("http://dashdot:3001"),
		secrets: func(_, _ *helpers.H) []secret { return []secret{} },
		widgets: []widget{{kind: "systemResources", options: map[string]any{
			"visibleCharts": []string{"cpu", "memory"}, "hasShadow": true, "labelDisplayMode": "textWithIcon",
		}}, statWidget("cpu", "memoryUsed", "memoryAvailable", "uptime")},
		verify: verifyDashdot,
	}
}

func verifyDashdot(ctx context.Context, from, to *helpers.H, integrationID string) error {
	if err := dashdot.VerifyMetrics(ctx, to); err != nil {
		return err
	}
	value, err := apiKeyProcedure(ctx, from, "widget.healthMonitoring.getSystemHealthStatus", map[string]any{"integrationIds": []string{integrationID}})
	if err != nil {
		return err
	}
	results, ok := value.([]any)
	if !ok || len(results) != 1 {
		return errors.New("Homarr did not return Dash. system measurements; retry self-host setup homarr")
	}
	result, _ := results[0].(map[string]any)
	if stringField(result, "integrationId") != integrationID || result["error"] != nil {
		return errors.New("Homarr could not read the owned Dash. integration; retry self-host setup homarr")
	}
	health, _ := result["healthInfo"].(map[string]any)
	for _, key := range []string{"cpuUtilization", "memUsedInBytes", "memAvailableInBytes", "uptime"} {
		value, ok := health[key].(float64)
		if !ok || math.IsNaN(value) || math.IsInf(value, 0) || value < 0 || key == "cpuUtilization" && value > 100 {
			return errors.New("Homarr returned incomplete Dash. CPU/RAM measurements; retry self-host setup homarr")
		}
	}
	if health["memUsedInBytes"].(float64)+health["memAvailableInBytes"].(float64) == 0 {
		return errors.New("Homarr returned unavailable Dash. memory; retry self-host setup homarr")
	}
	return nil
}
