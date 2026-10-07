// Package freshrss is FreshRSS. Traps: docs/catalog/traps/freshrss.md.
package freshrss

import (
	"context"
	"fmt"
	"net/http"
	"strconv"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/helpers"
	"github.com/ajnart/self-host/internal/onboard"
)

// App is FreshRSS. Traps: docs/catalog/traps/freshrss.md.
type App struct{}

func (App) Info() app.Info {
	return app.Info{
		ID: "freshrss", Name: "FreshRSS", Category: "Productivity",
		Description:   "Self-hosted RSS reader that keeps your feeds and reading state private",
		Image:         "ghcr.io/freshrss/freshrss:1.30.0",
		Docs:          "https://github.com/FreshRSS/FreshRSS/tree/edge/Docker",
		Port:          8080,
		ContainerPort: 80,
		Service:       "freshrss",
	}
}

func (App) Inputs() []app.Input { return nil }
func (App) Links() []app.Link   { return nil }

func (App) Compose(rc app.RenderContext) string {
	port := strconv.Itoa(rc.Port)
	return `services:
  freshrss:
    image: ghcr.io/freshrss/freshrss:1.30.0
    restart: unless-stopped
    environment:
      CRON_MIN: "1,31"
      TZ: ${TZ}
    volumes:
      - ./data:/var/www/FreshRSS/data
      - ./extensions:/var/www/FreshRSS/extensions
    ports:
      - ${BIND_IP}:` + port + `:80
`
}

const root = "/var/www/FreshRSS"

// adminExists checks the exact owned user configuration inside the container.
func adminExists(ctx context.Context, h *helpers.H) (bool, error) {
	res, err := h.Exec(ctx, nil, "sh", "-c", "test -f "+root+"/data/users/"+h.AdminUser()+"/config.php")
	if err != nil {
		return false, err
	}
	return res.ExitCode == 0, nil
}

// createAdmin installs FreshRSS, creates the first user and sets its password
// hash, which is computed and piped through stdin so the password never
// reaches the logged command line.
func createAdmin(ctx context.Context, h *helpers.H, user, password string) error {
	env := map[string]string{"FRESHRSS_ADMIN_PASSWORD": password}
	script := "php " + root + "/cli/do-install.php --default-user " + user +
		" --auth-type form --db-type sqlite" +
		" && php " + root + "/cli/create-user.php --user " + user + " --no-default-feeds" +
		` && h=$(php -r 'echo password_hash(getenv("FRESHRSS_ADMIN_PASSWORD"), PASSWORD_BCRYPT, ["cost"=>9]);')` +
		` && printf %s "$h" | php ` + root + `/cli/reconfigure-user.php --user ` + user +
		` --key passwordHash --set --value-stdin`
	res, err := h.Exec(ctx, env, "sh", "-c", script)
	if err != nil {
		return err
	}
	if res.ExitCode != 0 {
		return fmt.Errorf("FreshRSS install exited with %d", res.ExitCode)
	}
	return nil
}

// loginWorks proves the saved password against the installed hash, reading
// the plaintext only from the environment.
func loginWorks(ctx context.Context, h *helpers.H, user, password string) (bool, error) {
	env := map[string]string{"FRESHRSS_ADMIN_PASSWORD": password}
	script := `php -r '$u=@include "` + root + `/data/users/` + user + `/config.php";` +
		` exit(is_array($u) && password_verify(getenv("FRESHRSS_ADMIN_PASSWORD"), $u["passwordHash"] ?? "") ? 0 : 1);'`
	res, err := h.Exec(ctx, env, "sh", "-c", script)
	if err != nil {
		return false, err
	}
	return res.ExitCode == 0, nil
}

func firstAdmin() onboard.FirstAdmin {
	return onboard.FirstAdmin{
		Ready:  onboard.Probe{Path: "/", Want: []int{http.StatusOK, http.StatusFound}},
		Exists: adminExists,
		Create: createAdmin,
		Login:  loginWorks,
		Manual: "open the FreshRSS install page and create the administrator with the password from `self-host credentials`",
	}
}

func (App) Setup(ctx context.Context, h *helpers.H) error {
	return firstAdmin().Setup(ctx, h)
}

func (App) Check(ctx context.Context, h *helpers.H) error {
	ok, err := loginWorks(ctx, h, h.AdminUser(), h.AdminPassword())
	if err != nil {
		return err
	}
	if !ok {
		return fmt.Errorf("the Admin login %s cannot sign in to FreshRSS", h.AdminUser())
	}
	return nil
}
