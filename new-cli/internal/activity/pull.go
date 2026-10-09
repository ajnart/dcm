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
	// Fraction weighs each image by its known size. An image whose size is
	// not known yet weighs as much as the average known image, or 1 when no
	// size is known, and a done image counts whole.
	Fraction    float64
	Done, Total int
	// Pulling is true while the Action's pull stage has started and not ended.
	Pulling bool
	// Failed is true when the pull stage ended with step.fail.
	Failed bool
}

// Image is one image of a pull.
type Image struct {
	Label    string
	Fraction float64
	Done     bool
}

// pullLayer is one layer's known size and progress. Downloading covers the
// first half and Extracting the second, as Extracting restarts at 0.
type pullLayer struct {
	size     int64
	fraction float64
}

func (l *pullLayer) apply(e events.Event) {
	if e.Total > 0 {
		l.size = e.Total
	}
	share := 0.0
	if e.Total > 0 {
		share = min(float64(e.Current)/float64(e.Total), 1) / 2
	}
	switch e.Status {
	case "Downloading":
		l.fraction = max(l.fraction, share)
	case "Download complete", "Verifying Checksum":
		l.fraction = max(l.fraction, 0.5)
	case "Extracting":
		l.fraction = max(l.fraction, 0.5+share)
	case "Pull complete", "Already exists":
		l.fraction = 1
	}
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
	done := map[string]bool{}
	layers := map[string]map[string]*pullLayer{}
	for _, e := range evs {
		if e.Step == service.StagePull {
			switch e.Event {
			case events.StepStart:
				out.Pulling, out.Failed = true, false
			case events.StepFail:
				out.Pulling, out.Failed = false, true
			case events.StepOK, events.StepSkip:
				out.Pulling = false
			}
		}
		if e.Event == events.RunEnd {
			out.Pulling = false
		}
		if e.Event != events.PullProgress || e.Image == "" {
			continue
		}
		if _, ok := layers[e.Image]; !ok {
			layers[e.Image] = map[string]*pullLayer{}
			refs = append(refs, e.Image)
		}
		if e.Layer == "" {
			if e.Status == "Pulled" {
				done[e.Image] = true
			}
			continue
		}
		l, ok := layers[e.Image][e.Layer]
		if !ok {
			l = &pullLayer{}
			layers[e.Image][e.Layer] = l
		}
		l.apply(e)
	}
	sizes := make([]float64, len(refs))
	var known, knownSum float64
	for i, ref := range refs {
		img := Image{Label: imageLabel(status, ref), Done: done[ref]}
		var size, progress float64
		for _, l := range layers[ref] {
			size += float64(l.size)
			progress += float64(l.size) * l.fraction
		}
		if size > 0 {
			img.Fraction = progress / size
			known++
			knownSum += size
		}
		if img.Done {
			img.Fraction = 1
			out.Done++
		}
		sizes[i] = size
		out.Images = append(out.Images, img)
	}
	unknownWeight := 1.0
	if known > 0 {
		unknownWeight = knownSum / known
	}
	var weighted, total float64
	for i, img := range out.Images {
		weight := sizes[i]
		if weight == 0 {
			weight = unknownWeight
		}
		weighted += weight * img.Fraction
		total += weight
	}
	out.Total = len(out.Images)
	if total > 0 {
		out.Fraction = weighted / total
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
