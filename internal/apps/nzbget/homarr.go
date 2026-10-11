package nzbget

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/ajnart/self-host/internal/helpers"
)

const homarrUsername = "self-host-homarr"

func callRPC(ctx context.Context, h *helpers.H, username, password, method string, result any) error {
	id := "selfhost-" + method
	response, err := h.HTTP(ctx, helpers.Request{
		Method: http.MethodPost, Path: "/jsonrpc", NoRedirect: true,
		User: username, Password: password,
		JSON: map[string]any{"version": "1.1", "method": method, "params": []any{}, "id": id},
	})
	if err != nil {
		return fmt.Errorf("NZBGet %s could not be reached; retry self-host setup nzbget", method)
	}
	if response.Status != http.StatusOK {
		return fmt.Errorf("NZBGet %s returned HTTP %d; retry self-host setup nzbget", method, response.Status)
	}
	var body struct {
		ID     string          `json:"id"`
		Error  json.RawMessage `json:"error"`
		Result json.RawMessage `json:"result"`
	}
	if response.Decode(&body) != nil || body.ID != id || len(body.Error) > 0 && string(body.Error) != "null" || len(body.Result) == 0 || string(body.Result) == "null" || json.Unmarshal(body.Result, result) != nil {
		return fmt.Errorf("NZBGet returned an invalid %s response; retry self-host setup nzbget", method)
	}
	return nil
}

type restrictedAccount struct {
	username string
	password string
}

func restrictedLogin(ctx context.Context, h *helpers.H, method string) (restrictedAccount, error) {
	var entries []struct {
		Name  string
		Value *string
	}
	if err := callRPC(ctx, h, h.AdminUser(), h.AdminPassword(), method, &entries); err != nil {
		return restrictedAccount{}, err
	}
	account := restrictedAccount{}
	found := map[string]bool{}
	for _, entry := range entries {
		if entry.Name != "RestrictedUsername" && entry.Name != "RestrictedPassword" {
			continue
		}
		if entry.Value == nil || found[entry.Name] {
			return account, errors.New("NZBGet returned incomplete restricted-user settings")
		}
		found[entry.Name] = true
		if entry.Name == "RestrictedUsername" {
			account.username = *entry.Value
		} else {
			account.password = *entry.Value
		}
	}
	if len(found) != 2 {
		return account, errors.New("NZBGet did not return its restricted-user settings")
	}
	return account, nil
}

func VerifyHomarr(ctx context.Context, h *helpers.H) error {
	username, password := h.Secret(h.Key("homarr_username")), h.Secret(h.Key("homarr_password"))
	if username != homarrUsername || password == "" {
		return errors.New("NZBGet Homarr login is missing; run self-host setup nzbget")
	}
	if username == h.AdminUser() || password == h.AdminPassword() || strings.ContainsAny(password, "\r\n") {
		return errors.New("NZBGet Homarr access must use a separate restricted login; review its saved credential through the Project secret boundary")
	}
	if ok, err := adminWorks(ctx, h); err != nil || !ok {
		return errors.New("NZBGet must reject anonymous RPC and accept the Admin login on version 26.3; run self-host setup nzbget")
	}
	for _, method := range []string{"config", "loadconfig"} {
		account, err := restrictedLogin(ctx, h, method)
		if err != nil {
			return err
		}
		if account.username != username || account.password != password {
			return errors.New("NZBGet Homarr login does not match its active and saved restricted user; run self-host setup nzbget")
		}
	}
	var currentVersion string
	if err := callRPC(ctx, h, username, password, "version", &currentVersion); err != nil {
		return err
	}
	if currentVersion != version {
		return errors.New("NZBGet Homarr access requires version 26.3; back up NZBGet before changing its version, then retry Setup")
	}
	var status struct {
		DownloadPaused *bool
		DownloadRate   *int64
	}
	if err := callRPC(ctx, h, username, password, "status", &status); err != nil {
		return err
	}
	if status.DownloadPaused == nil || status.DownloadRate == nil || *status.DownloadRate < 0 {
		return errors.New("NZBGet did not return its download rate and queue state")
	}
	for _, method := range []string{"listgroups", "history"} {
		var items []map[string]any
		if err := callRPC(ctx, h, username, password, method, &items); err != nil {
			return err
		}
		if items == nil {
			return errors.New("NZBGet did not return its queue and history lists")
		}
		for _, item := range items {
			nameKey := "NZBName"
			stateKey := "Status"
			numericKeys := []string{"FileSizeLo", "FileSizeHi", "MaxPriority", "ActiveDownloads", "RemainingSizeLo", "RemainingSizeHi", "DownloadTimeSec", "DownloadedSizeMB", "FileSizeMB"}
			if method == "history" {
				nameKey = "Name"
				stateKey = "ScriptStatus"
				numericKeys = []string{"FileSizeLo", "FileSizeHi", "HistoryTime", "DownloadTimeSec"}
			}
			id, ok := item["NZBID"].(float64)
			name, _ := item[nameKey].(string)
			if !ok || id <= 0 || name == "" {
				return errors.New("NZBGet returned incomplete queue or history items")
			}
			state, _ := item[stateKey].(string)
			if _, ok := item["Category"].(string); !ok || state == "" {
				return errors.New("NZBGet returned incomplete queue or history items")
			}
			for _, key := range numericKeys {
				value, ok := item[key].(float64)
				if !ok || key != "MaxPriority" && value < 0 {
					return errors.New("NZBGet returned incomplete queue or history items")
				}
			}
		}
	}
	return nil
}

func prepareHomarr(ctx context.Context, h *helpers.H) error {
	if err := VerifyHomarr(ctx, h); err == nil {
		return nil
	}
	if ok, err := adminWorks(ctx, h); err != nil || !ok {
		return errors.New("cannot verify the NZBGet Admin login before preparing restricted access")
	}
	active, err := restrictedLogin(ctx, h, "config")
	if err != nil {
		return err
	}
	saved, err := restrictedLogin(ctx, h, "loadconfig")
	if err != nil {
		return err
	}
	expected := restrictedAccount{h.Secret(h.Key("homarr_username")), h.Secret(h.Key("homarr_password"))}
	for _, account := range []restrictedAccount{active, saved} {
		if account == (restrictedAccount{}) {
			continue
		}
		if expected.username != homarrUsername || expected.password == "" || account != expected {
			h.Info("NZBGet restricted access already exists. Restore the managed login through the Project secret boundary, or explicitly clear only the restricted-user slot in NZBGet settings, then run self-host setup nzbget. No existing account was changed.")
			return helpers.ErrManual
		}
	}
	if expected.username != "" && expected.username != homarrUsername {
		return errors.New("NZBGet saved Homarr username needs review through the Project secret boundary")
	}
	if homarrUsername == h.AdminUser() || expected.password != "" && (expected.password == h.AdminPassword() || strings.ContainsAny(expected.password, "\r\n")) {
		return errors.New("NZBGet Homarr access must use a separate restricted login; review its saved credential through the Project secret boundary")
	}
	if expected.password == "" {
		expected.password = rand.Text()
		if err := h.SetSecret(h.Key("homarr_password"), expected.password); err != nil {
			return err
		}
	}
	if expected.username == "" {
		expected.username = homarrUsername
		if err := h.SetSecret(h.Key("homarr_username"), expected.username); err != nil {
			return err
		}
	}
	if saved != expected {
		if _, err := h.ExecSecret(ctx, map[string]string{"HOMARR_USERNAME": expected.username, "HOMARR_PASSWORD": expected.password}, `set -eu
file=/config/nzbget.conf
temp=$(mktemp /config/.self-host-homarr.XXXXXX)
trap 'rm -f "$temp"' EXIT
awk '
BEGIN { username = ENVIRON["HOMARR_USERNAME"]; password = ENVIRON["HOMARR_PASSWORD"] }
/^[[:space:]]*RestrictedUsername[[:space:]]*=/ {
  value = $0; sub(/^[^=]*=/, "", value); sub(/\r$/, "", value)
  if (++users != 1 || (value != "" && value != username)) exit 1
  print "RestrictedUsername=" username; next
}
/^[[:space:]]*RestrictedPassword[[:space:]]*=/ {
  value = $0; sub(/^[^=]*=/, "", value); sub(/\r$/, "", value)
  if (++passwords != 1 || (value != "" && value != password)) exit 1
  print "RestrictedPassword=" password; next
}
{ print }
END { if (users != 1 || passwords != 1) exit 1 }
' "$file" > "$temp"
chmod 600 "$temp"
mv "$temp" "$file"`); err != nil {
			return errors.New("NZBGet restricted-user settings could not be saved safely; inspect its settings and retry self-host setup nzbget")
		}
	}
	if active != expected {
		if err := h.Restart(ctx); err != nil {
			return err
		}
	}
	return h.Poll(ctx, 2*time.Minute, func(ctx context.Context) (bool, error) {
		err := VerifyHomarr(ctx, h)
		return err == nil, err
	})
}
