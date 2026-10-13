package e2e

import "testing"

func TestPassboltFPMMetadataProjection(t *testing.T) {
	for _, tc := range []struct {
		body string
		want string
	}{
		{`{"sapi":"fpm","requirements_open":false,"bootstrap":"unobserved","fingerprint":"unobserved"}` + "\n", "owned Passbolt FPM metadata: sapi=fpm, requirements-open=false, bootstrap=unobserved, fingerprint=unobserved"},
		{`{"sapi":"fpm","requirements_open":true,"bootstrap":"initialized","fingerprint":"valid"}` + "\n", "owned Passbolt FPM metadata: sapi=fpm, requirements-open=true, bootstrap=initialized, fingerprint=valid"},
	} {
		if got := passboltFPMMetadataReason(200, []byte(tc.body)); got != tc.want {
			t.Fatalf("projection = %q, want %q", got, tc.want)
		}
	}
	for _, body := range []string{`{}`, `{"sapi":"fpm","requirements_open":false,"bootstrap":"initialized","fingerprint":"valid"}`, `{"sapi":"fpm","requirements_open":true,"bootstrap":"failed","fingerprint":"missing"}`, `{"sapi":"fpm","requirements_open":true,"bootstrap":"initialized","fingerprint":"valid","secret":"payload"}`} {
		if got := passboltFPMMetadataReason(200, []byte(body)); got != "owned Passbolt FPM metadata unobserved: invalid fixed projection" {
			t.Fatalf("unsafe projection accepted: %s", got)
		}
	}
}
