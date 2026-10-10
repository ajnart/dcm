package service

import "github.com/ajnart/self-host/internal/project"

// Appearance is the Project's appearance; the zero Appearance when none was
// chosen or no Project exists yet.
func (s *Service) Appearance() (project.Appearance, error) {
	p, err := s.Project()
	if err != nil {
		return project.Appearance{}, err
	}
	return p.LoadAppearance()
}

// SetAppearance saves the appearance with the Project. It takes no lock: it
// touches no other file, so it is safe while an install creates the Project.
func (s *Service) SetAppearance(a project.Appearance) error {
	p, err := s.Project()
	if err != nil {
		return err
	}
	return p.SaveAppearance(a)
}
