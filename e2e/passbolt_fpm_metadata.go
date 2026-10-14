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
$uid = is_string($status) && preg_match('/^Uid:\s+(\d+)/m', $status, $uid_match) === 1 ? (int)$uid_match[1] : -1;
$gid = is_string($status) && preg_match('/^Gid:\s+(\d+)/m', $status, $gid_match) === 1 ? (int)$gid_match[1] : -1;
$profile_raw = @file_get_contents('/proc/self/attr/current');
$profile = 'unobserved';
if (is_string($profile_raw)) {
 $profile_raw = trim($profile_raw);
 if ($profile_raw === 'unconfined') { $profile = 'unconfined'; }
	elseif (preg_match('/^(php-fpm|php_fpm_enforce)(\/\/[^ ]+)? \(enforce\)$/D', $profile_raw) === 1) { $profile = 'php-fpm-enforced'; }
 else { $profile = 'other'; }
}
$open = static function(string $path): bool { $handle = @fopen($path, 'rb'); if ($handle === false) { return false; } fclose($handle); return true; };
$data = ['sapi'=>str_starts_with(PHP_SAPI, 'fpm') ? 'fpm' : 'other', 'uid'=>$uid, 'gid'=>$gid, 'profile'=>$profile, 'requirements_readable'=>is_readable('/etc/passbolt/requirements.php'), 'requirements_open'=>false, 'autoload_open'=>$open('/usr/share/php/passbolt/vendor/autoload.php'), 'bootstrap'=>'unobserved', 'fingerprint'=>'unobserved'];
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
		UID              int64  `json:"uid"`
		GID              int64  `json:"gid"`
		Profile          string `json:"profile"`
		RequirementsRead *bool  `json:"requirements_readable"`
		RequirementsOpen *bool  `json:"requirements_open"`
		AutoloadOpen     *bool  `json:"autoload_open"`
		Bootstrap        string `json:"bootstrap"`
		Fingerprint      string `json:"fingerprint"`
	}
	decoder := json.NewDecoder(bytes.NewReader(output))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&doc) != nil || decoder.Decode(new(any)) != io.EOF || doc.RequirementsRead == nil || doc.RequirementsOpen == nil || doc.AutoloadOpen == nil {
		return invalid
	}
	if doc.UID < 0 || doc.UID > 4294967295 || doc.GID < 0 || doc.GID > 4294967295 {
		return invalid
	}
	if doc.SAPI != "fpm" && doc.SAPI != "other" {
		return invalid
	}
	if doc.Profile != "unobserved" && doc.Profile != "unconfined" && doc.Profile != "php-fpm-enforced" && doc.Profile != "other" {
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
	return fmt.Sprintf("owned Passbolt FPM metadata: sapi=%s, uid=%d, gid=%d, profile=%s, requirements-readable=%t, requirements-open=%t, autoload-open=%t, bootstrap=%s, fingerprint=%s", doc.SAPI, doc.UID, doc.GID, doc.Profile, *doc.RequirementsRead, *doc.RequirementsOpen, *doc.AutoloadOpen, doc.Bootstrap, doc.Fingerprint)
}
