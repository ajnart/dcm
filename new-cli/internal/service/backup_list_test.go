package service

import (
	"errors"
	"os"
	"path/filepath"
	"slices"
	"testing"
	"time"

	"github.com/ajnart/self-host/internal/backup"
)

func writeArchive(t *testing.T, path, passphrase string, ids ...string) {
	t.Helper()
	manifest := backup.Manifest{Version: 1, Created: time.Now().UTC()}
	for _, id := range ids {
		manifest.Apps = append(manifest.Apps, backup.ManifestApp{ID: id})
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		t.Fatal(err)
	}
	f, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	w, err := backup.Create(f, passphrase, manifest)
	if err != nil {
		t.Fatal(err)
	}
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}
	if err := f.Close(); err != nil {
		t.Fatal(err)
	}
}

func TestBackupsListsArchivesNewestFirstWithAppsAndEncryption(t *testing.T) {
	h := newHarness(t)
	dir := filepath.Join(h.root(), "backups")
	writeArchive(t, filepath.Join(dir, "selfhost-20261001-090000.tar.zst"), "", "jellyfin", "sonarr")
	writeArchive(t, filepath.Join(dir, "selfhost-20261008-231500.tar.zst.age"), "hunter2", "jellyfin")
	if err := os.WriteFile(filepath.Join(dir, "selfhost-20261009-000000.tar.zst.partial"), []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "notes.txt"), []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}

	got, err := h.svc.Backups()
	if err != nil {
		t.Fatal(err)
	}

	if len(got) != 2 {
		t.Fatalf("want 2 archives, got %+v", got)
	}
	if got[0].Name != "selfhost-20261008-231500.tar.zst.age" || !got[0].Encrypted || got[0].Apps != nil {
		t.Errorf("newest should be the encrypted archive with no readable Apps: %+v", got[0])
	}
	if want := time.Date(2026, 10, 8, 23, 15, 0, 0, time.Local); !got[0].Created.Equal(want) {
		t.Errorf("created = %v, want %v", got[0].Created, want)
	}
	if got[1].Encrypted || !slices.Equal(got[1].Apps, []string{"jellyfin", "sonarr"}) || got[1].Size == 0 {
		t.Errorf("older archive should be plain with its Apps and size: %+v", got[1])
	}
}

func TestBackupsIsEmptyWithoutAFolder(t *testing.T) {
	h := newHarness(t)

	got, err := h.svc.Backups()

	if err != nil || len(got) != 0 {
		t.Fatalf("got %+v, %v", got, err)
	}
}

func TestBackupAppsOpensAnEncryptedManifestOnlyWithThePassphrase(t *testing.T) {
	h := newHarness(t)
	file := filepath.Join(h.root(), "backups", "selfhost-20261008-231500.tar.zst.age")
	writeArchive(t, file, "hunter2", "jellyfin", "sonarr")

	if _, err := h.svc.BackupApps(file, ""); !errors.Is(err, backup.ErrNeedPassphrase) {
		t.Errorf("no passphrase: %v", err)
	}
	if _, err := h.svc.BackupApps(file, "wrong"); !errors.Is(err, backup.ErrPassphrase) {
		t.Errorf("wrong passphrase: %v", err)
	}
	ids, err := h.svc.BackupApps(file, "hunter2")
	if err != nil || !slices.Equal(ids, []string{"jellyfin", "sonarr"}) {
		t.Errorf("right passphrase: %v, %v", ids, err)
	}
}
