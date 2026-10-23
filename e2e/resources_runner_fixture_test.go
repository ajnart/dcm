//go:build e2e

package e2e

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestRunnerSeparatesExecutableAndProjectStorage(t *testing.T) {
	executableParent := t.TempDir()
	projectParent, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(projectParent, 0o700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("TMPDIR", executableParent)
	t.Setenv("E2E_PROJECT_TMPDIR", projectParent)
	r := newRunner(t, newSweepGuard(1))
	if filepath.Dir(r.root) != executableParent || filepath.Dir(r.storageRoot) != projectParent {
		t.Fatalf("runner roots were not independently selected: executable=%q storage=%q", r.root, r.storageRoot)
	}
	if r.project != filepath.Join(r.storageRoot, "project") {
		t.Fatal("Project does not use the selected storage filesystem")
	}
}

func TestProjectStorageRejectsRelativeSymlinkAndUnownedParents(t *testing.T) {
	owned := t.TempDir()
	link := filepath.Join(t.TempDir(), "project-storage")
	if err := os.Symlink(owned, link); err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{"relative", link} {
		if _, err := validateProjectStorageParent(path); err == nil {
			t.Fatalf("unsafe Project storage accepted: %q", path)
		}
	}
}

func TestRunnerAdmissionMeasuresProjectAndExecutableFilesystems(t *testing.T) {
	r := &runner{root: "/owned/executable", storageRoot: "/owned/project", minimumDiskBytes: 4 << 30, minimumExecutableBytes: 2 << 30}
	var measured []string
	obs := r.measureAdmission(func(path string) (filesystemCapacity, error) {
		measured = append(measured, path)
		if path == r.root {
			return filesystemCapacity{AvailableBytes: 3 << 30, FreeInodes: 200000}, nil
		}
		return filesystemCapacity{AvailableBytes: 5 << 30, FreeInodes: 200000}, nil
	})
	if obs.Reason != "" || strings.Join(measured, ",") != "/owned/project,/owned/executable" || obs.ProjectStorage.MinimumBytes != 4<<30 || obs.ExecutableStaging.MinimumBytes != 2<<30 || obs.ExecutableStaging.AvailableBytes != 3<<30 {
		t.Fatalf("admission did not measure both selected filesystems: %v %+v", measured, obs)
	}
	obs = r.measureAdmission(func(path string) (filesystemCapacity, error) {
		if path == r.storageRoot {
			return filesystemCapacity{AvailableBytes: 3 << 30, FreeInodes: 200000}, nil
		}
		return filesystemCapacity{AvailableBytes: 5 << 30, FreeInodes: 200000}, nil
	})
	if obs.Reason != "Project storage free bytes below configured floor" || obs.Purpose != "project-storage" || obs.BlockingPurpose != "project-storage" {
		t.Fatalf("Project storage shortage was not attributed safely: %+v", obs)
	}
	obs = r.measureAdmission(func(path string) (filesystemCapacity, error) {
		if path == r.root {
			return filesystemCapacity{AvailableBytes: 1 << 30, FreeInodes: 200000}, nil
		}
		return filesystemCapacity{AvailableBytes: 5 << 30, FreeInodes: 200000}, nil
	})
	if obs.Reason != "executable staging free bytes below configured floor" || obs.Purpose != "project-storage" || obs.BlockingPurpose != "executable-staging" || obs.AvailableBytes != 5<<30 || obs.MinimumBytes != 4<<30 || obs.ProjectStorage.AvailableBytes != 5<<30 || obs.ExecutableStaging.AvailableBytes != 1<<30 {
		t.Fatalf("executable staging shortage was not independently attributed: %+v", obs)
	}
}

func TestSuccessfulAdmissionAddsBothMeasurementsToEvidence(t *testing.T) {
	r := &runner{
		t:                      t,
		guard:                  newSweepGuard(1),
		root:                   t.TempDir(),
		storageRoot:            t.TempDir(),
		minimumDiskBytes:       1,
		minimumExecutableBytes: 1,
		evidence:               newEvidence(targetSpec{Apps: []string{"ntfy"}}, "fixture"),
	}
	r.requireLocalResources()
	resources := r.evidence.Resources
	if resources == nil || resources.ProjectStorage == nil || resources.ExecutableStaging == nil || !resources.ProjectStorage.Measured || !resources.ExecutableStaging.Measured {
		t.Fatal("successful admission omitted one of the selected filesystem measurements")
	}
	if resources.ProjectStorage.Purpose != "project-storage" || resources.ExecutableStaging.Purpose != "executable-staging" {
		t.Fatal("successful admission omitted filesystem purposes")
	}
}

func TestRunnerCleanupRemovesOnlyUniqueOwnedRoots(t *testing.T) {
	executableParent := t.TempDir()
	projectParent, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(projectParent, 0o700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("TMPDIR", executableParent)
	t.Setenv("E2E_PROJECT_TMPDIR", projectParent)
	r := newRunner(t, newSweepGuard(1))
	executableRoot, storageRoot := r.root, r.storageRoot
	if err := r.removeRoot(); err != nil {
		t.Fatal(err)
	}
	for _, root := range []string{executableRoot, storageRoot} {
		if _, err := os.Lstat(root); !os.IsNotExist(err) {
			t.Fatalf("unique owned root retained after cleanup: %q", root)
		}
	}
	for _, parent := range []string{executableParent, projectParent} {
		if info, err := os.Stat(parent); err != nil || !info.IsDir() {
			t.Fatalf("parent storage root was removed: %q", parent)
		}
	}
}

func TestRunnerCleanupAttemptsBothRootsAndReportsRetainedRecoveryPath(t *testing.T) {
	parent := t.TempDir()
	storageRoot := filepath.Join(parent, "storage")
	executableRoot := filepath.Join(parent, "executable")
	if err := os.Mkdir(storageRoot, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(storageRoot, executableRoot); err != nil {
		t.Fatal(err)
	}
	r := &runner{root: executableRoot, storageRoot: storageRoot, project: filepath.Join(storageRoot, "project"), evidence: newEvidence(targetSpec{Apps: []string{"ntfy"}}, "fixture")}
	if err := r.removeRoot(); err == nil {
		t.Fatal("retained executable recovery path was reported as clean")
	}
	r.recordRetainedRoots(r)
	if _, err := os.Lstat(storageRoot); !os.IsNotExist(err) {
		t.Fatal("independent Project storage root was not cleaned")
	}
	if info, err := os.Lstat(executableRoot); err != nil || info.Mode()&os.ModeSymlink == 0 {
		t.Fatal("uncertain executable root was not retained for recovery")
	}
	if len(r.evidence.RetainedOwnedRoots) != 1 || r.evidence.RetainedOwnedRoots[0].Purpose != "executable-staging" || r.evidence.RetainedOwnedRoots[0].Path != executableRoot || r.evidence.RetainedProject != "" || r.evidence.RetainedComposeProject != "" {
		t.Fatal("cleanup evidence did not report the actual retained root and provenance")
	}
}

func TestCleanupEvidenceUnionsSourceAndRestoreRecoveryInventory(t *testing.T) {
	newRetained := func(prefix, name string) *runner {
		storageRoot := filepath.Join(t.TempDir(), prefix+"-storage")
		executableRoot := filepath.Join(t.TempDir(), prefix+"-executable")
		project := filepath.Join(storageRoot, "project")
		if err := os.MkdirAll(project, 0o700); err != nil {
			t.Fatal(err)
		}
		if err := os.Mkdir(executableRoot, 0o700); err != nil {
			t.Fatal(err)
		}
		return &runner{root: executableRoot, storageRoot: storageRoot, project: project, name: name, composeCleanupFailed: true}
	}
	source := newRetained("source", "source-compose")
	restored := newRetained("restore", "restore-compose")
	source.evidence = newEvidence(targetSpec{Apps: []string{"ntfy"}}, "fixture")
	source.recordRetainedRoots(source)
	source.recordRetainedRoots(restored)
	if len(source.evidence.RetainedOwnedRoots) != 4 || len(source.evidence.RetainedProjects) != 2 {
		t.Fatal("simultaneous source and restore cleanup failures lost recovery inventory")
	}
	if source.evidence.RetainedProject != source.project || source.evidence.RetainedComposeProject != source.name {
		t.Fatal("legacy retained selectors did not preserve the first actual Project")
	}
	want := map[string]string{source.project: source.name, restored.project: restored.name}
	for _, selector := range source.evidence.RetainedProjects {
		if want[selector.Project] != selector.ComposeProject {
			t.Fatal("published recovery selector does not identify an actual retained Project")
		}
		delete(want, selector.Project)
	}
	if len(want) != 0 {
		t.Fatal("published recovery selectors omitted a retained Project")
	}
}

func TestRecoveryInventoryRetainsUncertainFilesystemPaths(t *testing.T) {
	r := &runner{storageRoot: "/owned/project-storage", root: "/owned/executable-staging"}
	remaining := r.remainingOwnedRootsWithStat(func(path string) error {
		if path == r.storageRoot {
			return os.ErrNotExist
		}
		return os.ErrPermission
	})
	if len(remaining) != 1 || remaining[0].Purpose != "executable-staging" || remaining[0].Path != r.root {
		t.Fatal("uncertain filesystem error discarded a known owned recovery path")
	}
}

func TestLegacyRecoverySelectorNeverMixesSourceAndRestoreProjects(t *testing.T) {
	makeRunner := func(prefix, name string, composeFailed bool) *runner {
		storageRoot := filepath.Join(t.TempDir(), prefix)
		project := filepath.Join(storageRoot, "project")
		if err := os.MkdirAll(project, 0o700); err != nil {
			t.Fatal(err)
		}
		return &runner{root: storageRoot, storageRoot: storageRoot, project: project, name: name, composeCleanupFailed: composeFailed}
	}
	source := makeRunner("source", "source-compose", false)
	restored := makeRunner("restore", "restore-compose", true)
	source.evidence = newEvidence(targetSpec{Apps: []string{"ntfy"}}, "fixture")
	source.recordRetainedRoots(source)
	source.recordRetainedRoots(restored)
	payload, err := json.Marshal(source.evidence)
	if err != nil {
		t.Fatal(err)
	}
	var published struct {
		RetainedProject        string                 `json:"retained_project"`
		RetainedComposeProject string                 `json:"retained_compose_project"`
		RetainedProjects       []ownedProjectEvidence `json:"retained_projects"`
	}
	if err := json.Unmarshal(payload, &published); err != nil {
		t.Fatal(err)
	}
	if published.RetainedProject != source.project || published.RetainedComposeProject != "" || len(published.RetainedProjects) != 2 || published.RetainedProjects[1].Project != restored.project || published.RetainedProjects[1].ComposeProject != restored.name {
		t.Fatal("legacy selector combined different source and restore Projects")
	}
}
