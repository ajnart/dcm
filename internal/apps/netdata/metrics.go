package netdata

import (
	"context"
	"errors"
	"fmt"
	"math"
	"net/http"
	"net/url"
	"time"

	"github.com/ajnart/self-host/internal/helpers"
)

func VerifyHomarr(ctx context.Context, h *helpers.H) error {
	var info struct {
		Alarms struct {
			Warning  *int64 `json:"warning"`
			Critical *int64 `json:"critical"`
		} `json:"alarms"`
	}
	if err := monitoringJSON(ctx, h, "/api/v1/info", &info); err != nil {
		return err
	}
	if info.Alarms.Warning == nil || info.Alarms.Critical == nil || *info.Alarms.Warning < 0 || *info.Alarms.Critical < 0 {
		return errors.New("Netdata returned incomplete alarm counts; retry self-host setup netdata")
	}
	var discovery struct {
		Charts map[string]struct {
			ID      string `json:"id"`
			Context string `json:"context"`
			Plugin  string `json:"plugin"`
			Module  string `json:"module"`
			Units   string `json:"units"`
		} `json:"charts"`
	}
	if err := monitoringJSON(ctx, h, "/api/v1/charts", &discovery); err != nil {
		return err
	}
	if discovery.Charts == nil {
		return errors.New("Netdata did not return its chart catalog; check its local API and retry self-host setup netdata")
	}
	chartID := ""
	for _, chart := range discovery.Charts {
		if chart.Context != "netdata.server_cpu" || chart.Plugin != "netdata" || chart.Module != "pulse" || chart.Units != "milliseconds/s" {
			continue
		}
		if chart.ID == "" || chartID != "" {
			return errors.New("Netdata returned missing or ambiguous agent CPU chart identifiers")
		}
		chartID = chart.ID
	}
	if chartID == "" {
		return errors.New("Netdata has no agent CPU chart; check its pulse collector and retry self-host setup netdata without adding host access")
	}
	query := url.Values{"chart": {chartID}, "after": {"-60"}, "points": {"1"}, "format": {"json"}}
	var sample struct {
		Labels []string     `json:"labels"`
		Data   [][]*float64 `json:"data"`
	}
	if err := monitoringJSON(ctx, h, "/api/v1/data?"+query.Encode(), &sample); err != nil {
		return err
	}
	if len(sample.Labels) != 3 || sample.Labels[0] != "time" ||
		!(sample.Labels[1] == "user" && sample.Labels[2] == "system" ||
			sample.Labels[1] == "system" && sample.Labels[2] == "user") {
		return errors.New("Netdata agent CPU data must have unique time, user and system columns; check its pulse collector and retry self-host setup netdata")
	}
	if len(sample.Data) == 0 {
		return errors.New("Netdata agent CPU data is empty or unavailable; wait for collection and retry self-host setup netdata")
	}
	for _, row := range sample.Data {
		if len(row) != len(sample.Labels) {
			continue
		}
		complete := true
		for _, value := range row {
			if value == nil || math.IsNaN(*value) || math.IsInf(*value, 0) || *value < 0 {
				complete = false
				break
			}
		}
		if !complete {
			continue
		}
		age := float64(h.Now().Unix()) - *row[0]
		if age >= -30 && age <= (2*time.Minute).Seconds() {
			return nil
		}
	}
	return errors.New("Netdata agent CPU samples are missing or stale; check collection and the clock, then retry self-host setup netdata")
}

func monitoringJSON(ctx context.Context, h *helpers.H, path string, value any) error {
	resp, err := h.HTTP(ctx, helpers.Request{Path: path, NoRedirect: true})
	if err != nil {
		return errors.New("Netdata local monitoring request failed; read self-host logs netdata and retry Setup")
	}
	if resp.Status == http.StatusUnauthorized || resp.Status == http.StatusForbidden {
		return fmt.Errorf("%w: Netdata local API access is denied; Homarr 2.4.1 cannot send Netdata credentials. Preserve authentication and review compatible access before retrying Setup", helpers.ErrManual)
	}
	if resp.Status != http.StatusOK {
		return fmt.Errorf("Netdata local monitoring API returned HTTP %d; read self-host logs netdata and retry Setup", resp.Status)
	}
	if resp.Decode(value) != nil {
		return errors.New("Netdata did not return valid local monitoring JSON; check its API before retrying Setup")
	}
	return nil
}
