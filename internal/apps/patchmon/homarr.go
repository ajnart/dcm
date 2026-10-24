package patchmon

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/ajnart/self-host/internal/helpers"
)

const HomarrHint = "PatchMon 2.1.3 statistics credentials also allow enrolling computers. Keep this Link paused: a reviewed upstream read-only credential fix is required before retrying self-host setup patchmon and self-host setup homarr. Do not create an enrollment token or install agents for this Link. Host enrollment requires separate approval."

func HomarrReadiness(ctx context.Context, h *helpers.H) error {
	resp, err := h.HTTP(ctx, helpers.Request{Path: "/api/v1/settings/login-settings", NoRedirect: true})
	if err != nil {
		return err
	}
	if resp.Status != 200 {
		return fmt.Errorf("PatchMon readiness returned HTTP %d; run self-host setup patchmon", resp.Status)
	}
	var settings struct {
		Version       string `json:"current_version"`
		HasAdminUsers *bool  `json:"hasAdminUsers"`
	}
	if resp.Decode(&settings) != nil || settings.Version == "" || settings.HasAdminUsers == nil {
		return errors.New("PatchMon did not return its version and account readiness; run self-host setup patchmon")
	}
	if !helpers.VersionCompatible(settings.Version, "2.1.3") {
		return errors.New("PatchMon version is unsupported for this Link; review its read-only credential contract before retrying Setup")
	}
	if !*settings.HasAdminUsers {
		return errors.New("PatchMon has no administrator; run self-host setup patchmon")
	}
	return fmt.Errorf("%w: %s", helpers.ErrManual, HomarrHint)
}

func HomarrStats(ctx context.Context, h *helpers.H) (map[string]int64, error) {
	key := h.Secret(h.Key("homarr_api_key"))
	secret := h.Secret(h.Key("homarr_api_secret"))
	if key == "" || secret == "" {
		return nil, errors.New("PatchMon needs both its owned Homarr API key and API secret; run self-host setup patchmon")
	}
	resp, err := h.HTTP(ctx, helpers.Request{
		Path: "/api/v1/gethomepage/stats", NoRedirect: true, User: key, Password: secret,
	})
	if err != nil {
		return nil, err
	}
	if resp.Status != 200 {
		return nil, fmt.Errorf("PatchMon statistics returned HTTP %d; run self-host setup patchmon", resp.Status)
	}
	var data map[string]json.RawMessage
	if resp.Decode(&data) != nil {
		return nil, errors.New("PatchMon returned invalid statistics")
	}
	counts := make(map[string]int64)
	for _, name := range []string{
		"total_hosts", "hosts_needing_updates", "security_updates",
		"up_to_date_hosts", "hosts_with_security_updates", "recent_updates_24h",
		"total_outdated_packages", "total_repos", "awaiting_data_hosts",
	} {
		var count *int64
		if json.Unmarshal(data[name], &count) != nil || count == nil || *count < 0 {
			return nil, errors.New("PatchMon returned missing or invalid statistics")
		}
		counts[name] = *count
	}
	var updated string
	if json.Unmarshal(data["last_updated"], &updated) != nil {
		return nil, errors.New("PatchMon did not return its statistics timestamp")
	}
	if _, err := time.Parse(time.RFC3339, updated); err != nil {
		return nil, errors.New("PatchMon returned an invalid statistics timestamp")
	}
	if counts["hosts_needing_updates"]+counts["up_to_date_hosts"]+counts["awaiting_data_hosts"] != counts["total_hosts"] ||
		counts["hosts_with_security_updates"] > counts["hosts_needing_updates"] ||
		counts["security_updates"] > counts["total_outdated_packages"] {
		return nil, errors.New("PatchMon returned inconsistent host or package statistics")
	}
	if counts["awaiting_data_hosts"] > 0 {
		h.Info("PatchMon has computers without package inventory. Their update status is unknown; host enrollment and inventory collection require separate approval.")
		return nil, fmt.Errorf("%w: PatchMon is awaiting package inventory", helpers.ErrManual)
	}
	if counts["total_hosts"] == 0 {
		h.Info("PatchMon has no computers enrolled. Zero updates is an empty inventory, not proof that any computer is secure.")
	}
	return counts, nil
}
