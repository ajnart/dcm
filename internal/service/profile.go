package service

import (
	"fmt"

	"github.com/ajnart/self-host/internal/project"
)

// Profile is the person's Profile; the zero Profile when none was saved.
func (s *Service) Profile() (project.Profile, error) {
	p, err := s.Project()
	if err != nil {
		return project.Profile{}, err
	}
	return p.LoadProfile()
}

// SetExperience saves the Experience level in the Profile. It takes no lock:
// it touches no other file, so it is safe before and during an install.
func (s *Service) SetExperience(level string) error {
	if level != project.ExperienceNew && level != project.ExperienceAdvanced {
		return fmt.Errorf("experience must be %s or %s, got %q", project.ExperienceNew, project.ExperienceAdvanced, level)
	}
	p, err := s.Project()
	if err != nil {
		return err
	}
	pr, err := p.LoadProfile()
	if err != nil {
		return err
	}
	pr.Experience = level
	return p.SaveProfile(pr)
}
