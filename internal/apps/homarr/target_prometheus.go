package homarr

import (
	"context"
	"errors"
	"math"

	"github.com/ajnart/self-host/internal/apps/prometheus"
	"github.com/ajnart/self-host/internal/helpers"
)

func prometheusTarget() target {
	return target{
		id: "prometheus", name: "Prometheus", kind: "prometheus", internal: fixed("http://prometheus:9090"),
		secrets: func(_, to *helpers.H) []secret {
			user, password := to.Secret(to.Key("username")), to.Secret(to.Key("password"))
			if user == "" && password == "" {
				return []secret{}
			}
			return []secret{{Kind: "username", Value: user}, {Kind: "password", Value: password}}
		},
		widgets: []widget{statWidget("total", "up", "down")},
		preflight: func(ctx context.Context, from, to *helpers.H) error {
			err := prometheus.VerifyHomarr(ctx, to)
			if errors.Is(err, helpers.ErrManual) {
				from.Info("Preserve Prometheus authentication and its scrape configuration. Run self-host setup prometheus for the private credential or self-scrape recovery instructions, then retry self-host setup homarr.")
			}
			return err
		},
		verify: verifyPrometheus,
		stats:  verifyPrometheusStats,
	}
}

func verifyPrometheus(ctx context.Context, _, to *helpers.H, _ string) error {
	return prometheus.VerifyHomarr(ctx, to)
}

func verifyPrometheusStats(sample statsSample) error {
	for _, key := range []string{"total", "up", "down"} {
		if sample.units[key] != "count" {
			return errors.New("Homarr does not expose the supported Prometheus target-count metrics; retry self-host setup homarr with Homarr 2.4.1")
		}
		count, ok := sample.values[key].(float64)
		if !ok || math.IsNaN(count) || math.IsInf(count, 0) || count < 0 || math.Trunc(count) != count {
			return errors.New("Homarr returned invalid Prometheus target counts; retry self-host setup homarr")
		}
	}
	// Unknown active-target health contributes only to total. Native discovery
	// and Homarr's refresh are independent observations, so counts may change.
	if sample.values["up"].(float64)+sample.values["down"].(float64) > sample.values["total"].(float64) {
		return errors.New("Homarr returned inconsistent Prometheus target counts; retry self-host setup homarr")
	}
	return nil
}
