package homarr

import (
	"context"
	"errors"
	"math"

	"github.com/ajnart/self-host/internal/apps/sabnzbd"
	"github.com/ajnart/self-host/internal/helpers"
)

func sabnzbdTarget() target {
	return target{
		id: "sabnzbd", name: "SABnzbd", kind: "sabNzbd", internal: fixed("http://sabnzbd:8080"),
		secrets: apiKeySecret,
		widgets: []widget{plain("downloads"), statWidget("download", "paused")},
		preflight: func(ctx context.Context, from, to *helpers.H) error {
			if err := requireCredentialSafeHomarr(ctx, from, "SABnzbd credential-safety hold #363: use Homarr 2.5.1 or newer 2.x with the shipped privacy fix. Back up Homarr before changing its version, then retry self-host setup homarr. Older, unreadable or unreviewed versions remain Manual; do not bypass the hold or create a manual integration."); err != nil {
				return err
			}
			return sabnzbd.VerifyHomarr(ctx, to)
		},
		verify: verifySABnzbd,
		stats:  verifySABnzbdStats,
	}
}

func verifySABnzbd(ctx context.Context, from, to *helpers.H, integrationID string) error {
	if err := sabnzbd.VerifyHomarr(ctx, to); err != nil {
		return err
	}
	queue, err := readDownloadsQueue(ctx, from, integrationID, "sabNzbd")
	if err != nil {
		return err
	}
	status, items := queue.status, queue.items
	rates, _ := status["rates"].(map[string]any)
	rate, numeric := rates["down"].(float64)
	_, paused := status["paused"].(bool)
	if !numeric || math.IsNaN(rate) || math.IsInf(rate, 0) || rate < 0 || !paused {
		return errors.New("Homarr returned incomplete SABnzbd downloads; an empty queue must explicitly contain items and a nonnegative download rate")
	}
	for _, item := range items {
		if !validSABnzbdItem(item) {
			return errors.New("Homarr returned incomplete SABnzbd download items; check the queue/history data and retry self-host setup homarr")
		}
	}
	return nil
}

func validSABnzbdItem(raw any) bool {
	item, ok := raw.(map[string]any)
	if !ok || item["type"] != "usenet" {
		return false
	}
	for _, key := range []string{"id", "name"} {
		value, ok := item[key].(string)
		if !ok || value == "" {
			return false
		}
	}
	switch item["state"] {
	case "downloading", "queued", "paused", "completed", "failed", "processing":
	default:
		return false
	}
	for _, key := range []string{"index", "size", "time", "progress"} {
		value, ok := item[key].(float64)
		if !ok || math.IsNaN(value) || math.IsInf(value, 0) {
			return false
		}
		if key == "size" && value < 0 || key == "progress" && (value < 0 || value > 1) {
			return false
		}
	}
	for _, key := range []string{"sent", "received", "downSpeed", "upSpeed", "added"} {
		raw, present := item[key]
		if !present {
			continue
		}
		value, ok := raw.(float64)
		if !ok || math.IsNaN(value) || math.IsInf(value, 0) || key != "added" && value < 0 {
			return false
		}
	}
	if category, present := item["category"]; present {
		switch value := category.(type) {
		case string:
		case []any:
			for _, raw := range value {
				if _, ok := raw.(string); !ok {
					return false
				}
			}
		default:
			return false
		}
	}
	return true
}

func verifySABnzbdStats(sample statsSample) error {
	rate, ok := sample.values["download"].(float64)
	if sample.units["download"] != "bytesPerSecond" || !ok || rate < 0 || math.IsNaN(rate) || math.IsInf(rate, 0) {
		return errors.New("Homarr returned unsupported refreshed SABnzbd byte-per-second Stats; retry self-host setup homarr")
	}
	if _, ok := sample.values["paused"].(bool); !ok || sample.units["paused"] != "text" {
		return errors.New("Homarr did not return supported refreshed SABnzbd paused Stats; retry self-host setup homarr")
	}
	return nil
}
