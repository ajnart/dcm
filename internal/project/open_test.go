package project

import (
	"testing"

	"github.com/ajnart/self-host/internal/system"
)

func TestOpenResolvesToTheHiddenFolderInHome(t *testing.T) {
	p := Open(system.User{Name: "alice", Home: "/home/alice"})
	if p.Root != "/home/alice/.self-host" {
		t.Fatalf("Root = %q, want /home/alice/.self-host", p.Root)
	}
}
