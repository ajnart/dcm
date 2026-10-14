package e2e

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
)

// Served only by the owned fixture through Passbolt's existing PHP-FPM path.
// It reads fixed public bootstrap paths and process metadata, then emits only
// bounded identifiers, booleans and state enums.
const passboltFPMMetadataPHP = `<?php
error_reporting(0);
header('Content-Type: application/json');
$status = @file_get_contents('/proc/self/status');
$euid = -1;
$egid = -1;
if (is_string($status) && preg_match('/^Uid:\s+\d+\s+(\d+)/m', $status, $uid_match) === 1) { $euid = (int)$uid_match[1]; }
if (is_string($status) && preg_match('/^Gid:\s+\d+\s+(\d+)/m', $status, $gid_match) === 1) { $egid = (int)$gid_match[1]; }
$profile_raw = @file_get_contents('/proc/self/attr/current');
$profile = 'unobserved';
if (is_string($profile_raw)) {
 $profile_raw = trim($profile_raw);
 if ($profile_raw === 'unconfined') { $profile = 'unconfined'; }
 elseif (preg_match('/^(php-fpm|php_fpm_enforce)(\/\/[^ ]+)? \(enforce\)$/D', $profile_raw) === 1) { $profile = 'php-fpm-enforced'; }
 elseif ($profile_raw === 'docker-default (enforce)') { $profile = 'docker-default-enforced'; }
 elseif (str_ends_with($profile_raw, ' (enforce)')) { $profile = 'other-enforced'; }
 else { $profile = 'other'; }
}
$open = static function(string $path): bool {
 $handle = @fopen($path, 'rb');
 if ($handle === false) { return false; }
 fclose($handle);
 return true;
};
$sapi = 'other';
if (str_starts_with(PHP_SAPI, 'fpm')) { $sapi = 'fpm'; }
$data = [
 'sapi'=>$sapi, 'euid'=>$euid, 'egid'=>$egid, 'profile'=>$profile,
 'requirements_readable'=>is_readable('/etc/passbolt/requirements.php'),
 'requirements_open'=>false,
 'config_open'=>$open('/etc/passbolt/passbolt.php'),
 'autoload_open'=>$open('/usr/share/php/passbolt/vendor/autoload.php'),
 'public_key_open'=>$open('/etc/passbolt/gpg/serverkey.asc'),
 'bootstrap'=>'unobserved', 'fingerprint'=>'unobserved'
];
$handle = fopen('/etc/passbolt/requirements.php', 'rb');
if ($handle === false) { echo json_encode($data, JSON_THROW_ON_ERROR), "\n"; exit; }
fclose($handle);
$data['requirements_open'] = true;
try {
 chdir('/usr/share/php/passbolt');
 include '/etc/passbolt/requirements.php';
 require '/usr/share/php/passbolt/vendor/autoload.php';
 $app = new \App\Application('/etc/passbolt');
 $app->bootstrap();
 $app->pluginBootstrap();
 $data['bootstrap'] = 'initialized';
 $fingerprint = \Cake\Core\Configure::read('passbolt.gpg.serverKey.fingerprint');
 $data['fingerprint'] = !is_string($fingerprint) || $fingerprint === '' ? 'missing' : (preg_match('/^[A-Fa-f0-9]{40}$/D', $fingerprint) === 1 ? 'valid' : 'invalid');
} catch (\Throwable $e) { $data['bootstrap'] = 'failed'; }
echo json_encode($data, JSON_THROW_ON_ERROR), "\n";
`

func passboltFPMMetadataReason(status int, output []byte) string {
	invalid := "owned Passbolt FPM metadata unobserved: invalid fixed projection"
	if status != 200 || len(output) > 2048 {
		return invalid
	}
	var doc struct {
		SAPI             string `json:"sapi"`
		EUID             *int64 `json:"euid"`
		EGID             *int64 `json:"egid"`
		Profile          string `json:"profile"`
		RequirementsRead *bool  `json:"requirements_readable"`
		RequirementsOpen *bool  `json:"requirements_open"`
		ConfigOpen       *bool  `json:"config_open"`
		AutoloadOpen     *bool  `json:"autoload_open"`
		PublicKeyOpen    *bool  `json:"public_key_open"`
		Bootstrap        string `json:"bootstrap"`
		Fingerprint      string `json:"fingerprint"`
	}
	decoder := json.NewDecoder(bytes.NewReader(output))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&doc) != nil || decoder.Decode(new(any)) != io.EOF || doc.RequirementsRead == nil || doc.RequirementsOpen == nil || doc.ConfigOpen == nil || doc.AutoloadOpen == nil || doc.PublicKeyOpen == nil {
		return invalid
	}
	if doc.EUID == nil || doc.EGID == nil || *doc.EUID < 0 || *doc.EUID > 4294967295 || *doc.EGID < 0 || *doc.EGID > 4294967295 {
		return invalid
	}
	if doc.SAPI != "fpm" && doc.SAPI != "other" {
		return invalid
	}
	if doc.Profile != "unobserved" && doc.Profile != "unconfined" && doc.Profile != "php-fpm-enforced" && doc.Profile != "docker-default-enforced" && doc.Profile != "other-enforced" && doc.Profile != "other" {
		return invalid
	}
	if doc.Bootstrap != "unobserved" && doc.Bootstrap != "initialized" && doc.Bootstrap != "failed" {
		return invalid
	}
	if doc.Fingerprint != "unobserved" && doc.Fingerprint != "missing" && doc.Fingerprint != "valid" && doc.Fingerprint != "invalid" {
		return invalid
	}
	if (!*doc.RequirementsOpen && (doc.Bootstrap != "unobserved" || doc.Fingerprint != "unobserved")) || (doc.Bootstrap != "initialized" && doc.Fingerprint != "unobserved") {
		return invalid
	}
	if !*doc.AutoloadOpen && doc.Bootstrap == "initialized" {
		return invalid
	}
	return fmt.Sprintf("owned Passbolt FPM metadata: sapi=%s, euid=%d, egid=%d, profile=%s, requirements-readable=%t, requirements-open=%t, config-open=%t, autoload-open=%t, public-key-open=%t, bootstrap=%s, fingerprint=%s", doc.SAPI, *doc.EUID, *doc.EGID, doc.Profile, *doc.RequirementsRead, *doc.RequirementsOpen, *doc.ConfigOpen, *doc.AutoloadOpen, *doc.PublicKeyOpen, doc.Bootstrap, doc.Fingerprint)
}
