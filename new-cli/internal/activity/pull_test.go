package activity

import (
	"reflect"
	"testing"

	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/service"
)

func progress(image, layer string, current, total int64) events.Event {
	return events.Event{Event: events.PullProgress, Image: image, Layer: layer, Status: "Downloading", Current: current, Total: total}
}

func pulled(image string) events.Event {
	return events.Event{Event: events.PullProgress, Image: image, Status: "Pulled"}
}

func TestActivityPull(t *testing.T) {
	const (
		jellyfin = "lscr.io/linuxserver/jellyfin:latest"
		sonarr   = "lscr.io/linuxserver/sonarr:latest"
		radarr   = "radarr"
	)
	status := service.Status{Apps: []service.AppStatus{{ID: "jellyfin", Name: "Jellyfin", Image: jellyfin, Managed: true}}}
	start := []events.Event{{Event: events.RunStart}, {Event: events.StepStart, Step: "pull", Msg: "pull 3 images"}}
	for _, tc := range []struct {
		name string
		evs  []events.Event
		want Pull
	}{
		{
			name: "several images",
			evs: append(start,
				progress(jellyfin, "a", 10, 100),
				progress(jellyfin, "b", 25, 100),
				progress(sonarr, "a", 100, 400),
				progress(jellyfin, "a", 50, 100),
			),
			want: Pull{Pulling: true, Fraction: 0.3125, Done: 0, Total: 2, Images: []Image{
				{Ref: jellyfin, Label: "Jellyfin", Fraction: 0.375, Current: 75, Size: 200},
				{Ref: sonarr, Label: "sonarr:latest", Fraction: 0.25, Current: 100, Size: 400},
			}},
		},
		{
			name: "unknown size counts nothing until done",
			evs: append(start,
				progress(radarr, "a", 30, 0),
				progress(sonarr, "a", 50, 100),
			),
			want: Pull{Pulling: true, Fraction: 0.25, Done: 0, Total: 2, Images: []Image{
				{Ref: radarr, Label: "radarr", Fraction: 0},
				{Ref: sonarr, Label: "sonarr:latest", Fraction: 0.5, Current: 50, Size: 100},
			}},
		},
		{
			name: "unknown size done counts whole",
			evs: append(start,
				progress(radarr, "a", 30, 0),
				progress(sonarr, "a", 50, 100),
				pulled(radarr),
			),
			want: Pull{Pulling: true, Fraction: 0.75, Done: 1, Total: 2, Images: []Image{
				{Ref: radarr, Label: "radarr", Fraction: 1, Done: true},
				{Ref: sonarr, Label: "sonarr:latest", Fraction: 0.5, Current: 50, Size: 100},
			}},
		},
		{
			name: "out-of-order finishing keeps first-seen order",
			evs: append(start,
				progress(jellyfin, "a", 25, 100),
				progress(sonarr, "a", 10, 100),
				progress(sonarr, "a", 100, 100),
				pulled(sonarr),
			),
			want: Pull{Pulling: true, Fraction: 0.625, Done: 1, Total: 2, Images: []Image{
				{Ref: jellyfin, Label: "Jellyfin", Fraction: 0.25, Current: 25, Size: 100},
				{Ref: sonarr, Label: "sonarr:latest", Fraction: 1, Done: true, Current: 100, Size: 100},
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
				{Ref: sonarr, Label: "sonarr:latest", Fraction: 1, Done: true, Current: 100, Size: 100},
			}},
		},
		{
			name: "new run resets the pull",
			evs: append(append(start,
				progress(sonarr, "a", 100, 100),
				pulled(sonarr),
				events.Event{Event: events.StepOK, Step: "pull"},
				events.Event{Event: events.RunEnd, Msg: "done"},
			), start[0], start[1], progress(jellyfin, "a", 0, 100)),
			want: Pull{Pulling: true, Fraction: 0, Done: 0, Total: 1, Images: []Image{
				{Ref: jellyfin, Label: "Jellyfin", Fraction: 0, Size: 100},
			}},
		},
		{
			name: "without a run start every event counts",
			evs: []events.Event{
				{Event: events.StepStart, App: "jellyfin", Step: "pull"},
				progress(jellyfin, "a", 50, 100),
			},
			want: Pull{Pulling: true, Fraction: 0.5, Done: 0, Total: 1, Images: []Image{
				{Ref: jellyfin, Label: "Jellyfin", Fraction: 0.5, Current: 50, Size: 100},
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
