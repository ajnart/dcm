package tui

import (
	"go/ast"
	"go/parser"
	"go/token"
	"io/fs"
	"strconv"
	"strings"
	"testing"

	"github.com/ajnart/self-host/internal/activity"
	"github.com/ajnart/self-host/internal/service"
)

// The word Exposure survives only in the stored EXPOSURE setting and the
// --exposure flag, never in what a person reads.
func TestNoStringInTheTUISaysExposure(t *testing.T) {
	files, err := parser.ParseDir(token.NewFileSet(), ".", func(info fs.FileInfo) bool {
		return !strings.HasSuffix(info.Name(), "_test.go")
	}, 0)
	if err != nil {
		t.Fatal(err)
	}
	for _, pkg := range files {
		for name, file := range pkg.Files {
			ast.Inspect(file, func(n ast.Node) bool {
				lit, ok := n.(*ast.BasicLit)
				if !ok || lit.Kind != token.STRING {
					return true
				}
				text, err := strconv.Unquote(lit.Value)
				if err == nil && text != "EXPOSURE" && strings.Contains(strings.ToLower(text), "exposure") {
					t.Errorf("%s: the string %s says Exposure; say Access", name, lit.Value)
				}
				return true
			})
		}
	}
}

func TestNoScreenSaysExposure(t *testing.T) {
	check := func(name string, m Model) {
		t.Helper()
		if out := screen(m); strings.Contains(strings.ToLower(out), "exposure") {
			t.Errorf("%s says Exposure\n%s", name, out)
		}
	}
	for _, size := range []struct{ width, height int }{{120, 30}, {80, 24}} {
		walkOnboarding(t, size.width, size.height, activity.Simple, func(name string, m Model) { check("Onboarding "+name, m) })
		for _, exposure := range []string{service.ExposureLAN, service.ExposureLocal} {
			m := goldenModelWith(t, size.width, size.height, exposure)
			m = drive(t, m, press("5"))
			check("Settings Host", m)
			m = drive(t, m, press("]"))
			check("Settings Access", m)
			check("Settings Access help", drive(t, m, press("?")))
			check("Settings Access pending", drive(t, drive(t, drive(t, m, press("enter")), press("down")), press("[")))
		}
	}
}
