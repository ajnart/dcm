package homarr

import (
	"context"
	"encoding/json"
	"errors"
	"math"
	"path"
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
			statistics := map[string]float64{}
			queue := []map[string]any{}
			seen := map[string]bool{}
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
				count := statistics["numActive"]
				switch method {
				case "tellWaiting":
					count = min(statistics["numWaiting"], 50)
				case "tellStopped":
					count = min(statistics["numStopped"], 50)
				}
				if float64(len(items)) != count {
					return errors.New("Aria2's queue counts and RPC items disagree; retry self-host setup homarr")
				}
				for _, item := range items {
					id, status := stringField(item, "gid"), stringField(item, "status")
					if id == "" || seen[id] ||
						method == "tellActive" && status != "active" ||
						method == "tellWaiting" && !slices.Contains([]string{"waiting", "paused"}, status) ||
						method == "tellStopped" && !slices.Contains([]string{"complete", "error", "removed"}, status) {
						return errors.New("Aria2 returned an invalid queue identifier or status")
					}
					seen[id] = true
					queue = append(queue, item)
				}
			}
			queue = queue[:min(len(queue), 50)]
			value, err = apiKeyProcedure(ctx, from, "widget.downloads.getJobsAndStatuses", map[string]any{
				"integrationIds": []string{integrationID}, "limitPerIntegration": 50,
			})
			if err != nil {
				return err
			}
			results, ok := value.([]any)
			if !ok || len(results) != 1 {
				return errors.New("Homarr did not return Aria2's native Downloads data")
			}
			result, _ := results[0].(map[string]any)
			integration, _ := result["integration"].(map[string]any)
			data, _ := result["data"].(map[string]any)
			if result["error"] != nil || stringField(result, "integrationId") != integrationID ||
				stringField(integration, "id") != integrationID || stringField(integration, "kind") != "aria2" || data == nil {
				return errors.New("Homarr did not return Downloads from the owned Aria2 integration")
			}
			status, _ := data["status"].(map[string]any)
			rates, _ := status["rates"].(map[string]any)
			types, _ := status["types"].([]any)
			items, itemsOK := data["items"].([]any)
			paused, pausedOK := status["paused"].(bool)
			if !itemsOK || len(items) != len(queue) || !pausedOK || len(types) != 2 ||
				!slices.Contains(types, any("torrent")) || !slices.Contains(types, any("miscellaneous")) {
				return errors.New("Homarr returned incomplete Aria2 queue data; an empty queue requires an explicit empty items array")
			}
			for key, rpcKey := range map[string]string{"down": "downloadSpeed", "up": "uploadSpeed"} {
				rate, ok := rates[key].(float64)
				if !ok || rate < 0 || math.IsNaN(rate) || math.IsInf(rate, 0) || rate != statistics[rpcKey] {
					return errors.New("Homarr's Aria2 byte-per-second rates differ from authenticated RPC; retry self-host setup homarr")
				}
			}
			allPaused := true
			for index, raw := range items {
				item, _ := raw.(map[string]any)
				rpc := queue[index]
				numbers := map[string]float64{}
				for _, key := range []string{"totalLength", "completedLength", "uploadLength", "downloadSpeed", "uploadSpeed"} {
					number, err := strconv.ParseUint(stringField(rpc, key), 10, 64)
					if err != nil {
						return errors.New("Aria2 returned incomplete queue sizes or transfer rates")
					}
					numbers[key] = float64(number)
				}
				progress, eta := float64(0), float64(0)
				if numbers["totalLength"] > 0 {
					progress = numbers["completedLength"] / numbers["totalLength"]
				}
				if progress > 1 {
					return errors.New("Aria2 returned queue progress outside the supported zero-to-one range")
				}
				if numbers["downloadSpeed"] > 0 && numbers["completedLength"] < numbers["totalLength"] {
					eta = math.Floor((numbers["totalLength"]-numbers["completedLength"])/numbers["downloadSpeed"]) * 1000
				}
				files, filesOK := rpc["files"].([]any)
				if !filesOK {
					return errors.New("Aria2 did not return its queue's file metadata")
				}
				name, itemType := "Unknown", "miscellaneous"
				if len(files) > 0 {
					file, _ := files[0].(map[string]any)
					filePath, ok := file["path"].(string)
					if !ok || filePath == "" {
						return errors.New("Aria2 returned a queue file without its path")
					}
					name = path.Base(filePath)
				}
				if rawTorrent := rpc["bittorrent"]; rawTorrent != nil {
					torrent, ok := rawTorrent.(map[string]any)
					if !ok {
						return errors.New("Aria2 returned unsupported torrent metadata")
					}
					itemType = "torrent"
					info, _ := torrent["info"].(map[string]any)
					if torrent["info"] != nil && info == nil {
						return errors.New("Aria2 returned unsupported torrent name metadata")
					}
					if rawName := info["name"]; rawName != nil {
						name, ok = rawName.(string)
						if !ok || name == "" {
							return errors.New("Aria2's torrent name is unsupported by Homarr's native Downloads schema")
						}
					}
				}
				state := "unknown"
				switch stringField(rpc, "status") {
				case "active":
					state = "downloading"
					if itemType == "torrent" {
						state = "leeching"
						if progress >= 1 {
							state = "seeding"
						}
					}
				case "waiting":
					state = "queued"
				case "paused":
					state = "paused"
				case "complete":
					state = "completed"
				case "error":
					state = "failed"
				}
				allPaused = allPaused && stringField(rpc, "status") == "paused"
				if stringField(item, "id") != stringField(rpc, "gid") || stringField(item, "name") != name ||
					stringField(item, "type") != itemType || stringField(item, "state") != state {
					return errors.New("Homarr's Aria2 item identity or state differs from authenticated RPC; retry self-host setup homarr")
				}
				for key, expected := range map[string]float64{"index": float64(index), "size": numbers["totalLength"],
					"sent": numbers["uploadLength"], "downSpeed": numbers["downloadSpeed"], "upSpeed": numbers["uploadSpeed"],
					"progress": progress, "time": eta} {
					number, ok := item[key].(float64)
					if !ok || number < 0 || math.IsNaN(number) || math.IsInf(number, 0) || number != expected {
						return errors.New("Homarr's Aria2 item bytes, rates, progress or millisecond ETA differ from authenticated RPC; retry self-host setup homarr")
					}
				}
			}
			if paused != allPaused {
				return errors.New("Homarr's Aria2 paused flag does not match its bounded download list")
			}
			value, err = apiKeyProcedure(ctx, from, "widget.stats.catalog", map[string]any{"integrationId": integrationID})
			if err != nil {
				return err
			}
			catalog, _ := value.(map[string]any)
			metrics, _ := catalog["metrics"].([]any)
			for key, unit := range map[string]string{"download": "bytesPerSecond", "upload": "bytesPerSecond", "paused": "text"} {
				matches := 0
				for _, raw := range metrics {
					metric, _ := raw.(map[string]any)
					if stringField(metric, "key") == key {
						if stringField(metric, "unit") != unit {
							return errors.New("Homarr returned unsupported Aria2 Stats units")
						}
						matches++
					}
				}
				if matches != 1 {
					return errors.New("Homarr did not expose Aria2's supported Stats metrics and units")
				}
			}
			stats, err := freshStatsSnapshot(ctx, from, integrationID)
			if err != nil {
				return err
			}
			for key, rpcKey := range map[string]string{"download": "downloadSpeed", "upload": "uploadSpeed"} {
				rate, ok := stats[key].(float64)
				if !ok || rate < 0 || math.IsNaN(rate) || math.IsInf(rate, 0) || rate != statistics[rpcKey] {
					return errors.New("Homarr's refreshed Aria2 byte-per-second Stats differ from authenticated RPC; retry self-host setup homarr")
				}
			}
			statsPaused := true
			if len(queue) > 0 {
				statsPaused = stringField(queue[0], "status") == "paused"
			}
			if value, ok := stats["paused"].(bool); !ok || value != statsPaused {
				return errors.New("Homarr's refreshed Aria2 paused Stats do not match its one-item download list")
			}
			return nil
		},
	}
}
