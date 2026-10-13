package homarr

import (
	"context"
	"errors"
	"math"

	"github.com/ajnart/self-host/internal/helpers"
)

func paperlessTarget() target {
	return target{
		id: "paperless-ngx", name: "Paperless-ngx", kind: "paperlessNgx",
		internal: fixed("http://paperless-ngx:8000"), secrets: apiKeySecret,
		widgets: []widget{{kind: "paperlessNgx", options: map[string]any{
			"showInboxRatio": true, "showInboxRing": true,
			"showDocumentsTotal": true, "showDocumentsInbox": true,
			"showCorrespondents": true, "showTags": true, "showDocumentTypes": true,
		}}, statWidget("documentsTotal", "documentsInbox", "tagsCount", "correspondentsCount", "documentTypesCount")},
		preflight: func(ctx context.Context, _, to *helpers.H) error {
			_, _, err := readPaperlessCounts(ctx, to)
			return err
		},
		verify: verifyPaperless,
		stats:  verifyPaperlessStats,
	}
}

// Read only aggregate counts through the peer-owned token. Global statistics
// count root documents; taxonomy lists count objects visible to this account.
func readPaperlessCounts(ctx context.Context, to *helpers.H) (map[string]float64, bool, error) {
	key := to.Secret(to.Key("api_key"))
	if key == "" {
		return nil, false, errors.New("Paperless-ngx's owned token is missing; run self-host setup paperless-ngx, then self-host setup homarr")
	}
	read := func(path string) (map[string]any, error) {
		response, err := to.HTTP(ctx, helpers.Request{
			Path: path, NoRedirect: true,
			Header: map[string]string{"Authorization": "Token " + key},
		})
		if err != nil || response.Status != 200 {
			return nil, errors.New("Paperless-ngx aggregate data is unavailable; run self-host setup paperless-ngx, then self-host setup homarr")
		}
		var data map[string]any
		if response.Decode(&data) != nil || data == nil {
			return nil, errors.New("Paperless-ngx returned malformed aggregate data; retry Setup")
		}
		return data, nil
	}
	statistics, err := read("/api/statistics/")
	if err != nil {
		return nil, false, err
	}
	total, valid := paperlessCount(statistics["documents_total"])
	if !valid {
		return nil, false, errors.New("Paperless-ngx did not return an explicit document count; missing data is not zero")
	}
	rawInbox, present := statistics["documents_inbox"]
	inbox, valid := paperlessCount(rawInbox)
	noInbox := present && rawInbox == nil
	if noInbox {
		// Paperless 3.2.1 returns null when no inbox tags exist. Homarr's
		// schema converts this to zero; require the source's matching metadata
		// so an unexplained null is never accepted as an empty inbox.
		tag, hasTag := statistics["inbox_tag"]
		tags, hasTags := statistics["inbox_tags"]
		if !hasTag || !hasTags || tag != nil || tags != nil {
			return nil, false, errors.New("Paperless-ngx returned an unexplained null inbox count; verify its inbox tags and retry Setup")
		}
		inbox, valid = 0, true
	}
	if !valid || inbox > total {
		return nil, false, errors.New("Paperless-ngx returned an invalid inbox count; retry Setup")
	}
	counts := map[string]float64{"documentsTotal": total, "documentsInbox": inbox}
	for _, taxonomy := range []struct{ path, metric string }{
		{"tags", "tagsCount"}, {"correspondents", "correspondentsCount"}, {"document_types", "documentTypesCount"},
	} {
		data, err := read("/api/" + taxonomy.path + "/?page_size=1")
		if err != nil {
			return nil, false, err
		}
		count, valid := paperlessCount(data["count"])
		if !valid {
			return nil, false, errors.New("Paperless-ngx omitted a valid taxonomy count; missing data is not zero")
		}
		counts[taxonomy.metric] = count
	}
	return counts, noInbox, nil
}

func paperlessCount(value any) (float64, bool) {
	count, ok := value.(float64)
	return count, ok && count >= 0 && !math.IsNaN(count) && !math.IsInf(count, 0) && math.Trunc(count) == count
}

func verifyPaperless(ctx context.Context, from, to *helpers.H, integrationID string) error {
	_, noInbox, err := readPaperlessCounts(ctx, to)
	if err != nil {
		return err
	}
	value, err := apiKeyProcedure(ctx, from, "widget.paperlessNgx.getStats", map[string]any{"integrationId": integrationID})
	if err != nil {
		return err
	}
	counts, ok := value.(map[string]any)
	if !ok {
		return errors.New("Homarr did not return Paperless-ngx native statistics; retry self-host setup homarr")
	}
	if err := verifyPaperlessValues(counts); err != nil {
		return err
	}
	if noInbox {
		from.Info("Paperless-ngx has no inbox tags configured. A zero inbox display represents an unconfigured inbox; this does not verify a processed inbox.")
	}
	return nil
}

func verifyPaperlessStats(sample statsSample) error {
	for _, metric := range paperlessTarget().statsMetrics() {
		if sample.units[metric] != "count" {
			return errors.New("Homarr Paperless-ngx Stats have an unsupported count unit; retry self-host setup homarr")
		}
	}
	return verifyPaperlessValues(sample.values)
}

func verifyPaperlessValues(values map[string]any) error {
	for _, metric := range paperlessTarget().statsMetrics() {
		if _, valid := paperlessCount(values[metric]); !valid {
			return errors.New("Homarr Paperless-ngx counts are incomplete or invalid; retry self-host setup homarr")
		}
	}
	if values["documentsInbox"].(float64) > values["documentsTotal"].(float64) {
		return errors.New("Homarr Paperless-ngx inbox count exceeds its document count; retry self-host setup homarr")
	}
	return nil
}
