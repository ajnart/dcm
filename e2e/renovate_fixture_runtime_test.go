//go:build e2e

package e2e

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"slices"
	"time"
)

type renovateRuntimeFixture struct {
	port  int
	path  string
	forge *renovateForgejoFixture
}

func (r *runner) prepareRenovateFixture(ports map[string]int) {
	if !slices.Contains(r.spec.Apps, "renovate") {
		return
	}
	var stages []stageEvidence
	for _, stage := range r.evidence.Stages {
		stages = append(stages, stage)
		name := ""
		if stage.Name == "update" {
			name = "forge-token-identity"
		}
		if stage.Name == "restored-check" {
			name = "restored-forge-token-identity"
		}
		if name != "" {
			stages = append(stages, stageEvidence{Name: name, Outcome: "not-run", Apps: map[string]string{"renovate": "not-run", "forgejo": "not-run"}})
		}
	}
	r.evidence.Stages = stages
	r.evidence.Probe += "; Renovate prepared and inert (--version only), no dependency jobs, scheduler or pull-request claim; actual dedicated owned Forgejo PAT identity and exact persisted token ID before backup and after restore"
	f := &renovateRuntimeFixture{port: ports["forgejo"], path: filepath.Join(r.root, "renovate-pat")}
	r.attachRenovateFixture(f)
}

func renovateFixtureFailure(reason string) result {
	return result{code: 1, events: []event{{Event: "step.fail", App: "renovate", Step: "forge-token-identity", Error: reason, Hint: "inspect the owned Forgejo prerequisite and retry this isolated fixture; Renovate remains inert"}}}
}

func renovateFixtureContext(r *runner) (context.Context, context.CancelFunc) {
	parent := r.commandCtx
	if parent == nil {
		parent = context.Background()
	}
	return context.WithTimeout(parent, 45*time.Second)
}

func renovateFixtureClient() *http.Client {
	return &http.Client{Timeout: 15 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
}

// Both original and restored credentials come through the public private
// handoff command. Its JSON remains in memory, never ordinary evidence.
func renovateCredentialHandoff(r *runner) (admin, password, token string, ok bool) {
	res := r.runWithTimeout(30*time.Second, "credentials", "--json")
	if res.code != 0 {
		return "", "", "", false
	}
	return decodeRenovateCredentialHandoff([]byte(res.stdout))
}

func (f *renovateRuntimeFixture) install(r *runner, args []string, ports map[string]int) result {
	// A real owned Forgejo is applied first inside the target's install stage;
	// only then can the dedicated bot and real PAT be issued by its API.
	forgeArgs := installArguments(targetSpec{Kind: "app", ID: "forgejo", Apps: []string{"forgejo"}}, r.storageRoot, ports)
	res := r.runWithTimeout(installCommandLimit(r.spec), forgeArgs...)
	if res.code != 0 {
		return res
	}
	admin, password, _, ok := renovateCredentialHandoff(r)
	if !ok {
		return renovateFixtureFailure("owned Forgejo administrator handoff was not available")
	}
	ctx, cancel := renovateFixtureContext(r)
	defer cancel()
	forge, token, err := issueRenovateToken(ctx, renovateFixtureClient(), fmt.Sprintf("http://127.0.0.1:%d", f.port), admin, password,
		"renovate-e2e-"+randomHex(12), "Selfhost-"+randomHex(48)+"!")
	if err != nil {
		return renovateFixtureFailure(err.Error())
	}
	f.forge = forge
	file, err := os.OpenFile(f.path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		return renovateFixtureFailure("owned Renovate token file could not be created")
	}
	_, err = file.WriteString(token)
	closeErr := file.Close()
	if err != nil || closeErr != nil {
		return renovateFixtureFailure("owned Renovate token file could not be written")
	}
	return r.runWithTimeout(installCommandLimit(r.spec), args...)
}

func (f *renovateRuntimeFixture) check(r *runner) result {
	_, _, token, ok := renovateCredentialHandoff(r)
	if !ok || token == "" || f.forge == nil {
		return renovateFixtureFailure("owned Forgejo bot/token handoff was not available")
	}
	ctx, cancel := renovateFixtureContext(r)
	defer cancel()
	if err := f.forge.verify(ctx, renovateFixtureClient(), fmt.Sprintf("http://127.0.0.1:%d", f.port), token); err != nil {
		return renovateFixtureFailure(err.Error())
	}
	return result{}
}

func (r *runner) attachRenovateFixture(f *renovateRuntimeFixture) {
	r.addFixture("renovate", f, &fixtureHooks{
		inputs:    []string{"--set-file", "renovate.token=" + f.path},
		installFn: func(args []string) result { return f.install(r, args, r.fixturePorts) },
		checkFn: func(phase string) result {
			switch phase {
			case "after-images":
				r.stage("forge-token-identity", []string{"verify", "owned-forgejo-pat-identity-and-persisted-id"}, func() result { return f.check(r) })
			case "restored":
				r.evidenceOwner.stage("restored-forge-token-identity", []string{"verify", "owned-forgejo-pat-identity-and-persisted-id"}, func() result { return f.check(r) })
			}
			return result{}
		},
		reattachFn: func(target *runner) error { target.attachRenovateFixture(f); return nil },
	})
}
