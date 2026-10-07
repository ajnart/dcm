package e2e

import "encoding/json"

// Only fixed messages from pinned AuthVerifyController/base-URL middleware become evidence.
// Unknown Cake errors, HTML, trace data and arbitrary paths remain private.
func passboltReadinessReason(status int, body []byte) string {
	if status != 500 {
		return "Passbolt verification returned an unexpected readiness status"
	}
	generic := "Passbolt verification returned HTTP 500; cause remains unclassified. If server-key and database checks pass, ask the host administrator to verify PHP-FPM access to Passbolt bootstrap and configuration files."
	if len(body) > 16<<10 {
		return generic
	}
	var response struct{ Header struct{ Message string } }
	if json.Unmarshal(body, &response) != nil {
		return generic
	}
	switch response.Header.Message {
	case "The `App.fullBaseUrl` configuration must be a valid non-empty string.":
		return "Passbolt verification reports missing enforced base-URL configuration"
	case "The OpenPGP public key information was not found in config.":
		return "Passbolt verification reports missing public-key configuration"
	case "The OpenPGP public key for this passbolt instance was not found.":
		return "Passbolt verification reports a missing server public-key file"
	case "The OpenPGP public key file '/etc/passbolt/gpg/serverkey.asc' is not readable.", "The OpenPGP public key file '/usr/share/php/passbolt/config/gpg/serverkey.asc' is not readable.":
		return "Passbolt verification reports an unreadable server public-key file"
	default:
		return generic
	}
}
