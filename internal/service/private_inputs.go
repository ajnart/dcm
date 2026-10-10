package service

import (
	"fmt"
	"io"
	"os"
	"strings"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/project"
	"golang.org/x/sys/unix"
)

const maxPrivateInputBytes = 64 * 1024

func validPrivateValue(value string) error {
	if len(value) > maxPrivateInputBytes || strings.ContainsRune(value, 0) {
		return fmt.Errorf("maximum 64 KiB, no NUL bytes")
	}
	return project.ValidEnvValue(value)
}

func inputFor(apps []app.App, id, key string) (app.Input, bool) {
	for _, a := range apps {
		if a.Info().ID != id {
			continue
		}
		for _, input := range a.Inputs() {
			if input.Key == key {
				return input, true
			}
		}
	}
	return app.Input{}, false
}

// privateReferences validates references without reading their payloads.
func privateReferences(apps []app.App, opts InstallOptions) (map[string]map[string]string, error) {
	files := map[string]map[string]string{}
	stdin := false
	for _, reference := range opts.SetFiles {
		key, file, ok := strings.Cut(reference, "=")
		id, name, scoped := strings.Cut(key, ".")
		input, found := inputFor(apps, id, name)
		if !ok || !scoped || file == "" || !found || !input.Private {
			return nil, fmt.Errorf("--set-file requires a selected private input as app.key=PATH")
		}
		if file == "-" {
			if stdin {
				return nil, fmt.Errorf("--set-file accepts at most one stdin reference (-) per command")
			}
			stdin = true
		}
		if files[id] == nil {
			files[id] = map[string]string{}
		}
		if _, duplicate := files[id][name]; duplicate {
			return nil, fmt.Errorf("duplicate --set-file input %s.%s", id, name)
		}
		files[id][name] = file
	}
	for id, values := range opts.PrivateInputs {
		for key := range values {
			input, found := inputFor(apps, id, key)
			if !found || !input.Private {
				return nil, fmt.Errorf("interactive private input must name a selected private field")
			}
			if _, duplicate := files[id][key]; duplicate {
				return nil, fmt.Errorf("duplicate private input %s.%s", id, key)
			}
		}
	}
	return files, nil
}

func readPrivateInput(file string, ownerUID int) (string, error) {
	// Paths are caller-selected and may have symlinked parent directories.
	// Nofollow rejects only a symlink at the final component; validation below
	// checks the opened descriptor. Nonblocking open avoids waiting on FIFOs.
	fd, err := unix.Open(file, unix.O_RDONLY|unix.O_CLOEXEC|unix.O_NOFOLLOW|unix.O_NONBLOCK, 0)
	if err != nil {
		return "", fmt.Errorf("cannot open private input file")
	}
	f := os.NewFile(uintptr(fd), file)
	defer f.Close()
	var metadata unix.Stat_t
	if err := unix.Fstat(fd, &metadata); err != nil || int(metadata.Uid) != ownerUID {
		return "", fmt.Errorf("private input file must belong to the authorized Project owner")
	}
	st, err := f.Stat()
	if err != nil || !st.Mode().IsRegular() || st.Mode().Perm()&0o077 != 0 || st.Size() > maxPrivateInputBytes {
		return "", fmt.Errorf("private input file must be a regular owner-only file of at most 64 KiB")
	}
	data, err := io.ReadAll(io.LimitReader(f, maxPrivateInputBytes+1))
	if err != nil || len(data) > maxPrivateInputBytes {
		return "", fmt.Errorf("cannot read private input file (maximum 64 KiB)")
	}
	return strings.TrimRight(string(data), "\r\n"), nil
}

func (s *Service) resolvePrivateInputs(p *project.Project, secrets map[string]string, apps []app.App, opts InstallOptions, values map[string]map[string]string) (map[string]string, error) {
	files, err := privateReferences(apps, opts)
	if err != nil {
		return nil, err
	}
	// Validate every supplied value before changing the secret store.
	pending := map[string]string{}
	for _, a := range apps {
		id := a.Info().ID
		for _, input := range a.Inputs() {
			if !input.Private {
				continue
			}
			secretKey := SecretKey(id, input.Key)
			value := secrets[secretKey]
			if supplied, found := opts.PrivateInputs[id][input.Key]; found {
				value = supplied
			}
			if file, found := files[id][input.Key]; found {
				if file == "-" {
					if s.Deps.In == nil {
						return nil, fmt.Errorf("private input %s.%s: stdin unavailable", id, input.Key)
					}
					var data []byte
					data, err = io.ReadAll(io.LimitReader(s.Deps.In, maxPrivateInputBytes+1))
					if err != nil || len(data) > maxPrivateInputBytes {
						return nil, fmt.Errorf("private input %s.%s: cannot read stdin (maximum 64 KiB)", id, input.Key)
					}
					value = strings.TrimRight(string(data), "\r\n")
				} else {
					value, err = readPrivateInput(file, p.Owner.UID)
				}
				if err != nil {
					return nil, fmt.Errorf("private input %s.%s: %w", id, input.Key, err)
				}
			}
			s.Log.Secret(value)
			if err := validPrivateValue(value); err != nil {
				return nil, fmt.Errorf("private input %s.%s: %w", id, input.Key, err)
			}
			if input.Required && value == "" {
				return nil, fmt.Errorf("missing private input %s.%s (pass --set-file %s.%s=PATH to an owner-only credential file)", id, input.Key, id, input.Key)
			}
			values[id][input.Key] = value
			if value != "" {
				pending[secretKey] = value
			}
		}
	}
	return pending, nil
}

func (ss *session) applyPrivateInputs(apps []app.App, opts InstallOptions, values map[string]map[string]string) error {
	pending, err := ss.s.resolvePrivateInputs(ss.p, ss.secrets.values, apps, opts, values)
	if err != nil {
		return err
	}

	for key, value := range pending {
		ss.secrets.values[key] = value
	}
	if len(pending) == 0 {
		return nil
	}
	return ss.p.SaveSecrets(ss.secrets.values)
}

func publicInputs(a app.App, values map[string]string) map[string]string {
	result := map[string]string{}
	for key, value := range values {
		input, found := inputFor([]app.App{a}, a.Info().ID, key)
		if !found || !input.Private {
			result[key] = value
		}
	}
	return result
}

// migratePrivateInputs runs under the Project lock, saving credentials before
// removing their legacy copies. An existing saved credential always wins.
func (ss *session) migratePrivateInputs() error {
	changed := false
	for id, st := range ss.state.Apps {
		a, found := ss.s.Catalog.App(id)
		if !found || st == nil {
			continue
		}
		for _, input := range a.Inputs() {
			if !input.Private {
				continue
			}
			value, legacy := st.Inputs[input.Key]
			if !legacy {
				continue
			}
			ss.s.Log.Secret(value)
			key := SecretKey(id, input.Key)
			if value != "" && ss.secrets.Get(key) == "" {
				if err := validPrivateValue(value); err != nil {
					return fmt.Errorf("legacy private input %s.%s cannot be migrated; privately repair %s in %s, then retry (keep the legacy state until the credential is saved)", id, input.Key, key, ss.p.Path("secrets.env"))
				}
				ss.secrets.values[key] = value
			}
			changed = true
		}
	}
	if !changed {
		return nil
	}
	if err := ss.p.SaveSecrets(ss.secrets.values); err != nil {
		return err
	}
	for id, st := range ss.state.Apps {
		a, found := ss.s.Catalog.App(id)
		if !found || st == nil {
			continue
		}
		st.Inputs = publicInputs(a, st.Inputs)
		for key, step := range st.Steps {
			step.Msg, step.Error, step.Hint = ss.s.Log.Redact(step.Msg), ss.s.Log.Redact(step.Error), ss.s.Log.Redact(step.Hint)
			st.Steps[key] = step
		}
	}
	return ss.p.SaveState(ss.state)
}
