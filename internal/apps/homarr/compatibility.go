package homarr

import (
	"context"
	"errors"
	"fmt"
	"slices"

	"github.com/ajnart/self-host/internal/helpers"
)

const supportedHomarrVersions = "2.4.1, 2.5.1 or 2.5.2"

func readHomarrVersion(ctx context.Context, h *helpers.H) (string, error) {
	value, err := apiKeyProcedure(ctx, h, "info.getInfo", nil)
	if err != nil {
		return "", err
	}
	info, _ := value.(map[string]any)
	return stringField(info, "version"), nil
}

// requireCredentialSafeHomarr gates privacy-sensitive preflights before provider
// probes or mutation. The caller supplies a fixed App-specific recovery hint.
func requireCredentialSafeHomarr(ctx context.Context, h *helpers.H, hint string) error {
	version, err := readHomarrVersion(ctx, h)
	if err == nil && (version == "2.5.1" || version == "2.5.2") {
		return nil
	}
	h.Info(hint)
	return helpers.ErrManual
}

func supportedVersion(ctx context.Context, h *helpers.H) error {
	version, err := readHomarrVersion(ctx, h)
	if err != nil {
		return fmt.Errorf("cannot verify Homarr compatibility; use Homarr %s and retry self-host setup homarr: %w", supportedHomarrVersions, err)
	}
	if version != "2.4.1" && version != "2.5.1" && version != "2.5.2" {
		return fmt.Errorf("Homarr %s is unsupported; this CLI supports %s. Back up Homarr before changing its version, then retry self-host setup homarr", version, supportedHomarrVersions)
	}
	return nil
}

func (t target) compatible(ctx context.Context, from, to *helpers.H) error {
	if err := supportedVersion(ctx, from); err != nil {
		return err
	}
	if t.kind == "" {
		return nil
	}
	value, err := apiKeyProcedure(ctx, from, "integration.getKinds", nil)
	if err != nil {
		return err
	}
	kinds, ok := value.([]any)
	if !ok {
		return errors.New("Homarr did not return its integration capabilities")
	}
	provided := []string{}
	for _, credential := range t.credentials(from, to) {
		if credential.Value == "" {
			return fmt.Errorf("%s %s credential is missing; run self-host setup %s, then self-host setup homarr", t.name, credential.Kind, t.id)
		}
		provided = append(provided, credential.Kind)
	}
	for _, raw := range kinds {
		kind, _ := raw.(map[string]any)
		if stringField(kind, "kind") != t.kind {
			continue
		}
		alternatives, _ := kind["requiredSecrets"].([]any)
		for _, raw := range alternatives {
			required, ok := raw.([]any)
			if !ok || len(required) != len(provided) {
				continue
			}
			matches := true
			for _, raw := range required {
				name, ok := raw.(string)
				if !ok || !slices.Contains(provided, name) {
					matches = false
				}
			}
			for _, name := range provided {
				if !slices.Contains(required, any(name)) {
					matches = false
				}
			}
			if matches {
				return nil
			}
		}
		return fmt.Errorf("Homarr %s credential shape is unsupported; use the supported Homarr %s and retry Setup", t.kind, supportedHomarrVersions)
	}
	return fmt.Errorf("Homarr does not support %s; use Homarr %s and retry Setup", t.kind, supportedHomarrVersions)
}
