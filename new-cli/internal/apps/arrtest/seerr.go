package arrtest

import (
	"encoding/json"
	"net/http"
	"slices"
	"strconv"
	"sync"
)

// Seerr models the Seerr v3.5 API subset its Links use. Its first Jellyfin
// sign-in binds the server and creates the admin; a second one carrying a
// hostname is refused with 500, as upstream does. The API key is the one
// the container got as API_KEY and works only once the admin exists.
type Seerr struct {
	// Jellyfin answers a sign-in made against host:port.
	Jellyfin func(host string, port int, user, password string) bool
	// JellyfinLibraries lists what a library sync finds.
	JellyfinLibraries func() []JellyfinLibrary
	// Servarr answers a connection test: the root folders of the server at
	// host:port when apiKey is right.
	Servarr func(kind, host string, port int, apiKey string) ([]string, bool)

	mu          sync.Mutex
	APIKey      string
	initialized bool
	mediaServer int
	admin       bool
	sessions    map[string]bool
	libraries   []map[string]any
	servers     map[string][]map[string]any
	nextID      map[string]int
}

func NewSeerr() *Seerr {
	return &Seerr{mediaServer: 4, sessions: map[string]bool{}, servers: map[string][]map[string]any{}, nextID: map[string]int{}}
}

func (s *Seerr) Initialized() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.initialized
}

// EnabledLibraries lists the names of enabled libraries.
func (s *Seerr) EnabledLibraries() []string {
	s.mu.Lock()
	defer s.mu.Unlock()
	var names []string
	for _, l := range s.libraries {
		if l["enabled"] == true {
			names = append(names, l["name"].(string))
		}
	}
	return names
}

// Servers lists the saved Sonarr or Radarr servers.
func (s *Seerr) Servers(kind string) []map[string]any {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]map[string]any(nil), s.servers[kind]...)
}

func (s *Seerr) locked(next func(w http.ResponseWriter, r *http.Request)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		s.mu.Lock()
		defer s.mu.Unlock()
		next(w, r)
	}
}

// admin serves next to the admin's session or the API key (user 1).
func (s *Seerr) adminOnly(next func(w http.ResponseWriter, r *http.Request)) http.HandlerFunc {
	return s.locked(func(w http.ResponseWriter, r *http.Request) {
		cookie, _ := r.Cookie("connect.sid")
		keyed := s.admin && s.APIKey != "" && r.Header.Get("X-Api-Key") == s.APIKey
		if !keyed && (cookie == nil || !s.sessions[cookie.Value]) {
			http.Error(w, `{"message":"You do not have permission to access this endpoint"}`, http.StatusForbidden)
			return
		}
		next(w, r)
	})
}

func (s *Seerr) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/v1/status", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{"version":"3.5.0"}`))
	})
	mux.HandleFunc("GET /api/v1/settings/public", s.locked(func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]any{"initialized": s.initialized, "mediaServerType": s.mediaServer})
	}))
	mux.HandleFunc("POST /api/v1/auth/jellyfin", s.locked(s.signIn))
	mux.HandleFunc("POST /api/v1/settings/jellyfin/library/sync", s.adminOnly(func(w http.ResponseWriter, r *http.Request) {
		found := s.JellyfinLibraries()
		if len(found) == 0 {
			http.Error(w, `{"message":"SyncErrorNoLibraries"}`, http.StatusNotFound)
			return
		}
		for _, l := range found {
			if !slices.ContainsFunc(s.libraries, func(have map[string]any) bool { return have["id"] == l.ItemID }) {
				s.libraries = append(s.libraries, map[string]any{"id": l.ItemID, "name": l.Name, "enabled": false})
			}
		}
		json.NewEncoder(w).Encode(s.libraries)
	}))
	mux.HandleFunc("GET /api/v1/settings/jellyfin/library", s.adminOnly(func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(append([]map[string]any{}, s.libraries...))
	}))
	mux.HandleFunc("PUT /api/v1/settings/jellyfin/library/{id}", s.adminOnly(func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Enabled *bool `json:"enabled"`
		}
		if json.NewDecoder(r.Body).Decode(&body) != nil || body.Enabled == nil {
			http.Error(w, "invalid body", http.StatusBadRequest)
			return
		}
		for _, l := range s.libraries {
			if l["id"] == r.PathValue("id") {
				l["enabled"] = *body.Enabled
				json.NewEncoder(w).Encode(l)
				return
			}
		}
		http.NotFound(w, r)
	}))
	mux.HandleFunc("POST /api/v1/settings/initialize", s.adminOnly(func(w http.ResponseWriter, r *http.Request) {
		s.initialized = true
		json.NewEncoder(w).Encode(map[string]any{"initialized": true})
	}))
	for _, kind := range []string{"sonarr", "radarr"} {
		s.serverRoutes(mux, kind)
	}
	return mux
}

func (s *Seerr) signIn(w http.ResponseWriter, r *http.Request) {
	var body map[string]any
	json.NewDecoder(r.Body).Decode(&body)
	user, _ := body["username"].(string)
	password, _ := body["password"].(string)
	host, hasHost := body["hostname"].(string)
	port, _ := body["port"].(float64)
	switch {
	case user == "" || password == "":
		http.Error(w, "username and password are required", http.StatusBadRequest)
		return
	case hasHost && s.mediaServer != 4:
		http.Error(w, `{"message":"Jellyfin hostname already configured"}`, http.StatusInternalServerError)
		return
	case !hasHost && s.mediaServer == 4:
		http.Error(w, `{"message":"no media server configured"}`, http.StatusInternalServerError)
		return
	}
	if hasHost {
		if body["serverType"] != float64(2) || !s.Jellyfin(host, int(port), user, password) {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		s.mediaServer, s.admin = 2, true
	} else if !s.Jellyfin("jellyfin", 8096, user, password) {
		w.WriteHeader(http.StatusUnauthorized)
		return
	}
	session := "sess-" + strconv.Itoa(len(s.sessions)+1)
	s.sessions[session] = true
	http.SetCookie(w, &http.Cookie{Name: "connect.sid", Value: session, Path: "/", HttpOnly: true})
	json.NewEncoder(w).Encode(map[string]any{"id": 1, "displayName": user})
}

// required lists the fields the OpenAPI validator insists on.
var required = map[string][]string{
	"sonarr": {"name", "hostname", "port", "apiKey", "useSsl", "activeProfileId", "activeProfileName", "activeDirectory", "is4k", "enableSeasonFolders", "isDefault"},
	"radarr": {"name", "hostname", "port", "apiKey", "useSsl", "activeProfileId", "activeProfileName", "activeDirectory", "is4k", "minimumAvailability", "isDefault"},
}

func (s *Seerr) serverRoutes(mux *http.ServeMux, kind string) {
	base := "/api/v1/settings/" + kind
	mux.HandleFunc("POST "+base+"/test", s.adminOnly(func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Hostname string  `json:"hostname"`
			Port     float64 `json:"port"`
			APIKey   string  `json:"apiKey"`
		}
		json.NewDecoder(r.Body).Decode(&body)
		folders, ok := s.Servarr(kind, body.Hostname, int(body.Port), body.APIKey)
		if !ok {
			http.Error(w, `{"message":"Failed to connect"}`, http.StatusInternalServerError)
			return
		}
		var rootFolders []map[string]any
		for i, f := range folders {
			rootFolders = append(rootFolders, map[string]any{"id": i + 1, "path": f})
		}
		json.NewEncoder(w).Encode(map[string]any{
			"profiles":    []map[string]any{{"id": 1, "name": "Any"}, {"id": 4, "name": "HD-1080p"}},
			"rootFolders": rootFolders, "tags": []any{}, "urlBase": "",
		})
	}))
	mux.HandleFunc("GET "+base, s.adminOnly(func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(append([]map[string]any{}, s.servers[kind]...))
	}))
	mux.HandleFunc("POST "+base, s.adminOnly(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		json.NewDecoder(r.Body).Decode(&body)
		for _, field := range required[kind] {
			if _, found := body[field]; !found {
				http.Error(w, `{"message":"request/body must have required property '`+field+`'"}`, http.StatusBadRequest)
				return
			}
		}
		body["id"] = s.nextID[kind]
		s.nextID[kind]++
		s.servers[kind] = append(s.servers[kind], body)
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(body)
	}))
	mux.HandleFunc("DELETE "+base+"/{id}", s.adminOnly(func(w http.ResponseWriter, r *http.Request) {
		for i, item := range s.servers[kind] {
			if strconv.Itoa(item["id"].(int)) == r.PathValue("id") {
				s.servers[kind] = append(s.servers[kind][:i], s.servers[kind][i+1:]...)
				json.NewEncoder(w).Encode(item)
				return
			}
		}
		http.NotFound(w, r)
	}))
}
