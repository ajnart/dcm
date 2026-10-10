package cli

import (
	"strings"
	"testing"

	"github.com/ajnart/self-host/internal/service"
)

func TestPrintDebugTitlesTheLogsWithTheReportsLineCount(t *testing.T) {
	var out strings.Builder

	printDebug(&out, service.DebugReport{Name: "Echo", ID: "one", LogLines: 7})

	if !strings.Contains(out.String(), "\nLogs (last 7 lines)\n") {
		t.Fatalf("output:\n%s", out.String())
	}
}
