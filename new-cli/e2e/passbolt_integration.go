package e2e

func preparePassboltEvidence(e *targetEvidence) {
	var stages []stageEvidence
	for _, stage := range e.Stages {
		stages = append(stages, stage)
		name := ""
		if stage.Name == "install" {
			name = "local-prerequisites"
		}
		if stage.Name == "restored-check" {
			name = "restored-local-prerequisites"
		}
		if name != "" {
			stages = append(stages, stageEvidence{Name: name, Outcome: "not-run", Apps: map[string]string{"passbolt": "not-run", "passbolt-prerequisites": "not-run"}})
		}
	}
	e.Stages = stages
}
