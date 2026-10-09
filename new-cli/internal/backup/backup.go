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
	"sort"
	"strings"
	"time"

	"filippo.io/age"
	"github.com/klauspost/compress/zstd"
)

const ManifestName = "manifest.json"

// OwnershipDocker means numeric archive owners belong to Docker's user
// namespace, rather than the CLI host's namespace. Empty remains legacy host.
const OwnershipDocker = "docker"

type ManifestApp struct {
	ID                 string `json:"id"`
	OwnershipNamespace string `json:"ownership_namespace,omitempty"`
	Name               string `json:"name,omitempty"`
	Image              string `json:"image,omitempty"`
	Managed            bool   `json:"managed"`
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

// AddTar imports the stdout-only tar stream of one owned App. Numeric owners
// remain in the helper's container namespace; callers mark the ManifestApp with
// OwnershipDocker. On any error the incomplete backup must be discarded.
// Adapter-declared ephemeral FIFOs omit only exact FIFO entries; declarations
// must be canonical App-relative paths. Other special entries remain invalid.
func (w *Writer) AddTar(src io.Reader, prefix string, ephemeralFIFOs ...string) error {
	if err := safeArchivePath(prefix); err != nil || path.Clean(prefix) == "." {
		return errors.New("unsafe helper archive prefix")
	}
	prefix = path.Clean(prefix)
	omit := map[string]bool{}
	for _, name := range ephemeralFIFOs {
		if safeArchivePath(name) != nil || name == "" || name == "." || path.Clean(name) != name {
			return errors.New("unsafe ephemeral FIFO declaration: require a contained canonical App-relative path")
		}
		omit[name] = true
	}
	tr := tar.NewReader(src)
	links := make(map[string]string)
	previous := make(map[string]EntryMetadata)
	for {
		h, err := tr.Next()
		if err == io.EOF {
			for name := range links {
				if err := validateLinkGraph(name, links); err != nil {
					return fmt.Errorf("unsafe helper symlink: %w", err)
				}
			}
			return nil
		}
		if err != nil {
			return fmt.Errorf("read App helper archive: %w", err)
		}
		if err := safeArchivePath(h.Name); err != nil {
			return err
		}
		name := path.Clean(h.Name)
		skipFIFO := h.Typeflag == tar.TypeFifo && omit[name] && strings.TrimPrefix(h.Name, "./") == name && h.Size == 0 && h.Linkname == ""
		if skipFIFO {
			if err := safeEntryOwnersAndMode(h); err != nil {
				return err
			}
		} else if err := safeEntryMetadata(h); err != nil {
			return err
		}
		for parent := name; parent != "."; parent = path.Dir(parent) {
			if _, found := links[parent]; found {
				return errors.New("unsafe helper archive: an entry writes through a symlink")
			}
		}
		if skipFIFO {
			continue
		}
		if h.Typeflag == tar.TypeSymlink {
			if len(h.Linkname) > 4096 || path.IsAbs(h.Linkname) || filepath.IsAbs(filepath.FromSlash(h.Linkname)) {
				return errors.New("unsafe helper archive symlink")
			}
			resolved := path.Clean(path.Join(path.Dir(name), h.Linkname))
			if err := safeArchivePath(resolved); err != nil {
				return errors.New("unsafe helper archive: symlink escapes the selected App")
			}
			links[name] = h.Linkname
		}
		if name == "." && h.Typeflag != tar.TypeDir {
			return errors.New("unsafe helper archive root entry")
		}
		copyHeader := *h
		copyHeader.Name = path.Join(prefix, name)
		if h.Typeflag == tar.TypeLink {
			if err := safeArchivePath(h.Linkname); err != nil {
				return errors.New("unsafe helper hardlink target (type 0x31)")
			}
			link := path.Clean(h.Linkname)
			for parent := link; parent != "."; parent = path.Dir(parent) {
				if _, found := links[parent]; found {
					return errors.New("unsafe helper hardlink target (type 0x31): symlink in target path")
				}
			}
			copyHeader.Linkname = path.Join(prefix, link)
			if _, err := hardlinkTarget(copyHeader.Name, &copyHeader, previous); err != nil {
				return err
			}
		}
		// Extended headers must not override our validated names and owners.
		copyHeader.PAXRecords = nil
		copyHeader.Uname, copyHeader.Gname = "", ""
		if err := w.tw.WriteHeader(&copyHeader); err != nil {
			return err
		}
		if h.Typeflag == tar.TypeReg || h.Typeflag == tar.TypeRegA {
			if _, err := io.Copy(w.tw, tr); err != nil {
				return err
			}
		}
		previous[copyHeader.Name] = EntryMetadata{Path: copyHeader.Name, UID: h.Uid, GID: h.Gid, Mode: uint32(h.Mode), Type: h.Typeflag}
	}
}

func safeArchivePath(name string) error {
	clean := path.Clean(name)
	if len(name) > 4096 || path.IsAbs(clean) || clean == ".." || strings.HasPrefix(clean, "../") || strings.Contains(name, "/../") || !filepath.IsLocal(filepath.FromSlash(clean)) {
		return errors.New("unsafe path in backup archive")
	}
	return nil
}

func safeEntryMetadata(h *tar.Header) error {
	if err := safeEntryOwnersAndMode(h); err != nil {
		return err
	}
	switch h.Typeflag {
	case tar.TypeReg, tar.TypeRegA, tar.TypeDir, tar.TypeSymlink, tar.TypeLink:
		return nil
	default:
		return fmt.Errorf("unsupported backup entry type 0x%02x: special files cannot be restored", h.Typeflag)
	}
}

func safeEntryOwnersAndMode(h *tar.Header) error {
	if h.Uid < 0 || h.Gid < 0 || uint64(h.Uid) > 2147483647 || uint64(h.Gid) > 2147483647 || h.Mode < 0 || h.Mode & ^int64(0o7777) != 0 {
		return errors.New("unsafe backup metadata: owners must be nonnegative IDs and modes must use permission bits up to 07777")
	}
	// A restore may run as root, so an archive must not plant a file that
	// runs with root's user or group.
	if h.Typeflag != tar.TypeDir && (h.Mode&0o4000 != 0 && h.Uid == 0 || h.Mode&0o2000 != 0 && h.Gid == 0) {
		return fmt.Errorf("unsafe backup metadata: %q is setuid or setgid root", h.Name)
	}
	return nil
}

// entryFileMode maps raw tar mode bits, including setuid, setgid and sticky,
// onto fs.FileMode's permission and special bits.
func entryFileMode(mode int64) fs.FileMode {
	m := fs.FileMode(mode) & fs.ModePerm
	if mode&0o4000 != 0 {
		m |= fs.ModeSetuid
	}
	if mode&0o2000 != 0 {
		m |= fs.ModeSetgid
	}
	if mode&0o1000 != 0 {
		m |= fs.ModeSticky
	}
	return m
}

// stagedMode defers chmod until after every entry's chown, so ownership
// changes cannot clear restored setuid or setgid bits.
type stagedMode struct {
	rel  string
	mode fs.FileMode
}

// hardlinkTarget permits only an earlier ordinary file in the same App. A
// hardlink must not alter its shared inode's owners or permissions.
func hardlinkTarget(name string, h *tar.Header, previous map[string]EntryMetadata) (string, error) {
	if err := safeArchivePath(h.Linkname); err != nil || h.Size != 0 {
		return "", errors.New("unsafe hardlink target (type 0x31)")
	}
	link := path.Clean(h.Linkname)
	parts, targetParts := strings.SplitN(name, "/", 3), strings.SplitN(link, "/", 3)
	if len(parts) != 3 || len(targetParts) != 3 || parts[0] != "apps" || targetParts[0] != "apps" || parts[1] != targetParts[1] || name == link {
		return "", errors.New("unsafe hardlink target (type 0x31): target must be another file in the same selected App")
	}
	entry, found := previous[link]
	if !found || (entry.Type != tar.TypeReg && entry.Type != tar.TypeRegA) {
		return "", errors.New("unsafe hardlink target (type 0x31): target must be an earlier selected regular file")
	}
	if entry.UID != h.Uid || entry.GID != h.Gid || entry.Mode != uint32(h.Mode) {
		return "", errors.New("unsafe hardlink metadata (type 0x31): owners and mode must match the earlier regular file")
	}
	return link, nil
}

// validateLinkGraph resolves archive-relative links component by component, so
// aliases cannot disguise an escape using an apparently contained ../ target.
func validateLinkGraph(name string, links map[string]string) error {
	parts := strings.Split(name, "/")
	var resolved []string
	followed := 0
	for len(parts) > 0 {
		part := parts[0]
		parts = parts[1:]
		switch part {
		case "", ".":
			continue
		case "..":
			if len(resolved) == 0 {
				return errors.New("link chain escapes the selected App")
			}
			resolved = resolved[:len(resolved)-1]
			continue
		}
		key := strings.Join(append(append([]string{}, resolved...), part), "/")
		if link, found := links[key]; found {
			followed++
			if followed > 40 {
				return errors.New("link chain is cyclic or too deep")
			}
			parts = append(strings.Split(link, "/"), parts...)
			continue
		}
		resolved = append(resolved, part)
	}
	return nil
}

func (w *Writer) Close() error {
	errs := []error{w.tw.Close()}
	for _, c := range w.closer {
		errs = append(errs, c.Close())
	}
	return errors.Join(errs...)
}

type Reader struct {
	Manifest  Manifest
	tr        *tar.Reader
	closer    func()
	metadata  map[string]EntryMetadata
	extracted bool
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
	for _, app := range manifest.Apps {
		if app.OwnershipNamespace != "" && app.OwnershipNamespace != OwnershipDocker {
			zr.Close()
			return nil, errors.New("backup has an unsupported ownership namespace")
		}
	}
	return &Reader{Manifest: manifest, tr: tr, closer: zr.Close}, nil
}

func (r *Reader) Close() { r.closer() }

// Extract writes selected entries beneath root, which must be a private staging
// directory. Relative symlinks are retained only when their lexical destination
// is also selected by dest. Entries never write through symlink ancestors or
// destinations. Hard links may target an earlier regular file in the same
// selected App with identical metadata; special files are rejected. chown must not follow
// symlinks (use os.Lchown). The caller must discard staging on any error.
func (r *Reader) Extract(root string, dest func(name string) string, chown func(path string, uid, gid int) error) error {
	r.extracted = false
	r.metadata = make(map[string]EntryMetadata)
	root, err := filepath.Abs(root)
	if err != nil {
		return err
	}
	staging, err := os.OpenRoot(root)
	if err != nil {
		return fmt.Errorf("open backup staging directory: %w", err)
	}
	defer staging.Close()
	var links []string
	locations := make(map[string]string)
	var fileModes, dirModes []stagedMode
	for {
		h, err := r.tr.Next()
		if err == io.EOF {
			// Later entries may change how an earlier link resolves. Check the
			// completed graph before the caller can use ordinary filesystem APIs.
			for _, link := range links {
				if _, err := staging.Stat(link); err != nil && !errors.Is(err, fs.ErrNotExist) {
					return fmt.Errorf("unsafe symlink in backup entry %q: link chain cannot resolve inside staging", filepath.ToSlash(link))
				}
			}
			if err := applyStagedModes(staging, fileModes, dirModes); err != nil {
				return err
			}
			r.extracted = true
			return nil
		}
		if err != nil {
			return err
		}
		if len(h.Name) > 4096 || len(h.Linkname) > 4096 {
			return errors.New("unsafe backup entry: path or link exceeds 4096 bytes")
		}
		clean := path.Clean(h.Name)
		if path.IsAbs(clean) || clean == ".." || strings.HasPrefix(clean, "../") || strings.Contains(h.Name, "/../") || !filepath.IsLocal(filepath.FromSlash(clean)) {
			return fmt.Errorf("unsafe path in backup: %q", h.Name)
		}
		target := dest(clean)
		if target == "" {
			continue
		}
		rel, err := filepath.Rel(root, target)
		if err != nil || !filepath.IsLocal(rel) || rel == "." {
			return fmt.Errorf("unsafe backup destination for %q: select a path inside staging", clean)
		}
		if err := safeEntryMetadata(h); err != nil {
			return err
		}
		if err := rejectSymlinkPath(staging, rel); err != nil {
			return fmt.Errorf("unsafe backup entry %q: %w", clean, err)
		}
		if err := staging.MkdirAll(filepath.Dir(rel), 0o755); err != nil {
			return fmt.Errorf("backup entry %q: %w", clean, err)
		}
		mode := fs.FileMode(h.Mode).Perm()
		switch h.Typeflag {
		case tar.TypeDir:
			if err := staging.MkdirAll(rel, mode|0o700); err != nil {
				return err
			}
			dirModes = append(dirModes, stagedMode{rel, entryFileMode(h.Mode) | 0o700})
		case tar.TypeSymlink:
			link := filepath.FromSlash(h.Linkname)
			resolved := filepath.Clean(filepath.Join(filepath.Dir(rel), link))
			archiveLink := path.Clean(path.Join(path.Dir(clean), h.Linkname))
			selected := dest(archiveLink)
			if filepath.IsAbs(link) || path.IsAbs(h.Linkname) || !filepath.IsLocal(resolved) || selected == "" || filepath.Clean(selected) != filepath.Join(root, resolved) {
				return fmt.Errorf("unsafe symlink in backup entry %q: use a relative link to another selected path", clean)
			}
			if err := staging.Remove(rel); err != nil && !errors.Is(err, fs.ErrNotExist) {
				return err
			}
			if err := staging.Symlink(link, rel); err != nil {
				return err
			}
			links = append(links, rel)
		case tar.TypeLink:
			link, err := hardlinkTarget(clean, h, r.metadata)
			if err != nil {
				return err
			}
			selected := dest(link)
			linkRel, present := locations[link]
			if selected == "" || !present || filepath.Clean(selected) != filepath.Join(root, linkRel) {
				return errors.New("unsafe hardlink target (type 0x31): target is not selected for extraction")
			}
			if err := rejectSymlinkPath(staging, linkRel); err != nil {
				return fmt.Errorf("unsafe hardlink target (type 0x31): %w", err)
			}
			info, err := staging.Lstat(linkRel)
			if err != nil || !info.Mode().IsRegular() {
				return errors.New("unsafe hardlink target (type 0x31): target is not a regular staged file")
			}
			if err := staging.Remove(rel); err != nil && !errors.Is(err, fs.ErrNotExist) {
				return err
			}
			if err := staging.Link(linkRel, rel); err != nil {
				return err
			}
		case tar.TypeReg, tar.TypeRegA:
			// Replace the inode rather than truncating a possible existing hard link.
			if err := staging.Remove(rel); err != nil && !errors.Is(err, fs.ErrNotExist) {
				return err
			}
			f, err := staging.OpenFile(rel, os.O_CREATE|os.O_EXCL|os.O_WRONLY, mode)
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
			fileModes = append(fileModes, stagedMode{rel, entryFileMode(h.Mode)})
		default:
			return fmt.Errorf("unsupported backup entry type 0x%02x: special files cannot be restored", h.Typeflag)
		}
		r.metadata[clean] = EntryMetadata{Path: clean, UID: h.Uid, GID: h.Gid, Mode: uint32(h.Mode), Type: h.Typeflag}
		locations[clean] = rel
		if chown != nil {
			if err := chown(filepath.Join(root, rel), h.Uid, h.Gid); err != nil {
				return err
			}
		}
	}
}

func applyStagedModes(staging *os.Root, files, dirs []stagedMode) error {
	for _, m := range files {
		if err := staging.Chmod(m.rel, m.mode); err != nil {
			return err
		}
	}
	sort.SliceStable(dirs, func(i, j int) bool {
		return strings.Count(dirs[i].rel, string(filepath.Separator)) > strings.Count(dirs[j].rel, string(filepath.Separator))
	})
	for _, m := range dirs {
		if err := staging.Chmod(m.rel, m.mode); err != nil {
			return err
		}
	}
	return nil
}

func rejectSymlinkPath(root *os.Root, name string) error {
	current := "."
	for _, part := range strings.Split(name, string(filepath.Separator)) {
		current = filepath.Join(current, part)
		info, err := root.Lstat(current)
		if errors.Is(err, fs.ErrNotExist) {
			return nil
		}
		if err != nil {
			return err
		}
		if info.Mode()&os.ModeSymlink != 0 {
			return errors.New("a symlink occupies the extraction path; restore links without writing through them")
		}
	}
	return nil
}

// EntryMetadata is an extraction-validated ownership journal item. Path is
// relative to the selected App when returned by AppMetadata.
type EntryMetadata struct {
	Path string
	UID  int
	GID  int
	Mode uint32
	Type byte
}

// AppMetadata exposes only entries successfully extracted for this selected
// App, after all path/link validation completed. Apply files before directories
// and deepest directories first, so restrictive modes cannot block children.
func (r *Reader) AppMetadata(appID string) ([]EntryMetadata, error) {
	if !r.extracted {
		return nil, errors.New("backup metadata is unavailable until safe extraction succeeds")
	}
	if appID == "" || appID == "." || appID == ".." || strings.ContainsAny(appID, "/\\") || !r.Manifest.Has(appID) {
		return nil, errors.New("backup metadata requires a selected manifest App")
	}
	prefix := "apps/" + appID
	var entries []EntryMetadata
	for name, entry := range r.metadata {
		if name == prefix {
			entry.Path = "."
		} else if strings.HasPrefix(name, prefix+"/") {
			entry.Path = strings.TrimPrefix(name, prefix+"/")
		} else {
			continue
		}
		entries = append(entries, entry)
	}
	sort.Slice(entries, func(i, j int) bool {
		leftDir, rightDir := entries[i].Type == tar.TypeDir, entries[j].Type == tar.TypeDir
		if leftDir != rightDir {
			return !leftDir
		}
		if leftDir {
			leftDepth, rightDepth := strings.Count(entries[i].Path, "/"), strings.Count(entries[j].Path, "/")
			if entries[i].Path == "." {
				leftDepth = -1
			}
			if entries[j].Path == "." {
				rightDepth = -1
			}
			if leftDepth != rightDepth {
				return leftDepth > rightDepth
			}
		}
		return entries[i].Path < entries[j].Path
	})
	return entries, nil
}
