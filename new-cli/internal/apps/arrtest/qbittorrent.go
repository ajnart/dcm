// Package arrtest holds the fakes the media Apps are tested with: httptest
// servers modelling the API subset Setup and Links use, and a scripted
// `docker compose` that "starts" containers.
package arrtest

import (
	"encoding/json"
	"net/http"
	"strings"
	"sync"
)

// QBittorrent models the qBittorrent WebUI API v2 subset Setup uses, as
// shipped by 5.2.x: login answers 204 with a QBT_SID_<port> cookie, 401 on
// bad credentials and 403 once the client IP is banned. Legacy switches to
// the ≤5.1 shape (200 "Ok."/"Fails." and a SID cookie).
type QBittorrent struct {
	Legacy bool

	mu       sync.Mutex
	username string
	password string
	// TempPassword is the one the container printed on first start.
	TempPassword string
	prefs        map[string]any
	sessions     map[string]bool
	logins       int
	failures     int
	updates      int
}

// maxFailures is how many failed logins qBittorrent allows before banning.
const maxFailures = 5

func NewQBittorrent() *QBittorrent {
	return &QBittorrent{
		username:     "admin",
		password:     "tmpPass1",
		TempPassword: "tmpPass1",
		prefs:        map[string]any{"save_path": "/config/qBittorrent/downloads"},
		sessions:     map[string]bool{},
	}
}

// Credentials returns the WebUI login as it currently stands.
func (q *QBittorrent) Credentials() (string, string) {
	q.mu.Lock()
	defer q.mu.Unlock()
	return q.username, q.password
}

// SavePath returns the default save path.
func (q *QBittorrent) SavePath() string {
	q.mu.Lock()
	defer q.mu.Unlock()
	return q.prefs["save_path"].(string)
}

// Logins counts login attempts; FailedLogins counts the ones that failed.
func (q *QBittorrent) Logins() int {
	q.mu.Lock()
	defer q.mu.Unlock()
	return q.logins
}

func (q *QBittorrent) FailedLogins() int {
	q.mu.Lock()
	defer q.mu.Unlock()
	return q.failures
}

// Ban makes every further login answer 403, as after too many failures.
func (q *QBittorrent) Ban() {
	q.mu.Lock()
	defer q.mu.Unlock()
	q.failures = maxFailures
}

// CredentialUpdates counts setPreferences calls that changed the login.
func (q *QBittorrent) CredentialUpdates() int {
	q.mu.Lock()
	defer q.mu.Unlock()
	return q.updates
}

func (q *QBittorrent) cookieName(r *http.Request) string {
	if q.Legacy {
		return "SID"
	}
	_, port, _ := strings.Cut(r.Host, ":")
	return "QBT_SID_" + port
}

// referer reports whether the request carries the Referer qBittorrent's CSRF
// protection demands.
func referer(r *http.Request) bool {
	return r.Header.Get("Referer") == "http://"+r.Host
}

func (q *QBittorrent) authorized(r *http.Request) bool {
	cookie, err := r.Cookie(q.cookieName(r))
	return err == nil && q.sessions[cookie.Value]
}

func (q *QBittorrent) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /{$}", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("<html></html>"))
	})
	mux.HandleFunc("POST /api/v2/auth/login", func(w http.ResponseWriter, r *http.Request) {
		q.mu.Lock()
		defer q.mu.Unlock()
		if !referer(r) {
			http.Error(w, "Unauthorized", http.StatusUnauthorized)
			return
		}
		r.ParseForm()
		q.logins++
		if q.failures >= maxFailures {
			http.Error(w, "Your IP address has been banned after too many failed authentication attempts.", http.StatusForbidden)
			return
		}
		if r.PostForm.Get("username") != q.username || r.PostForm.Get("password") != q.password {
			q.failures++
			if q.Legacy {
				w.Write([]byte("Fails."))
				return
			}
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		sid := "sid-" + q.password
		q.sessions[sid] = true
		http.SetCookie(w, &http.Cookie{Name: q.cookieName(r), Value: sid, Path: "/"})
		if q.Legacy {
			w.Write([]byte("Ok."))
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})
	mux.HandleFunc("GET /api/v2/app/preferences", func(w http.ResponseWriter, r *http.Request) {
		q.mu.Lock()
		defer q.mu.Unlock()
		if !q.authorized(r) {
			http.Error(w, "Forbidden", http.StatusForbidden)
			return
		}
		json.NewEncoder(w).Encode(q.prefs)
	})
	mux.HandleFunc("POST /api/v2/app/setPreferences", func(w http.ResponseWriter, r *http.Request) {
		q.mu.Lock()
		defer q.mu.Unlock()
		if !referer(r) || !q.authorized(r) {
			http.Error(w, "Forbidden", http.StatusForbidden)
			return
		}
		r.ParseForm()
		var changes map[string]any
		if err := json.Unmarshal([]byte(r.PostForm.Get("json")), &changes); err != nil {
			http.Error(w, "bad json", http.StatusBadRequest)
			return
		}
		user, hasUser := changes["web_ui_username"].(string)
		pass, hasPass := changes["web_ui_password"].(string)
		// 5.2.4 appcontroller.cpp: username ≥3 chars without ':', password ≥6.
		if (hasUser && (len(user) < 3 || strings.Contains(user, ":"))) || (hasPass && len(pass) < 6) {
			http.Error(w, "invalid WebUI credentials", http.StatusBadRequest)
			return
		}
		if hasUser {
			q.username = user
		}
		if hasPass {
			q.password = pass
		}
		if hasUser || hasPass {
			q.updates++
		}
		if path, ok := changes["save_path"].(string); ok {
			q.prefs["save_path"] = path
		}
	})
	return mux
}
