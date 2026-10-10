package project

import (
	"encoding/json"
	"errors"
	"os"
)

const (
	ExperienceNew      = "new"
	ExperienceAdvanced = "advanced"
)

// Profile is what self-host knows about the person: non-secret facts kept in
// profile.json in the Home folder. It can exist before any Project.
type Profile struct {
	// Experience is new or advanced; empty until the person answered.
	Experience string `json:"experience"`
}

// LoadProfile reads the Profile; the zero Profile when none was saved.
func (p *Project) LoadProfile() (Profile, error) {
	var pr Profile
	data, err := os.ReadFile(p.Path("profile.json"))
	if errors.Is(err, os.ErrNotExist) {
		return pr, nil
	}
	if err != nil {
		return pr, err
	}
	return pr, json.Unmarshal(data, &pr)
}

// SaveProfile writes the Profile, creating the Home folder when no install
// has created it yet.
func (p *Project) SaveProfile(pr Profile) error {
	if err := p.MkdirAll(); err != nil {
		return err
	}
	data, err := json.MarshalIndent(pr, "", "  ")
	if err != nil {
		return err
	}
	return p.writeFile(p.Path("profile.json"), append(data, '\n'), 0o644)
}
