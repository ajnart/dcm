package e2e

import (
	"errors"
	"math"
	"strconv"
	"strings"

	"golang.org/x/sys/unix"
)

const minimumFreeInodes = 100000

type filesystemCapacity struct{ AvailableBytes, FreeInodes uint64 }
type resourceEvidence struct {
	Measured       bool   `json:"measured"`
	AvailableBytes uint64 `json:"available_bytes"`
	FreeInodes     uint64 `json:"free_inodes"`
	MinimumBytes   uint64 `json:"minimum_bytes"`
	MinimumInodes  uint64 `json:"minimum_inodes"`
	Reason         string `json:"reason,omitempty"`
}

func minimumFreeBytes(value string) (uint64, error) {
	if strings.TrimSpace(value) == "" {
		return 8 << 30, nil
	}
	gb, err := strconv.ParseUint(strings.TrimSpace(value), 10, 64)
	if err != nil || gb == 0 || gb > math.MaxUint64/(1<<30) {
		return 0, errors.New("E2E_MIN_FREE_GB must be a positive integer within the filesystem byte range")
	}
	return gb << 30, nil
}

func ownedFilesystemCapacity(root string) (filesystemCapacity, error) {
	var stat unix.Statfs_t
	if unix.Statfs(root, &stat) != nil || stat.Bsize <= 0 || stat.Bavail > math.MaxUint64/uint64(stat.Bsize) {
		return filesystemCapacity{}, errors.New("owned filesystem measurement unavailable")
	}
	return filesystemCapacity{AvailableBytes: stat.Bavail * uint64(stat.Bsize), FreeInodes: stat.Ffree}, nil
}

func measureLocalAdmission(root string, minimumBytes uint64, measure func(string) (filesystemCapacity, error)) resourceEvidence {
	obs := resourceEvidence{MinimumBytes: minimumBytes, MinimumInodes: minimumFreeInodes}
	capacity, err := measure(root)
	if err != nil {
		obs.Reason = "local owned filesystem capacity unavailable"
		return obs
	}
	obs.Measured = true
	obs.AvailableBytes, obs.FreeInodes = capacity.AvailableBytes, capacity.FreeInodes
	if capacity.AvailableBytes < minimumBytes {
		obs.Reason = "local disk free bytes below configured floor"
	} else if capacity.FreeInodes < minimumFreeInodes {
		obs.Reason = "local disk free inodes below safety floor"
	}
	return obs
}

func (g *sweepGuard) blockLocalResources(obs resourceEvidence) {
	if g == nil {
		return
	}
	g.mu.Lock()
	defer g.mu.Unlock()
	if g.resources == nil {
		copy := obs
		g.resources = &copy
	}
	g.signalLocked()
}

func (g *sweepGuard) localResourceBlocker() *resourceEvidence {
	if g == nil {
		return nil
	}
	g.mu.Lock()
	defer g.mu.Unlock()
	if g.resources == nil {
		return nil
	}
	copy := *g.resources
	return &copy
}

func diskMutatingCommand(args []string) bool {
	if len(args) == 0 {
		return false
	}
	switch args[0] {
	case "install", "setup", "start", "restart", "update", "pull", "restore", "backup", "add":
		return true
	}
	return false
}

func markResourceBlocked(e *targetEvidence, obs *resourceEvidence) {
	e.Outcome, e.Classification, e.BlockerReason, e.Resources = "blocked", "local-disk-blocked", obs.Reason, obs
	for i := range e.Stages {
		stage := &e.Stages[i]
		if stage.Outcome == "running" {
			stage.Outcome, stage.Reason, stage.Resources = "blocked", obs.Reason, obs
		}
	}
}
