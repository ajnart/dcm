package homarr

import (
	"context"
	"errors"
	"math"
	"strings"

	"github.com/ajnart/self-host/internal/apps/frigate"
	"github.com/ajnart/self-host/internal/helpers"
)

func frigateTarget() target {
	return target{
		id: "frigate", name: "Frigate", kind: "frigate", internal: fixed("https://frigate:8971"),
		secrets: func(_, to *helpers.H) []secret {
			return []secret{{Kind: "username", Value: to.AdminUser()}, {Kind: "password", Value: to.AdminPassword()}}
		},
		widgets: []widget{statWidget("cameras", "uptime", "version")},
		preflight: func(ctx context.Context, from, to *helpers.H) error {
			err := verifyFrigate(ctx, from, to, "")
			if errors.Is(err, helpers.ErrManual) {
				from.Info(err.Error())
			}
			return err
		},
		verify: verifyFrigate,
		stats:  verifyFrigateStats,
	}
}

func verifyFrigate(ctx context.Context, _, to *helpers.H, _ string) error {
	_, err := frigate.VerifyHomarr(ctx, to)
	return err
}

func verifyFrigateStats(sample statsSample) error {
	cameras, camerasOK := sample.values["cameras"].(float64)
	uptime, uptimeOK := sample.values["uptime"].(float64)
	version, versionOK := sample.values["version"].(string)
	if sample.units["cameras"] != "count" || !camerasOK || cameras < 0 || math.IsNaN(cameras) || math.IsInf(cameras, 0) || math.Trunc(cameras) != cameras {
		return errors.New("Homarr returned invalid Frigate camera Stats; retry self-host setup homarr")
	}
	if sample.units["uptime"] != "seconds" || !uptimeOK || uptime < 0 || math.IsNaN(uptime) || math.IsInf(uptime, 0) {
		return errors.New("Homarr returned invalid Frigate uptime Stats; retry self-host setup homarr")
	}
	if sample.units["version"] != "text" || !versionOK || version != "0.18.0" && !strings.HasPrefix(version, "0.18.0-") {
		return errors.New("Homarr returned unsupported Frigate version Stats; retry self-host setup homarr")
	}
	return nil
}
