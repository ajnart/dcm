package tracearr_test

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/ajnart/self-host/internal/apps/tracearr"
	"github.com/ajnart/self-host/internal/helpers"
)

const (
	ownedKey   = "trr_pub_synthetic_owned_key"
	ownedHash  = "85684de508bf68a70083fd77ab7a7fe13d167dd50131e9f21d6655d329dd8de6"
	ownedOwner = "a1b2c3d4-0000-4000-8000-000000000000"
)

func ownedKeyFixture(t *testing.T, version string) (*helpers.H, *int) {
	t.Helper()
	base := (&fakeTracearr{password: "adminpass"}).handler()
	regenerations := 0
	var timestamp time.Time
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/v1/settings/api-key/regenerate":
			regenerations++
			w.WriteHeader(http.StatusForbidden)
		case "/api/v1/settings/api-key":
			if r.Method != http.MethodGet || r.Header.Get("Authorization") != "Bearer bearer-for-admin" {
				w.WriteHeader(http.StatusUnauthorized)
				return
			}
			json.NewEncoder(w).Encode(map[string]string{"token": ownedKey})
		case "/api/v1/public/health":
			if r.Method != http.MethodGet || r.Header.Get("Authorization") != "Bearer "+ownedKey {
				w.WriteHeader(http.StatusUnauthorized)
				return
			}
			json.NewEncoder(w).Encode(map[string]any{
				"status": "ok", "version": version, "timestamp": timestamp,
				"servers": []any{},
			})
		case "/health":
			w.Write([]byte(`{"status":"ok","mode":"ready","db":true,"redis":true}`))
		default:
			base.ServeHTTP(w, r)
		}
	}))
	t.Cleanup(srv.Close)
	h, _ := newH(t, srv)
	timestamp = h.Now()
	h.Secrets.Set("TRACEARR_HOMARR_API_KEY", ownedKey)
	h.Secrets.Set("TRACEARR_HOMARR_API_KEY_OWNER", ownedOwner)
	h.Secrets.Set("TRACEARR_HOMARR_API_KEY_HASH", ownedHash)
	return h, &regenerations
}

func TestOwnedKeyAcceptsCatalogVersionWithoutMediaServer(t *testing.T) {
	h, regenerations := ownedKeyFixture(t, "v2.6.0")
	ctx := context.Background()
	if err := (tracearr.App{}).Setup(ctx, h); err != nil {
		t.Fatalf("Setup with the owned key: %v", err)
	}
	if err := (tracearr.App{}).Check(ctx, h); err != nil {
		t.Fatalf("Check with the owned key: %v", err)
	}
	if err := tracearr.VerifyHomarr(ctx, h); !errors.Is(err, helpers.ErrManual) || !strings.Contains(err.Error(), "no attached media server") {
		t.Fatalf("VerifyHomarr = %v, want the media-server Manual prerequisite", err)
	}
	if *regenerations != 0 || h.Secret("TRACEARR_HOMARR_API_KEY") != ownedKey || h.Secret("TRACEARR_HOMARR_API_KEY_OWNER") != ownedOwner || h.Secret("TRACEARR_HOMARR_API_KEY_HASH") != ownedHash {
		t.Fatal("existing key or ownership checkpoint changed")
	}
}

func TestHealthVersionRequiresSupportedRelease(t *testing.T) {
	for _, test := range []struct {
		name    string
		version string
		pass    bool
	}{
		{name: "unprefixed release", version: "2.6.0", pass: true},
		{name: "different release", version: "v2.6.1"},
		{name: "repeated prefix", version: "vv2.6.0"},
		{name: "prerelease", version: "v2.6.0-rc.1"},
		{name: "missing version"},
	} {
		t.Run(test.name, func(t *testing.T) {
			h, regenerations := ownedKeyFixture(t, test.version)
			ctx := context.Background()
			setupErr := (tracearr.App{}).Setup(ctx, h)
			checkErr := (tracearr.App{}).Check(ctx, h)
			if test.pass {
				if setupErr != nil || checkErr != nil {
					t.Fatalf("supported release: Setup = %v, Check = %v", setupErr, checkErr)
				}
			} else if !errors.Is(setupErr, helpers.ErrStepFailed) || checkErr == nil || !strings.Contains(checkErr.Error(), "requires Tracearr 2.6.0") {
				t.Fatalf("unsupported release: Setup = %v, Check = %v", setupErr, checkErr)
			}
			if *regenerations != 0 || h.Secret("TRACEARR_HOMARR_API_KEY") != ownedKey || h.Secret("TRACEARR_HOMARR_API_KEY_OWNER") != ownedOwner || h.Secret("TRACEARR_HOMARR_API_KEY_HASH") != ownedHash {
				t.Fatal("version verification changed the key or ownership checkpoint")
			}
		})
	}
}
