package e2e

import (
	"strings"
	"testing"
)

func TestPassboltReadinessClassificationNeverRetainsResponseText(t *testing.T) {
	cases := []struct{ body, want string }{
		{`{"header":{"message":"The OpenPGP public key information was not found in config."}}`, "Passbolt verification reports missing public-key configuration"},
		{`{"header":{"message":"The OpenPGP public key for this passbolt instance was not found."}}`, "Passbolt verification reports a missing server public-key file"},
		{`{"header":{"message":"The OpenPGP public key file '/etc/passbolt/gpg/serverkey.asc' is not readable."}}`, "Passbolt verification reports an unreadable server public-key file"},
		{`{"header":{"message":"The ` + "`App.fullBaseUrl`" + ` configuration must be a valid non-empty string."}}`, "Passbolt verification reports missing enforced base-URL configuration"},
		{`{"header":{"message":"SQL error with unknown credential payload"}}`, "Passbolt verification returned HTTP 500; cause remains unclassified. If server-key and database checks pass, ask the host administrator to verify PHP-FPM access to Passbolt bootstrap and configuration files."},
		{`<html>unknown credential payload</html>`, "Passbolt verification returned HTTP 500; cause remains unclassified. If server-key and database checks pass, ask the host administrator to verify PHP-FPM access to Passbolt bootstrap and configuration files."},
	}
	for _, c := range cases {
		got := passboltReadinessReason(500, []byte(c.body))
		if got != c.want || strings.Contains(got, "credential payload") {
			t.Fatal("readiness classification lost fixed-error boundary")
		}
	}
	if passboltReadinessReason(200, []byte(cases[0].body)) != "Passbolt verification returned an unexpected readiness status" {
		t.Fatal("non-500 response interpreted as startup failure")
	}
}
