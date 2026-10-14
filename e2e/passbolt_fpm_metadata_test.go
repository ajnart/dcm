package e2e

import (
	"encoding/json"
	"testing"
)

func TestPassboltFPMMetadataProjection(t *testing.T) {
	for _, tc := range []struct {
		body string
		want string
	}{
		{`{"sapi":"fpm","euid":33,"egid":33,"profile":"php-fpm-enforced","requirements_readable":true,"requirements_open":false,"config_open":false,"autoload_open":true,"public_key_open":false,"bootstrap":"unobserved","fingerprint":"unobserved"}` + "\n", "owned Passbolt FPM metadata: sapi=fpm, euid=33, egid=33, profile=php-fpm-enforced, requirements-readable=true, requirements-open=false, config-open=false, autoload-open=true, public-key-open=false, bootstrap=unobserved, fingerprint=unobserved"},
		{`{"sapi":"fpm","euid":33,"egid":33,"profile":"docker-default-enforced","requirements_readable":true,"requirements_open":true,"config_open":true,"autoload_open":true,"public_key_open":true,"bootstrap":"initialized","fingerprint":"valid"}` + "\n", "owned Passbolt FPM metadata: sapi=fpm, euid=33, egid=33, profile=docker-default-enforced, requirements-readable=true, requirements-open=true, config-open=true, autoload-open=true, public-key-open=true, bootstrap=initialized, fingerprint=valid"},
	} {
		if got := passboltFPMMetadataReason(200, []byte(tc.body)); got != tc.want {
			t.Fatalf("projection = %q, want %q", got, tc.want)
		}
	}
	valid := map[string]any{
		"sapi": "fpm", "euid": 33, "egid": 33, "profile": "unconfined",
		"requirements_readable": true, "requirements_open": true,
		"config_open": true, "autoload_open": true, "public_key_open": true,
		"bootstrap": "initialized", "fingerprint": "valid",
	}
	invalid := []struct {
		name   string
		mutate func(map[string]any)
	}{
		{"missing effective uid", func(body map[string]any) { delete(body, "euid") }},
		{"missing config access", func(body map[string]any) { delete(body, "config_open") }},
		{"missing public key access", func(body map[string]any) { delete(body, "public_key_open") }},
		{"closed requirements with initialized bootstrap", func(body map[string]any) { body["requirements_open"] = false }},
		{"closed autoload with initialized bootstrap", func(body map[string]any) { body["autoload_open"] = false }},
		{"valid fingerprint with failed bootstrap", func(body map[string]any) { body["bootstrap"] = "failed" }},
		{"unknown profile", func(body map[string]any) { body["profile"] = "raw-profile-name" }},
		{"unknown field", func(body map[string]any) { body["secret"] = "payload" }},
	}
	for _, tc := range invalid {
		t.Run(tc.name, func(t *testing.T) {
			body := make(map[string]any, len(valid)+1)
			for key, value := range valid {
				body[key] = value
			}
			tc.mutate(body)
			payload, err := json.Marshal(body)
			if err != nil {
				t.Fatal(err)
			}
			if got := passboltFPMMetadataReason(200, payload); got != "owned Passbolt FPM metadata unobserved: invalid fixed projection" {
				t.Fatalf("unsafe projection accepted: %s", got)
			}
		})
	}
}
