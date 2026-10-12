package homarr

import (
	"context"
	"errors"
	"fmt"
	"slices"

	"github.com/ajnart/self-host/internal/helpers"
)

const supportedHomarrVersion = "2.4.1"

func supportedVersion(ctx context.Context, h *helpers.H) error {
	value, err := apiKeyProcedure(ctx, h, "info.getInfo", nil)
	if err != nil {
		return fmt.Errorf("cannot verify Homarr compatibility; use Homarr %s and retry self-host setup homarr: %w", supportedHomarrVersion, err)
	}
	info, _ := value.(map[string]any)
	if stringField(info, "version") != supportedHomarrVersion {
		return fmt.Errorf("Homarr %s is unsupported; this CLI supports %s. Back up Homarr before changing its version, then retry self-host setup homarr", stringField(info, "version"), supportedHomarrVersion)
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
		return fmt.Errorf("Homarr %s credential shape is unsupported; use the supported Homarr %s and retry Setup", t.kind, supportedHomarrVersion)
	}
	return fmt.Errorf("Homarr does not support %s; use Homarr %s and retry Setup", t.kind, supportedHomarrVersion)
}
