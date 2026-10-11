package prometheus

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/http"
	"net/url"
	"strconv"
	"time"

	"github.com/ajnart/self-host/internal/helpers"
)

const recoveryHint = "Keep existing authentication and scrape configuration. For HTTP Basic, provide both existing read-only credentials using self-host install prometheus --set-file prometheus.username=PATH --set-file prometheus.password=PATH --yes with owner-only files, then retry self-host setup prometheus and self-host setup homarr. Other authentication or HTTPS requires a Manual connection. The starter self-scrape must remain enabled; inspect self-host logs prometheus if data is absent or stale."

const selfQuery = `up{job="prometheus",instance="localhost:9090"}[1m]`

type Counts struct {
	Total int
	Up    int
	Down  int
}

type scrapeTarget struct {
	Health    *string           `json:"health"`
	Labels    map[string]string `json:"labels"`
	ScrapeURL string            `json:"scrapeUrl"`
}

func readAPI(ctx context.Context, h *helpers.H, path string, destination any) error {
	user, password := h.Secret(h.Key("username")), h.Secret(h.Key("password"))
	if (user == "") != (password == "") {
		h.Info(recoveryHint)
		return fmt.Errorf("%w: Prometheus requires both saved HTTP Basic credentials, never a partial or unauthenticated fallback", helpers.ErrManual)
	}
	base, err := url.Parse(h.BaseURL)
	if err != nil || base.Scheme != "http" {
		h.Info(recoveryHint)
		return fmt.Errorf("%w: the native Prometheus Link requires the Catalog's internal HTTP Address; preserve existing HTTPS", helpers.ErrManual)
	}
	response, err := h.HTTP(ctx, helpers.Request{Path: path, User: user, Password: password, NoRedirect: true})
	if err != nil {
		return errors.New("Prometheus API is unavailable; inspect self-host logs prometheus and retry self-host setup prometheus")
	}
	if response.Status == http.StatusUnauthorized || response.Status == http.StatusForbidden || response.Status >= 300 && response.Status < 400 {
		h.Info(recoveryHint)
		return fmt.Errorf("%w: Prometheus rejected the selected authentication or requires a different protected Address (HTTP %d)", helpers.ErrManual, response.Status)
	}
	if response.Status != http.StatusOK {
		return fmt.Errorf("Prometheus API returned HTTP %d; retry self-host setup prometheus", response.Status)
	}
	var envelope struct {
		Status string          `json:"status"`
		Data   json.RawMessage `json:"data"`
	}
	if response.Decode(&envelope) != nil || envelope.Status != "success" || len(envelope.Data) == 0 || string(envelope.Data) == "null" {
		return errors.New("Prometheus returned an unsuccessful or incomplete API response; retry self-host setup prometheus")
	}
	if json.Unmarshal(envelope.Data, destination) != nil {
		return errors.New("Prometheus returned malformed API data; retry self-host setup prometheus")
	}
	return nil
}

func VerifyHomarr(ctx context.Context, h *helpers.H) (Counts, error) {
	var data struct {
		Active  []scrapeTarget    `json:"activeTargets"`
		Dropped []json.RawMessage `json:"droppedTargets"`
	}
	if err := readAPI(ctx, h, "/api/v1/targets", &data); err != nil {
		return Counts{}, err
	}
	if data.Active == nil || data.Dropped == nil {
		return Counts{}, errors.New("Prometheus returned incomplete target discovery data")
	}
	counts := Counts{Total: len(data.Active)}
	selfHealth := ""
	selfCount := 0
	for _, target := range data.Active {
		if target.Health == nil {
			return Counts{}, errors.New("Prometheus returned a target without its health")
		}
		switch *target.Health {
		case "up":
			counts.Up++
		case "down":
			counts.Down++
		}
		if target.Labels["job"] == "prometheus" && target.Labels["instance"] == "localhost:9090" && target.ScrapeURL == "http://localhost:9090/metrics" {
			selfCount++
			selfHealth = *target.Health
		}
	}
	if selfCount != 1 {
		h.Info(recoveryHint)
		return counts, fmt.Errorf("%w: Prometheus has no unique starter self-scrape target; an empty target list is not a zero-valued time series", helpers.ErrManual)
	}
	if selfHealth != "up" && selfHealth != "down" {
		return counts, errors.New("Prometheus has not completed its starter self-scrape; retry self-host setup prometheus")
	}
	if err := verifySelfQuery(ctx, h, selfHealth); err != nil {
		return counts, err
	}
	return counts, nil
}

func verifySelfQuery(ctx context.Context, h *helpers.H, health string) error {
	var data struct {
		ResultType string `json:"resultType"`
		Result     []struct {
			Metric map[string]string   `json:"metric"`
			Values [][]json.RawMessage `json:"values"`
		} `json:"result"`
	}
	if err := readAPI(ctx, h, "/api/v1/query?query="+url.QueryEscape(selfQuery), &data); err != nil {
		return err
	}
	if data.ResultType != "matrix" || len(data.Result) != 1 {
		return errors.New("Prometheus self-scrape query returned no unique matrix series; absent data is not zero, retry self-host setup prometheus")
	}
	series := data.Result[0]
	if series.Metric["__name__"] != "up" || series.Metric["job"] != "prometheus" || series.Metric["instance"] != "localhost:9090" || len(series.Values) == 0 {
		return errors.New("Prometheus self-scrape query returned incomplete or unexpected data")
	}
	now := float64(h.Now().UnixMilli()) / 1000
	previous := float64(0)
	value := float64(0)
	for _, sample := range series.Values {
		var timestamp float64
		var text string
		if len(sample) != 2 || json.Unmarshal(sample[0], &timestamp) != nil || json.Unmarshal(sample[1], &text) != nil {
			return errors.New("Prometheus self-scrape query returned a malformed sample")
		}
		parsed, err := strconv.ParseFloat(text, 64)
		if err != nil || math.IsNaN(parsed) || math.IsInf(parsed, 0) || parsed != 0 && parsed != 1 || timestamp <= previous || timestamp > now+5 {
			return errors.New("Prometheus self-scrape query returned an invalid value or timestamp")
		}
		previous, value = timestamp, parsed
	}
	if now-previous > time.Minute.Seconds() {
		return errors.New("Prometheus self-scrape query is stale; retry self-host setup prometheus")
	}
	if health == "up" && value != 1 || health == "down" && value != 0 {
		return errors.New("Prometheus self-scrape health changed during verification; retry self-host setup prometheus")
	}
	return nil
}
