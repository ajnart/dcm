package e2e

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
)

// Served only by the owned fixture through Passbolt's existing PHP-FPM path.
// It reads one fixed public bootstrap file and emits fixed state enums only.
const passboltFPMMetadataPHP = `<?php
error_reporting(0);
header('Content-Type: application/json');
$data = ['sapi'=>str_starts_with(PHP_SAPI, 'fpm') ? 'fpm' : 'other', 'requirements_open'=>false, 'bootstrap'=>'unobserved', 'fingerprint'=>'unobserved'];
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
		RequirementsOpen *bool  `json:"requirements_open"`
		Bootstrap        string `json:"bootstrap"`
		Fingerprint      string `json:"fingerprint"`
	}
	decoder := json.NewDecoder(bytes.NewReader(output))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&doc) != nil || decoder.Decode(new(any)) != io.EOF || doc.RequirementsOpen == nil {
		return invalid
	}
	if doc.SAPI != "fpm" && doc.SAPI != "other" {
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
	return fmt.Sprintf("owned Passbolt FPM metadata: sapi=%s, requirements-open=%t, bootstrap=%s, fingerprint=%s", doc.SAPI, *doc.RequirementsOpen, doc.Bootstrap, doc.Fingerprint)
}
