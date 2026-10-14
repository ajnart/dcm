package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"

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

var icons = map[string]string{
	"archive-team-warrior": "png/archiveteam-warrior.png",
	"aria2":                "png/ariang.png",
	"borgmatic":            "svg/borg.svg",
	"cloudflare-tunnel":    "svg/cloudflare.svg",
	"dashdot":              "png/dashdot.png",
	"pihole":               "svg/pi-hole.svg",
	"stalwart-mail":        "svg/stalwart.svg",
	"technitium-dns":       "svg/technitium.svg",
	"victoria-metrics":     "svg/victoriametrics.svg",
	"wud":                  "svg/whats-up-docker.svg",
	"docmost":              "",
	"linkwarden":           "",
	"passbolt":             "",
	"restic":               "",
	"scrypted":             "",
	"speedtest-tracker":    "",
}

func icon(id string) string {
	if path, ok := icons[id]; ok {
		return path
	}
	return "svg/" + id + ".svg"
}

type recipeJSON struct {
	ID          string   `json:"id"`
	Name        string   `json:"name"`
	Description string   `json:"d"`
	Apps        []string `json:"apps"`
}

func writeCatalog() error {
	cat := catalog.Default()
	apps := []appJSON{}
	for _, ap := range cat.Apps() {
		info := ap.Info()
		out := appJSON{ID: info.ID, Name: info.Name, Description: info.Description, Category: info.Category, Image: info.Image, Port: info.Port, Links: []string{}, LinkTitles: []string{}, Icon: icon(info.ID)}
		for _, link := range ap.Links() {
			out.Links = append(out.Links, link.Target)
			out.LinkTitles = append(out.LinkTitles, link.Title)
		}
		apps = append(apps, out)
	}
	recipes := []recipeJSON{}
	for _, r := range cat.Recipes() {
		recipes = append(recipes, recipeJSON{ID: r.ID, Name: r.Name, Description: r.Description, Apps: r.Apps})
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
