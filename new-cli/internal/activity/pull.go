package activity

import (
	"strings"

	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/service"
)

// Pull is the image pull of one Action: the events since the last run.start,
// or every event when there is none.
type Pull struct {
	// Images are in first-seen order.
	Images []Image
	// Fraction is the mean of the image fractions, so every image weighs the
	// same whatever its size: an image without known layer sizes counts 0
	// until it is done, and a done image counts 1.
	Fraction    float64
	Done, Total int
	// Pulling is true while the Action's pull stage has started and not ended.
	Pulling bool
}

// Image is one image of a pull. Current and Size are the known bytes, kept
// for details and logs.
type Image struct {
	Ref, Label    string
	Fraction      float64
	Done          bool
	Current, Size int64
}

func buildPull(status service.Status, evs []events.Event) Pull {
	for i := len(evs) - 1; i >= 0; i-- {
		if evs[i].Event == events.RunStart {
			evs = evs[i+1:]
			break
		}
	}
	var out Pull
	var refs []string
	byRef := map[string]*Image{}
	layers := map[string]map[string]events.Event{}
	for _, e := range evs {
		if e.Step == service.StagePull {
			switch e.Event {
			case events.StepStart:
				out.Pulling = true
			case events.StepOK, events.StepFail, events.StepSkip:
				out.Pulling = false
			}
		}
		if e.Event == events.RunEnd {
			out.Pulling = false
		}
		if e.Event != events.PullProgress || e.Image == "" {
			continue
		}
		img, ok := byRef[e.Image]
		if !ok {
			img = &Image{Ref: e.Image, Label: imageLabel(status, e.Image)}
			byRef[e.Image] = img
			layers[e.Image] = map[string]events.Event{}
			refs = append(refs, e.Image)
		}
		if e.Layer == "" {
			if e.Status == "Pulled" {
				img.Done = true
			}
			continue
		}
		if e.Total > 0 {
			layers[e.Image][e.Layer] = e
		}
	}
	var sum float64
	for _, ref := range refs {
		img := byRef[ref]
		for _, e := range layers[ref] {
			img.Current += e.Current
			img.Size += e.Total
		}
		if img.Done {
			img.Current = img.Size
			img.Fraction = 1
			out.Done++
		} else if img.Size > 0 {
			img.Fraction = min(float64(img.Current)/float64(img.Size), 1)
		}
		sum += img.Fraction
		out.Images = append(out.Images, *img)
	}
	out.Total = len(out.Images)
	if out.Total > 0 {
		out.Fraction = sum / float64(out.Total)
	}
	return out
}

// imageLabel names an image by the App that runs it, else by the last
// element of its reference.
func imageLabel(status service.Status, ref string) string {
	for _, app := range status.Apps {
		if app.Image == ref && app.Name != "" {
			return app.Name
		}
	}
	if i := strings.LastIndex(ref, "/"); i >= 0 {
		return ref[i+1:]
	}
	return ref
}
