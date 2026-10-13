package service

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/ajnart/self-host/internal/backup"
)

// BackupInfo is one archive in the Project's backups folder.
type BackupInfo struct {
	Path      string
	Name      string
	Size      int64
	Created   time.Time
	Encrypted bool
	// Apps are the App IDs in its manifest. An encrypted archive has none
	// until BackupApps opens it with the passphrase.
	Apps []string
}

// Backups lists the archives in the Project's backups folder, newest first.
func (s *Service) Backups() ([]BackupInfo, error) {
	p, err := s.Project()
	if err != nil {
		return nil, err
	}
	var files []string
	for _, pattern := range []string{"selfhost-*.tar.zst", "selfhost-*.tar.zst.age"} {
		matches, err := filepath.Glob(filepath.Join(BackupDir(p), pattern))
		if err != nil {
			return nil, err
		}
		files = append(files, matches...)
	}
	var out []BackupInfo
	for _, file := range files {
		info, err := os.Stat(file)
		if err != nil || !info.Mode().IsRegular() {
			continue
		}
		entry := BackupInfo{Path: file, Name: filepath.Base(file), Size: info.Size(), Created: info.ModTime()}
		if stamp, ok := strings.CutPrefix(entry.Name, "selfhost-"); ok && len(stamp) >= len("20060102-150405") {
			if at, err := time.ParseInLocation("20060102-150405", stamp[:len("20060102-150405")], time.Local); err == nil {
				entry.Created = at
			}
		}
		entry.Encrypted = archiveEncrypted(file)
		if !entry.Encrypted {
			entry.Apps, _ = s.BackupApps(file, "")
		}
		out = append(out, entry)
	}
	slices.SortFunc(out, func(a, b BackupInfo) int {
		if c := b.Created.Compare(a.Created); c != 0 {
			return c
		}
		return strings.Compare(a.Name, b.Name)
	})
	return out, nil
}

func archiveEncrypted(file string) bool {
	f, err := os.Open(file)
	if err != nil {
		return false
	}
	defer f.Close()
	head := make([]byte, 32)
	n, _ := io.ReadFull(f, head)
	return backup.IsEncrypted(head[:n])
}

// BackupApps reads the App IDs from an archive's manifest, decrypting it with
// the passphrase when it is encrypted.
func (s *Service) BackupApps(file, passphrase string) ([]string, error) {
	f, err := os.Open(file)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	r, err := backup.Open(f, passphrase)
	if err != nil {
		return nil, err
	}
	defer r.Close()
	var ids []string
	for _, a := range r.Manifest.Apps {
		ids = append(ids, a.ID)
	}
	return ids, nil
}

// HumanSize is a byte count as B, KB, MB or GB.
func HumanSize(n int64) string {
	switch {
	case n >= 1<<30:
		return fmt.Sprintf("%.1f GB", float64(n)/(1<<30))
	case n >= 1<<20:
		return fmt.Sprintf("%.1f MB", float64(n)/(1<<20))
	case n >= 1<<10:
		return fmt.Sprintf("%.1f KB", float64(n)/(1<<10))
	}
	return strconv.FormatInt(n, 10) + " B"
}
