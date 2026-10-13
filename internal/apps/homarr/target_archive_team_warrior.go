package homarr

import (
	"context"
	"errors"
	"math"
	"time"

	"github.com/ajnart/self-host/internal/apps/archiveteamwarrior"
	"github.com/ajnart/self-host/internal/helpers"
)

func archiveTeamWarriorTarget() target {
	return target{
		id: "archive-team-warrior", name: "ArchiveTeam Warrior", kind: "archiveTeamWarrior",
		internal: fixed("http://archive-team-warrior:8001"),
		secrets: func(_, to *helpers.H) []secret {
			return []secret{{Kind: "username", Value: to.AdminUser()}, {Kind: "password", Value: to.AdminPassword()}}
		},
		widgets: []widget{plain("archiveTeamWarrior"), statWidget("running", "completed", "failed")},
		verify:  verifyArchiveTeamWarrior,
		stats:   verifyArchiveTeamWarriorStats,
	}
}

func verifyArchiveTeamWarrior(ctx context.Context, from, to *helpers.H, integrationID string) error {
	if err := archiveteamwarrior.Verify(ctx, to); err != nil {
		return err
	}
	value, err := apiKeyProcedure(ctx, from, "widget.archiveTeamWarrior.getStatus", map[string]any{"integrationId": integrationID})
	if err != nil {
		return err
	}
	result, ok := value.(map[string]any)
	if !ok {
		return errors.New("Homarr did not return Warrior worker status")
	}
	status, ok := result["status"].(map[string]any)
	if !ok {
		return errors.New("Homarr returned incomplete Warrior worker status")
	}
	state := stringField(status, "status")
	switch state {
	case "No Project":
		project, exists := status["project"]
		if !exists || project != nil {
			return errors.New("Homarr idle Warrior snapshot has no explicit empty project")
		}
	case "Running":
		project, ok := status["project"].(map[string]any)
		if !ok || stringField(project, "title") == "" || stringField(project, "title") == "Unknown Project" {
			return errors.New("Homarr returned no Warrior running project identity")
		}
	default:
		return errors.New("Homarr has no ready Warrior snapshot; retry self-host setup homarr")
	}
	if _, err := time.Parse(time.RFC3339Nano, stringField(status, "updatedAt")); err != nil {
		return errors.New("Homarr returned no Warrior snapshot timestamp")
	}
	items, ok := status["items"].([]any)
	if !ok {
		return errors.New("Homarr returned no Warrior worker items")
	}
	counts, ok := status["counts"].(map[string]any)
	if !ok {
		return errors.New("Homarr returned no Warrior worker counts")
	}
	total := 0.0
	for _, key := range []string{"running", "completed", "failed", "canceled"} {
		count, ok := counts[key].(float64)
		if !ok || count < 0 || math.IsNaN(count) || math.IsInf(count, 0) || math.Trunc(count) != count {
			return errors.New("Homarr returned incomplete Warrior worker counts")
		}
		total += count
	}
	if total > float64(len(items)) {
		return errors.New("Homarr Warrior counts do not match its worker items")
	}
	if state == "No Project" && (total != 0 || len(items) != 0) {
		return errors.New("Homarr idle Warrior snapshot still has worker items")
	}
	return nil
}

func verifyArchiveTeamWarriorStats(sample statsSample) error {
	for _, key := range []string{"running", "completed", "failed"} {
		count, ok := sample.values[key].(float64)
		if sample.units[key] != "count" || !ok || count < 0 || math.IsNaN(count) || math.IsInf(count, 0) || math.Trunc(count) != count {
			return errors.New("Homarr returned invalid Warrior worker Stats; retry self-host setup homarr")
		}
	}
	return nil
}
