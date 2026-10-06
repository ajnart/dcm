package arrtest

import (
	"encoding/json"
	"fmt"
	"net/http"
	"slices"
	"strconv"
	"sync"
)

// Arr models the API subset of Sonarr and Radarr (v3) or Prowlarr (v1) that
// Setup and Links use: system status, host config with forms authentication,
// root folders, download clients (v3) and applications (Prowlarr).
type Arr struct {
	mu      sync.Mutex
	kind    string
	version string
	// Key is the API key the App wrote to config.xml.
	Key string

	host            map[string]any
	password        string
	rootFolders     []string
	downloadClients []map[string]any
	applications    []map[string]any
	nextID          int

	// FolderExists reports whether a folder was created inside the container.
	FolderExists func(path string) bool
	// AcceptDownloadClient plays the connection test Sonarr and Radarr run
	// when a download client is saved.
	AcceptDownloadClient func(host string, port int, user, password string) bool
	// AcceptApplication plays the connection test Prowlarr runs when an
	// application is saved.
	AcceptApplication func(baseURL, apiKey string) bool
	// FailDeletes makes every DELETE answer 500, as when the App is broken.
	FailDeletes bool
}

// SeedDownloadClient adds a download client the user configured by hand.
func (a *Arr) SeedDownloadClient(client map[string]any) {
	a.mu.Lock()
	defer a.mu.Unlock()
	client["id"] = a.nextID
	a.nextID++
	a.downloadClients = append(a.downloadClients, client)
}

// NewArr returns a fake of kind "sonarr", "radarr" or "prowlarr".
func NewArr(kind string) *Arr {
	a := &Arr{kind: kind, version: "v3", Key: "key-" + kind, nextID: 1}
	if kind == "prowlarr" {
		a.version = "v1"
	}
	a.host = map[string]any{
		"id": 1, "bindAddress": "*", "port": 8989,
		"authenticationMethod": "none", "authenticationRequired": "enabled",
		"username": "", "password": "", "passwordConfirmation": "",
	}
	return a
}

// Auth returns the authentication method and the username it is set up with.
func (a *Arr) Auth() (method, username string) {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.host["authenticationMethod"].(string), a.host["username"].(string)
}

// Password returns the password the login form accepts.
func (a *Arr) Password() string {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.password
}

func (a *Arr) RootFolders() []string {
	a.mu.Lock()
	defer a.mu.Unlock()
	return slices.Clone(a.rootFolders)
}

func (a *Arr) DownloadClients() []map[string]any {
	a.mu.Lock()
	defer a.mu.Unlock()
	return slices.Clone(a.downloadClients)
}

func (a *Arr) Applications() []map[string]any {
	a.mu.Lock()
	defer a.mu.Unlock()
	return slices.Clone(a.applications)
}

// Field returns the value of the field called name on a download client or
// application object.
func Field(object map[string]any, name string) any {
	fields, _ := object["fields"].([]any)
	for _, f := range fields {
		field, _ := f.(map[string]any)
		if field["name"] == name {
			return field["value"]
		}
	}
	return nil
}

func schemaFields(names ...string) []any {
	fields := make([]any, len(names))
	for i, name := range names {
		fields[i] = map[string]any{"name": name, "value": nil}
	}
	return fields
}

func (a *Arr) categoryField() string {
	if a.kind == "radarr" {
		return "movieCategory"
	}
	return "tvCategory"
}

func (a *Arr) downloadClientSchema() []any {
	return []any{
		map[string]any{"implementation": "SABnzbd", "implementationName": "SABnzbd", "protocol": "usenet",
			"fields": schemaFields("host", "port", "apiKey")},
		map[string]any{"implementation": "QBittorrent", "implementationName": "qBittorrent",
			"configContract": "QBittorrentSettings", "protocol": "torrent", "priority": 1, "enable": false, "name": nil,
			"fields": schemaFields("host", "port", "useSsl", "username", "password", a.categoryField())},
	}
}

func (a *Arr) applicationSchema() []any {
	app := func(implementation string) map[string]any {
		return map[string]any{"implementation": implementation, "implementationName": implementation,
			"configContract": implementation + "Settings", "syncLevel": "disabled", "name": nil,
			"fields": schemaFields("prowlarrUrl", "baseUrl", "apiKey", "syncCategories")}
	}
	return []any{app("Lidarr"), app("Radarr"), app("Sonarr")}
}

func (a *Arr) keyed(next func(w http.ResponseWriter, r *http.Request)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		a.mu.Lock()
		defer a.mu.Unlock()
		if r.Header.Get("X-Api-Key") != a.Key {
			http.Error(w, `{"error":"Unauthorized"}`, http.StatusUnauthorized)
			return
		}
		next(w, r)
	}
}

func fail(w http.ResponseWriter, format string, args ...any) {
	http.Error(w, fmt.Sprintf(`[{"errorMessage":%q}]`, fmt.Sprintf(format, args...)), http.StatusBadRequest)
}

func (a *Arr) Handler() http.Handler {
	mux := http.NewServeMux()
	api := "/api/" + a.version
	mux.HandleFunc("GET /ping", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{"status":"OK"}`))
	})
	mux.HandleFunc("POST /login", a.login)
	mux.HandleFunc("GET "+api+"/system/status", a.keyed(func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprintf(w, `{"appName":%q,"version":"4.0.0"}`, a.kind)
	}))
	mux.HandleFunc("GET "+api+"/config/host", a.keyed(func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(a.host)
	}))
	mux.HandleFunc("PUT "+api+"/config/host/{id}", a.keyed(a.putHost))
	if a.kind == "prowlarr" {
		a.applicationRoutes(mux, api)
		return mux
	}
	a.rootFolderRoutes(mux, api)
	a.downloadClientRoutes(mux, api)
	return mux
}

func (a *Arr) login(w http.ResponseWriter, r *http.Request) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.host["authenticationMethod"] != "forms" {
		http.NotFound(w, r)
		return
	}
	r.ParseForm()
	if r.PostForm.Get("username") == a.host["username"] && r.PostForm.Get("password") == a.password {
		w.Header().Set("Location", "/")
	} else {
		w.Header().Set("Location", "/login?returnUrl=/&loginFailed=true")
	}
	w.WriteHeader(http.StatusFound)
}

func (a *Arr) putHost(w http.ResponseWriter, r *http.Request) {
	var host map[string]any
	if err := json.NewDecoder(r.Body).Decode(&host); err != nil {
		fail(w, "bad json")
		return
	}
	if host["authenticationMethod"] == "forms" {
		user, _ := host["username"].(string)
		pass, _ := host["password"].(string)
		if user == "" || pass == "" || pass != host["passwordConfirmation"] {
			fail(w, "forms authentication needs a username and matching passwords")
			return
		}
		a.password = pass
	}
	host["password"], host["passwordConfirmation"] = "", ""
	a.host = host
	json.NewEncoder(w).Encode(host)
}

func (a *Arr) rootFolderRoutes(mux *http.ServeMux, api string) {
	mux.HandleFunc("GET "+api+"/rootfolder", a.keyed(func(w http.ResponseWriter, r *http.Request) {
		folders := []map[string]any{}
		for i, path := range a.rootFolders {
			folders = append(folders, map[string]any{"id": i + 1, "path": path})
		}
		json.NewEncoder(w).Encode(folders)
	}))
	mux.HandleFunc("POST "+api+"/rootfolder", a.keyed(func(w http.ResponseWriter, r *http.Request) {
		var folder struct{ Path string }
		json.NewDecoder(r.Body).Decode(&folder)
		if a.FolderExists != nil && !a.FolderExists(folder.Path) {
			fail(w, "folder %s does not exist", folder.Path)
			return
		}
		a.rootFolders = append(a.rootFolders, folder.Path)
		json.NewEncoder(w).Encode(map[string]any{"id": len(a.rootFolders), "path": folder.Path})
	}))
}

func (a *Arr) downloadClientRoutes(mux *http.ServeMux, api string) {
	mux.HandleFunc("GET "+api+"/downloadclient/schema", a.keyed(func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(a.downloadClientSchema())
	}))
	mux.HandleFunc("GET "+api+"/downloadclient", a.keyed(func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(a.downloadClients)
	}))
	mux.HandleFunc("POST "+api+"/downloadclient", a.keyed(func(w http.ResponseWriter, r *http.Request) {
		var client map[string]any
		json.NewDecoder(r.Body).Decode(&client)
		if name, _ := client["name"].(string); name == "" {
			fail(w, "name is required")
			return
		}
		host, _ := Field(client, "host").(string)
		port, _ := Field(client, "port").(float64)
		user, _ := Field(client, "username").(string)
		pass, _ := Field(client, "password").(string)
		if a.AcceptDownloadClient != nil && !a.AcceptDownloadClient(host, int(port), user, pass) {
			fail(w, "unable to connect to the download client")
			return
		}
		client["id"] = a.nextID
		a.nextID++
		a.downloadClients = append(a.downloadClients, client)
		json.NewEncoder(w).Encode(client)
	}))
	mux.HandleFunc("DELETE "+api+"/downloadclient/{id}", a.keyed(func(w http.ResponseWriter, r *http.Request) {
		if a.FailDeletes {
			http.Error(w, "database is locked", http.StatusInternalServerError)
			return
		}
		a.downloadClients = deleteByID(a.downloadClients, r.PathValue("id"))
		w.Write([]byte("{}"))
	}))
}

func (a *Arr) applicationRoutes(mux *http.ServeMux, api string) {
	mux.HandleFunc("GET "+api+"/applications/schema", a.keyed(func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(a.applicationSchema())
	}))
	mux.HandleFunc("GET "+api+"/applications", a.keyed(func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(a.applications)
	}))
	mux.HandleFunc("POST "+api+"/applications", a.keyed(func(w http.ResponseWriter, r *http.Request) {
		var application map[string]any
		json.NewDecoder(r.Body).Decode(&application)
		if name, _ := application["name"].(string); name == "" {
			fail(w, "name is required")
			return
		}
		baseURL, _ := Field(application, "baseUrl").(string)
		apiKey, _ := Field(application, "apiKey").(string)
		if Field(application, "prowlarrUrl") == "" || Field(application, "prowlarrUrl") == nil {
			fail(w, "prowlarrUrl is required")
			return
		}
		if a.AcceptApplication != nil && !a.AcceptApplication(baseURL, apiKey) {
			fail(w, "unable to connect to %s", baseURL)
			return
		}
		application["id"] = a.nextID
		a.nextID++
		a.applications = append(a.applications, application)
		json.NewEncoder(w).Encode(application)
	}))
	mux.HandleFunc("DELETE "+api+"/applications/{id}", a.keyed(func(w http.ResponseWriter, r *http.Request) {
		if a.FailDeletes {
			http.Error(w, "database is locked", http.StatusInternalServerError)
			return
		}
		a.applications = deleteByID(a.applications, r.PathValue("id"))
		w.Write([]byte("{}"))
	}))
}

func deleteByID(items []map[string]any, id string) []map[string]any {
	n, _ := strconv.Atoi(id)
	return slices.DeleteFunc(items, func(item map[string]any) bool {
		return int(item["id"].(int)) == n
	})
}
