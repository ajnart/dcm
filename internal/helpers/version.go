package helpers

import (
	"strconv"
	"strings"
)

// VersionCompatible reports whether got is at least tested and shares its
// major component. Floating upstream images move forward, so Setup accepts the
// tested release and later releases of the same major. got may carry a leading
// "v" and any suffix after the dotted number, such as " (abc123)" or "-rc.1".
func VersionCompatible(got, tested string) bool {
	have, ok := versionParts(got)
	want, wantOK := versionParts(tested)
	return ok && wantOK && have[0] == want[0] && versionAtLeast(have, want)
}

// VersionAtLeast reports whether got is tested or later, for calendar versions
// whose first component is a year rather than a breaking-change marker.
func VersionAtLeast(got, tested string) bool {
	have, ok := versionParts(got)
	want, wantOK := versionParts(tested)
	return ok && wantOK && versionAtLeast(have, want)
}

func versionAtLeast(have, want []int) bool {
	for i := 0; i < len(have) || i < len(want); i++ {
		var a, b int
		if i < len(have) {
			a = have[i]
		}
		if i < len(want) {
			b = want[i]
		}
		if a != b {
			return a > b
		}
	}
	return true
}

func versionParts(v string) ([]int, bool) {
	v = strings.TrimPrefix(strings.TrimSpace(v), "v")
	end := 0
	for end < len(v) && (v[end] == '.' || v[end] >= '0' && v[end] <= '9') {
		end++
	}
	if end == 0 || strings.HasSuffix(v[:end], ".") {
		return nil, false
	}
	var parts []int
	for _, field := range strings.Split(v[:end], ".") {
		n, err := strconv.Atoi(field)
		if err != nil {
			return nil, false
		}
		parts = append(parts, n)
	}
	return parts, true
}
