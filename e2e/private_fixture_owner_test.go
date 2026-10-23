package e2e

import "testing"

func TestPrivateFixtureContainerUserMapsTheHarnessOwner(t *testing.T) {
	for _, tc := range []struct {
		name     string
		options  []string
		uid, gid int
		want     string
		wantErr  bool
	}{
		{name: "rootless", options: []string{"name=seccomp,profile=builtin", "name=rootless", "name=cgroupns"}, uid: 1000, gid: 1001, want: "0:0"},
		{name: "rootful", options: []string{"name=apparmor", "name=seccomp,profile=builtin", "name=cgroupns"}, uid: 1000, gid: 1001, want: "1000:1001"},
		{name: "rootful-harness-root", options: []string{"name=seccomp,profile=builtin"}, uid: 0, gid: 0, want: "0:0"},
		{name: "userns-remap", options: []string{"name=seccomp,profile=builtin", "name=userns"}, uid: 1000, gid: 1001, wantErr: true},
		{name: "rootless-with-userns-remap", options: []string{"name=rootless", "name=userns"}, uid: 1000, gid: 1001, wantErr: true},
		{name: "missing", options: nil, uid: 1000, gid: 1001, wantErr: true},
		{name: "unrecognized", options: []string{"name=unknown"}, uid: 1000, gid: 1001, wantErr: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got, err := privateFixtureContainerUser(tc.options, tc.uid, tc.gid)
			if (err != nil) != tc.wantErr {
				t.Fatalf("private fixture error = %v, want error %v for %v", err, tc.wantErr, tc.options)
			}
			if !tc.wantErr && got != tc.want {
				t.Fatalf("private fixture user = %q, want %q", got, tc.want)
			}
		})
	}
}
