package homarr

import (
	"context"
	"errors"
	"math"

	"github.com/ajnart/self-host/internal/apps/peanut"
	"github.com/ajnart/self-host/internal/helpers"
)

func peanutTarget() target {
	return target{
		id: "peanut", name: "PeaNUT", kind: "peaNut", internal: fixed("http://peanut:8080"),
		secrets: func(_, to *helpers.H) []secret {
			return []secret{{Kind: "username", Value: to.AdminUser()}, {Kind: "password", Value: to.AdminPassword()}}
		},
		widgets: []widget{{kind: "ups", options: map[string]any{
			"showBattery": true, "showLoad": true, "showVoltage": true,
		}}, statWidget("devices", "onBattery", "lowBattery")},
		preflight: func(ctx context.Context, from, to *helpers.H) error {
			err := peanut.VerifyAPI(ctx, to)
			if err == nil {
				_, err = peanut.Devices(ctx, to)
			}
			if err != nil {
				from.Info("PeaNUT needs its verified Project Admin login and actual UPS readings from an owner-selected NUT server. Resolve its Manual steps, then run self-host setup peanut and self-host setup homarr. Do not disable authentication, add hardware access or grant shutdown control. No Homarr resources were changed.")
				return err
			}
			return nil
		},
		verify: verifyPeanut,
		stats:  verifyPeanutStats,
	}
}

func verifyPeanut(ctx context.Context, from, to *helpers.H, integrationID string) error {
	if err := peanut.VerifyAPI(ctx, to); err != nil {
		return err
	}
	devices, err := peanut.Devices(ctx, to)
	if err != nil {
		return err
	}
	value, err := apiKeyProcedure(ctx, from, "widget.ups.getSummaries", map[string]any{"integrationIds": []string{integrationID}})
	if err != nil {
		return err
	}
	instances, ok := value.([]any)
	if !ok || len(instances) != 1 {
		return errors.New("Homarr did not return PeaNUT UPS summaries; retry self-host setup homarr")
	}
	instance, _ := instances[0].(map[string]any)
	if stringField(instance, "integrationId") != integrationID || instance["error"] != nil {
		return errors.New("Homarr could not read the owned PeaNUT integration; verify its credentials and retry Setup")
	}
	summaries, ok := instance["summaries"].([]any)
	if !ok || len(summaries) != len(devices) {
		return errors.New("Homarr returned incomplete PeaNUT UPS data; check its NUT connection and retry Setup")
	}
	expected := map[string]peanut.Device{}
	for _, device := range devices {
		expected[device.ID] = device
	}
	for _, raw := range summaries {
		summary, _ := raw.(map[string]any)
		device, found := expected[stringField(summary, "id")]
		status := stringField(summary, "status")
		if !found || (status != "online" && status != "charging" && status != "onBattery" && status != "lowBattery") {
			return errors.New("Homarr did not return the discovered PeaNUT UPS identifiers and status; retry Setup without guessing device names")
		}
		delete(expected, device.ID)
		for _, field := range []struct{ nut, homarr string }{
			{"battery.charge", "batteryCharge"}, {"battery.runtime", "batteryRuntime"},
			{"battery.voltage", "batteryVoltage"}, {"ups.load", "load"},
			{"input.voltage", "inputVoltage"}, {"output.voltage", "outputVoltage"},
		} {
			_, present := device.Readings[field.nut]
			actual, exists := summary[field.homarr]
			if !exists || !present && actual != nil {
				return errors.New("Homarr UPS readings must preserve unavailable values, not replace them with zero; retry Setup")
			}
			if present {
				number, ok := actual.(float64)
				if !ok || math.IsNaN(number) || math.IsInf(number, 0) || number < 0 || (field.nut == "battery.charge" || field.nut == "ups.load") && number > 100 {
					return errors.New("Homarr returned invalid PeaNUT UPS readings; check the NUT driver and retry Setup")
				}
			}
		}
	}
	return nil
}

func verifyPeanutStats(sample statsSample) error {
	for _, key := range []string{"devices", "onBattery", "lowBattery"} {
		count, ok := sample.values[key].(float64)
		if sample.units[key] != "count" || !ok || count < 0 || math.IsNaN(count) || math.IsInf(count, 0) || math.Trunc(count) != count {
			return errors.New("Homarr returned incomplete PeaNUT native Stats; retry Setup")
		}
	}
	if sample.values["onBattery"].(float64)+sample.values["lowBattery"].(float64) > sample.values["devices"].(float64) {
		return errors.New("Homarr PeaNUT native Stats exceed the refreshed UPS count; retry Setup")
	}
	return nil
}
