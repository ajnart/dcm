package e2e

import "slices"

// Runtime fixtures extend the owned App set before classification, capacity
// admission, port reservation and lifecycle evidence; catalog inventory stays exact.
func withOwnedPrerequisites(t targetSpec) targetSpec {
	if slices.Contains(t.Apps, "haproxy") && !slices.Contains(t.Apps, "ntfy") {
		t.Apps = append(slices.Clone(t.Apps), "ntfy")
	}
	if slices.Contains(t.Apps, "renovate") && !slices.Contains(t.Apps, "forgejo") {
		t.Apps = append(slices.Clone(t.Apps), "forgejo")
	}
	return t
}
