package e2e

import (
	"context"
	"slices"
	"testing"

	"github.com/ajnart/self-host/internal/catalog"
)

func TestPassboltOwnedPrerequisitesCountTowardAdmissionAndImages(t *testing.T) {
	c := catalog.Default()
	target := findTarget(acceptanceInventory(c), "passbolt")
	if targetEnvironmentCount(target) != 2 {
		t.Fatal("owned Passbolt prerequisite environment excluded from capacity")
	}
	guard := newSweepGuard(1)
	lease, err := guard.acquire(context.Background(), targetEnvironmentCount(target), exclusiveTarget(c, target))
	if err != nil {
		t.Fatal("Passbolt prerequisite admission failed")
	}
	defer lease.finish(true)
	if _, count := guard.capacity(); count != 2 {
		t.Fatal("owned prerequisite capacity was not reserved")
	}
	if !slices.Contains(expectedServices(target), "passbolt-prerequisites") {
		t.Fatal("owned prerequisite image/service inventory missing")
	}
	if classifyTarget(c, target) != "runnable" {
		t.Fatal("owned runtime prerequisites still classified as unavailable")
	}
	if len(target.Apps) != 1 {
		t.Fatal("native fixture was mislabeled as a catalog App")
	}
	if targetEnvironmentCount(targetSpec{Apps: []string{"ntfy"}}) != 1 {
		t.Fatal("ordinary App capacity changed")
	}
}

func TestPassboltPrerequisiteProofPreservesManualEnrollmentBoundary(t *testing.T) {
	e := newEvidence(targetSpec{Kind: "app", ID: "passbolt", Apps: []string{"passbolt"}}, "fixture")
	preparePassboltEvidence(e)
	if e.Stages[0].Name != "install" || e.Stages[1].Name != "local-prerequisites" {
		t.Fatal("separate prerequisite evidence unavailable when install ends manual")
	}
	e.Outcome = "manual"
	e.Stages[0].Outcome = "manual"
	e.Stages[1].Outcome = "pass"
	if e.complete() || e.Stages[2].Outcome != "not-run" {
		t.Fatal("local prerequisite proof promoted manual enrollment to lifecycle acceptance")
	}
	var restoreProof bool
	for i, stage := range e.Stages {
		if stage.Name == "restored-local-prerequisites" && i > 0 && e.Stages[i-1].Name == "restored-check" {
			restoreProof = stage.Outcome == "not-run"
		}
	}
	if !restoreProof {
		t.Fatal("restored prerequisite proof missing or falsely passed")
	}
}
