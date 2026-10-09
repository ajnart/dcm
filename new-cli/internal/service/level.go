package service

import stepstatus "github.com/ajnart/self-host/internal/status"

// Level is an App's Status: ok (green), attention (yellow) or broken (red),
// combined from its container, its health check and its Setup.
func Level(a AppStatus) string {
	switch {
	case a.State == "unknown":
		return "attention"
	case a.State != "running":
		return "broken"
	case a.Health == "unhealthy" || a.Setup == stepstatus.SetupIncomplete:
		return "broken"
	case a.Health == "starting" || a.Setup == stepstatus.SetupPending || a.Setup == stepstatus.SetupManual:
		return "attention"
	default:
		return "ok"
	}
}
