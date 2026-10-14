package e2e

import "testing"

func TestPassboltFPMMetadataProjection(t *testing.T) {
	for _, tc := range []struct {
		body string
		want string
	}{
		{`{"sapi":"fpm","euid":33,"egid":33,"profile":"php-fpm-enforced","requirements_readable":true,"requirements_open":false,"autoload_open":true,"bootstrap":"unobserved","fingerprint":"unobserved"}` + "\n", "owned Passbolt FPM metadata: sapi=fpm, euid=33, egid=33, profile=php-fpm-enforced, requirements-readable=true, requirements-open=false, autoload-open=true, bootstrap=unobserved, fingerprint=unobserved"},
		{`{"sapi":"fpm","euid":33,"egid":33,"profile":"docker-default-enforced","requirements_readable":true,"requirements_open":true,"autoload_open":true,"bootstrap":"initialized","fingerprint":"valid"}` + "\n", "owned Passbolt FPM metadata: sapi=fpm, euid=33, egid=33, profile=docker-default-enforced, requirements-readable=true, requirements-open=true, autoload-open=true, bootstrap=initialized, fingerprint=valid"},
	} {
		if got := passboltFPMMetadataReason(200, []byte(tc.body)); got != tc.want {
			t.Fatalf("projection = %q, want %q", got, tc.want)
		}
	}
	for _, body := range []string{`{}`, `{"sapi":"fpm","profile":"unconfined","requirements_readable":true,"requirements_open":true,"autoload_open":true,"bootstrap":"initialized","fingerprint":"valid"}`, `{"sapi":"fpm","euid":33,"egid":33,"profile":"php-fpm-enforced","requirements_readable":true,"requirements_open":false,"autoload_open":true,"bootstrap":"initialized","fingerprint":"valid"}`, `{"sapi":"fpm","euid":33,"egid":33,"profile":"php-fpm-enforced","requirements_readable":true,"requirements_open":true,"autoload_open":false,"bootstrap":"initialized","fingerprint":"valid"}`, `{"sapi":"fpm","euid":33,"egid":33,"profile":"php-fpm-enforced","requirements_readable":true,"requirements_open":true,"autoload_open":true,"bootstrap":"failed","fingerprint":"missing"}`, `{"sapi":"fpm","euid":33,"egid":33,"profile":"raw-profile-name","requirements_readable":true,"requirements_open":true,"autoload_open":true,"bootstrap":"initialized","fingerprint":"valid"}`, `{"sapi":"fpm","euid":33,"egid":33,"profile":"unconfined","requirements_readable":true,"requirements_open":true,"autoload_open":true,"bootstrap":"initialized","fingerprint":"valid","secret":"payload"}`} {
		if got := passboltFPMMetadataReason(200, []byte(body)); got != "owned Passbolt FPM metadata unobserved: invalid fixed projection" {
			t.Fatalf("unsafe projection accepted: %s", got)
		}
	}
}
