package service

// Level summarises an App's health as ok (green), warn (yellow) or fail (red).
func Level(a AppStatus) string {
	switch {
	case a.State == "unknown":
		return "warn"
	case a.State != "running":
		return "fail"
	case a.Health == "unhealthy" || a.Setup == "incomplete":
		return "fail"
	case a.Health == "starting" || a.Setup == "pending":
		return "warn"
	default:
		return "ok"
	}
}
