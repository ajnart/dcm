package project

import "os"

// ReadHomeFile reads a small file that lives directly in the Home folder.
func (p *Project) ReadHomeFile(name string) ([]byte, error) {
	return os.ReadFile(p.Path(name))
}

// WriteHomeFile writes a small file directly in the Home folder, creating the
// folder for its owner when it does not exist yet.
func (p *Project) WriteHomeFile(name string, data []byte, mode os.FileMode) error {
	if err := p.MkdirAll(); err != nil {
		return err
	}
	return p.writeFile(p.Path(name), data, mode)
}
