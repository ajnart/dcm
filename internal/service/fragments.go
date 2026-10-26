package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"reflect"
	"slices"
	"strings"

	"go.yaml.in/yaml/v3"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/project"
)

func fragmentSum(data []byte) string {
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}

// writeFragment writes an App's compose.yml and records what was written.
func (ss *session) writeFragment(id, content string) error {
	if err := ss.p.WriteFragment(id, content); err != nil {
		return err
	}
	if st := ss.state.Apps[id]; st != nil {
		st.FragmentSHA256 = fragmentSum([]byte(project.FragmentHeader(id) + content))
	}
	return nil
}

// generatedUnmodified reports whether the compose.yml on disk is still what
// self-host wrote. Without a recorded hash, it must carry the generated header
// and equal the current render or differ from it only in image tags.
func generatedUnmodified(id string, st *project.AppState, data []byte, current string, legacy ...string) bool {
	if st != nil && st.FragmentSHA256 != "" {
		return fragmentSum(data) == st.FragmentSHA256
	}
	header := project.FragmentHeader(id)
	text := string(data)
	if !strings.HasPrefix(text, header) {
		return false
	}
	if text == header+current {
		return true
	}
	body := strings.TrimPrefix(text, header)
	if slices.Contains(legacy, body) {
		return true
	}
	return sameExceptImageTags(body, current)
}

func legacyComposes(a app.App, rc app.RenderContext) []string {
	if legacy, ok := a.(app.LegacyComposer); ok {
		return legacy.LegacyComposes(rc)
	}
	return nil
}

func sameExceptImageTags(a, b string) bool {
	var left, right any
	if yaml.Unmarshal([]byte(a), &left) != nil || yaml.Unmarshal([]byte(b), &right) != nil {
		return false
	}
	return reflect.DeepEqual(stripImageTags(left), stripImageTags(right))
}

func stripImageTags(v any) any {
	doc, ok := v.(map[string]any)
	if !ok {
		return v
	}
	services, ok := doc["services"].(map[string]any)
	if !ok {
		return v
	}
	stripped := make(map[string]any, len(services))
	for name, value := range services {
		service, ok := value.(map[string]any)
		if !ok {
			stripped[name] = value
			continue
		}
		copied := make(map[string]any, len(service))
		for key, field := range service {
			if text, ok := field.(string); ok && key == "image" {
				field = imageRepository(text)
			}
			copied[key] = field
		}
		stripped[name] = copied
	}
	out := make(map[string]any, len(doc))
	for key, value := range doc {
		out[key] = value
	}
	out["services"] = stripped
	return out
}

func imageRepository(image string) string {
	image, _, _ = strings.Cut(image, "@")
	slash := strings.LastIndex(image, "/")
	if colon := strings.LastIndex(image, ":"); colon > slash {
		return image[:colon]
	}
	return image
}

// renderApp renders an installed catalog App's Compose with the Project's
// current settings, port and inputs, as install does.
func (ss *session) renderApp(ctx context.Context, a app.App, st *project.AppState) (string, app.RenderContext, error) {
	id := a.Info().ID
	inputs := map[string]string{}
	for key, value := range st.Inputs {
		inputs[key] = value
	}
	for _, input := range a.Inputs() {
		if input.Private {
			inputs[input.Key] = ss.secrets.Get(SecretKey(id, input.Key))
		}
	}
	rc, err := ss.s.renderContext(ctx, a, st.Port, inputs, ss.settings)
	if err != nil {
		return "", rc, err
	}
	return a.Compose(rc), rc, nil
}

// refreshFragments rewrites the generated, unmodified compose.yml of each
// targeted catalog App whose render changed with this self-host version, and
// the Tailscale App's, which install and remove always rewrite.
func (ss *session) refreshFragments(ctx context.Context, ids []string) error {
	ss.refreshed = nil
	type pending struct {
		a        app.App
		rc       app.RenderContext
		fragment string
	}
	var stale []string
	pendings := map[string]pending{}
	for _, id := range ids {
		a, found := ss.s.Catalog.App(id)
		st := ss.state.Apps[id]
		if !found || st == nil || ss.p.IsExtra(id) || id == tailscaleID {
			continue
		}
		fragment, rc, err := ss.renderApp(ctx, a, st)
		if err != nil {
			return err
		}
		data, err := ss.p.ReadFragment(id)
		if err != nil {
			return err
		}
		if string(data) == project.FragmentHeader(id)+fragment {
			if st.FragmentSHA256 == "" {
				st.FragmentSHA256 = fragmentSum(data)
			}
			continue
		}
		if !generatedUnmodified(id, st, data, fragment, legacyComposes(a, rc)...) {
			ss.s.Log.Emit(events.Event{Event: events.Info, App: id, Step: "refresh",
				Msg:  id + "'s Compose differs from this self-host version's, so it keeps its own images and settings",
				Hint: "Run self-host install " + id + " --yes to rewrite it for this self-host version."})
			continue
		}
		if err := ss.p.ValidateFragment(id, fragment); err != nil {
			return fmt.Errorf("%s: the Compose for this self-host version is not valid: %w", id, err)
		}
		stale = append(stale, id)
		pendings[id] = pending{a, rc, fragment}
	}
	for _, id := range stale {
		next := pendings[id]
		if err := ss.ensureSecrets(next.a); err != nil {
			return errors.Join(err, ss.p.SaveState(ss.state))
		}
		if err := ss.writeFiles(next.a, next.rc); err != nil {
			return errors.Join(err, ss.p.SaveState(ss.state))
		}
		if err := ss.writeFragment(id, next.fragment); err != nil {
			return errors.Join(err, ss.p.SaveState(ss.state))
		}
		ss.refreshed = append(ss.refreshed, id)
		ss.s.Log.Emit(events.Event{Event: events.Info, App: id, Step: "refresh",
			Msg: "refreshed " + next.a.Info().Name + "'s Compose for this self-host version"})
	}
	if slices.Contains(ids, tailscaleID) {
		changed, err := ss.renderTailscale()
		if err != nil {
			return errors.Join(err, ss.p.SaveState(ss.state))
		}
		if changed {
			ss.refreshed = append(ss.refreshed, tailscaleID)
			ss.s.Log.Emit(events.Event{Event: events.Info, App: tailscaleID, Step: "refresh",
				Msg: "refreshed Tailscale's Compose for this self-host version"})
		}
	}
	slices.Sort(ss.refreshed)
	return nil
}
