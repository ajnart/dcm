package service

import "slices"

// ShareApps lists the Catalog App ids in the Project, sorted. Unmanaged apps
// are left out, and it is empty when no Project exists yet.
func (s *Service) ShareApps() ([]string, error) {
	p, err := s.Project()
	if err != nil {
		return nil, err
	}
	if !p.Exists() {
		return nil, nil
	}
	ids, err := p.AppIDs()
	if err != nil {
		return nil, err
	}
	var out []string
	for _, id := range ids {
		if _, found := s.Catalog.App(id); found && !p.IsExtra(id) {
			out = append(out, id)
		}
	}
	slices.Sort(out)
	return out, nil
}
