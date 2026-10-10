package service

import (
	"context"
	"fmt"
	"slices"
	"strings"

	"github.com/ajnart/self-host/internal/host"
)

// addresses lists this machine's LAN candidates, the default route first.
func (s *Service) addresses() []string {
	var ips []string
	if ip, err := s.Deps.LANIP(); err == nil && ip != "" && ip != "127.0.0.1" {
		ips = append(ips, ip)
	}
	if s.Deps.HostIPs != nil {
		if all, err := s.Deps.HostIPs(); err == nil {
			for _, ip := range all {
				if ip != "127.0.0.1" && !slices.Contains(ips, ip) {
					ips = append(ips, ip)
				}
			}
		}
	}
	return ips
}

// lanStale reports whether the stored LAN_IP is no longer an address of
// this machine (e.g. the laptop moved from the office to home). It is never
// stale when the addresses cannot be read or Exposure is this machine only.
func (s *Service) lanStale(settings map[string]string) (bool, []string) {
	if settings["EXPOSURE"] == ExposureLocal {
		return false, nil
	}
	current := s.addresses()
	if len(current) == 0 {
		return false, nil
	}
	return !slices.Contains(current, settings["LAN_IP"]), current
}

const lanHint = "Run: self-host config set LAN_IP=auto (detects this network's address and recreates the Apps that use it), or self-host config review"

func (s *Service) lanCheck(settings map[string]string) host.Check {
	stale, current := s.lanStale(settings)
	if !stale {
		return host.Check{ID: "lan-ip", Title: "LAN IP", Level: host.OK,
			Detail: "local network: other devices connect to " + settings["LAN_IP"]}
	}
	hint := lanHint
	if settings[settingNames] == namesOn {
		hint += "; Easy names contain the LAN address, so update bookmarks afterward. A DHCP reservation avoids another change."
	}
	return host.Check{ID: "lan-ip", Title: "LAN IP", Level: host.Warn,
		Detail: fmt.Sprintf("Apps use %s, which is not an address of this machine any more (now %s); their URLs do not work",
			settings["LAN_IP"], strings.Join(current, ", ")),
		Hint: hint}
}

// SettingReview is one Host setting next to what the host looks like now.
type SettingReview struct {
	Key      string `json:"key"`
	Current  string `json:"current"`
	Detected string `json:"detected,omitempty"`
	// Choices are the values a person can pick from, current first.
	Choices []string `json:"choices,omitempty"`
	// Drift is true when the stored value no longer matches the host.
	Drift bool   `json:"drift"`
	Note  string `json:"note,omitempty"`
}

// ReviewSettings compares the Project's Host settings with a fresh detection,
// so onboarding choices can be re-confirmed on an existing Project.
func (s *Service) ReviewSettings(ctx context.Context) ([]SettingReview, error) {
	ss, err := s.open(ctx)
	if err != nil {
		return nil, err
	}
	owner, err := s.Owner()
	if err != nil {
		return nil, err
	}
	settings := ss.settings
	detected := s.detectSettings(ctx, owner, settings["EXPOSURE"])
	rootless, _ := host.Rootless(ctx, s.Deps)
	choices := func(values ...string) []string {
		var out []string
		for _, v := range values {
			if v != "" && !slices.Contains(out, v) {
				out = append(out, v)
			}
		}
		return out
	}

	stale, addresses := s.lanStale(settings)
	lan := SettingReview{Key: "LAN_IP", Current: settings["LAN_IP"], Choices: choices(append([]string{settings["LAN_IP"]}, addresses...)...), Drift: stale}
	if len(addresses) > 0 {
		lan.Detected = addresses[0]
	}
	if stale {
		lan.Note = "not an address of this machine any more"
	}
	review := []SettingReview{
		{Key: "EXPOSURE", Current: settings["EXPOSURE"], Choices: choices(settings["EXPOSURE"], ExposureLAN, ExposureLocal)},
		{Key: settingNames, Current: settings[settingNames], Choices: []string{"off", "on"}},
		lan,
	}
	for _, key := range []string{"TZ", "PUID", "PGID"} {
		r := SettingReview{Key: key, Current: settings[key], Detected: detected[key], Drift: settings[key] != detected[key]}
		if key == "TZ" {
			r.Choices = choices(settings[key], detected[key])
		} else if r.Drift {
			r.Note = "changing it changes who owns the Apps' files; use self-host config set " + key + "=" + detected[key] + " on purpose"
		}
		if rootless && (key == "PUID" || key == "PGID") {
			r.Note = "rootless Docker maps container 0:0 to the daemon's host user; review bind-mount ownership before changing saved IDs. " + r.Note
		}
		review = append(review, r)
	}
	for _, key := range []string{"UMASK", "MEDIA_ROOT", "DOWNLOADS_ROOT"} {
		review = append(review, SettingReview{Key: key, Current: settings[key]})
	}
	return review, nil
}

// DriftFixes returns the KEY=value pairs that bring drifted, safely
// re-detectable settings (LAN_IP, TZ) back in line with the host.
func DriftFixes(review []SettingReview) []string {
	var pairs []string
	for _, r := range review {
		if r.Drift && r.Detected != "" && (r.Key == "LAN_IP" || r.Key == "TZ") {
			pairs = append(pairs, r.Key+"="+r.Detected)
		}
	}
	return pairs
}

// resolveAuto turns LAN_IP=auto into the detected address.
func (s *Service) resolveAuto(key, value string) (string, error) {
	if key != "LAN_IP" || value != "auto" {
		return value, nil
	}
	addresses := s.addresses()
	if len(addresses) == 0 {
		return "", fmt.Errorf("could not detect this machine's LAN address; pass LAN_IP=<ip> (see: ip addr or ifconfig)")
	}
	return addresses[0], nil
}
