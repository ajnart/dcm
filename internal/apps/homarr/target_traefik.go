package homarr

import (
	"context"
	"errors"
	"fmt"
	"math"
	"net/http"
	"slices"
	"strconv"
	"strings"

	"github.com/ajnart/self-host/internal/apps/traefik"
	"github.com/ajnart/self-host/internal/helpers"
)

func traefikTarget() target {
	return target{
		id: "traefik", name: "Traefik", kind: "traefik", internal: fixed("http://traefik:8080"),
		secrets: func(_, to *helpers.H) []secret {
			return []secret{{Kind: "username", Value: to.AdminUser()}, {Kind: "password", Value: to.AdminPassword()}}
		},
		widgets: []widget{{kind: "traefik", options: map[string]any{
			"showTcp": true, "showUdp": true, "showEntryPoints": true,
		}}, statWidget("routers", "services", "middlewares")},
		preflight: func(ctx context.Context, from, to *helpers.H) error {
			_, err := readTraefikAPI(ctx, from, to)
			return err
		},
		verify: verifyTraefik,
		stats:  verifyTraefikStats,
	}
}

func readTraefikAPI(ctx context.Context, from, to *helpers.H) (map[string]float64, error) {
	if to.AdminUser() == "" || to.AdminPassword() == "" {
		return nil, errors.New("Traefik saved control-interface login is missing; restore it through self-host credentials, then retry self-host setup traefik and self-host setup homarr")
	}
	anonymous, err := to.HTTP(ctx, helpers.Request{Path: "/api/version", NoRedirect: true})
	if err != nil {
		return nil, traefikRequestError(ctx)
	}
	if anonymous.OK() || traefikUnsupportedAuth(anonymous) {
		return nil, traefikManualAuth(from)
	}
	if anonymous.Status != http.StatusUnauthorized {
		return nil, fmt.Errorf("Traefik protected API probe returned HTTP %d; HTTP 404 means the API route is missing or disabled; retry self-host setup traefik before self-host setup homarr", anonymous.Status)
	}
	metrics := map[string]float64{"routers": 0, "services": 0, "middlewares": 0}
	for _, endpoint := range []string{
		"entrypoints", "http/routers", "http/services", "http/middlewares",
		"tcp/routers", "tcp/services", "tcp/middlewares", "udp/routers", "udp/services",
	} {
		response, err := to.HTTP(ctx, helpers.Request{
			Path: "/api/" + endpoint, User: to.AdminUser(), Password: to.AdminPassword(), NoRedirect: true,
		})
		if err != nil {
			return nil, traefikRequestError(ctx)
		}
		if traefikUnsupportedAuth(response) {
			return nil, traefikManualAuth(from)
		}
		if response.Status != http.StatusOK {
			return nil, fmt.Errorf("Traefik %s returned HTTP %d; repair the existing protected API and retry self-host setup traefik before self-host setup homarr", endpoint, response.Status)
		}
		nextPage, err := strconv.Atoi(response.Header.Get("X-Next-Page"))
		if err != nil || nextPage < 1 {
			return nil, fmt.Errorf("Traefik %s returned invalid pagination metadata; complete resource counts cannot be verified", endpoint)
		}
		if nextPage != 1 {
			from.Info("Homarr 2.4.1 reads only the first 100 Traefik resources per endpoint. This API has another page, so complete counts cannot be verified. Keep routing unchanged and use a manually configured dashboard that supports the existing resource set.")
			return nil, helpers.ErrManual
		}
		var resources []struct {
			Name        string   `json:"name"`
			Provider    string   `json:"provider"`
			Status      string   `json:"status"`
			Type        string   `json:"type"`
			Service     string   `json:"service"`
			Middlewares []string `json:"middlewares"`
		}
		if response.Decode(&resources) != nil || resources == nil {
			return nil, fmt.Errorf("Traefik %s returned malformed data, not an explicit resource list; retry self-host setup traefik", endpoint)
		}
		owned := false
		for _, resource := range resources {
			if resource.Name == "" || endpoint != "entrypoints" && (resource.Provider == "" || !slices.Contains([]string{"enabled", "disabled", "warning", "error"}, resource.Status)) {
				return nil, fmt.Errorf("Traefik %s returned incomplete resource data; retry self-host setup traefik", endpoint)
			}
			switch endpoint {
			case "entrypoints":
				owned = owned || resource.Name == "health"
			case "http/routers":
				if resource.Name == "selfhost-api@file" && resource.Provider == "file" && resource.Status == "enabled" && resource.Service == "api@internal" && (slices.Contains(resource.Middlewares, "selfhost-auth@file") || slices.Contains(resource.Middlewares, "selfhost-auth")) {
					owned = true
				}
			case "http/services":
				owned = owned || resource.Name == "api@internal" && resource.Provider == "internal" && resource.Status == "enabled"
			case "http/middlewares":
				owned = owned || resource.Name == "selfhost-auth@file" && resource.Provider == "file" && resource.Status == "enabled" && resource.Type == "basicauth"
			}
		}
		if (endpoint == "entrypoints" || strings.HasPrefix(endpoint, "http/")) && !owned {
			return nil, fmt.Errorf("Traefik %s has no enabled owned management resource; restore the existing protected file-provider configuration and retry self-host setup traefik", endpoint)
		}
		if endpoint != "entrypoints" {
			_, metric, _ := strings.Cut(endpoint, "/")
			metrics[metric] += float64(len(resources))
		}
	}
	if err := (traefik.App{}).Check(ctx, to); err != nil {
		return nil, err
	}
	return metrics, nil
}

func traefikUnsupportedAuth(response helpers.Response) bool {
	if response.Status >= 300 && response.Status < 400 || response.Status == http.StatusForbidden {
		return true
	}
	return response.Status == http.StatusUnauthorized && !strings.HasPrefix(strings.ToLower(strings.TrimSpace(response.Header.Get("WWW-Authenticate"))), "basic ")
}

func traefikManualAuth(from *helpers.H) error {
	from.Info("Traefik's existing API protection is not the supported saved BasicAuth login. Keep its authentication and routing unchanged; review the existing protected API with its owner before retrying self-host setup traefik and self-host setup homarr. No unauthenticated or bearer fallback will be attempted.")
	return helpers.ErrManual
}

func traefikRequestError(ctx context.Context) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	return errors.New("Traefik protected API request failed before an HTTP response; retry self-host setup traefik")
}

func verifyTraefik(ctx context.Context, from, to *helpers.H, integrationID string) error {
	_, err := readTraefikAPI(ctx, from, to)
	if err != nil {
		return err
	}
	value, err := apiKeyProcedure(ctx, from, "widget.traefik.getDashboard", map[string]any{"integrationIds": []string{integrationID}})
	if err != nil {
		return errors.New("Homarr could not read the Traefik dashboard; check the protected API and saved login, then retry self-host setup homarr")
	}
	sources, ok := value.([]any)
	if !ok || len(sources) != 1 {
		return errors.New("Homarr did not return the requested Traefik dashboard")
	}
	source, ok := sources[0].(map[string]any)
	if !ok || stringField(source, "integrationId") != integrationID || source["error"] != nil {
		return errors.New("Homarr returned a failed or mismatched Traefik dashboard")
	}
	dashboard, ok := source["dashboard"].(map[string]any)
	if !ok || !helpers.VersionCompatible(stringField(dashboard, "version"), "3.6.22") {
		return errors.New("Homarr did not return a Traefik 3.6.22 or newer 3.x dashboard")
	}
	failed, ok := dashboard["failedEndpoints"].([]any)
	if !ok || len(failed) != 0 {
		return errors.New("Homarr returned incomplete Traefik API data; failed endpoints are not empty datasets; repair the protected API and retry self-host setup homarr")
	}
	entryPoints, ok := dashboard["entryPoints"].([]any)
	if !ok || !slices.Contains(entryPoints, any("health")) {
		return errors.New("Homarr did not return Traefik's management entry point")
	}
	for _, entryPoint := range entryPoints {
		if name, ok := entryPoint.(string); !ok || name == "" {
			return errors.New("Homarr returned malformed Traefik entry points")
		}
	}
	for _, protocol := range []string{"http", "tcp", "udp"} {
		group, ok := dashboard[protocol].(map[string]any)
		if !ok {
			return errors.New("Homarr returned incomplete Traefik protocol summaries")
		}
		for _, kind := range []string{"routers", "services", "middlewares"} {
			if protocol == "udp" && kind == "middlewares" {
				continue
			}
			summary, ok := group[kind].(map[string]any)
			if !ok || !traefikSummaryValid(summary) {
				return errors.New("Homarr returned malformed Traefik resource summaries")
			}
			if protocol == "http" && summary["total"].(float64) == 0 {
				return errors.New("Homarr returned an empty Traefik management resource summary; retry self-host setup homarr")
			}
		}
	}
	resources, ok := dashboard["resources"].([]any)
	if !ok || len(resources) == 0 || len(resources) > 200 {
		return errors.New("Homarr did not return bounded Traefik resource details")
	}
	for _, raw := range resources {
		resource, ok := raw.(map[string]any)
		if !ok || stringField(resource, "name") == "" || !slices.Contains([]string{"http", "tcp", "udp"}, stringField(resource, "protocol")) || !slices.Contains([]string{"router", "service", "middleware"}, stringField(resource, "type")) || !slices.Contains([]string{"enabled", "disabled", "warning", "error", "unknown"}, stringField(resource, "status")) {
			return errors.New("Homarr returned malformed Traefik resource details")
		}
	}
	return nil
}

func verifyTraefikStats(sample statsSample) error {
	for _, key := range []string{"routers", "services", "middlewares"} {
		if _, ok := traefikCount(sample.values[key]); !ok || sample.units[key] != "count" {
			return errors.New("Homarr Traefik counts are incomplete; retry self-host setup homarr after the protected API is ready")
		}
	}
	return nil
}

func traefikCount(value any) (float64, bool) {
	count, ok := value.(float64)
	return count, ok && count >= 0 && !math.IsNaN(count) && !math.IsInf(count, 0) && math.Trunc(count) == count
}

func traefikSummaryValid(summary map[string]any) bool {
	for _, key := range []string{"total", "enabled", "warnings", "errors"} {
		if _, ok := traefikCount(summary[key]); !ok {
			return false
		}
	}
	return summary["enabled"].(float64)+summary["warnings"].(float64)+summary["errors"].(float64) <= summary["total"].(float64)
}
