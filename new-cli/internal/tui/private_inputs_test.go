package tui

import (
	"strings"
	"testing"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/catalog"
	"github.com/ajnart/self-host/internal/service"
)

const privateTypedValue = " synthetic-private-token "

func privateInputCatalog() *catalog.Catalog {
	return catalog.New([]app.App{stubApp{info: app.Info{ID: "credential-demo", Name: "Credential demo", Category: "Other"}, inputs: []app.Input{
		{Key: "TOKEN", Prompt: "Provider token", Required: true, Private: true},
		{Key: "NAME", Prompt: "Ordinary name", Required: true},
	}}}, nil)
}

func TestInstallConcealsPrivateInputWhileOrdinaryInputStaysVisible(t *testing.T) {
	m, backend := sample(t, 120, 40)
	backend.catalog = privateInputCatalog()
	m = drive(t, m, press("i"))
	m = drive(t, m, press("space"))
	m = drive(t, m, press("enter"))
	m = typeText(t, m, privateTypedValue)
	if out := screen(m); strings.Contains(out, "synthetic-private-token") || !strings.Contains(out, "***") {
		t.Fatal("private review input is not visibly masked")
	}
	m = drive(t, m, press("tab"))
	m = typeText(t, m, "ordinary-visible-name")
	if out := screen(m); strings.Contains(out, "synthetic-private-token") || !strings.Contains(out, "ordinary-visible-name") {
		t.Fatal("review must conceal private values while showing ordinary values")
	}
	m = drive(t, m, press("enter"))
	assertPrivateInstallOptions(t, backend.installs())
}

func TestWizardConcealsPrivateInputWhileOrdinaryInputStaysVisible(t *testing.T) {
	m, backend := freshHost(t)
	backend.catalog = privateInputCatalog()
	m = drive(t, m, press("enter"))
	m = drive(t, m, press("enter"))
	m = drive(t, m, press("x"))
	m = drive(t, m, press("enter"))
	for i := 0; i < 6; i++ {
		m = drive(t, m, press("enter"))
	}
	if out := screen(m); !strings.Contains(out, "Provider token") {
		t.Fatalf("wizard did not reach private input\n%s", out)
	}
	m = typeText(t, m, privateTypedValue)
	if out := screen(m); strings.Contains(out, "synthetic-private-token") || !strings.Contains(out, "***") {
		t.Fatal("private wizard input is not visibly masked")
	}
	m = drive(t, m, press("enter"))
	m = typeText(t, m, "ordinary-visible-name")
	if out := screen(m); strings.Contains(out, "synthetic-private-token") || !strings.Contains(out, "ordinary-visible-name") {
		t.Fatal("wizard must conceal private values while showing ordinary values")
	}
	m = drive(t, m, press("enter"))
	if out := screen(m); !strings.Contains(out, "Review") || strings.Contains(out, "synthetic-private-token") {
		t.Fatal("wizard review echoed a private input")
	}
	m = drive(t, m, press("enter"))
	assertPrivateInstallOptions(t, backend.installs())
}

func assertPrivateInstallOptions(t *testing.T, installs []service.InstallOptions) {
	t.Helper()
	if len(installs) != 1 {
		t.Fatalf("installs = %d, want 1", len(installs))
	}
	opts := installs[0]
	if opts.PrivateInputs["credential-demo"]["TOKEN"] != privateTypedValue {
		t.Fatal("private input was not carried through the typed in-memory boundary")
	}
	if !strings.Contains(strings.Join(opts.Sets, " "), "credential-demo.NAME=ordinary-visible-name") {
		t.Fatal("ordinary input missing from install options")
	}
	if strings.Contains(strings.Join(opts.Sets, " "), "synthetic-private-token") {
		t.Fatal("private input copied into command-style settings")
	}
}

func TestInstallDoesNotUsePrivateDefaults(t *testing.T) {
	m, backend := sample(t, 120, 40)
	backend.catalog = catalog.New([]app.App{stubApp{info: app.Info{ID: "credential-demo", Name: "Credential demo", Category: "Other"}, inputs: []app.Input{{Key: "TOKEN", Prompt: "Provider token", Required: true, Private: true, Default: "synthetic-private-default"}}}}, nil)
	m = drive(t, m, press("i"))
	m = drive(t, m, press("space"))
	m = drive(t, m, press("enter"))
	m = drive(t, m, press("enter"))
	if out := screen(m); !strings.Contains(out, "required: Credential demo") || strings.Contains(out, "synthetic-private-default") || len(backend.installs()) != 0 {
		t.Fatal("private default bypassed explicit concealed input")
	}
}

func TestWizardDoesNotUsePrivateDefaults(t *testing.T) {
	m, backend := freshHost(t)
	backend.catalog = catalog.New([]app.App{stubApp{info: app.Info{ID: "credential-demo", Name: "Credential demo"}, inputs: []app.Input{{Key: "TOKEN", Prompt: "Provider token", Required: true, Private: true, Default: "synthetic-private-default"}}}}, nil)
	m = drive(t, m, press("enter"))
	m = drive(t, m, press("enter"))
	m = drive(t, m, press("x"))
	m = drive(t, m, press("enter"))
	for i := 0; i < 6; i++ {
		m = drive(t, m, press("enter"))
	}
	m = drive(t, m, press("enter"))
	if out := screen(m); !strings.Contains(out, "required") || strings.Contains(out, "Review") || strings.Contains(out, "synthetic-private-default") {
		t.Fatal("private wizard default bypassed explicit concealed input")
	}
}
