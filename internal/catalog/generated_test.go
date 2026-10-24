package catalog

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/helpers"
	"github.com/ajnart/self-host/internal/systemtest"
	"go.yaml.in/yaml/v3"
)

var hostSettings = map[string]bool{
	"TZ": true, "PUID": true, "PGID": true, "UMASK": true, "BIND_IP": true,
	"LAN_IP": true, "MEDIA_ROOT": true, "DOWNLOADS_ROOT": true,
	// The Admin login is in secrets.env for Apps that take it as env.
	"ADMIN_USER": true, "ADMIN_PASSWORD": true,
}

var composeRef = regexp.MustCompile(`\$\{([^}]+)\}`)

// recipeCommands mirrors the non-null recipe commands the generated Apps ship;
// each argument must survive into the rendered Compose.
var recipeCommands = map[string][]string{
	"victoria-metrics": {"-storageDataPath=/victoria-metrics-data", "-selfScrapeInterval=5s"},
}

type fakeSecrets map[string]string

func (s fakeSecrets) Get(key string) string       { return s[key] }
func (s fakeSecrets) Set(key, value string) error { s[key] = value; return nil }

func TestGeneratedAppsCompose(t *testing.T) {
	for _, a := range generatedApps() {
		a := a
		t.Run(a.Info().ID, func(t *testing.T) {
			info := a.Info()
			compose := a.Compose(app.RenderContext{Port: info.Port})

			var doc struct {
				Services map[string]struct {
					Image string   `yaml:"image"`
					Ports []string `yaml:"ports"`
				} `yaml:"services"`
			}
			if err := yaml.Unmarshal([]byte(compose), &doc); err != nil {
				t.Fatalf("Compose is not valid YAML: %v\n%s", err, compose)
			}
			if len(doc.Services) != 1 {
				t.Fatalf("want exactly one service, got %d", len(doc.Services))
			}
			svc, ok := doc.Services[info.Service]
			if !ok {
				t.Fatalf("missing service %q", info.Service)
			}
			if svc.Image != info.Image {
				t.Errorf("image = %q, want %q", svc.Image, info.Image)
			}
			tag := imageTag(svc.Image)
			if tag == "" {
				t.Errorf("image %q has no explicit tag", svc.Image)
			}
			if len(svc.Ports) == 0 {
				t.Fatalf("service %q has no ports", info.Service)
			}
			for _, p := range svc.Ports {
				if !strings.HasPrefix(p, "${BIND_IP}:") {
					t.Errorf("port %q does not bind via ${BIND_IP}", p)
				}
			}

			secrets := map[string]bool{}
			if d, ok := a.(app.SecretDeclarer); ok {
				prefix := strings.ToUpper(strings.ReplaceAll(info.ID, "-", "_")) + "_"
				for _, s := range d.Secrets() {
					secrets[prefix+strings.ToUpper(s.Name)] = true
				}
			}
			for _, m := range composeRef.FindAllStringSubmatch(compose, -1) {
				name := m[1]
				if hostSettings[name] || secrets[name] {
					continue
				}
				t.Errorf("Compose references %q, which is neither a host setting nor a declared secret", name)
			}

			for _, arg := range recipeCommands[info.ID] {
				if !strings.Contains(compose, arg) {
					t.Errorf("Compose is missing recipe command argument %q", arg)
				}
			}
		})
	}
}

func TestGeneratedAppsOnboard(t *testing.T) {
	for _, a := range generatedApps() {
		a := a
		t.Run(a.Info().ID, func(t *testing.T) {
			info := a.Info()
			deps := systemtest.NewDeps(t)
			var netdataSample atomic.Value
			netdataSample.Store(`{"labels":["time","user","system"],"data":[[%d,1,0]]}`)
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if info.ID == "netdata" {
					w.Header().Set("Content-Type", "application/json")
					if r.Method != http.MethodGet {
						w.WriteHeader(http.StatusMethodNotAllowed)
						return
					}
					switch r.URL.Path {
					case "/api/v1/info":
						fmt.Fprint(w, `{"version":"v2.11.0","alarms":{"normal":0,"warning":0,"critical":0}}`)
					case "/api/v1/charts":
						fmt.Fprint(w, `{"charts":{"netdata.server_cpu":{"id":"netdata.server_cpu","context":"netdata.server_cpu","plugin":"netdata","module":"pulse","units":"milliseconds/s","dimensions":{"user":{"name":"user"},"system":{"name":"system"}}}}}`)
					case "/api/v1/data":
						query := r.URL.Query()
						if query.Get("chart") != "netdata.server_cpu" || query.Get("after") != "-60" || query.Get("points") != "1" || query.Get("format") != "json" {
							w.WriteHeader(http.StatusBadRequest)
							return
						}
						fmt.Fprintf(w, netdataSample.Load().(string), deps.Now().Unix())
					default:
						w.WriteHeader(http.StatusNotFound)
					}
					return
				}
				if a.Info().ID == "glances" {
					w.Header().Set("Content-Type", "application/json")
					switch r.URL.Path {
					case "/api/4/status":
						w.Write([]byte(`{"version":"4.5.6"}`))
					case "/api/4/version":
						w.Write([]byte(`"4.5.6"`))
					case "/api/4/all":
						w.Write([]byte(`{"cpu":{"total":0},"mem":{"total":0,"used":0,"free":0},"network":[],"fs":[],"uptime":"0:00:00"}`))
					default:
						http.NotFound(w, r)
					}
					return
				}
				if a.Info().ID == "prometheus" {
					switch r.URL.Path {
					case "/api/v1/targets":
						fmt.Fprint(w, `{"status":"success","data":{"activeTargets":[{"health":"up","labels":{"job":"prometheus","instance":"localhost:9090"},"scrapeUrl":"http://localhost:9090/metrics"}],"droppedTargets":[]}}`)
					case "/api/v1/query":
						if r.URL.Query().Get("query") != `up{job="prometheus",instance="localhost:9090"}[1m]` {
							w.WriteHeader(http.StatusBadRequest)
							return
						}
						fmt.Fprintf(w, `{"status":"success","data":{"resultType":"matrix","result":[{"metric":{"__name__":"up","job":"prometheus","instance":"localhost:9090"},"values":[[%d,"1"]]}]}}`, deps.Now().Unix())
					default:
						w.WriteHeader(http.StatusNotFound)
					}
					return
				}
				w.WriteHeader(http.StatusOK)
				if a.Info().ID == "dashdot" {
					switch r.URL.Path {
					case "/config":
						w.Write([]byte(`{"config":{"widget_list":["cpu","ram"],"running_in_docker":false,"disable_background_stats_collection":true,"disable_integrations":false,"enable_cpu_temps":false}}`))
					case "/info":
						w.Write([]byte(`{"cpu":{"brand":"Kernel CPU","model":"Model","threads":2},"ram":{"size":8192}}`))
					case "/load/cpu":
						w.Write([]byte(`[{"load":0,"temp":0},{"load":0,"temp":0}]`))
					case "/load/ram":
						w.Write([]byte(`{"load":0}`))
					}
				}
			}))
			defer srv.Close()
			h := helpers.New(helpers.Config{
				App:     info.ID,
				Service: info.Service,
				BaseURL: srv.URL,
				URL:     srv.URL,
				HTTP:    srv.Client(),
				Secrets: fakeSecrets{},
				Log:     events.Discard(),
				Now:     deps.Now,
				Sleep:   deps.Sleep,
			})
			ctx := context.Background()
			if err := a.Setup(ctx, h); err != nil {
				t.Fatalf("Setup: %v", err)
			}
			if err := a.Check(ctx, h); err != nil {
				t.Fatalf("Check: %v", err)
			}
			if info.ID != "netdata" {
				return
			}
			for _, sample := range []struct {
				name, body string
				valid      bool
			}{
				{"unrelated dimension", `{"labels":["time","unrelated"],"data":[[%d,0]]}`, false},
				{"missing system", `{"labels":["time","user"],"data":[[%d,0]]}`, false},
				{"missing user", `{"labels":["time","system"],"data":[[%d,0]]}`, false},
				{"duplicate user", `{"labels":["time","user","user"],"data":[[%d,0,0]]}`, false},
				{"duplicate system", `{"labels":["time","system","system"],"data":[[%d,0,0]]}`, false},
				{"duplicate time", `{"labels":["time","time","system"],"data":[[%d,0,0]]}`, false},
				{"misplaced time", `{"labels":["user","time","system"],"data":[[%d,0,0]]}`, false},
				{"extra dimension", `{"labels":["time","user","system","unrelated"],"data":[[%d,0,0,0]]}`, false},
				{"misaligned columns", `{"labels":["time","user","system"],"data":[[%d,0]]}`, false},
				{"native zero CPU", `{"labels":["time","user","system"],"data":[[%d,0,0]]}`, true},
				{"native reversed CPU", `{"labels":["time","system","user"],"data":[[%d,0,1]]}`, true},
			} {
				netdataSample.Store(sample.body)
				err := a.Check(ctx, h)
				if sample.valid && err != nil {
					t.Fatalf("Netdata Check rejected %s: %v", sample.name, err)
				}
				if !sample.valid && err == nil {
					t.Fatalf("Netdata Check accepted %s", sample.name)
				}
			}
		})
	}
}

func TestDefaultAppIDsUnique(t *testing.T) {
	seen := map[string]bool{}
	for _, a := range Default().Apps() {
		id := a.Info().ID
		if seen[id] {
			t.Errorf("duplicate App ID %q", id)
		}
		seen[id] = true
	}
}

func imageTag(image string) string {
	idx := strings.LastIndex(image, ":")
	if idx < 0 {
		return ""
	}
	return image[idx+1:]
}
