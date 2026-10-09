package activity

import (
	"reflect"
	"testing"

	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/service"
)

func layer(image, layer, status string, current, total int64) events.Event {
	return events.Event{Event: events.PullProgress, Image: image, Layer: layer, Status: status, Current: current, Total: total}
}

func progress(image, id string, current, total int64) events.Event {
	return layer(image, id, "Downloading", current, total)
}

func pulled(image string) events.Event {
	return events.Event{Event: events.PullProgress, Image: image, Status: "Pulled"}
}

// Expected fractions are worked by hand. A layer counts ½·current/total while
// Downloading and ½ + ½·current/total while Extracting; an image weighs its
// layers by size, and the pull weighs its images by size.
func TestActivityPull(t *testing.T) {
	const (
		jellyfin = "lscr.io/linuxserver/jellyfin:latest"
		sonarr   = "lscr.io/linuxserver/sonarr:latest"
		radarr   = "radarr"
		tiny     = "busybox:1.36.1"
		huge     = "ghcr.io/big/model:latest"
	)
	status := service.Status{Apps: []service.AppStatus{{ID: "jellyfin", Name: "Jellyfin", Image: jellyfin, Managed: true}}}
	start := []events.Event{{Event: events.RunStart}, {Event: events.StepStart, Step: "pull", Msg: "pull 3 images"}}
	for _, tc := range []struct {
		name string
		evs  []events.Event
		want Pull
	}{
		{
			// Jellyfin: a 64/128 → ¼, b 32/128 → ⅛; (128·¼ + 128·⅛)/256 = 48/256 = 0.1875.
			// Sonarr: 128/256 → ¼. Overall (256·0.1875 + 256·¼)/512 = 112/512 = 0.21875.
			name: "several images weigh their known sizes",
			evs: append(start,
				progress(jellyfin, "a", 16, 128),
				progress(jellyfin, "b", 32, 128),
				progress(sonarr, "a", 128, 256),
				progress(jellyfin, "a", 64, 128),
			),
			want: Pull{Pulling: true, Fraction: 0.21875, Done: 0, Total: 2, Images: []Image{
				{Label: "Jellyfin", Fraction: 0.1875},
				{Label: "sonarr:latest", Fraction: 0.25},
			}},
		},
		{
			// Sonarr 50/100 → ¼ at weight 100; radarr has no known size, so it
			// weighs the average known image, 100. (100·¼ + 100·0)/200 = 0.125.
			name: "unknown size weighs the average known image",
			evs: append(start,
				layer(radarr, "a", "Pulling fs layer", 0, 0),
				progress(sonarr, "a", 50, 100),
			),
			want: Pull{Pulling: true, Fraction: 0.125, Done: 0, Total: 2, Images: []Image{
				{Label: "radarr", Fraction: 0},
				{Label: "sonarr:latest", Fraction: 0.25},
			}},
		},
		{
			// Radarr done counts 1 at weight 100: (100·1 + 100·¼)/200 = 0.625.
			name: "unknown size done counts whole",
			evs: append(start,
				layer(radarr, "a", "Pulling fs layer", 0, 0),
				progress(sonarr, "a", 50, 100),
				pulled(radarr),
			),
			want: Pull{Pulling: true, Fraction: 0.625, Done: 1, Total: 2, Images: []Image{
				{Label: "radarr", Fraction: 1, Done: true},
				{Label: "sonarr:latest", Fraction: 0.25},
			}},
		},
		{
			// Nothing known: every image weighs 1. Radarr done: (1 + 0)/2 = 0.5.
			name: "no known size weighs every image the same",
			evs: append(start,
				layer(radarr, "a", "Pulling fs layer", 0, 0),
				layer(sonarr, "a", "Waiting", 0, 0),
				pulled(radarr),
			),
			want: Pull{Pulling: true, Fraction: 0.5, Done: 1, Total: 2, Images: []Image{
				{Label: "radarr", Fraction: 1, Done: true},
				{Label: "sonarr:latest", Fraction: 0},
			}},
		},
		{
			// Jellyfin 100/100 downloaded → ½ at 100; Sonarr done at 300.
			// (100·½ + 300·1)/400 = 350/400 = 0.875.
			name: "out-of-order finishing keeps first-seen order",
			evs: append(start,
				progress(jellyfin, "a", 10, 100),
				layer(sonarr, "a", "Extracting", 30, 300),
				progress(jellyfin, "a", 100, 100),
				layer(sonarr, "a", "Extracting", 300, 300),
				layer(sonarr, "a", "Pull complete", 0, 0),
				pulled(sonarr),
			),
			want: Pull{Pulling: true, Fraction: 0.875, Done: 1, Total: 2, Images: []Image{
				{Label: "Jellyfin", Fraction: 0.5},
				{Label: "sonarr:latest", Fraction: 1, Done: true},
			}},
		},
		{
			// Tiny 1024 done; huge 1047552 at 523776 downloaded → ¼.
			// (1024·1 + 1047552·¼)/1048576 = 262912/1048576 = 0.250732421875.
			name: "one tiny and one huge image",
			evs: append(start,
				layer(tiny, "a", "Extracting", 1024, 1024),
				layer(tiny, "a", "Pull complete", 0, 0),
				pulled(tiny),
				progress(huge, "a", 523776, 1047552),
			),
			want: Pull{Pulling: true, Fraction: 0.250732421875, Done: 1, Total: 2, Images: []Image{
				{Label: "busybox:1.36.1", Fraction: 1, Done: true},
				{Label: "model:latest", Fraction: 0.25},
			}},
		},
		{
			name: "finished pull stays visible",
			evs: append(start,
				progress(sonarr, "a", 100, 100),
				pulled(sonarr),
				events.Event{Event: events.StepOK, Step: "pull", Msg: "pulled sonarr"},
				events.Event{Event: events.StepStart, App: "sonarr", Step: "ready"},
			),
			want: Pull{Fraction: 1, Done: 1, Total: 1, Images: []Image{
				{Label: "sonarr:latest", Fraction: 1, Done: true},
			}},
		},
		{
			name: "failed pull records the failure",
			evs: append(start,
				progress(sonarr, "a", 50, 100),
				pulled(jellyfin),
				events.Event{Event: events.StepFail, App: "sonarr", Step: "pull", Error: "manifest unknown"},
				events.Event{Event: events.StepFail, Step: "pull", Error: "manifest unknown"},
				events.Event{Event: events.RunEnd, Error: "manifest unknown"},
			),
			want: Pull{Failed: true, Fraction: 0.625, Done: 1, Total: 2, Images: []Image{
				{Label: "sonarr:latest", Fraction: 0.25},
				{Label: "Jellyfin", Fraction: 1, Done: true},
			}},
		},
		{
			name: "interrupted pull is not a failure",
			evs: append(start,
				progress(sonarr, "a", 50, 100),
				events.Event{Event: events.RunEnd, Error: "interrupted"},
			),
			want: Pull{Fraction: 0.25, Done: 0, Total: 1, Images: []Image{
				{Label: "sonarr:latest", Fraction: 0.25},
			}},
		},
		{
			name: "new run resets the pull",
			evs: append(append(start,
				progress(sonarr, "a", 100, 100),
				pulled(sonarr),
				events.Event{Event: events.StepFail, Step: "pull"},
				events.Event{Event: events.RunEnd, Msg: "done"},
			), start[0], start[1], progress(jellyfin, "a", 0, 100)),
			want: Pull{Pulling: true, Fraction: 0, Done: 0, Total: 1, Images: []Image{
				{Label: "Jellyfin", Fraction: 0},
			}},
		},
		{
			name: "without a run start every event counts",
			evs: []events.Event{
				{Event: events.StepStart, App: "jellyfin", Step: "pull"},
				progress(jellyfin, "a", 50, 100),
			},
			want: Pull{Pulling: true, Fraction: 0.25, Done: 0, Total: 1, Images: []Image{
				{Label: "Jellyfin", Fraction: 0.25},
			}},
		},
		{
			name: "no pull at all",
			evs: []events.Event{
				{Event: events.RunStart},
				{Event: events.StepOK, App: "jellyfin", Step: "ready"},
			},
			want: Pull{},
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got := Build(status, tc.evs).Pull
			if !reflect.DeepEqual(got, tc.want) {
				t.Fatalf("pull =\n%+v\nwant\n%+v", got, tc.want)
			}
		})
	}
}

// The sequence follows internal/compose/testdata/pull.jsonl: each layer
// downloads, verifies, then extracts from 0 again with the same total.
func TestActivityPullNeverGoesBackwards(t *testing.T) {
	const image = "busybox:1.36.1"
	evs := []events.Event{
		{Event: events.RunStart},
		{Event: events.StepStart, Step: "pull"},
		layer(image, "821d", "Pulling fs layer", 0, 0),
		layer(image, "9a3f", "Pulling fs layer", 0, 0),
		layer(image, "9a3f", "Downloading", 1000, 400000),
		layer(image, "821d", "Downloading", 32124, 1896265),
		layer(image, "821d", "Downloading", 1200000, 1896265),
		layer(image, "9a3f", "Downloading", 400000, 400000),
		layer(image, "9a3f", "Verifying Checksum", 0, 0),
		layer(image, "9a3f", "Download complete", 0, 0),
		layer(image, "821d", "Downloading", 1896265, 1896265),
		layer(image, "821d", "Verifying Checksum", 0, 0),
		layer(image, "821d", "Download complete", 0, 0),
		layer(image, "821d", "Extracting", 32768, 1896265),
		layer(image, "821d", "Extracting", 1896265, 1896265),
		layer(image, "821d", "Pull complete", 0, 0),
		layer(image, "9a3f", "Extracting", 0, 400000),
		layer(image, "9a3f", "Extracting", 400000, 400000),
		layer(image, "9a3f", "Pull complete", 0, 0),
		pulled(image),
	}
	var image0, overall float64
	for i := range evs {
		pull := Build(service.Status{}, evs[:i+1]).Pull
		if len(pull.Images) == 0 {
			continue
		}
		if pull.Images[0].Fraction < image0 || pull.Fraction < overall {
			t.Fatalf("after %s %s the bar went back: image %v → %v, overall %v → %v",
				evs[i].Layer, evs[i].Status, image0, pull.Images[0].Fraction, overall, pull.Fraction)
		}
		image0, overall = pull.Images[0].Fraction, pull.Fraction
	}
	if image0 != 1 || overall != 1 {
		t.Fatalf("finished pull = image %v, overall %v; want 1 and 1", image0, overall)
	}
}
