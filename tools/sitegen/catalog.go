package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/catalog"
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

// availableLinks drops the links to Apps hidden from new installs.
func availableLinks(ap app.App) []app.Link {
	var links []app.Link
	for _, link := range ap.Links() {
		if catalog.Unavailable(link.Target) == "" {
			links = append(links, link)
		}
	}
	return links
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
		for _, link := range availableLinks(ap) {
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
	path := filepath.Join("site", "src", "data", "catalog.json")
	if err := os.WriteFile(path, append(doc, '\n'), 0o644); err != nil {
		return err
	}
	fmt.Println(path)
	return nil
}
