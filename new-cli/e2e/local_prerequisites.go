package e2e

import "slices"

func targetEnvironmentCount(t targetSpec) int {
	count := len(t.Apps)
	if slices.Contains(t.Apps, "passbolt") {
		count++ // Owned TLS and STARTTLS prerequisite container.
	}
	if slices.Contains(t.Apps, "wud") {
		count++
	}
	return count
}

// Runtime fixtures extend the owned App set before classification, capacity
// admission, port reservation and lifecycle evidence; catalog inventory stays exact.
func withOwnedPrerequisites(t targetSpec) targetSpec {
	if slices.Contains(t.Apps, "haproxy") && !slices.Contains(t.Apps, "ntfy") {
		t.Apps = append(slices.Clone(t.Apps), "ntfy")
	}
	if slices.Contains(t.Apps, "renovate") && !slices.Contains(t.Apps, "forgejo") {
		t.Apps = append(slices.Clone(t.Apps), "forgejo")
	}
	if slices.Contains(t.Apps, "wud") && !slices.Contains(t.Apps, "ntfy") {
		t.Apps = append(slices.Clone(t.Apps), "ntfy")
	}
	return t
}
