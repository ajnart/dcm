package e2e

type appInputs struct {
	local   map[string]string
	runtime map[string]string
}

// Runtime inputs name their owned prerequisite App, or need no additional App.
var appInputTable = map[string]appInputs{
	"archive-team-warrior": {local: map[string]string{"nickname": "selfhost-e2e"}},
	"headscale":            {local: map[string]string{"canonical-origin": "https://headscale.e2e.selfhost.test", "magic-dns-domain": "mesh.e2e.selfhost.test"}},
	"authelia":             {local: map[string]string{"origin": "https://auth.e2e.selfhost.test"}},
	"pangolin":             {local: map[string]string{"PANGOLIN_CANONICAL_ORIGIN": "https://pangolin.e2e.selfhost.test", "PANGOLIN_BASE_DOMAIN": "e2e.selfhost.test"}},
	"restic":               {local: map[string]string{"repository": "/repository"}},
	"borgmatic":            {local: map[string]string{"repository": "/mnt/borg-repository"}},
	"stalwart-mail":        {local: map[string]string{"STALWART_HOSTNAME": "mail.e2e.selfhost.test", "STALWART_DOMAIN": "e2e.selfhost.test"}},
	"haproxy":              {local: map[string]string{"target-app": "ntfy", "target-port": "80"}},
	"wud":                  {runtime: map[string]string{"WUD_DOCKER_HOST": "ntfy"}},
	"netbird":              {runtime: map[string]string{"NETBIRD_CANONICAL_ORIGIN": ""}},
	"renovate":             {runtime: map[string]string{"token": "forgejo"}},
	"passbolt":             {runtime: map[string]string{"PASSBOLT_CANONICAL_ORIGIN": "", "PASSBOLT_SMTP_HOST": ""}},
}
