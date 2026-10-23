package e2e

import "testing"

func TestBeszelContainerEvidenceRequiresExactOwnedUsage(t *testing.T) {
	want := beszelContainerIdentity{
		ContainerID: "0123456789abcdef",
		Name:        "selfhost-e2e-owned-beszel-proof-load-1",
		Project:     "selfhost-e2e-owned",
		Service:     "beszel-proof-load",
	}
	valid := beszelContainerObservation{
		ID: "0123456789ab", Name: want.Name, System: "owned-system",
		CPU: 12.5, Memory: 32.0, Updated: 1234,
	}
	if !beszelContainerMatch(want, "owned-system", valid) {
		t.Fatal("exact owned Beszel observation was rejected")
	}
	for _, tc := range []struct {
		name string
		got  beszelContainerObservation
	}{
		{"empty", beszelContainerObservation{}},
		{"wrong id", beszelContainerObservation{ID: "fedcba987654", Name: want.Name, System: "owned-system", CPU: 1, Memory: 32, Updated: 1}},
		{"wrong name", beszelContainerObservation{ID: "0123456789ab", Name: "another", System: "owned-system", CPU: 1, Memory: 32, Updated: 1}},
		{"no cpu usage", beszelContainerObservation{ID: "0123456789ab", Name: want.Name, System: "owned-system", Memory: 32, Updated: 1}},
		{"insufficient memory load", beszelContainerObservation{ID: "0123456789ab", Name: want.Name, System: "owned-system", CPU: 1, Memory: 0.47, Updated: 1}},
		{"no memory usage", beszelContainerObservation{ID: "0123456789ab", Name: want.Name, System: "owned-system", CPU: 1, Updated: 1}},
		{"wrong nonempty system", beszelContainerObservation{ID: "0123456789ab", Name: want.Name, System: "another-system", CPU: 1, Memory: 32, Updated: 1}},
		{"no system", beszelContainerObservation{ID: "0123456789ab", Name: want.Name, CPU: 1, Memory: 32, Updated: 1}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if beszelContainerMatch(want, "owned-system", tc.got) {
				t.Fatal("non-owned or usage-free observation passed")
			}
		})
	}
}

func TestBeszelRootlessProofRequiresExactEndpointAndSecurityFact(t *testing.T) {
	rootless := []string{"name=seccomp,profile=builtin", "name=rootless"}
	if !beszelRootlessSocketMatch("unix:///dev/shm/owned/docker.sock", rootless, "/dev/shm/owned/docker.sock") {
		t.Fatal("exact rootless endpoint was rejected")
	}
	if !beszelRootlessSocketMatch("unix:///var/run/docker.sock", rootless, "/var/run/docker.sock") {
		t.Fatal("verified rootless default socket was rejected")
	}
	for _, tc := range []struct {
		name, endpoint, mount string
		security              []string
	}{
		{"rootful unix alias", "unix:///tmp/rootful/docker.sock", "/tmp/rootful/docker.sock", []string{"name=seccomp,profile=builtin"}},
		{"different socket", "unix:///dev/shm/owned/docker.sock", "/dev/shm/other/docker.sock", rootless},
		{"remote", "tcp://127.0.0.1:2375", "/dev/shm/owned/docker.sock", rootless},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if beszelRootlessSocketMatch(tc.endpoint, tc.security, tc.mount) {
				t.Fatal("non-rootless or mismatched daemon passed")
			}
		})
	}
}

func TestBeszelProxyConfigurationFeedsRootlessSocketProof(t *testing.T) {
	projection := []byte(`{"Mounts":[{"Source":"/var/run/docker.sock","Destination":"/var/run/docker.sock","RW":false}],"Env":["CONTAINERS=1","POST=0"]}`)
	socket, ok := beszelProxyConfiguration(projection)
	if !ok || socket != "/var/run/docker.sock" {
		t.Fatalf("proxy configuration = %q, %t", socket, ok)
	}
	if !beszelRootlessSocketMatch("unix:///var/run/docker.sock", []string{"name=rootless"}, socket) {
		t.Fatal("decoded proxy socket did not reach the verified-rootless matcher")
	}
	if beszelRootlessSocketMatch("unix:///var/run/docker.sock", []string{"name=seccomp,profile=builtin"}, socket) {
		t.Fatal("decoded default socket passed with rootful security facts")
	}
}

func TestBeszelWorkloadLimitsAreExact(t *testing.T) {
	valid := beszelWorkloadLimits{CPU: 1_000_000_000, Memory: 96 * 1024 * 1024, PIDs: 32, CapabilitiesDropAll: true, NoNewPrivileges: true, TmpfsBound: true, ReadOnlyRoot: true}
	if !beszelWorkloadLimitsMatch(valid) {
		t.Fatal("bounded workload limits were rejected")
	}
	for _, mutate := range []func(*beszelWorkloadLimits){
		func(v *beszelWorkloadLimits) { v.CPU = 0 },
		func(v *beszelWorkloadLimits) { v.Memory = 0 },
		func(v *beszelWorkloadLimits) { v.PIDs = 0 },
		func(v *beszelWorkloadLimits) { v.CapabilitiesDropAll = false },
		func(v *beszelWorkloadLimits) { v.NoNewPrivileges = false },
		func(v *beszelWorkloadLimits) { v.TmpfsBound = false },
		func(v *beszelWorkloadLimits) { v.ReadOnlyRoot = false },
	} {
		got := valid
		mutate(&got)
		if beszelWorkloadLimitsMatch(got) {
			t.Fatal("incomplete workload bounds passed")
		}
	}
}
