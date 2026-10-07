// Package backup reads and writes Backup archives: a tar stream with a
// manifest first, compressed with zstd and optionally encrypted with an age
// passphrase.
package backup

import (
	"archive/tar"
	"bufio"
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"strings"
	"time"

	"filippo.io/age"
	"github.com/klauspost/compress/zstd"
)

const ManifestName = "manifest.json"

type ManifestApp struct {
	ID      string `json:"id"`
	Name    string `json:"name,omitempty"`
	Image   string `json:"image,omitempty"`
	Managed bool   `json:"managed"`
}

type Manifest struct {
	Version    int           `json:"version"`
	Created    time.Time     `json:"created"`
	CLIVersion string        `json:"cli_version"`
	Apps       []ManifestApp `json:"apps"`
}

func (m Manifest) Has(id string) bool {
	for _, a := range m.Apps {
		if a.ID == id {
			return true
		}
	}
	return false
}

// ErrPassphrase means the archive is encrypted and the passphrase is wrong or missing.
var ErrPassphrase = errors.New("wrong passphrase for this encrypted backup")

// ErrNeedPassphrase means the archive is encrypted and no passphrase was given.
var ErrNeedPassphrase = errors.New("this backup is encrypted; set SELF_HOST_BACKUP_PASSPHRASE or enter the passphrase")

type Writer struct {
	tw     *tar.Writer
	closer []io.Closer
}

// Create starts an archive on w with manifest as its first entry.
func Create(w io.Writer, passphrase string, manifest Manifest) (*Writer, error) {
	out := &Writer{}
	if passphrase != "" {
		recipient, err := age.NewScryptRecipient(passphrase)
		if err != nil {
			return nil, err
		}
		enc, err := age.Encrypt(w, recipient)
		if err != nil {
			return nil, err
		}
		out.closer = append(out.closer, enc)
		w = enc
	}
	zw, err := zstd.NewWriter(w, zstd.WithEncoderLevel(zstd.SpeedBestCompression))
	if err != nil {
		return nil, err
	}
	out.closer = append([]io.Closer{zw}, out.closer...)
	out.tw = tar.NewWriter(zw)
	data, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		return nil, err
	}
	return out, out.AddBytes(ManifestName, data, 0o644)
}

func (w *Writer) AddBytes(name string, data []byte, mode int64) error {
	if err := w.tw.WriteHeader(&tar.Header{Name: name, Mode: mode, Size: int64(len(data)), ModTime: time.Now()}); err != nil {
		return err
	}
	_, err := w.tw.Write(data)
	return err
}

// AddTree archives dir under prefix, keeping modes, owners and symlinks.
func (w *Writer) AddTree(dir, prefix string) error {
	return filepath.WalkDir(dir, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		info, err := d.Info()
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(dir, p)
		if err != nil {
			return err
		}
		link := ""
		if info.Mode()&os.ModeSymlink != 0 {
			if link, err = os.Readlink(p); err != nil {
				return err
			}
		}
		h, err := tar.FileInfoHeader(info, link)
		if err != nil {
			return err
		}
		h.Name = path.Join(prefix, filepath.ToSlash(rel))
		if info.IsDir() {
			h.Name += "/"
		}
		if !info.Mode().IsRegular() && !info.IsDir() && link == "" {
			return nil // sockets, pipes and devices are not configuration
		}
		if err := w.tw.WriteHeader(h); err != nil {
			return err
		}
		if !info.Mode().IsRegular() {
			return nil
		}
		f, err := os.Open(p)
		if err != nil {
			return fmt.Errorf("cannot read %s: %w (rerun with sudo if the App wrote it as another user)", p, err)
		}
		defer f.Close()
		_, err = io.Copy(w.tw, f)
		return err
	})
}

func (w *Writer) Close() error {
	errs := []error{w.tw.Close()}
	for _, c := range w.closer {
		errs = append(errs, c.Close())
	}
	return errors.Join(errs...)
}

type Reader struct {
	Manifest Manifest
	tr       *tar.Reader
	closer   func()
}

var ageHeader = []byte("age-encryption.org/v1")

// IsEncrypted reports whether the archive at r starts with an age header.
func IsEncrypted(head []byte) bool { return bytes.HasPrefix(head, ageHeader) }

// Open reads the manifest of an archive, decrypting it when needed.
func Open(r io.Reader, passphrase string) (*Reader, error) {
	br := bufio.NewReader(r)
	head, _ := br.Peek(len(ageHeader))
	var src io.Reader = br
	if IsEncrypted(head) {
		if passphrase == "" {
			return nil, ErrNeedPassphrase
		}
		identity, err := age.NewScryptIdentity(passphrase)
		if err != nil {
			return nil, err
		}
		dec, err := age.Decrypt(br, identity)
		if err != nil {
			return nil, ErrPassphrase
		}
		src = dec
	}
	zr, err := zstd.NewReader(src)
	if err != nil {
		return nil, fmt.Errorf("not a self-host backup: %w", err)
	}
	tr := tar.NewReader(zr)
	h, err := tr.Next()
	if err != nil || h.Name != ManifestName {
		zr.Close()
		return nil, errors.New("not a self-host backup: manifest.json is missing")
	}
	var manifest Manifest
	if err := json.NewDecoder(tr).Decode(&manifest); err != nil {
		zr.Close()
		return nil, fmt.Errorf("backup manifest: %w", err)
	}
	return &Reader{Manifest: manifest, tr: tr, closer: zr.Close}, nil
}

func (r *Reader) Close() { r.closer() }

// Extract writes every entry for which dest returns a path. Entries whose
// names escape the archive root are rejected.
func (r *Reader) Extract(dest func(name string) string, chown func(path string, uid, gid int) error) error {
	for {
		h, err := r.tr.Next()
		if err == io.EOF {
			return nil
		}
		if err != nil {
			return err
		}
		clean := path.Clean(h.Name)
		if path.IsAbs(clean) || clean == ".." || strings.HasPrefix(clean, "../") || strings.Contains(h.Name, "/../") {
			return fmt.Errorf("unsafe path in backup: %s", h.Name)
		}
		target := dest(clean)
		if target == "" {
			continue
		}
		if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
			return err
		}
		mode := fs.FileMode(h.Mode).Perm()
		switch h.Typeflag {
		case tar.TypeDir:
			if err := os.MkdirAll(target, mode|0o700); err != nil {
				return err
			}
		case tar.TypeSymlink:
			os.Remove(target)
			if err := os.Symlink(h.Linkname, target); err != nil {
				return err
			}
		case tar.TypeReg:
			f, err := os.OpenFile(target, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, mode)
			if err != nil {
				return err
			}
			if _, err := io.Copy(f, r.tr); err != nil {
				f.Close()
				return err
			}
			if err := f.Close(); err != nil {
				return err
			}
		default:
			continue
		}
		if chown != nil {
			if err := chown(target, h.Uid, h.Gid); err != nil {
				return err
			}
		}
	}
}
