package tui

import (
	"fmt"
	"slices"
	"strconv"
	"strings"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/catalog"
	"github.com/ajnart/self-host/internal/service"
)

// plan is a reviewed install: what will happen, before anything is written.
type plan struct {
	privateAccess bool
	apps          []app.App
	opts          service.InstallOptions
	links         []string
	settings      map[string]string
	fresh         bool
}

// planFromAnswers turns completed answers into a reviewed install.
func planFromAnswers(backend Backend, v *answers) *plan {
	cat := backend.Catalog()
	folders := newFolderPicker(backend)
	apps := v.picks.apps(cat)
	opts := service.InstallOptions{Exposure: v.exposure, EasyNames: v.easyNames, AdminUser: v.adminUser, AdminPassword: v.adminPassword,
		Settings: map[string]string{"TZ": v.tz, "LAN_IP": v.lan, "PUID": v.puid, "PGID": v.pgid}}
	needsMedia := false
	for _, a := range apps {
		opts.Targets = append(opts.Targets, a.Info().ID)
		needsMedia = needsMedia || a.Info().UsesMedia
		for _, in := range a.Inputs() {
			if value := v.inputs[a.Info().ID+"."+in.Key]; value != nil && *value != "" {
				if in.Private {
					setPrivateInput(&opts, a.Info().ID, in.Key, *value)
					continue
				}
				opts.Sets = append(opts.Sets, a.Info().ID+"."+in.Key+"="+*value)
			}
		}
	}
	if needsMedia {
		opts.MediaRoot, opts.DownloadsRoot = folders.expand(v.media), folders.expand(v.downloads)
	}
	settings := map[string]string{"TZ": v.tz, "LAN_IP": v.lan, "PUID": v.puid, "PGID": v.pgid, "EXPOSURE": v.exposure}
	if v.easyNames {
		settings["EASY_NAMES"] = "on"
	}
	if needsMedia {
		settings["MEDIA_ROOT"], settings["DOWNLOADS_ROOT"] = folders.expand(v.media), folders.expand(v.downloads)
	}
	return &plan{apps: apps, opts: opts, links: linksBetween(cat, apps, nil), settings: settings, fresh: true}
}

func setPrivateInput(opts *service.InstallOptions, id, key, value string) {
	if opts.PrivateInputs == nil {
		opts.PrivateInputs = map[string]map[string]string{}
	}
	if opts.PrivateInputs[id] == nil {
		opts.PrivateInputs[id] = map[string]string{}
	}
	opts.PrivateInputs[id][key] = value
}

// linksBetween lists Links that will be made among apps and already installed ones.
func linksBetween(cat *catalog.Catalog, apps []app.App, installed []string) []string {
	present := map[string]bool{}
	for _, id := range installed {
		present[id] = true
	}
	for _, a := range apps {
		present[a.Info().ID] = true
	}
	var links []string
	for _, a := range cat.Apps() {
		if !present[a.Info().ID] {
			continue
		}
		for _, l := range a.Links() {
			if !present[l.Target] {
				continue
			}
			isNew := slices.ContainsFunc(apps, func(x app.App) bool { id := x.Info().ID; return id == a.Info().ID || id == l.Target })
			if isNew {
				links = append(links, a.Info().Name+" → "+targetName(cat, l.Target)+": "+l.Title)
			}
		}
	}
	return links
}

func targetName(cat *catalog.Catalog, id string) string {
	if a, found := cat.App(id); found {
		return a.Info().Name
	}
	return id
}

// renderPlan is the Catalog's review of an install.
func renderPlan(t theme, p *plan, keys string) string {
	lines := []string{"", "  " + t.title().Render("Review") + t.dim().Render("  nothing has been written yet")}
	lines = append(lines, planLines(t, p)...)
	lines = append(lines, "", "  "+t.button("enter")+t.dim().Render(" "+keys))
	return strings.Join(lines, "\n")
}

// planLines are the plan as a table: the Apps with image and port, then
// Access, settings, folders, the Admin login and the Links.
func planLines(t theme, p *plan) []string {
	lines := []string{"", "  " + t.dim().Bold(true).Render(pad("APP", 20)+pad("IMAGE", 46)+"PORT")}
	for _, a := range p.apps {
		info := a.Info()
		lines = append(lines, "  "+t.dot("ok")+" "+pad(info.Name, 18)+pad(info.Image, 46)+strconv.Itoa(info.Port))
	}
	lines = append(lines, "")
	row := func(k, v string) string { return "  " + t.dim().Render(pad(k, 10)) + t.body().Render(v) }
	access := "Home network — addresses use " + p.settings["LAN_IP"]
	if p.opts.EasyNames {
		access = "Easy names at home · addresses with numbers kept"
	}
	if p.settings["EXPOSURE"] == service.ExposureLocal {
		access = "This computer only — other devices cannot connect"
	}
	lines = append(lines, row("Access", access))
	if !p.opts.EasyNames && p.settings["EXPOSURE"] != service.ExposureLocal {
		lines = append(lines, row("", "Reachability is not verified; check from another device."))
	}
	if slices.Contains(p.opts.Targets, "tailscale") {
		lines = append(lines, row("", "From anywhere, privately, with Tailscale"))
	}
	if p.privateAccess {
		for _, a := range p.apps {
			info := a.Info()
			if info.Port > 0 && !info.NoWebUI {
				lines = append(lines, row("", "Private: "+info.Name+" (only missing nodes while Tailscale is on)"))
			}
		}
	}
	if p.fresh {
		lines = append(lines, row("Settings", fmt.Sprintf("TZ=%s PUID=%s PGID=%s", p.settings["TZ"], p.settings["PUID"], p.settings["PGID"])))
		if p.settings["MEDIA_ROOT"] != "" {
			lines = append(lines, row("Folders", "media "+p.settings["MEDIA_ROOT"]+" · downloads "+p.settings["DOWNLOADS_ROOT"]))
		}
		admin := p.opts.AdminUser + " · password generated (see it with: self-host credentials)"
		if p.opts.AdminPassword != "" {
			admin = p.opts.AdminUser + " · •••••••• your own password"
		}
		lines = append(lines, row("Admin", admin))
	}
	if len(p.links) > 0 {
		lines = append(lines, "", "  "+t.heading().Render("Links"))
		for _, l := range p.links {
			lines = append(lines, "  "+t.dim().Render("⇄ ")+t.body().Render(l))
		}
	}
	return lines
}
