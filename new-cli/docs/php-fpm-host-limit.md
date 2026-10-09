# PHP-FPM host confinement limit

Normal PHP-FPM execution on this host cannot access some files required by the pinned applications. The evidence below comes from isolated public-image helpers; it does not turn a failed application installation into a pass.

## Passbolt

The pinned `passbolt/passbolt:5.16.0-1-ce` image (local image ID `sha256:a7d4b166b6702ca0752e51f734638f95ba383b7446f9028082b0ea7c34b6facb`) serves its public entry point by including `/etc/passbolt/requirements.php` before loading the application.

An isolated helper created from the image used the original PHP-FPM pool, ordinary capabilities, no network, and two read-only public probe files. It opened no credential or configuration payload. Its fixed projection showed:

| Context | File reported readable | Actual fopen succeeded |
| --- | --- | --- |
| www-data PHP CLI | true | true |
| Native PHP-FPM, enforced host profile | true | false |

The response confirmed the actual FPM SAPI and an enforced profile. Readability metadata alone therefore does not establish that the application process can open a file.

The helper required recovery after Docker could not remove it directly. Identity was verified against its nonce, pinned image and exact public mounts. A policy-permitted host peer sent the normal FPM shutdown signal; the exact stopped helper was removed and its absence verified. Cleanup passed.

The live `/auth/verify.json` check still returns HTTP 500. This reproduction establishes a host access limit, not the complete cause of that response or successful Passbolt acceptance. The fixed unknown-500 recovery hint asks the host administrator to check FPM access to bootstrap and configuration files if server-key and database checks pass.

## BookStack and Speedtest Tracker

Root-received observations from public BookStack image helpers (local image ID `sha256:675c1edfab2ab727303aa5014df941f710ee858b472500d75faeb1a775bde4a4`) showed native `/usr/sbin/php-fpm85` entering the enforced host profile and failing to open `/etc/php85/php-fpm.conf`, while CLI fopen succeeded. The binary had ordinary root-owned mode 0755 without setuid or setgid bits. Five exact owned helpers were removed and cleanup verified. Runtime traces were not saved; these facts retain tool-observation provenance rather than a stored trace checksum.

The preserved public main and pool defaults are root-owned mode 0644. Their allowlisted projection records the normal Alpine include paths and pool settings; its checksum covers that projection, not the unsaved runtime observations.

Speedtest Tracker uses the same `/usr/sbin/php-fpm85` binary path and `/etc/php85/php-fpm.conf` configuration path in its pinned application source. The BookStack reproduction demonstrates the relevant host-policy incompatibility for that shared path. This report does not claim a separate public-image Speedtest reproduction or passing application acceptance for either app.

## Host policy

The public host profile attaches to `/usr/sbin/php-fpm*`. Its PHP abstraction permits `/etc/php{,5,7,8}/**` and `/usr/share/php{,5,7,8}/**`; the local PHP-FPM override is empty. The first configuration glob excludes both Alpine `/etc/php85/**` and Passbolt `/etc/passbolt/**`.

No confinement policy or application acceptance check was weakened. Application configuration, environment values, keys and logs remain outside this report. Machine-readable observations and source-artifact checksums are in [php-fpm-host-limit.json](php-fpm-host-limit.json).
