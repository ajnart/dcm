package project

import (
	"fmt"
	"os"
	"sort"

	"go.yaml.in/yaml/v3"
)

func fragmentServiceNames(id string, content []byte) ([]string, error) {
	var doc struct {
		Services map[string]any `yaml:"services"`
	}
	if yaml.Unmarshal(content, &doc) != nil {
		return nil, fmt.Errorf("App %s has an invalid Compose fragment", id)
	}
	names := make([]string, 0, len(doc.Services))
	for name := range doc.Services {
		names = append(names, name)
	}
	sort.Strings(names)
	return names, nil
}

// ValidateFragment rejects a proposed App fragment that reuses another App's
// Compose service. Call before writing accompanying App configuration as well.
func (p *Project) ValidateFragment(id, content string) error {
	names, err := fragmentServiceNames(id, []byte(content))
	if err != nil {
		return err
	}
	proposed := map[string]bool{}
	for _, name := range names {
		if name == "access-caddy" {
			return fmt.Errorf("Compose service access-caddy belongs to Easy names, not App %s", id)
		}
		proposed[name] = true
	}
	ids, err := p.AppIDs()
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return err
	}
	for _, other := range ids {
		if other == id {
			continue
		}
		data, err := os.ReadFile(p.FragmentPath(other))
		if err != nil {
			return err
		}
		existing, err := fragmentServiceNames(other, data)
		if err != nil {
			return err
		}
		for _, name := range existing {
			if proposed[name] {
				return fmt.Errorf("Compose service %s is defined by both Apps %s and %s; use distinct App-owned service names", name, other, id)
			}
		}
	}
	return nil
}

// ValidateServiceOwnership checks the final included composition before apply.
// Keep this after an Install's edits so reinstall can repair a legacy collision.
func (p *Project) ValidateServiceOwnership(replacements map[string]string) error {
	ids, err := p.AppIDs()
	if err != nil && !os.IsNotExist(err) {
		return err
	}
	owners := map[string]string{}
	for id := range replacements {
		found := false
		for _, existing := range ids {
			if existing == id {
				found = true
				break
			}
		}
		if !found {
			ids = append(ids, id)
		}
	}
	sort.Strings(ids)
	for _, id := range ids {
		content, replaced := replacements[id]
		data := []byte(content)
		if !replaced {
			var err error
			data, err = os.ReadFile(p.FragmentPath(id))
			if err != nil {
				return err
			}
		}
		names, err := fragmentServiceNames(id, data)
		if err != nil {
			return err
		}
		for _, name := range names {
			if name == "access-caddy" {
				return fmt.Errorf("Compose service access-caddy belongs to Easy names, not App %s", id)
			}
			if other, exists := owners[name]; exists {
				return fmt.Errorf("Compose service %s is defined by both Apps %s and %s; use distinct App-owned service names", name, other, id)
			}
			owners[name] = id
		}
	}
	return nil
}
