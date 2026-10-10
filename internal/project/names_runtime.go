package project

import (
	"encoding/json"
	"errors"
	"os"
)

type NamesRuntime struct {
	Applied     string `json:"applied,omitempty"`
	StartAction string `json:"start_action,omitempty"`
}

func (p *Project) LoadNamesRuntime() (NamesRuntime, error) {
	var runtime NamesRuntime
	data, err := os.ReadFile(p.Path(NamesFolder, "runtime.json"))
	if errors.Is(err, os.ErrNotExist) {
		return runtime, nil
	}
	if err != nil {
		return runtime, err
	}
	err = json.Unmarshal(data, &runtime)
	return runtime, err
}

func (p *Project) SaveNamesRuntime(runtime NamesRuntime) error {
	if err := p.MkdirAll(NamesFolder); err != nil {
		return err
	}
	data, err := json.Marshal(runtime)
	if err != nil {
		return err
	}
	return p.writeFile(p.Path(NamesFolder, "runtime.json"), data, 0644)
}
