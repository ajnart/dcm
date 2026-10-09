package service

// Level is an App's Status: ok (green), attention (yellow) or broken (red),
// combined from its container, its health check and its Setup.
func Level(a AppStatus) string {
	switch {
	case a.State == "unknown":
		return "attention"
	case a.State != "running":
		return "broken"
	case a.Health == "unhealthy" || a.Setup == "incomplete":
		return "broken"
	case a.Health == "starting" || a.Setup == "pending" || a.Setup == "manual":
		return "attention"
	default:
		return "ok"
	}
}
