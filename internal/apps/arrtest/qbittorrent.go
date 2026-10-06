// Package arrtest holds the fakes the media Apps are tested with: httptest
// servers modelling the API subset Setup and Links use, and a scripted
// `docker compose` that "starts" containers.
package arrtest

import (
	"encoding/json"
	"net/http"
	"sync"
)

// QBittorrent models the qBittorrent WebUI API v2 subset Setup uses.
type QBittorrent struct {
	mu       sync.Mutex
	username string
	password string
	// TempPassword is the one the container printed on first start.
	TempPassword string
	prefs        map[string]any
	sessions     map[string]bool
	logins       int
	failures     int
}

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

// referer reports whether the request carries the Referer qBittorrent's CSRF
// protection demands.
func referer(r *http.Request) bool {
	return r.Header.Get("Referer") == "http://"+r.Host
}

func (q *QBittorrent) authorized(r *http.Request) bool {
	cookie, err := r.Cookie("SID")
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
		if r.PostForm.Get("username") != q.username || r.PostForm.Get("password") != q.password {
			q.failures++
			w.Write([]byte("Fails."))
			return
		}
		sid := "sid-" + q.password
		q.sessions[sid] = true
		http.SetCookie(w, &http.Cookie{Name: "SID", Value: sid, Path: "/"})
		w.Write([]byte("Ok."))
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
		if user, ok := changes["web_ui_username"].(string); ok {
			q.username = user
		}
		if pass, ok := changes["web_ui_password"].(string); ok {
			q.password = pass
		}
		if path, ok := changes["save_path"].(string); ok {
			q.prefs["save_path"] = path
		}
	})
	return mux
}
