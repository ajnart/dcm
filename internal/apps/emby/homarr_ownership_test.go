package emby_test

import (
	"context"
	"errors"
	"net/http/httptest"
	"testing"

	"github.com/ajnart/self-host/internal/apps/emby"
	"github.com/ajnart/self-host/internal/helpers"
	stepstatus "github.com/ajnart/self-host/internal/status"
)

func TestSetupDoesNotAdoptAnUnownedNamedKey(t *testing.T) {
	for _, checkpoint := range []string{"", "unknown"} {
		t.Run("checkpoint="+checkpoint, func(t *testing.T) {
			fake := &fakeEmby{key: "<REDACTED-USER-KEY>"}
			srv := httptest.NewServer(fake.handler())
			t.Cleanup(srv.Close)
			var records []helpers.StepResult
			h := newH(t, srv, &records)
			if err := h.SetSecret(h.Key("homarr_key_created"), checkpoint); err != nil {
				t.Fatal(err)
			}

			for range 2 {
				if err := (emby.App{}).Setup(context.Background(), h); !errors.Is(err, helpers.ErrManual) {
					t.Fatalf("named user key needs a Manual ownership decision, got %v", err)
				}
				if emby.APIKey(h) != "" || h.Secret(h.Key("homarr_key_created")) != checkpoint {
					t.Fatal("Setup adopted the user key or changed its ownership checkpoint")
				}
				if fake.created != 0 || fake.key != "<REDACTED-USER-KEY>" {
					t.Fatal("Setup mutated a user-owned named key")
				}
			}
			last := records[len(records)-1]
			if last.ID != "homarr-api-key" || last.Status != stepstatus.StepManual {
				t.Fatal("the ownership collision should remain a retryable Manual step")
			}
		})
	}
}

type interruptedKeySave struct {
	helpers.Secrets
	interrupted bool
}

func (s *interruptedKeySave) Set(key, value string) error {
	if key == "EMBY_HOMARR_API_KEY" && !s.interrupted {
		s.interrupted = true
		return errors.New("fixture interrupted the Project credential save")
	}
	return s.Secrets.Set(key, value)
}

func TestSetupRecoversItsInterruptedKeyCreationWithoutRotation(t *testing.T) {
	fake := &fakeEmby{}
	srv := httptest.NewServer(fake.handler())
	t.Cleanup(srv.Close)
	var records []helpers.StepResult
	h := newH(t, srv, &records)
	secrets := &interruptedKeySave{Secrets: h.Secrets}
	h.Secrets = secrets
	ctx := context.Background()

	if err := (emby.App{}).Setup(ctx, h); err == nil || errors.Is(err, helpers.ErrManual) {
		t.Fatalf("the fixture should interrupt the created credential save, got %v", err)
	}
	if fake.created != 1 || emby.APIKey(h) != "" || h.Secret(h.Key("homarr_key_created")) != "pending" {
		t.Fatal("the interruption must leave one created key and its Project checkpoint")
	}
	createdKey := fake.key

	h = newH(t, srv, &records)
	h.Secrets = secrets
	for range 2 {
		if err := (emby.App{}).Setup(ctx, h); err != nil {
			t.Fatalf("resume Setup: %v", err)
		}
		if fake.created != 1 || fake.key != createdKey || emby.APIKey(h) != createdKey {
			t.Fatal("resuming should recover and reuse its created key without rotation")
		}
	}
	if err := (emby.App{}).Check(ctx, h); err != nil {
		t.Fatalf("recovered key Check: %v", err)
	}
}

func TestSetupDoesNotReplayPendingCreationWithNoKey(t *testing.T) {
	fake := &fakeEmby{}
	srv := httptest.NewServer(fake.handler())
	t.Cleanup(srv.Close)
	var records []helpers.StepResult
	h := newH(t, srv, &records)
	if err := h.SetSecret(h.Key("homarr_key_created"), "pending"); err != nil {
		t.Fatal(err)
	}
	if err := (emby.App{}).Setup(context.Background(), h); !errors.Is(err, helpers.ErrManual) {
		t.Fatalf("ambiguous creation without a listed key needs a Manual step, got %v", err)
	}
	if fake.created != 0 || emby.APIKey(h) != "" || h.Secret(h.Key("homarr_key_created")) != "pending" {
		t.Fatal("Setup replayed an ambiguous key creation or changed its checkpoint")
	}
}
