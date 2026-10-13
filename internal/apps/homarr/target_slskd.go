package homarr

import (
	"context"
	"errors"
	"math"
	"time"

	"github.com/ajnart/self-host/internal/apps/slskd"
	"github.com/ajnart/self-host/internal/helpers"
)

func slskdTarget() target {
	return target{
		id: "slskd", name: "Slskd", kind: "slskd", internal: fixed("http://slskd:5030"), secrets: apiKeySecret,
		widgets: []widget{{kind: "downloads", options: map[string]any{
			"columns": []string{"name", "progress", "size", "time", "state"}, "limitPerIntegration": 50,
		}}, statWidget("download")},
		preflight: func(ctx context.Context, from, to *helpers.H) error {
			if err := slskd.VerifyHomarr(ctx, to); err != nil {
				return err
			}
			if err := slskd.VerifySoulseek(ctx, to); err != nil {
				if errors.Is(err, helpers.ErrManual) {
					from.Info("Slskd needs your Soulseek account and an approved connection before this Link can be verified. Configure it privately in Slskd, then run self-host setup slskd and self-host setup homarr; an empty queue is not proof of provider readiness.")
				}
				return err
			}
			return nil
		},
		verify: verifySlskd,
		stats:  verifySlskdStats,
	}
}

func verifySlskd(ctx context.Context, from, to *helpers.H, integrationID string) error {
	if err := slskd.VerifyHomarr(ctx, to); err != nil {
		return err
	}
	if err := slskd.VerifySoulseek(ctx, to); err != nil {
		return err
	}
	const failure = "Homarr returned incomplete Slskd downloads; check Slskd's connection and retry self-host setup homarr"
	queue, err := readDownloadsQueue(ctx, from, integrationID, "slskd")
	if err != nil {
		return err
	}
	updatedAt, err := time.Parse(time.RFC3339Nano, stringField(queue.integration, "updatedAt"))
	if err != nil || !slskdFresh(from.Now(), updatedAt) {
		return errors.New("Homarr's Slskd download data is missing or stale; retry self-host setup homarr")
	}
	status := queue.status
	rates, ok := status["rates"].(map[string]any)
	if !ok || !slskdNumber(rates["down"]) || rates["up"] != float64(0) || status["paused"] != false {
		return errors.New(failure)
	}
	types, ok := status["types"].([]any)
	if !ok || len(types) != 1 || types[0] != "miscellaneous" {
		return errors.New(failure)
	}
	items := queue.items
	if len(items) > 50 {
		return errors.New(failure)
	}
	for _, raw := range items {
		item, ok := raw.(map[string]any)
		if !ok || stringField(item, "id") == "" || stringField(item, "name") == "" || stringField(item, "state") == "" || stringField(item, "type") != "miscellaneous" {
			return errors.New(failure)
		}
		for _, key := range []string{"size", "time", "progress", "added", "index"} {
			if !slskdNumber(item[key]) {
				return errors.New(failure)
			}
		}
		if item["progress"].(float64) > 1 {
			return errors.New(failure)
		}
	}
	return nil
}

func verifySlskdStats(sample statsSample) error {
	const failure = "Homarr did not return fresh Slskd download statistics; retry self-host setup homarr"
	if sample.units["download"] != "bytesPerSecond" {
		return errors.New("Homarr lacks Slskd's supported download statistic in bytes/s; use Homarr 2.4.1 and retry Setup")
	}
	age := sample.completedAt - math.Trunc(sample.updatedAt)
	if age < -60000 || age > 60000 || sample.retryAt != float64(0) || !slskdNumber(sample.values["download"]) {
		return errors.New(failure)
	}
	return nil
}

func slskdNumber(value any) bool {
	number, ok := value.(float64)
	return ok && number >= 0 && !math.IsNaN(number) && !math.IsInf(number, 0)
}

func slskdFresh(now, updatedAt time.Time) bool {
	age := now.Sub(updatedAt)
	return age >= -time.Minute && age <= time.Minute
}
