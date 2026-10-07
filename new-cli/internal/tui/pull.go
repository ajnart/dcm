package tui

import (
	"fmt"

	"github.com/ajnart/self-host/internal/events"
)

type pullImage struct {
	image   string
	current int64
	total   int64
	done    bool
}

func (p pullImage) percent() int {
	if p.done {
		return 100
	}
	if p.total <= 0 {
		return 0
	}
	pct := int(p.current * 100 / p.total)
	if pct > 100 {
		pct = 100
	}
	return pct
}

// pullImages aggregates a task's pull.progress events per image, keeping the
// newest byte counts per layer. Order is first seen.
func pullImages(evs []events.Event) []pullImage {
	var order []string
	byImage := map[string]*pullImage{}
	layers := map[string]map[string]events.Event{}
	for _, e := range evs {
		if e.Event != events.PullProgress || e.Image == "" {
			continue
		}
		img, ok := byImage[e.Image]
		if !ok {
			img = &pullImage{image: e.Image}
			byImage[e.Image] = img
			layers[e.Image] = map[string]events.Event{}
			order = append(order, e.Image)
		}
		if e.Layer == "" {
			if e.Status == "Pulled" {
				img.done = true
			}
			continue
		}
		if e.Total > 0 {
			layers[e.Image][e.Layer] = e
		}
	}
	out := make([]pullImage, 0, len(order))
	for _, name := range order {
		img := byImage[name]
		for _, e := range layers[name] {
			img.current += e.Current
			img.total += e.Total
		}
		if img.done && img.total > 0 {
			img.current = img.total
		}
		out = append(out, *img)
	}
	return out
}

// pullTotals is the whole-task progress: image count, overall percent and bytes.
func pullTotals(evs []events.Event) (int, int, int64, int64, bool) {
	images := pullImages(evs)
	if len(images) == 0 {
		return 0, 0, 0, 0, false
	}
	var current, total int64
	for _, img := range images {
		current += img.current
		total += img.total
	}
	pct := 0
	if total > 0 {
		pct = int(current * 100 / total)
	}
	return len(images), pct, current, total, true
}

// pullMB renders bytes as whole megabytes.
func pullMB(n int64) string { return fmt.Sprintf("%d MB", n/1_000_000) }

// pullPercent is the running task's overall pull percentage.
func (m Model) pullPercent() (int, bool) {
	task := m.tasks.latest()
	if task == nil {
		return 0, false
	}
	t := task.snapshot()
	if t.state != taskRunning {
		return 0, false
	}
	_, pct, _, _, ok := pullTotals(t.events)
	return pct, ok
}
