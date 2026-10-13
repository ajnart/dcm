package homarr

import (
	"context"
	"encoding/json"
	"errors"
	"math"
	"slices"
	"strconv"

	"github.com/ajnart/self-host/internal/apps/aria2"
	"github.com/ajnart/self-host/internal/helpers"
)

func aria2Target() target {
	return target{
		id: "aria2", name: "Aria2", kind: "aria2", internal: fixed("http://aria2:6800"),
		secrets: func(_, to *helpers.H) []secret {
			return []secret{{Kind: "apiKey", Value: to.Secret(to.Key("rpc_token"))}}
		},
		widgets: []widget{plain("downloads"), statWidget("download", "upload", "paused")},
		stats:   verifyAria2Stats,
		verify: func(ctx context.Context, from, to *helpers.H, integrationID string) error {
			if err := (aria2.App{}).Check(ctx, to); err != nil {
				return err
			}
			if integrationID == "" || integrationID != from.Secret(from.Key("linked_aria2")) ||
				from.Secret(integrationFingerprintKey(from, integrationID)) != integrationFingerprint(aria2Target(), from, to) {
				return errors.New("Homarr's Aria2 integration does not match its saved ownership and RPC credential; retry self-host setup homarr")
			}
			value, err := apiKeyProcedure(ctx, from, "integration.byId", map[string]any{"id": integrationID})
			if err != nil {
				return err
			}
			record, _ := value.(map[string]any)
			credentials, _ := record["secrets"].([]any)
			if stringField(record, "id") != integrationID || stringField(record, "kind") != "aria2" ||
				stringField(record, "url") != "http://aria2:6800" || len(credentials) != 1 {
				return errors.New("Homarr did not return the owned token-authenticated Aria2 integration")
			}
			credential, _ := credentials[0].(map[string]any)
			privateValue, present := credential["value"]
			if stringField(credential, "kind") != "apiKey" || !present || privateValue != nil {
				return errors.New("Homarr did not return Aria2's private RPC credential metadata")
			}
			for _, method := range []string{"getVersion", "getGlobalOption"} {
				value, err := apiKeyWrite(ctx, from, "integration.request", map[string]any{
					"integrationId": integrationID, "method": "POST", "path": "/jsonrpc",
					"body": map[string]any{"jsonrpc": "2.0", "id": 1, "method": "aria2." + method, "params": []any{}},
				})
				if err != nil {
					return err
				}
				response, _ := value.(map[string]any)
				integration, _ := response["integration"].(map[string]any)
				body, _ := response["data"].(map[string]any)
				result, _ := body["result"].(map[string]any)
				if response["ok"] != true || response["status"] != float64(200) ||
					stringField(integration, "id") != integrationID || stringField(integration, "kind") != "aria2" ||
					body["jsonrpc"] != "2.0" || body["id"] != float64(1) || body["error"] != nil || result == nil {
					return errors.New("Homarr's saved Aria2 RPC credential did not authenticate; run self-host setup aria2, then self-host setup homarr")
				}
				if method == "getVersion" && stringField(result, "version") != "1.37.0" ||
					method == "getGlobalOption" && stringField(result, "dir") != "/var/lib/aria2/downloads" {
					return errors.New("Homarr's saved Aria2 connection reports a different version or download directory")
				}
			}
			keys := []string{"gid", "status", "bittorrent", "files", "totalLength", "completedLength", "uploadLength", "downloadSpeed", "uploadSpeed"}
			for _, method := range []string{"getGlobalStat", "tellActive", "tellWaiting", "tellStopped"} {
				params := []any{"token:" + to.Secret(to.Key("rpc_token"))}
				switch method {
				case "tellActive":
					params = append(params, keys)
				case "tellWaiting", "tellStopped":
					params = append(params, 0, 50, keys)
				}
				response, err := to.HTTP(ctx, helpers.Request{Method: "POST", Path: "/jsonrpc", NoRedirect: true,
					JSON: map[string]any{"jsonrpc": "2.0", "id": 1, "method": "aria2." + method, "params": params}})
				if err != nil {
					return err
				}
				var body struct {
					JSONRPC string          `json:"jsonrpc"`
					ID      int             `json:"id"`
					Result  json.RawMessage `json:"result"`
					Error   json.RawMessage `json:"error"`
				}
				if response.Status != 200 || response.Decode(&body) != nil || body.JSONRPC != "2.0" || body.ID != 1 ||
					len(body.Error) > 0 && string(body.Error) != "null" || len(body.Result) == 0 || string(body.Result) == "null" {
					return errors.New("Aria2 rejected the authenticated read-only queue request")
				}
				if method == "getGlobalStat" {
					var stats map[string]string
					if json.Unmarshal(body.Result, &stats) != nil {
						return errors.New("Aria2 did not return queue statistics")
					}
					statistics := map[string]float64{}
					for _, key := range []string{"downloadSpeed", "uploadSpeed", "numActive", "numWaiting", "numStopped", "numStoppedTotal"} {
						count, err := strconv.ParseUint(stats[key], 10, 64)
						if err != nil {
							return errors.New("Aria2 did not return nonnegative queue counts and byte-per-second rates")
						}
						statistics[key] = float64(count)
					}
					if statistics["numStoppedTotal"] < statistics["numStopped"] {
						return errors.New("Aria2 returned inconsistent stopped queue counts")
					}
					continue
				}
				var items []map[string]any
				if json.Unmarshal(body.Result, &items) != nil || items == nil {
					return errors.New("Aria2 did not return an explicit queue array")
				}
				if method != "tellActive" && len(items) > 50 {
					return errors.New("Aria2 returned a queue array exceeding its requested limit")
				}
				seen := map[string]bool{}
				for _, item := range items {
					id, status := stringField(item, "gid"), stringField(item, "status")
					if id == "" || seen[id] ||
						method == "tellActive" && status != "active" ||
						method == "tellWaiting" && !slices.Contains([]string{"waiting", "paused"}, status) ||
						method == "tellStopped" && !slices.Contains([]string{"complete", "error", "removed"}, status) {
						return errors.New("Aria2 returned an invalid queue identifier or status")
					}
					seen[id] = true
					numbers := map[string]float64{}
					for _, key := range []string{"totalLength", "completedLength", "uploadLength", "downloadSpeed", "uploadSpeed"} {
						number, err := strconv.ParseUint(stringField(item, key), 10, 64)
						if err != nil {
							return errors.New("Aria2 returned incomplete queue sizes or transfer rates")
						}
						numbers[key] = float64(number)
					}
					if numbers["totalLength"] > 0 && numbers["completedLength"] > numbers["totalLength"] {
						return errors.New("Aria2 returned queue progress outside the supported zero-to-one range")
					}
					files, filesOK := item["files"].([]any)
					if !filesOK {
						return errors.New("Aria2 did not return its queue's file metadata")
					}
					if len(files) > 0 {
						file, _ := files[0].(map[string]any)
						if stringField(file, "path") == "" {
							return errors.New("Aria2 returned a queue file without its path")
						}
					}
					if rawTorrent := item["bittorrent"]; rawTorrent != nil {
						torrent, ok := rawTorrent.(map[string]any)
						if !ok {
							return errors.New("Aria2 returned unsupported torrent metadata")
						}
						info, _ := torrent["info"].(map[string]any)
						if torrent["info"] != nil && info == nil {
							return errors.New("Aria2 returned unsupported torrent name metadata")
						}
						if rawName := info["name"]; rawName != nil {
							name, ok := rawName.(string)
							if !ok || name == "" {
								return errors.New("Aria2's torrent name is unsupported by Homarr's native Downloads schema")
							}
						}
					}
				}
			}
			queue, err := readDownloadsQueue(ctx, from, integrationID, "aria2")
			if err != nil {
				return err
			}
			status, items := queue.status, queue.items
			rates, _ := status["rates"].(map[string]any)
			types, _ := status["types"].([]any)
			paused, pausedOK := status["paused"].(bool)
			if len(items) > 50 || !pausedOK || len(types) != 2 ||
				!slices.Contains(types, any("torrent")) || !slices.Contains(types, any("miscellaneous")) {
				return errors.New("Homarr returned incomplete Aria2 queue data; an empty queue requires an explicit empty items array")
			}
			for _, key := range []string{"down", "up"} {
				rate, ok := rates[key].(float64)
				if !ok || rate < 0 || math.IsNaN(rate) || math.IsInf(rate, 0) {
					return errors.New("Homarr returned incomplete Aria2 byte-per-second rates")
				}
			}
			allPaused := true
			for index, raw := range items {
				item, _ := raw.(map[string]any)
				itemType, state := stringField(item, "type"), stringField(item, "state")
				if stringField(item, "id") == "" || stringField(item, "name") == "" ||
					!slices.Contains([]string{"torrent", "miscellaneous"}, itemType) ||
					!slices.Contains([]string{"downloading", "leeching", "seeding", "queued", "paused", "completed", "failed", "unknown"}, state) ||
					itemType == "torrent" && state == "downloading" ||
					itemType == "miscellaneous" && slices.Contains([]string{"leeching", "seeding"}, state) {
					return errors.New("Homarr returned unsupported Aria2 item identity, type or state")
				}
				for _, key := range []string{"index", "size", "sent", "downSpeed", "upSpeed", "progress", "time"} {
					number, ok := item[key].(float64)
					if !ok || number < 0 || math.IsNaN(number) || math.IsInf(number, 0) ||
						key == "progress" && number > 1 || key == "index" && number != float64(index) {
						return errors.New("Homarr returned incomplete Aria2 item bytes, rates, progress or millisecond ETA")
					}
				}
				progress := item["progress"].(float64)
				if state == "leeching" && progress >= 1 || state == "seeding" && progress < 1 ||
					(item["downSpeed"] == float64(0) || progress == 1 || item["size"] == float64(0)) && item["time"] != float64(0) {
					return errors.New("Homarr returned inconsistent Aria2 item progress, state or ETA")
				}
				allPaused = allPaused && state == "paused"
			}
			if paused != allPaused {
				return errors.New("Homarr's Aria2 paused flag does not match its bounded download list")
			}
			return nil
		},
	}
}

func verifyAria2Stats(sample statsSample) error {
	for _, key := range []string{"download", "upload"} {
		rate, ok := sample.values[key].(float64)
		if sample.units[key] != "bytesPerSecond" || !ok || rate < 0 || math.IsNaN(rate) || math.IsInf(rate, 0) {
			return errors.New("Homarr returned unsupported refreshed Aria2 byte-per-second Stats; retry self-host setup homarr")
		}
	}
	if _, ok := sample.values["paused"].(bool); !ok || sample.units["paused"] != "text" {
		return errors.New("Homarr did not return supported refreshed Aria2 paused Stats; retry self-host setup homarr")
	}
	return nil
}
