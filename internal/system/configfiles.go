package system

import (
	"crypto/rand"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"

	"golang.org/x/sys/unix"
)

type ConfigFiles interface {
	LoadOrCreateConfigFile(name string, create func() ([]byte, error)) ([]byte, error)
}

type configFiles struct {
	directory func() (string, error)
	chown     func(path string) error
}

func ConfigFilesAt(directory string) ConfigFiles {
	return configFiles{directory: func() (string, error) { return directory, nil }}
}

func (c configFiles) LoadOrCreateConfigFile(name string, create func() ([]byte, error)) ([]byte, error) {
	if name != "telemetry-id" {
		return nil, errors.New("unexpected config file")
	}
	dir, err := c.directory()
	if err != nil || dir == "" {
		return nil, errors.New("user config directory unavailable")
	}
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, err
	}
	if c.chown != nil {
		if err := c.chown(dir); err != nil {
			return nil, err
		}
	}
	fd, err := unix.Open(dir, unix.O_RDONLY|unix.O_DIRECTORY|unix.O_NOFOLLOW|unix.O_CLOEXEC, 0)
	if err != nil {
		return nil, err
	}
	directory := os.NewFile(uintptr(fd), dir)
	defer directory.Close()
	data, err := readConfigFile(fd, name)
	if err == nil {
		return data, directory.Sync()
	}
	if !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}
	data, err = create()
	if err != nil {
		return nil, err
	}
	if len(data) == 0 || len(data) > 4096 {
		return nil, errors.New("unexpected config file content")
	}
	var suffix [16]byte
	if _, err := rand.Read(suffix[:]); err != nil {
		return nil, err
	}
	temp := fmt.Sprintf(".%s-%x.tmp", name, suffix)
	tmpfd, err := unix.Openat(fd, temp, unix.O_WRONLY|unix.O_CREAT|unix.O_EXCL|unix.O_NOFOLLOW|unix.O_CLOEXEC, 0o600)
	if err != nil {
		return nil, err
	}
	defer unix.Unlinkat(fd, temp, 0)
	f := os.NewFile(uintptr(tmpfd), filepath.Join(dir, temp))
	defer f.Close()
	if n, err := f.Write(data); err != nil {
		return nil, err
	} else if n != len(data) {
		return nil, io.ErrShortWrite
	}
	if err := f.Sync(); err != nil {
		return nil, err
	}
	if err := f.Close(); err != nil {
		return nil, err
	}
	if err := unix.Linkat(fd, temp, fd, name, 0); err != nil {
		if errors.Is(err, os.ErrExist) {
			data, err := readConfigFile(fd, name)
			if err != nil {
				return nil, err
			}
			return data, directory.Sync()
		}
		return nil, err
	}
	if err := unix.Unlinkat(fd, temp, 0); err != nil {
		return nil, err
	}
	if c.chown != nil {
		if err := c.chown(filepath.Join(dir, name)); err != nil {
			return nil, err
		}
	}
	if err := directory.Sync(); err != nil {
		return nil, err
	}
	return data, nil
}

func readConfigFile(directory int, name string) ([]byte, error) {
	fd, err := unix.Openat(directory, name, unix.O_RDONLY|unix.O_NOFOLLOW|unix.O_NONBLOCK|unix.O_CLOEXEC, 0)
	if err != nil {
		return nil, err
	}
	f := os.NewFile(uintptr(fd), name)
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		return nil, err
	}
	if !info.Mode().IsRegular() || info.Size() == 0 || info.Size() > 4096 {
		return nil, errors.New("unexpected config file storage")
	}
	data, err := io.ReadAll(io.LimitReader(f, 4097))
	if err != nil {
		return nil, err
	}
	if int64(len(data)) != info.Size() {
		return nil, errors.New("config file changed during read")
	}
	return data, nil
}
