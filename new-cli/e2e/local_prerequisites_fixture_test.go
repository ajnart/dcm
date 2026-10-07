package e2e

import (
	"context"
	"github.com/ajnart/self-host/internal/catalog"
	"reflect"
	"slices"
	"testing"
)

func TestHAProxyOwnedBackendIsIncludedBeforeAdmission(t *testing.T) {
	c := catalog.Default()
	original := findTarget(acceptanceInventory(c), "haproxy")
	target := withOwnedPrerequisites(original)
	if !reflect.DeepEqual(target.Apps, []string{"haproxy", "ntfy"}) || len(original.Apps) != 1 || !exclusiveTarget(c, target) || classifyTarget(c, target) != "runnable" {
		t.Fatal("owned backend missing from complete target or admission accounting")
	}
	if !reflect.DeepEqual(withOwnedPrerequisites(target).Apps, target.Apps) {
		t.Fatal("backend duplicated")
	}
	guard := newSweepGuard(4)
	lease, err := guard.acquire(context.Background(), len(target.Apps), exclusiveTarget(c, target))
	if err != nil {
		t.Fatal("complete owned fixture could not be admitted")
	}
	defer lease.finish(true)
	if jobs, apps := guard.capacity(); jobs != 1 || apps != 2 {
		t.Fatal("owned backend omitted from global App budget")
	}
	args := installArguments(target, "/tmp/fixture", map[string]int{"haproxy": 30001, "ntfy": 30002})
	if !reflect.DeepEqual(args[:3], []string{"install", "haproxy", "ntfy"}) {
		t.Fatal("CLI does not install both owned Apps")
	}
	for _, arg := range []string{"haproxy.target-app=ntfy", "haproxy.target-port=80", "ntfy.port=30002"} {
		if !slices.Contains(args, arg) {
			t.Fatal("owned backend configuration missing")
		}
	}
	services := expectedServices(target)
	if len(services) != 2 || !slices.Contains(services, "haproxy") || !slices.Contains(services, "ntfy") {
		t.Fatal("backend excluded from readiness/image inventory")
	}
	e := newEvidence(target, "fixture")
	for _, stage := range e.Stages {
		if len(stage.Apps) != 2 {
			t.Fatal("backend excluded from lifecycle/backup/restore")
		}
	}
}

func TestLocalRoutingPrerequisitesAreNotExternalCredentials(t *testing.T) {
	c := catalog.Default()
	for _, id := range []string{"passbolt", "wud"} {
		if classifyTarget(c, findTarget(acceptanceInventory(c), id)) != "awaiting-local-prerequisites" {
			t.Fatalf("%s local prerequisite classified as external credentials", id)
		}
	}
	if classifyTarget(c, findTarget(acceptanceInventory(c), "netbird")) != "runnable" {
		t.Fatal("owned NetBird TLS fixture remains external prerequisite")
	}
}

func TestStalwartLocalInputsReachManualBoundary(t *testing.T) {
	c := catalog.Default()
	target := findTarget(acceptanceInventory(c), "stalwart-mail")
	if classifyTarget(c, target) != "runnable" || externalApps["stalwart-mail"] || localInputs["stalwart-mail"]["STALWART_HOSTNAME"] != "mail.e2e.selfhost.test" || localInputs["stalwart-mail"]["STALWART_DOMAIN"] != "e2e.selfhost.test" {
		t.Fatal("ordinary local domain inputs still classified as external")
	}
	e := newEvidence(target, "fixture")
	e.Outcome, e.Stages[0].Outcome = "manual", "manual"
	if e.complete() {
		t.Fatal("manual administrator boundary promoted to lifecycle pass")
	}
}
