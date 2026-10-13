package helpers_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/ajnart/self-host/internal/helpers"
	"github.com/ajnart/self-host/internal/status"
)

func keyServer(t *testing.T, header, want string) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/probe" || r.Header.Get(header) != want {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		w.WriteHeader(http.StatusOK)
	}))
	t.Cleanup(srv.Close)
	return srv
}

func spec(discover func(context.Context, *helpers.H) (string, error)) helpers.APIKey {
	return helpers.APIKey{
		Msg:        "read the Demo API key",
		Hint:       "Copy the key.",
		Credential: "admin",
		Scheme:     helpers.KeyScheme{Header: "X-Api-Key"},
		Probe:      "/probe",
		Discover:   discover,
	}
}

func fixedKey(key string, calls *int) func(context.Context, *helpers.H) (string, error) {
	return func(context.Context, *helpers.H) (string, error) {
		*calls++
		return key, nil
	}
}

func TestAPIKeyStepStoresTheDiscoveredKeyOnceTheAppAcceptsIt(t *testing.T) {
	srv := keyServer(t, "X-Api-Key", "k-123")
	var results []helpers.StepResult
	h := newH(t, srv, nil, &results)
	discovered := 0

	err := h.APIKeyStep(context.Background(), spec(fixedKey("k-123", &discovered)))

	if err != nil {
		t.Fatalf("KeyStep: %v", err)
	}
	if got := h.Secret("DEMO_API_KEY"); got != "k-123" {
		t.Errorf("stored key = %q, want k-123", got)
	}
	if len(results) != 1 || results[0].ID != "api-key" || results[0].Status != status.StepOK || results[0].Msg != "read the Demo API key" {
		t.Errorf("results = %+v, want one OK api-key step", results)
	}
}

func TestAPIKeyStepSkipsWhenTheStoredKeyIsAlreadyAccepted(t *testing.T) {
	srv := keyServer(t, "X-Api-Key", "k-123")
	var results []helpers.StepResult
	h := newH(t, srv, nil, &results)
	if err := h.SetSecret("DEMO_API_KEY", "k-123"); err != nil {
		t.Fatal(err)
	}
	discovered := 0

	if err := h.APIKeyStep(context.Background(), spec(fixedKey("other", &discovered))); err != nil {
		t.Fatalf("KeyStep: %v", err)
	}

	if discovered != 0 {
		t.Errorf("Discover ran %d times, want 0 for an accepted key", discovered)
	}
	if len(results) != 1 || results[0].Status != status.StepSkip {
		t.Errorf("results = %+v, want one skipped step", results)
	}
}

func TestAPIKeyStepReplacesAStoredKeyTheAppRejects(t *testing.T) {
	srv := keyServer(t, "X-Api-Key", "fresh")
	h := newH(t, srv, nil, nil)
	if err := h.SetSecret("DEMO_API_KEY", "stale"); err != nil {
		t.Fatal(err)
	}
	discovered := 0

	if err := h.APIKeyStep(context.Background(), spec(fixedKey("fresh", &discovered))); err != nil {
		t.Fatalf("KeyStep: %v", err)
	}

	if got := h.Secret("DEMO_API_KEY"); got != "fresh" {
		t.Errorf("stored key = %q, want fresh", got)
	}
}

func TestAPIKeyStepSendsTheKeyInTheSchemeHeaderVerbatim(t *testing.T) {
	srv := keyServer(t, "Authorization", `Scheme Id="x", Token="k-123"`)
	h := newH(t, srv, nil, nil)
	step := spec(fixedKey("k-123", new(int)))
	step.Scheme = helpers.KeyScheme{Header: "Authorization", Prefix: `Scheme Id="x", Token="`, Suffix: `"`}

	if err := h.APIKeyStep(context.Background(), step); err != nil {
		t.Fatalf("KeyStep: %v", err)
	}
}

func TestAPIKeyStepFailsWithTheHintWhenTheAppRejectsTheDiscoveredKey(t *testing.T) {
	srv := keyServer(t, "X-Api-Key", "right")
	var results []helpers.StepResult
	h := newH(t, srv, nil, &results)

	err := h.APIKeyStep(context.Background(), spec(fixedKey("wrong", new(int))))

	if err == nil {
		t.Fatal("KeyStep succeeded with a key the App rejects")
	}
	if len(results) != 1 || results[0].Status != status.StepFail || results[0].Hint != "Copy the key." {
		t.Errorf("results = %+v, want one failed step carrying the hint", results)
	}
}

func TestAPIKeyStepFailsWhenDiscoveryFails(t *testing.T) {
	srv := keyServer(t, "X-Api-Key", "k")
	var results []helpers.StepResult
	h := newH(t, srv, nil, &results)

	err := h.APIKeyStep(context.Background(), spec(func(context.Context, *helpers.H) (string, error) {
		return "", os.ErrNotExist
	}))

	if err == nil || !strings.Contains(err.Error(), "api-key") {
		t.Fatalf("err = %v, want an api-key step failure", err)
	}
	if h.Secret("DEMO_API_KEY") != "" {
		t.Error("a key was stored although discovery failed")
	}
}

func TestAPIKeyAcceptedIsFalseWithoutAStoredKey(t *testing.T) {
	calls := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { calls++ }))
	defer srv.Close()
	h := newH(t, srv, nil, nil)

	ok, err := h.APIKeyAccepted(context.Background(), spec(nil))

	if ok || err != nil || calls != 0 {
		t.Errorf("KeyAccepted = %v, %v after %d requests; want false, nil, 0", ok, err, calls)
	}
}

func TestConfigKeyDiscoversTheKeyFromTheAppsConfigFile(t *testing.T) {
	dir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(dir, "config"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "config", "config.xml"), []byte("<Config><ApiKey>from-file</ApiKey></Config>"), 0o600); err != nil {
		t.Fatal(err)
	}
	h := newH(t, nil, nil, nil)
	h.Dir = dir

	key, err := helpers.ConfigKey(filepath.Join("config", "config.xml"), helpers.XMLElement("ApiKey"), time.Minute)(context.Background(), h)

	if err != nil || key != "from-file" {
		t.Errorf("ConfigKey = %q, %v; want from-file", key, err)
	}
}
