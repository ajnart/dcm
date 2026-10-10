package e2e

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
)

// Normal CLI application bootstrap; this is not evidence of FPM's configuration.
// Output buffering discards application echo/exit output; the strict decoder also
// rejects direct STDOUT writes instead of retaining unknown bootstrap output.
const passboltEffectiveMetadataPHP = `
error_reporting(0);
ob_start(static function ($output) { return ""; });
$projection = ["bootstrap"=>"failed"];
register_shutdown_function(static function () use (&$projection) { fwrite(STDOUT, json_encode($projection, JSON_THROW_ON_ERROR)."\n"); });
try {
 if (!chdir("/usr/share/php/passbolt")) { throw new \RuntimeException(); }
 include "/etc/passbolt/requirements.php";
 require "/usr/share/php/passbolt/vendor/autoload.php";
 $app = new \App\Application("/etc/passbolt");
 $app->bootstrap();
 $app->pluginBootstrap();
 $public = \Cake\Core\Configure::read("passbolt.gpg.serverKey.public");
 $matches = is_string($public) && $public === "/etc/passbolt/gpg/serverkey.asc";
 $original = \Cake\Core\Configure::read("passbolt.originalFullBaseUrl");
 $present = is_string($original) && $original !== "";
 $fingerprint = \Cake\Core\Configure::read("passbolt.gpg.serverKey.fingerprint");
 $authClass = "unobserved";
 try {
  $auth = $app->getContainer()->get(\Authentication\AuthenticationServiceInterface::class);
  $authClass = get_class($auth) === "App\\Authenticator\\SessionAuthenticationService" ? "session" : "other";
 } catch (\Throwable $e) { $authClass = "failed"; }
 $projection = ["bootstrap"=>"initialized", "public_path_matches"=>$matches, "public_readable"=>$matches && !is_link($public) && is_file($public) && is_readable($public), "original_present"=>$present, "canonical_match"=>$present && $original === getenv("APP_FULL_BASE_URL"), "url_enforced"=>(bool)\Cake\Core\Configure::read("passbolt.security.fullBaseUrlEnforce",false), "fingerprint_present"=>is_string($fingerprint) && $fingerprint !== "", "fingerprint_valid"=>is_string($fingerprint) && preg_match('/^[A-Fa-f0-9]{40}$/D',$fingerprint) === 1, "authentication"=>$authClass];
} catch (\Throwable $e) { $projection = ["bootstrap"=>"failed"]; }
`

func passboltEffectiveMetadataReason(exit int, output []byte) string {
	if exit != 0 {
		return "owned Passbolt effective metadata unobserved: probe failed"
	}
	invalid := "owned Passbolt effective metadata unobserved: invalid fixed projection"
	if len(output) > 2048 {
		return invalid
	}
	var d struct {
		Bootstrap          string `json:"bootstrap"`
		PublicMatches      *bool  `json:"public_path_matches"`
		PublicReadable     *bool  `json:"public_readable"`
		OriginalPresent    *bool  `json:"original_present"`
		CanonicalMatch     *bool  `json:"canonical_match"`
		Enforce            *bool  `json:"url_enforced"`
		FingerprintPresent *bool  `json:"fingerprint_present"`
		FingerprintValid   *bool  `json:"fingerprint_valid"`
		Auth               string `json:"authentication"`
	}
	decoder := json.NewDecoder(bytes.NewReader(output))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&d) != nil || decoder.Decode(new(any)) != io.EOF {
		return invalid
	}
	if d.Bootstrap == "failed" && d.PublicMatches == nil && d.PublicReadable == nil && d.OriginalPresent == nil && d.CanonicalMatch == nil && d.Enforce == nil && d.FingerprintPresent == nil && d.FingerprintValid == nil && d.Auth == "" {
		return "owned Passbolt effective metadata unobserved: bootstrap failed"
	}
	if d.Bootstrap != "initialized" || d.PublicMatches == nil || d.PublicReadable == nil || d.OriginalPresent == nil || d.CanonicalMatch == nil || d.Enforce == nil || d.FingerprintPresent == nil || d.FingerprintValid == nil {
		return invalid
	}
	if (*d.PublicReadable && !*d.PublicMatches) || (*d.CanonicalMatch && !*d.OriginalPresent) || (*d.FingerprintValid && !*d.FingerprintPresent) {
		return invalid
	}
	switch d.Auth {
	case "session", "other", "failed":
	default:
		return invalid
	}
	return fmt.Sprintf("owned Passbolt effective metadata: bootstrap=initialized, configured-public-path-matches=%t, configured-public-readable=%t, original-url-present=%t, canonical-match=%t, url-enforced=%t, fingerprint-present=%t, fingerprint-valid=%t, authentication=%s", *d.PublicMatches, *d.PublicReadable, *d.OriginalPresent, *d.CanonicalMatch, *d.Enforce, *d.FingerprintPresent, *d.FingerprintValid, d.Auth)
}
