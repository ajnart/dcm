package e2e

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
)

// Runs as www-data. File operations are metadata-only; datasource credentials
// remain inside the child environment and only fixed local SELECTs are issued.
const passboltApplicationMetadataPHP = `
error_reporting(0);
$key = "/etc/passbolt/gpg/serverkey_private.asc";
$ring = "/var/lib/passbolt/.gnupg";
if (is_link($key) || is_link($ring)) { exit(31); }
$origin = parse_url((string)getenv("APP_FULL_BASE_URL"));
$canonical = is_array($origin) && ($origin["scheme"] ?? "") === "https" && ($origin["host"] ?? "") === "passbolt.e2e.selfhost.test" && ($origin["port"] ?? 0) > 0 && ($origin["port"] ?? 0) <= 65535 && !isset($origin["user"]) && !isset($origin["pass"]) && !isset($origin["query"]) && !isset($origin["fragment"]);
$data = ["private_key_exists"=>is_file($key), "private_key_readable"=>is_readable($key), "keyring_readable"=>is_readable($ring), "keyring_writable"=>is_writable($ring), "gnupg_extension"=>extension_loaded("gnupg"), "pdo_mysql_extension"=>extension_loaded("pdo_mysql"), "canonical_input_valid"=>$canonical, "ssl_force_input"=>filter_var(getenv("PASSBOLT_SSL_FORCE"), FILTER_VALIDATE_BOOLEAN), "datasource"=>"unobserved", "schema"=>"unobserved"];
$port = getenv("DATASOURCES_DEFAULT_PORT");
if (getenv("DATASOURCES_DEFAULT_HOST") !== "passbolt-db" || getenv("DATASOURCES_DEFAULT_DATABASE") !== "passbolt" || getenv("DATASOURCES_DEFAULT_USERNAME") !== "passbolt" || ($port !== false && $port !== "" && $port !== "3306")) {
 $data["datasource"] = "selectors-mismatch";
} elseif (!$data["pdo_mysql_extension"]) {
 $data["datasource"] = "driver-unavailable";
} else {
 try {
  $pdo = new PDO("mysql:host=db;port=3306;dbname=passbolt", "passbolt", (string)getenv("DATASOURCES_DEFAULT_PASSWORD"), [PDO::ATTR_TIMEOUT=>3, PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION, PDO::ATTR_PERSISTENT=>false]);
  $data["datasource"] = "connected";
  try {
   $one = $pdo->query("SELECT 1")->fetchColumn();
   $count = $pdo->query("SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name IN ('users','gpgkeys','authentication_tokens')")->fetchColumn();
   $data["schema"] = "missing";
   if ((int)$one === 1 && (int)$count === 3) { $data["schema"] = "present"; }
  } catch (Throwable $e) { $data["schema"] = "query-failed"; }
 } catch (Throwable $e) {
  $data["datasource"] = "other-failure";
  if ($e instanceof PDOException) {
   $code = (int)($e->errorInfo[1] ?? 0);
   switch ($code) { case 1045: $data["datasource"]="auth-failed"; break; case 2002: case 2003: $data["datasource"]="unreachable"; break; case 1049: $data["datasource"]="database-missing"; break; }
  }
 }
}
echo json_encode($data, JSON_THROW_ON_ERROR), "\n";
`

func passboltApplicationMetadataReason(exit int, output []byte) string {
	if exit != 0 {
		if exit >= 1 && exit <= 255 {
			return fmt.Sprintf("owned Passbolt application metadata unobserved: probe exited %d", exit)
		}
		return "owned Passbolt application metadata unobserved: probe failed"
	}
	invalid := "owned Passbolt application metadata unobserved: invalid fixed projection"
	if len(output) > 2048 {
		return invalid
	}
	var doc struct {
		PrivateExists   *bool  `json:"private_key_exists"`
		PrivateReadable *bool  `json:"private_key_readable"`
		RingReadable    *bool  `json:"keyring_readable"`
		RingWritable    *bool  `json:"keyring_writable"`
		GnuPG           *bool  `json:"gnupg_extension"`
		PDO             *bool  `json:"pdo_mysql_extension"`
		Canonical       *bool  `json:"canonical_input_valid"`
		SSLForce        *bool  `json:"ssl_force_input"`
		Datasource      string `json:"datasource"`
		Schema          string `json:"schema"`
	}
	decoder := json.NewDecoder(bytes.NewReader(output))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&doc) != nil || decoder.Decode(new(any)) != io.EOF || doc.PrivateExists == nil || doc.PrivateReadable == nil || doc.RingReadable == nil || doc.RingWritable == nil || doc.GnuPG == nil || doc.PDO == nil || doc.Canonical == nil || doc.SSLForce == nil || (*doc.PrivateReadable && !*doc.PrivateExists) {
		return invalid
	}
	switch doc.Datasource {
	case "connected", "selectors-mismatch", "driver-unavailable", "auth-failed", "unreachable", "database-missing", "other-failure":
	default:
		return invalid
	}
	switch doc.Schema {
	case "present", "missing", "query-failed", "unobserved":
	default:
		return invalid
	}
	if (doc.Datasource != "connected" && doc.Schema != "unobserved") || (doc.Datasource == "connected" && (doc.Schema == "unobserved" || !*doc.PDO)) {
		return invalid
	}
	return fmt.Sprintf("owned Passbolt application metadata: private-key-exists=%t, private-key-readable=%t, keyring-readable=%t, keyring-writable=%t, gnupg-extension=%t, pdo-mysql-extension=%t, canonical-input-valid=%t, ssl-force-input=%t, datasource=%s, schema=%s", *doc.PrivateExists, *doc.PrivateReadable, *doc.RingReadable, *doc.RingWritable, *doc.GnuPG, *doc.PDO, *doc.Canonical, *doc.SSLForce, doc.Datasource, doc.Schema)
}
