package e2e

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
)

// Fixed expected public-key path metadata only. test/stat never open a key
// payload; the www-data subcommand reports true/false without printing errors.
const passboltMetadataCommand = `set -eu
[ -d /etc/passbolt/gpg ] || exit 21
[ ! -L /etc/passbolt/gpg ] && [ ! -L /etc/passbolt/gpg/serverkey.asc ] || exit 22
owner=$(stat -c %u /etc/passbolt/gpg 2>/dev/null) || exit 21
group=$(stat -c %g /etc/passbolt/gpg 2>/dev/null) || exit 21
mode=$(stat -c %a /etc/passbolt/gpg 2>/dev/null) || exit 21
case "$owner" in 0) owner=root;; 33) owner=www-data;; *) owner=other;; esac
case "$group" in 0) group=root;; 33) group=www-data;; *) group=other;; esac
case "$mode" in 700) mode=0700;; 770) mode=0770;; 755) mode=0755;; *) mode=other;; esac
exists=false
if [ -f /etc/passbolt/gpg/serverkey.asc ]; then exists=true; fi
readable=$(su -s /bin/sh -c 'if [ -r /etc/passbolt/gpg/serverkey.asc ]; then printf true; else printf false; fi' www-data 2>/dev/null) || exit 23
case "$readable" in true|false) ;; *) exit 24;; esac
printf '{"public_key_exists":%s,"www_data_readable":%s,"directory_owner":"%s","directory_group":"%s","directory_mode":"%s"}\n' "$exists" "$readable" "$owner" "$group" "$mode"
`

func passboltMetadataReason(exit int, output []byte) string {
	if exit != 0 {
		if exit >= 1 && exit <= 255 {
			return fmt.Sprintf("owned Passbolt public-key metadata unobserved: probe exited %d", exit)
		}
		return "owned Passbolt public-key metadata unobserved: probe failed"
	}
	invalid := "owned Passbolt public-key metadata unobserved: invalid fixed projection"
	if len(output) > 1024 {
		return invalid
	}
	var doc struct {
		Exists   *bool  `json:"public_key_exists"`
		Readable *bool  `json:"www_data_readable"`
		Owner    string `json:"directory_owner"`
		Group    string `json:"directory_group"`
		Mode     string `json:"directory_mode"`
	}
	decoder := json.NewDecoder(bytes.NewReader(output))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&doc) != nil || decoder.Decode(new(any)) != io.EOF || doc.Exists == nil || doc.Readable == nil {
		return invalid
	}
	owner := func(value string) bool { return value == "root" || value == "www-data" || value == "other" }
	if !owner(doc.Owner) || !owner(doc.Group) || (doc.Mode != "0700" && doc.Mode != "0770" && doc.Mode != "0755" && doc.Mode != "other") || (*doc.Readable && !*doc.Exists) {
		return invalid
	}
	return fmt.Sprintf("owned Passbolt public-key metadata: exists=%t, www-data-readable=%t, directory-owner=%s, directory-group=%s, directory-mode=%s", *doc.Exists, *doc.Readable, doc.Owner, doc.Group, doc.Mode)
}
