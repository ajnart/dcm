package project

import (
	"encoding/json"
	"errors"
	"os"
)

type RestoreStartup struct {
	Scope    string   `json:"scope"`
	Targets  []string `json:"targets"`
	Services []string `json:"services,omitempty"`
	Names    bool     `json:"names,omitempty"`
	Fresh    bool     `json:"fresh,omitempty"`
}

func (p *Project) LoadRestoreStartup() (*RestoreStartup, error) {
	data, err := os.ReadFile(p.Path("restore-startup.json"))
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var startup RestoreStartup
	if err := json.Unmarshal(data, &startup); err != nil {
		return nil, err
	}
	return &startup, nil
}

func (p *Project) SaveRestoreStartup(startup RestoreStartup) error {
	data, err := json.Marshal(startup)
	if err != nil {
		return err
	}
	return p.writeFile(p.Path("restore-startup.json"), data, 0644)
}

func (p *Project) ClearRestoreStartup(scope string) error {
	startup, err := p.LoadRestoreStartup()
	if err != nil || startup == nil {
		return err
	}
	if scope != "" && startup.Scope != scope {
		return errors.New("pending Restore belongs to a different approved Action")
	}
	if err := os.Remove(p.Path("restore-startup.json")); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	return nil
}
