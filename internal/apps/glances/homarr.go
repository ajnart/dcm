package glances

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"regexp"

	"github.com/ajnart/self-host/internal/helpers"
)

const SupportedVersion = "4.5.6"

var uptimePattern = regexp.MustCompile(`^(?:\d+ days?, )?\d+:\d+:\d+$`)

type resourceData struct {
	CPU struct {
		Total *float64 `json:"total"`
	} `json:"cpu"`
	Memory struct {
		Total *float64 `json:"total"`
		Used  *float64 `json:"used"`
		Free  *float64 `json:"free"`
	} `json:"mem"`
	Network []struct {
		Sent     *float64 `json:"bytes_sent_rate_per_sec"`
		Received *float64 `json:"bytes_recv_rate_per_sec"`
	} `json:"network"`
	FileSystem []struct {
		Device  *string  `json:"device_name"`
		Used    *float64 `json:"used"`
		Free    *float64 `json:"free"`
		Percent *float64 `json:"percent"`
	} `json:"fs"`
	Uptime string `json:"uptime"`
}

func apiResponse(ctx context.Context, h *helpers.H, path string) (helpers.Response, error) {
	response, err := h.HTTP(ctx, helpers.Request{Path: path, NoRedirect: true})
	if err != nil {
		return response, errors.New("Glances API did not answer; inspect self-host logs glances and retry self-host setup glances")
	}
	if response.Status == http.StatusUnauthorized || response.Status == http.StatusForbidden {
		return response, fmt.Errorf("%w: Glances requires authentication; keep it enabled. Homarr 2.4.1's native Glances adapter supports no credentials, so this Link must wait for a supported authenticated adapter", helpers.ErrManual)
	}
	if response.Status != http.StatusOK {
		return response, fmt.Errorf("Glances API v4 returned HTTP %d; use Glances 4.5.6 or newer 4.x and retry self-host setup glances", response.Status)
	}
	return response, nil
}

func VerifyHomarr(ctx context.Context, h *helpers.H) error {
	response, err := apiResponse(ctx, h, "/api/4/version")
	if err != nil {
		return err
	}
	var version string
	if response.Decode(&version) != nil || !helpers.VersionCompatible(version, SupportedVersion) {
		return errors.New("unsupported Glances version; use Glances 4.5.6 or newer 4.x with API v4, then retry self-host setup glances")
	}
	response, err = apiResponse(ctx, h, "/api/4/all")
	if err != nil {
		return err
	}
	var data resourceData
	if response.Decode(&data) != nil || !data.valid() {
		return errors.New("Glances returned incomplete API v4 resource data; enable its CPU, memory, network, filesystem and uptime plugins, then retry self-host setup glances without adding host or device privileges")
	}
	return nil
}

func nonnegative(value *float64) bool {
	return value != nil && *value >= 0
}

func (data resourceData) valid() bool {
	if !nonnegative(data.CPU.Total) || *data.CPU.Total > 100 {
		return false
	}
	if !nonnegative(data.Memory.Total) || !nonnegative(data.Memory.Used) || !nonnegative(data.Memory.Free) || *data.Memory.Used > *data.Memory.Total {
		return false
	}
	if data.Network == nil || data.FileSystem == nil || !uptimePattern.MatchString(data.Uptime) {
		return false
	}
	for _, network := range data.Network {
		if !nonnegative(network.Sent) || !nonnegative(network.Received) {
			return false
		}
	}
	for _, filesystem := range data.FileSystem {
		if filesystem.Device == nil || !nonnegative(filesystem.Used) || !nonnegative(filesystem.Free) || !nonnegative(filesystem.Percent) || *filesystem.Percent > 100 {
			return false
		}
	}
	return true
}
