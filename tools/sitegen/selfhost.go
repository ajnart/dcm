package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/catalog"
	"github.com/ajnart/self-host/tools/sitegen/standalone"
)

type selfHostRecipe struct {
	ID          string   `json:"id"`
	Name        string   `json:"name"`
	Description string   `json:"description"`
	Apps        []string `json:"apps"`
}

type selfHostApp struct {
	ID          string            `json:"id"`
	Name        string            `json:"name"`
	Description string            `json:"description"`
	Category    string            `json:"category"`
	Icon        string            `json:"icon"`
	Image       string            `json:"image"`
	Port        int               `json:"port"`
	Docs        string            `json:"docs"`
	Links       []standalone.Link `json:"links"`
	Compose     string            `json:"compose"`
	Env         []standalone.Env  `json:"env"`
	// Standalone is false when the compose mounts files only self-host generates.
	Standalone bool   `json:"standalone"`
	Notes      string `json:"notes,omitempty"`
}

func selfHostEntry(ap app.App) (selfHostApp, error) {
	info := ap.Info()
	projected, err := standalone.Project(ap)
	if err != nil {
		return selfHostApp{}, err
	}
	iconPath, err := icon(info.ID)
	if err != nil {
		return selfHostApp{}, err
	}
	return selfHostApp{ID: info.ID, Name: info.Name, Description: info.Description, Category: info.Category, Icon: iconPath,
		Image: info.Image, Port: info.Port, Docs: info.Docs, Links: projected.Links, Compose: projected.Compose, Env: projected.Env,
		Standalone: projected.Standalone, Notes: projected.Notes}, nil
}

func writeSelfHost() error {
	cat := catalog.Default()
	apps := []selfHostApp{}
	for _, ap := range cat.Apps() {
		entry, err := selfHostEntry(ap)
		if err != nil {
			return err
		}
		apps = append(apps, entry)
	}
	recipes := []selfHostRecipe{}
	for _, r := range cat.Recipes() {
		recipes = append(recipes, selfHostRecipe{ID: r.ID, Name: r.Name, Description: r.Description, Apps: offeredApps(r)})
	}
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	enc.SetIndent("", " ")
	if err := enc.Encode(struct {
		Apps    []selfHostApp    `json:"apps"`
		Recipes []selfHostRecipe `json:"recipes"`
	}{apps, recipes}); err != nil {
		return err
	}
	dir := filepath.Join("dcm", "src", "data")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	file := filepath.Join(dir, "selfhost.json")
	if err := os.WriteFile(file, buf.Bytes(), 0o644); err != nil {
		return err
	}
	fmt.Println(file)
	return nil
}
