package dashdot

import (
	"context"
	"errors"
	"fmt"
	"math"
	"slices"

	"github.com/ajnart/self-host/internal/helpers"
)

func VerifyMetrics(ctx context.Context, h *helpers.H) error {
	var configuration struct {
		Config struct {
			WidgetList                       []string `json:"widget_list"`
			RunningInDocker                  *bool    `json:"running_in_docker"`
			DisableBackgroundStatsCollection *bool    `json:"disable_background_stats_collection"`
			DisableIntegrations              *bool    `json:"disable_integrations"`
			EnableCPUTemps                   *bool    `json:"enable_cpu_temps"`
		} `json:"config"`
	}
	if err := metricResponse(ctx, h, "/config", &configuration); err != nil {
		return err
	}
	config := configuration.Config
	if len(config.WidgetList) != 2 || !slices.Contains(config.WidgetList, "cpu") || !slices.Contains(config.WidgetList, "ram") ||
		config.RunningInDocker == nil || *config.RunningInDocker ||
		config.DisableBackgroundStatsCollection == nil || !*config.DisableBackgroundStatsCollection ||
		config.DisableIntegrations == nil || *config.DisableIntegrations ||
		config.EnableCPUTemps == nil || *config.EnableCPUTemps {
		return errors.New("Dash. does not expose the supported kernel CPU/RAM configuration; restore its Catalog settings, restart it and retry self-host setup dashdot")
	}
	var info struct {
		CPU struct {
			Brand, Model string
			Threads      *float64
		} `json:"cpu"`
		RAM struct {
			Size *float64
		} `json:"ram"`
	}
	if err := metricResponse(ctx, h, "/info", &info); err != nil {
		return err
	}
	if info.CPU.Brand == "" && info.CPU.Model == "" || !nonnegative(info.CPU.Threads) || *info.CPU.Threads < 1 ||
		!nonnegative(info.RAM.Size) || *info.RAM.Size == 0 {
		return errors.New("Dash. CPU/RAM inventory is unavailable; read self-host logs dashdot and retry self-host setup dashdot")
	}
	var cpu []struct {
		Load *float64 `json:"load"`
		Temp *float64 `json:"temp"`
	}
	if err := metricResponse(ctx, h, "/load/cpu", &cpu); err != nil {
		return err
	}
	if len(cpu) == 0 {
		return errors.New("Dash. CPU measurements are unavailable; retry self-host setup dashdot")
	}
	for _, core := range cpu {
		if !nonnegative(core.Load) || *core.Load > 100 || !nonnegative(core.Temp) {
			return errors.New("Dash. returned incomplete CPU measurements; retry self-host setup dashdot")
		}
	}
	var ram struct {
		Load *float64 `json:"load"`
	}
	if err := metricResponse(ctx, h, "/load/ram", &ram); err != nil {
		return err
	}
	if !nonnegative(ram.Load) || *ram.Load > *info.RAM.Size {
		return errors.New("Dash. returned incomplete or inconsistent RAM measurements; retry self-host setup dashdot")
	}
	return nil
}

func metricResponse(ctx context.Context, h *helpers.H, path string, value any) error {
	response, err := h.HTTP(ctx, helpers.Request{Path: path, NoRedirect: true})
	if err != nil || response.Status != 200 {
		return fmt.Errorf("Dash. %s is unavailable; read self-host logs dashdot and retry self-host setup dashdot", path)
	}
	if response.Decode(value) != nil {
		return fmt.Errorf("Dash. %s did not return metric data; retry self-host setup dashdot", path)
	}
	return nil
}

func nonnegative(value *float64) bool {
	return value != nil && !math.IsNaN(*value) && !math.IsInf(*value, 0) && *value >= 0
}
