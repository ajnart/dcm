package arrtest

import (
	"encoding/json"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"sync"
)

// Jellyfin models the Jellyfin 12.x API subset Setup and Seerr use: the
// startup wizard (GET /Startup/User before POST, 403 once a password is
// set), sign-in, API keys, and libraries (a duplicate name becomes
// "Movies2"). Only `Authorization: MediaBrowser` is accepted, as in 12.x.
type Jellyfin struct {
	// Booting is how many /System/Info/Public reads answer like the boot
	// placeholder: no Version and the wizard reported unfinished.
	Booting int
	// FailComplete is how many POST /Startup/Complete calls fail with 500,
	// like a run interrupted after the admin password was set.
	FailComplete int
	// FolderExists reports whether a path exists inside the container.
	FolderExists func(path string) bool

	mu        sync.Mutex
	completed bool
	userReady bool
	username  string
	password  string
	sessions  map[string]bool
	keys      []jellyfinKey
	libraries []JellyfinLibrary
	wizard    int
}

type jellyfinKey struct{ AccessToken, AppName string }

type JellyfinLibrary struct {
	Name           string
	CollectionType string
	Locations      []string
	ItemID         string `json:"ItemId"`
}

func NewJellyfin() *Jellyfin {
	return &Jellyfin{sessions: map[string]bool{}, FolderExists: func(string) bool { return true }}
}

// Admin returns the administrator the wizard created.
func (j *Jellyfin) Admin() (string, string) {
	j.mu.Lock()
	defer j.mu.Unlock()
	return j.username, j.password
}

// SignIn reports whether user/password is the administrator, like
// AuthenticateByName (used by the Seerr fake).
func (j *Jellyfin) SignIn(user, password string) bool {
	j.mu.Lock()
	defer j.mu.Unlock()
	return j.completed && user == j.username && password == j.password
}

func (j *Jellyfin) Libraries() []JellyfinLibrary {
	j.mu.Lock()
	defer j.mu.Unlock()
	return append([]JellyfinLibrary(nil), j.libraries...)
}

// Keys lists the API keys' app names.
func (j *Jellyfin) Keys() []string {
	j.mu.Lock()
	defer j.mu.Unlock()
	var names []string
	for _, k := range j.keys {
		names = append(names, k.AppName)
	}
	return names
}

// WizardRuns counts POST /Startup/Complete calls.
func (j *Jellyfin) WizardRuns() int {
	j.mu.Lock()
	defer j.mu.Unlock()
	return j.wizard
}

var tokenPart = regexp.MustCompile(`Token="([^"]*)"`)

// authorized accepts a session token or API key in the MediaBrowser header.
func (j *Jellyfin) authorized(r *http.Request) bool {
	value := r.Header.Get("Authorization")
	if !strings.HasPrefix(value, "MediaBrowser ") {
		return false
	}
	found := tokenPart.FindStringSubmatch(value)
	if found == nil {
		return false
	}
	if j.sessions[found[1]] {
		return true
	}
	for _, k := range j.keys {
		if k.AccessToken == found[1] {
			return true
		}
	}
	return false
}

func (j *Jellyfin) locked(next func(w http.ResponseWriter, r *http.Request)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		j.mu.Lock()
		defer j.mu.Unlock()
		next(w, r)
	}
}

// elevated serves next only to an administrator, or to anyone before the
// wizard completed (the FirstTimeSetupOrElevated policy).
func (j *Jellyfin) elevated(next func(w http.ResponseWriter, r *http.Request)) http.HandlerFunc {
	return j.locked(func(w http.ResponseWriter, r *http.Request) {
		if j.completed && !j.authorized(r) {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		next(w, r)
	})
}

func (j *Jellyfin) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /System/Info/Public", j.locked(func(w http.ResponseWriter, r *http.Request) {
		if j.Booting > 0 {
			j.Booting--
			w.Write([]byte(`{"StartupWizardCompleted":false}`))
			return
		}
		json.NewEncoder(w).Encode(map[string]any{"Version": "12.2.0", "ServerName": "Jellyfin", "StartupWizardCompleted": j.completed})
	}))
	mux.HandleFunc("POST /Startup/Configuration", j.elevated(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))
	mux.HandleFunc("GET /Startup/User", j.elevated(func(w http.ResponseWriter, r *http.Request) {
		j.userReady = true
		w.Write([]byte(`{"Name":"root"}`))
	}))
	mux.HandleFunc("POST /Startup/User", j.elevated(func(w http.ResponseWriter, r *http.Request) {
		if !j.userReady {
			http.NotFound(w, r)
			return
		}
		var body struct{ Name, Password string }
		json.NewDecoder(r.Body).Decode(&body)
		switch {
		case strings.TrimSpace(body.Password) == "":
			http.Error(w, "Password must not be empty", http.StatusBadRequest)
		case j.password != "":
			w.WriteHeader(http.StatusForbidden)
		default:
			j.username, j.password = body.Name, body.Password
			w.WriteHeader(http.StatusNoContent)
		}
	}))
	mux.HandleFunc("POST /Startup/RemoteAccess", j.elevated(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		if json.NewDecoder(r.Body).Decode(&body) != nil || body["EnableRemoteAccess"] == nil {
			http.Error(w, "body required", http.StatusBadRequest)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	mux.HandleFunc("POST /Startup/Complete", j.elevated(func(w http.ResponseWriter, r *http.Request) {
		if j.FailComplete > 0 {
			j.FailComplete--
			http.Error(w, "interrupted", http.StatusInternalServerError)
			return
		}
		j.completed = true
		j.wizard++
		w.WriteHeader(http.StatusNoContent)
	}))
	mux.HandleFunc("POST /Users/AuthenticateByName", j.locked(func(w http.ResponseWriter, r *http.Request) {
		if !strings.Contains(r.Header.Get("Authorization"), `DeviceId="`) {
			http.Error(w, "missing device", http.StatusBadRequest)
			return
		}
		var body struct{ Username, Pw string }
		json.NewDecoder(r.Body).Decode(&body)
		if !j.completed || body.Username != j.username || body.Pw != j.password {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		token := "session-" + strconv.Itoa(len(j.sessions)+1)
		j.sessions[token] = true
		json.NewEncoder(w).Encode(map[string]any{"AccessToken": token, "User": map[string]any{"Name": j.username, "Policy": map[string]any{"IsAdministrator": true}}})
	}))
	mux.HandleFunc("GET /System/Info", j.elevated(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{"Version":"12.2.0"}`))
	}))
	mux.HandleFunc("GET /Auth/Keys", j.elevated(func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]any{"Items": j.keys, "TotalRecordCount": len(j.keys)})
	}))
	mux.HandleFunc("POST /Auth/Keys", j.elevated(func(w http.ResponseWriter, r *http.Request) {
		name := r.URL.Query().Get("app")
		if name == "" {
			http.Error(w, "app required", http.StatusBadRequest)
			return
		}
		j.keys = append(j.keys, jellyfinKey{AccessToken: name + "-key-" + strconv.Itoa(len(j.keys)+1), AppName: name})
		w.WriteHeader(http.StatusNoContent)
	}))
	mux.HandleFunc("GET /Library/VirtualFolders", j.elevated(func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(append([]JellyfinLibrary{}, j.libraries...))
	}))
	mux.HandleFunc("POST /Library/VirtualFolders", j.elevated(func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		paths := strings.Split(q.Get("paths"), ",")
		for _, p := range paths {
			if !j.FolderExists(p) {
				http.Error(w, "The specified path does not exist", http.StatusInternalServerError)
				return
			}
		}
		name := q.Get("name")
		for n := 2; j.hasLibrary(name); n++ {
			name = q.Get("name") + strconv.Itoa(n)
		}
		j.libraries = append(j.libraries, JellyfinLibrary{Name: name, CollectionType: q.Get("collectionType"), Locations: paths,
			ItemID: "item-" + strconv.Itoa(len(j.libraries)+1)})
		w.WriteHeader(http.StatusNoContent)
	}))
	return mux
}

func (j *Jellyfin) hasLibrary(name string) bool {
	for _, l := range j.libraries {
		if l.Name == name {
			return true
		}
	}
	return false
}
