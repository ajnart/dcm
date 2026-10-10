package names_test

import (
	"context"
	"slices"
	"strings"
	"testing"

	"github.com/ajnart/self-host/internal/names"
	"github.com/ajnart/self-host/internal/systemtest"
)

func TestHostEmbedsTheLANAddressWithDashes(t *testing.T) {
	got, ok := names.Host("jellyfin", "192.168.1.20")
	if !ok || got != "jellyfin.192-168-1-20.sslip.io" {
		t.Fatalf("Host = %q, %v; want jellyfin.192-168-1-20.sslip.io", got, ok)
	}
}

func TestNoNameIsBuiltFromAnAddressThatIsNotAnIPv4(t *testing.T) {
	for _, lan := range []string{"", "auto", "fe80::1", "192.168.1", "movies.local"} {
		if got, ok := names.Host("jellyfin", lan); ok {
			t.Errorf("Host(%q) = %q, want no name", lan, got)
		}
	}
}

func TestCaddyfileRoutesEachNameToItsAppAndAnswersUnknownNamesWith404(t *testing.T) {
	got := names.Caddyfile([]names.Route{
		{Host: "jellyfin.192-168-1-20.sslip.io", Upstream: "jellyfin:8096"},
		{Host: "sonarr.192-168-1-20.sslip.io", Upstream: "sonarr:8989"},
	})
	want := `{
	admin off
	auto_https off
}

http://jellyfin.192-168-1-20.sslip.io {
	reverse_proxy jellyfin:8096
}

http://sonarr.192-168-1-20.sslip.io {
	reverse_proxy sonarr:8989
}

http://:80 {
	respond "self-host: unknown name" 404
}
`
	if got != want {
		t.Fatalf("Caddyfile:\n%s\nwant:\n%s", got, want)
	}
}

func TestCaddyfileWithoutAppsStillAnswersUnknownNames(t *testing.T) {
	got := names.Caddyfile(nil)
	want := "{\n\tadmin off\n\tauto_https off\n}\n\nhttp://:80 {\n\trespond \"self-host: unknown name\" 404\n}\n"
	if got != want {
		t.Fatalf("Caddyfile:\n%s\nwant:\n%s", got, want)
	}
}

func TestFragmentPublishesPortEightyAndMountsTheCaddyfileFolderReadOnly(t *testing.T) {
	got := names.Fragment()
	want := `services:
  access-caddy:
    image: caddy:2.11.4
    restart: unless-stopped
    ports:
      - ${BIND_IP}:80:80
    volumes:
      - ./config:/etc/caddy:ro
`
	if got != want {
		t.Fatalf("Fragment:\n%s\nwant:\n%s", got, want)
	}
}

func diagnose(r *systemtest.Resolver) names.Verdict {
	return names.Diagnose(context.Background(), r, "192.168.1.20")
}

func TestNamesWorkWhenThisComputersResolverAnswersTheProbeWithTheLANAddress(t *testing.T) {
	r := &systemtest.Resolver{}
	if got := diagnose(r); got != names.Working {
		t.Fatalf("verdict %q, want working", got)
	}
	if want := []string{"selfhost-probe.192-168-1-20.sslip.io"}; !slices.Equal(r.Queries(), want) {
		t.Fatalf("asked %q, want only %q", r.Queries(), want)
	}
}

func TestARouterThatDropsPrivateAnswersIsToldApartFromBeingOffline(t *testing.T) {
	r := &systemtest.Resolver{Blocked: true}
	if got := diagnose(r); got != names.Blocked {
		t.Fatalf("verdict %q, want blocked", got)
	}
	wantAsked := []string{"selfhost-probe.192-168-1-20.sslip.io", "selfhost-control.1-1-1-1.sslip.io"}
	if !slices.Equal(r.Queries(), wantAsked) {
		t.Fatalf("asked %q, want probe then control %q", r.Queries(), wantAsked)
	}
	if want := []string{"1.1.1.1:53 selfhost-probe.192-168-1-20.sslip.io"}; !slices.Equal(r.Via, want) {
		t.Fatalf("direct queries %q, want %q", r.Via, want)
	}
}

func TestNoInternetNameLookupIsOffline(t *testing.T) {
	if got := diagnose(&systemtest.Resolver{Offline: true}); got != names.Offline {
		t.Fatalf("verdict %q, want offline", got)
	}
}

func TestAnAnswerForAnotherAddressIsRewritten(t *testing.T) {
	if got := diagnose(&systemtest.Resolver{Rewrite: "10.0.0.1"}); got != names.Rewritten {
		t.Fatalf("verdict %q, want rewritten", got)
	}
}

func TestWhenOnlyTheDirectQueryFailsTheNameServiceIsUnreachable(t *testing.T) {
	if got := diagnose(&systemtest.Resolver{Blocked: true, NoDirect: true}); got != names.Unreachable {
		t.Fatalf("verdict %q, want unreachable", got)
	}
}

func TestEveryProblemHasOnePlainSentenceThatKeepsTheNumberedAddresses(t *testing.T) {
	for _, v := range []names.Verdict{names.Blocked, names.Offline, names.Rewritten, names.Unreachable} {
		s := v.Sentence()
		if s == "" || strings.Contains(s, "\n") || !strings.Contains(s, "addresses with numbers") {
			t.Errorf("%s: sentence %q", v, s)
		}
		for _, jargon := range []string{"DNS", "rebind", "sslip", "resolver"} {
			if strings.Contains(s, jargon) {
				t.Errorf("%s: sentence %q has jargon %q", v, s, jargon)
			}
		}
	}
	if names.Working.Sentence() != "" {
		t.Errorf("working has nothing to say, got %q", names.Working.Sentence())
	}
}

func TestTheRouterFixIsATechnicalDetail(t *testing.T) {
	if got := names.Blocked.Technical(); !strings.Contains(got, "DNS-rebind") || !strings.Contains(got, "sslip.io") {
		t.Fatalf("technical details %q", got)
	}
}
