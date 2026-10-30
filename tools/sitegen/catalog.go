package main

import (
	"encoding/json"
	"path/filepath"

	"github.com/ajnart/self-host/internal/catalog"
	"github.com/ajnart/self-host/tools/sitegen/standalone"
)

type appJSON struct {
	ID          string   `json:"id"`
	Name        string   `json:"name"`
	Description string   `json:"d"`
	Category    string   `json:"c"`
	Image       string   `json:"img"`
	Port        int      `json:"p"`
	Links       []string `json:"l"`
	LinkTitles  []string `json:"lt"`
	Icon        string   `json:"i,omitempty"`
}

type recipeJSON struct {
	ID          string   `json:"id"`
	Name        string   `json:"name"`
	Description string   `json:"d"`
	Apps        []string `json:"apps"`
}

// offeredApps lists a Recipe's Apps that are offered for new installs, never nil.
func offeredApps(r catalog.Recipe) []string {
	offered := []string{}
	for _, id := range r.Apps {
		if catalog.Unavailable(id) == "" {
			offered = append(offered, id)
		}
	}
	return offered
}

func writeCatalog() error {
	cat := catalog.Default()
	if err := checkIcons(cat); err != nil {
		return err
	}
	apps := []appJSON{}
	for _, ap := range cat.Apps() {
		info := ap.Info()
		iconPath, err := icon(info.ID)
		if err != nil {
			return err
		}
		out := appJSON{ID: info.ID, Name: info.Name, Description: info.Description, Category: info.Category, Image: info.Image, Port: info.Port, Links: []string{}, LinkTitles: []string{}, Icon: iconPath}
		for _, link := range standalone.AvailableLinks(ap) {
			out.Links = append(out.Links, link.Target)
			out.LinkTitles = append(out.LinkTitles, link.Title)
		}
		apps = append(apps, out)
	}
	recipes := []recipeJSON{}
	for _, r := range cat.Recipes() {
		recipes = append(recipes, recipeJSON{ID: r.ID, Name: r.Name, Description: r.Description, Apps: offeredApps(r)})
	}
	doc, err := json.MarshalIndent(struct {
		Apps    []appJSON    `json:"apps"`
		Recipes []recipeJSON `json:"recipes"`
	}{apps, recipes}, "", " ")
	if err != nil {
		return err
	}
	return writeFile(filepath.Join("site", "src", "data", "catalog.json"), append(doc, '\n'))
}
