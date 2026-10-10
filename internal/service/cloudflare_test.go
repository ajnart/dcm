package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/apps/cloudflaretunnel"
	tsapp "github.com/ajnart/self-host/internal/apps/tailscale"
	"github.com/ajnart/self-host/internal/cloudflare/cloudflaretest"
	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/system"
	"github.com/ajnart/self-host/internal/systemtest"
)

type publicationApp struct {
	testApp
	category string
	noWeb    bool
}

func (a *publicationApp) Info() app.Info {
	info := a.testApp.Info()
	info.Category, info.NoWebUI = a.category, a.noWeb
	return info
}

type cloudflareTransport struct {
	server *cloudflaretest.Server
	status int
}

func (tr cloudflareTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	if req.URL.Hostname() == "api.cloudflare.com" {
		copy := req.Clone(req.Context())
		target, _ := url.Parse(tr.server.URL)
		copy.URL.Scheme, copy.URL.Host = target.Scheme, target.Host
		return http.DefaultTransport.RoundTrip(copy)
	}
	tr.server.Mark("PROBE", "GET "+req.URL.String())
	return &http.Response{StatusCode: tr.status, Header: http.Header{"Location": {"https://myteam.cloudflareaccess.com/login"}}, Body: http.NoBody, Request: req}, nil
}

func publicationHarness(t *testing.T) (*harness, *cloudflaretest.Server, CloudflareOptions) {
	t.Helper()
	h := newHarness(t,
		&publicationApp{testApp: testApp{id: "paperless-ngx", done: map[string]bool{}}, category: "Documents"},
		&publicationApp{testApp: testApp{id: "jellyfin", done: map[string]bool{}}, category: "Media"},
		&publicationApp{testApp: testApp{id: "qbittorrent", done: map[string]bool{}}, category: "Downloads"},
		&publicationApp{testApp: testApp{id: "postgresql", done: map[string]bool{}}, category: "Databases", noWeb: true},
		cloudflaretunnel.App{}, tsapp.App{})
	if err := h.install("paperless-ngx", "jellyfin", "qbittorrent", "postgresql"); err != nil {
		t.Fatal(err)
	}
	server := cloudflaretest.New(t, cloudflaretest.Options{Token: "private-api-fixture", Domain: "example.com", Team: "myteam"})
	h.deps.HTTP = &http.Client{Transport: cloudflareTransport{server: server, status: 302}}
	return h, server, CloudflareOptions{Domain: "example.com", Emails: []string{"alice@example.org"}, Apps: []string{"paperless-ngx", "jellyfin"}, APIToken: "private-api-fixture", AcceptPublic: true}
}

func TestCloudflareNeedsSeparatePublicationYes(t *testing.T) {
	h, server, opts := publicationHarness(t)
	opts.AcceptPublic = false
	_, err := h.svc.CloudflarePublish(t.Context(), opts)
	if !errors.Is(err, ErrPublicNotAccepted) || len(server.Calls()) != 0 {
		t.Fatalf("err=%v calls=%v", err, server.Calls())
	}
}

func TestCombinedAccessKeepsPrivatePublicAndLocalAddressesThroughPartialRestore(t *testing.T) {
	h, server, opts := publicationHarness(t)
	net := &tailnet{running: []string{"tailscale", "tailscale-paperless-ngx", "tailscale-jellyfin", "paperless-ngx", "jellyfin"}, status: map[string]string{"tailscale-paperless-ngx": runningNode("paperless-ngx-2.example.ts.net.", nil)}}
	net.install(h)
	if err := h.installTailscale(); err != nil {
		t.Fatal(err)
	}
	if _, err := h.svc.CloudflarePublish(t.Context(), opts); err != nil {
		t.Fatal(err)
	}
	a := appStatus(t, h, "paperless-ngx")
	want := []string{"https://paperless-ngx-2.example.ts.net", "https://paperless-ngx.example.com", "http://192.168.1.20:9000"}
	if !slices.Equal(a.Addresses, want) || a.URL != want[0] || a.observationURL() != want[2] {
		t.Fatalf("combined Addresses: %+v local %s", a, a.observationURL())
	}
	archive, err := h.svc.Backup(t.Context(), []string{"paperless-ngx"}, filepath.Join(t.TempDir(), "combined.tar.zst"), "")
	if err != nil {
		t.Fatal(err)
	}
	net.running = []string{"tailscale", "paperless-ngx", "jellyfin", "cloudflare-tunnel"}
	net.stopped = []string{"tailscale-jellyfin"}
	net.trackStartup = true
	before := len(h.composeCalls())
	server.Reset()
	if err := h.svc.Restore(t.Context(), archive, []string{"paperless-ngx"}, ""); err != nil {
		t.Fatal(err)
	}
	if !slices.Contains(net.running, "tailscale-paperless-ngx") {
		t.Fatal("approved absent private node not started")
	}
	for _, call := range h.composeCalls()[before:] {
		if strings.HasPrefix(call, "up -d") && (strings.Contains(call, "cloudflare-tunnel") || strings.Contains(call, "tailscale-jellyfin") || strings.HasSuffix(call, " tailscale")) {
			t.Fatalf("Restore started held or stopped Access: %s", call)
		}
	}
	a = appStatus(t, h, "paperless-ngx")
	if !slices.Equal(a.Addresses, []string{want[0], want[2]}) || a.URL != want[0] || a.observationURL() != want[2] {
		t.Fatalf("restored Addresses: %+v", a)
	}
	status, err := h.svc.Status(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	if !status.CloudflareCleanup || len(status.AccessWarnings) == 0 || slices.Contains(status.Access, "cloudflare") || !slices.Contains(status.Access, "tailscale") {
		t.Fatalf("restored ownership warnings: %+v", status)
	}
	opts.AcceptPublic = false
	if _, err := h.svc.CloudflarePublish(t.Context(), opts); !errors.Is(err, ErrPublicNotAccepted) {
		t.Fatal("Restore bypassed specific approval", err)
	}
	if len(server.Calls()) != 0 {
		t.Fatal("Restore or missing approval called Cloudflare", server.Calls())
	}
}

func TestCloudflareRefusesPrivateCategoriesAndNoWebAppsAndWarnsForMedia(t *testing.T) {
	h, _, opts := publicationHarness(t)
	opts.Apps = []string{"jellyfin", "qbittorrent", "postgresql"}
	plan, err := h.svc.CloudflarePlan(t.Context(), opts)
	if err != nil {
		t.Fatal(err)
	}
	if len(plan.Publish) != 1 || len(plan.Refused) != 2 || !strings.Contains(plan.Publish[0].Warning, "Tailscale") || !strings.Contains(plan.Publish[0].Warning, "phone and TV") {
		t.Fatalf("plan %+v", plan)
	}
	opts.Allow = []string{"qbittorrent", "postgresql"}
	plan, err = h.svc.CloudflarePlan(t.Context(), opts)
	if err != nil || len(plan.Publish) != 2 || len(plan.Refused) != 1 {
		t.Fatalf("plan %+v err %v", plan, err)
	}
}

func TestCloudflarePublishesHTTPSKeepsLANAndStoresOnlyRunToken(t *testing.T) {
	h, _, opts := publicationHarness(t)
	res, err := h.svc.CloudflarePublish(t.Context(), opts)
	if err != nil || len(res.Published) != 2 {
		t.Fatalf("result %+v err %v", res, err)
	}
	status, err := h.svc.Status(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	if !slices.Contains(status.Access, "cloudflare") {
		t.Fatalf("access %v", status.Access)
	}
	as := appStatus(t, h, "paperless-ngx")
	if !slices.Equal(as.Addresses, []string{"https://paperless-ngx.example.com", "http://192.168.1.20:9000"}) || as.URL != "https://paperless-ngx.example.com" {
		t.Fatalf("addresses %v url %s", as.Addresses, as.URL)
	}
	p, _ := h.svc.Project()
	secrets, err := p.LoadSecrets()
	if err != nil || secrets["CLOUDFLARE_TUNNEL_TOKEN"] != cloudflaretest.TunnelToken {
		t.Fatal("run token not stored", err)
	}
	for _, value := range secrets {
		if value == opts.APIToken {
			t.Fatal("API token stored")
		}
	}
	state, _ := p.LoadState()
	data, _ := json.Marshal(state)
	log, _ := json.Marshal(h.rec.events)
	if strings.Contains(string(data)+string(log)+strings.Join(h.runner.Calls(), " "), opts.APIToken) || strings.Contains(string(data)+string(log), cloudflaretest.TunnelToken) {
		t.Fatal("secret leaked")
	}
	opts.APIToken = ""
	if err := h.svc.CloudflareRemove(context.Background(), opts); err == nil || !strings.Contains(err.Error(), "privately") {
		t.Fatalf("removal did not request new token: %v", err)
	}
}

func TestCloudflareServiceStartsTheConnectorOnlyAfterIngressAndBeforeDNS(t *testing.T) {
	h, server, opts := publicationHarness(t)
	h.runner.OnFunc("docker compose --project-directory", func(cmd system.Cmd) system.Result {
		if strings.Contains(systemtest.Line(cmd), "up -d --remove-orphans cloudflare-tunnel") {
			server.Mark("LOCAL", "start the connector")
		}
		return system.Result{}
	})
	if _, err := h.svc.CloudflarePublish(t.Context(), opts); err != nil {
		t.Fatal(err)
	}
	calls := server.Calls()
	start := slices.Index(calls, "LOCAL start the connector")
	ingress := slices.Index(calls, "PUT /accounts/acct-1/cfd_tunnel/tunnel-1/configurations")
	dns := slices.Index(calls, "POST /zones/zone-1/dns_records")
	if ingress < 0 || start <= ingress || dns <= start {
		t.Fatalf("unsafe order:\n%s", strings.Join(calls, "\n"))
	}
}

func TestCloudflareFailedProbeIsNotAnAddressAndStillCanBeRemoved(t *testing.T) {
	h, server, opts := publicationHarness(t)
	h.deps.HTTP = &http.Client{Transport: cloudflareTransport{server: server, status: 200}}
	res, err := h.svc.CloudflarePublish(t.Context(), opts)
	if !errors.Is(err, ErrIncomplete) || len(res.Published) != 0 || len(res.Failed) != 2 || len(server.Records()) != 0 {
		t.Fatalf("result %+v err %v", res, err)
	}
	as := appStatus(t, h, "paperless-ngx")
	if !slices.Equal(as.Addresses, []string{"http://192.168.1.20:9000"}) {
		t.Fatalf("unverified Address in status %v", as.Addresses)
	}
	if err := h.svc.CloudflareRemove(t.Context(), opts); err != nil {
		t.Fatal(err)
	}
	tunnels, policies, apps, idps, records := server.Count()
	if tunnels != 0 || policies != 0 || apps != 0 || idps != 1 || records != 0 {
		t.Fatal("failed publication could not be removed")
	}
}

func TestIndependentDefaultProjectsDoNotShareCloudflareResources(t *testing.T) {
	a, server, first := publicationHarness(t)
	b, _, second := publicationHarness(t)
	b.deps.HTTP = a.deps.HTTP
	second.Domain = "other.example"
	second.Emails = []string{"bob@example.org"}
	server.AddZone("other.example")
	if _, err := a.svc.CloudflarePublish(t.Context(), first); err != nil {
		t.Fatal(err)
	}
	if _, err := b.svc.CloudflarePublish(t.Context(), second); err != nil {
		t.Fatal(err)
	}
	tunnels, policies, apps, _, records := server.Count()
	if tunnels != 2 || policies != 2 || apps != 4 || records != 4 {
		t.Fatalf("Projects shared resources: %d %d %d %d", tunnels, policies, apps, records)
	}
	server.Reset()
	if _, err := a.svc.CloudflarePublish(t.Context(), first); err != nil {
		t.Fatal(err)
	}
	for _, call := range server.Writes() {
		if strings.HasPrefix(call, "POST") {
			t.Fatalf("rerun duplicated resources: %s", call)
		}
	}
	if err := a.svc.CloudflareRemove(t.Context(), first); err != nil {
		t.Fatal(err)
	}
	tunnels, policies, apps, _, records = server.Count()
	if tunnels != 1 || policies != 1 || apps != 2 || records != 2 {
		t.Fatal("removal crossed Project ownership")
	}
}

type publicationBarrier struct {
	base        http.RoundTripper
	enteredOnce atomic.Bool
	entered     chan struct{}
	release     chan struct{}
}

func (b *publicationBarrier) RoundTrip(req *http.Request) (*http.Response, error) {
	if strings.HasSuffix(req.URL.Path, "/access/organizations") {
		if b.enteredOnce.CompareAndSwap(false, true) {
			close(b.entered)
			<-b.release
		}
	}
	return b.base.RoundTrip(req)
}

func TestCloudflareTransactionSerializesPublishAndRemove(t *testing.T) {
	for _, remove := range []bool{false, true} {
		t.Run(fmt.Sprint(remove), func(t *testing.T) {
			h, server, opts := publicationHarness(t)
			if _, err := h.svc.CloudflarePublish(t.Context(), opts); err != nil {
				t.Fatal(err)
			}
			barrier := &publicationBarrier{base: h.deps.HTTP.Transport, entered: make(chan struct{}), release: make(chan struct{})}
			h.deps.HTTP = &http.Client{Transport: barrier}
			other := New(h.deps, events.Discard(), h.svc.Catalog)
			first, second := make(chan error, 1), make(chan error, 1)
			go func() { _, err := h.svc.CloudflarePublish(t.Context(), opts); first <- err }()
			<-barrier.entered
			go func() {
				if remove {
					second <- other.CloudflareRemove(t.Context(), opts)
					return
				}
				next := opts
				next.Apps = []string{"paperless-ngx"}
				_, err := other.CloudflarePublish(t.Context(), next)
				second <- err
			}()
			select {
			case err := <-second:
				close(barrier.release)
				<-first
				t.Fatalf("overlap was not held at Project lock: %v", err)
			case <-time.After(40 * time.Millisecond):
			}
			close(barrier.release)
			if err := <-first; err != nil {
				t.Fatal(err)
			}
			if err := <-second; err != nil {
				t.Fatal(err)
			}
			p, _ := h.svc.Project()
			rec, _, err := loadCloudflareRecord(p)
			if err != nil {
				t.Fatal(err)
			}
			want := 1
			if remove {
				want = 0
			}
			if len(rec.Hosts) != want || len(server.Records()) != want {
				t.Fatalf("lost publication receipt: record %+v DNS %v", rec, server.Records())
			}
		})
	}
}

func TestEarlyCloudflareFailuresRetainVerifiedAddressesAndCleanupReceipts(t *testing.T) {
	for _, fault := range []struct{ method, path string }{{"GET", "/zones"}, {"GET", "/accounts/acct-1/access/organizations"}, {"GET", "/accounts/acct-1/access/identity_providers"}, {"GET", "/accounts/acct-1/cfd_tunnel"}, {"GET", "/zones/zone-1/dns_records"}, {"DELETE", "/zones/zone-1/dns_records/dns-2"}} {
		t.Run(fault.method+fault.path, func(t *testing.T) {
			h, server, opts := publicationHarness(t)
			if _, err := h.svc.CloudflarePublish(t.Context(), opts); err != nil {
				t.Fatal(err)
			}
			p, _ := h.svc.Project()
			before, _, _ := loadCloudflareRecord(p)
			if strings.Contains(fault.path, "dns_records") {
				opts.Apps = []string{"paperless-ngx"}
			}
			server.SetFailure(fault.method, fault.path)
			if _, err := h.svc.CloudflarePublish(t.Context(), opts); err == nil {
				t.Fatal("fault not applied")
			}
			a := appStatus(t, h, "paperless-ngx")
			if a.URL != "https://paperless-ngx.example.com" || len(server.Records()) != 2 {
				t.Fatalf("truth lost: %+v DNS %v", a, server.Records())
			}
			after, _, _ := loadCloudflareRecord(p)
			if before.Ownership.TunnelID != after.Ownership.TunnelID || len(after.Hosts) != 2 || after.Warning == "" {
				t.Fatal("ownership or warning lost")
			}
			server.SetFailure("", "")
			if err := h.svc.CloudflareRemove(t.Context(), opts); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestOrdinaryConnectorRemovalCannotAbandonPublishedRoutes(t *testing.T) {
	h, server, opts := publicationHarness(t)
	if _, err := h.svc.CloudflarePublish(t.Context(), opts); err != nil {
		t.Fatal(err)
	}
	server.Reset()
	err := h.svc.Remove(t.Context(), []string{cloudflareConnector}, false)
	if err == nil || !strings.Contains(err.Error(), "cloudflare remove") {
		t.Fatalf("connector removed: %v", err)
	}
	if len(server.Calls()) != 0 {
		t.Fatal("unauthorized API cleanup", server.Calls())
	}
}

func TestCloudflareBackupRestoreRetainsOwnershipButRequiresPublicationApproval(t *testing.T) {
	for _, kind := range []string{"fresh", "full", "partial", "legacy", "legacy-partial"} {
		t.Run(kind, func(t *testing.T) {
			h, server, opts := publicationHarness(t)
			if _, err := h.svc.CloudflarePublish(t.Context(), opts); err != nil {
				t.Fatal(err)
			}
			p, _ := h.svc.Project()
			before, _, _ := loadCloudflareRecord(p)
			if kind == "legacy" || kind == "legacy-partial" {
				if err := os.Remove(p.Path(cloudflareRecordFile)); err != nil {
					t.Fatal(err)
				}
			}
			file, err := h.svc.Backup(t.Context(), nil, filepath.Join(t.TempDir(), "copy.tar.zst"), "")
			if err != nil {
				t.Fatal(err)
			}
			if kind == "legacy-partial" {
				if err := writeCloudflareRecord(p, before); err != nil {
					t.Fatal(err)
				}
			}
			restored := h
			if kind == "fresh" || kind == "legacy" {
				restored = newHarness(t)
				restored.svc.Catalog = h.svc.Catalog
				restored.deps.HTTP = h.deps.HTTP
			}
			var targets []string
			if kind == "partial" || kind == "legacy-partial" {
				targets = []string{"paperless-ngx"}
			}
			start := len(restored.runner.Calls())
			server.Reset()
			if err := restored.svc.Restore(t.Context(), file, targets, ""); err != nil {
				t.Fatal(err)
			}
			for _, call := range restored.runner.Calls()[start:] {
				if strings.Contains(call, "up -d") && strings.Contains(call, cloudflareConnector) {
					t.Fatalf("restore approved public startup: %s", call)
				}
			}
			if len(server.Calls()) != 0 {
				t.Fatal("restore made remote changes")
			}
			p, _ = restored.svc.Project()
			after, _, _ := loadCloudflareRecord(p)
			if !after.Suspended {
				t.Fatal("restored connector not held")
			}
			if kind != "legacy" && after.Ownership.TunnelID != before.Ownership.TunnelID {
				t.Fatal("cleanup receipt lost")
			}
			status, err := restored.svc.Status(t.Context())
			if err != nil {
				t.Fatal(err)
			}
			for _, a := range status.Apps {
				if strings.HasPrefix(a.URL, "https://") {
					t.Fatal("suspended Address preferred", a)
				}
			}
			start = len(restored.runner.Calls())
			if err := restored.svc.Start(t.Context(), nil); err != nil {
				t.Fatal(err)
			}
			for _, call := range restored.runner.Calls()[start:] {
				if strings.Contains(call, "up -d") && strings.Contains(call, cloudflareConnector) {
					t.Fatal("generic Start bypassed publication approval", call)
				}
			}
			if kind == "legacy" {
				if _, err := restored.svc.CloudflarePublish(t.Context(), opts); err == nil {
					t.Fatal("legacy resources auto adopted")
				}
				return
			}
			if _, err := restored.svc.CloudflarePublish(t.Context(), opts); err != nil {
				t.Fatal(err)
			}
			if err := restored.svc.CloudflareRemove(t.Context(), opts); err != nil {
				t.Fatal(err)
			}
		})
	}
}
