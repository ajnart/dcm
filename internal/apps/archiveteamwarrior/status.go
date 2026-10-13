package archiveteamwarrior

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/ajnart/self-host/internal/helpers"
)

func Verify(ctx context.Context, h *helpers.H) error {
	if h.AdminUser() == "" || h.AdminPassword() == "" {
		return errors.New("the Warrior Admin login is missing; retry self-host setup archive-team-warrior")
	}
	anon, err := h.HTTP(ctx, helpers.Request{Path: "/"})
	if err != nil {
		return err
	}
	if anon.Status != http.StatusUnauthorized && anon.Status != http.StatusForbidden {
		return fmt.Errorf("anonymous visitors can reach the Warrior control interface (HTTP %d); set HTTP_USERNAME and HTTP_PASSWORD", anon.Status)
	}
	login, err := h.HTTP(ctx, helpers.Request{Path: "/", User: h.AdminUser(), Password: h.AdminPassword()})
	if err != nil {
		return err
	}
	if login.Status != http.StatusOK {
		return fmt.Errorf("Warrior rejected the Admin login (HTTP %d); repair its saved HTTP settings and retry self-host setup archive-team-warrior", login.Status)
	}
	return verifySnapshot(ctx, h)
}

func verifySnapshot(ctx context.Context, h *helpers.H) error {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	session := make([]byte, 16)
	if _, err := rand.Read(session); err != nil {
		return err
	}
	path := "/000/" + hex.EncodeToString(session) + "/xhr"
	status := ""
	var project json.RawMessage
	for range 4 {
		resp, err := h.HTTP(ctx, helpers.Request{Method: http.MethodPost, Path: path, User: h.AdminUser(), Password: h.AdminPassword()})
		if err != nil {
			return err
		}
		if resp.Status != http.StatusOK {
			return fmt.Errorf("Warrior worker status returned HTTP %d; retry self-host setup archive-team-warrior", resp.Status)
		}
		frame := strings.TrimSpace(string(resp.Body))
		if frame == "o" || frame == "h" {
			continue
		}
		if !strings.HasPrefix(frame, "a") {
			return errors.New("Warrior did not return a SockJS worker status snapshot")
		}
		var messages []string
		if err := json.Unmarshal([]byte(frame[1:]), &messages); err != nil {
			return errors.New("Warrior returned an invalid worker status snapshot")
		}
		for _, message := range messages {
			var event struct {
				Name    string          `json:"event_name"`
				Message json.RawMessage `json:"message"`
			}
			if err := json.Unmarshal([]byte(message), &event); err != nil {
				return errors.New("Warrior returned an invalid worker status event")
			}
			switch event.Name {
			case "warrior.status":
				var value struct {
					Status string `json:"status"`
				}
				if err := json.Unmarshal(event.Message, &value); err != nil || value.Status == "" {
					return errors.New("Warrior worker status is missing")
				}
				status = value.Status
			case "project.refresh":
				project = event.Message
			}
		}
		if status != "" && len(project) != 0 {
			return verifyWorker(status, project)
		}
	}
	return errors.New("Warrior worker/project status is incomplete; retry self-host setup archive-team-warrior")
}

func verifyWorker(status string, project json.RawMessage) error {
	switch status {
	case "UNINITIALIZED", "INVALID_SETTINGS":
		return fmt.Errorf("%w: verify the Warrior nickname and HQ registration in its control interface, then retry self-host setup archive-team-warrior", helpers.ErrManual)
	case "NO_PROJECT":
		if strings.TrimSpace(string(project)) != "null" {
			return errors.New("Warrior reports no selected project but still has a worker project")
		}
		return nil
	case "RUNNING_PROJECT":
		var value struct {
			Project *struct {
				Title string `json:"title"`
			} `json:"project"`
			Status string            `json:"status"`
			Items  []json.RawMessage `json:"items"`
		}
		if err := json.Unmarshal(project, &value); err != nil || value.Project == nil || value.Project.Title == "" || value.Status != "running" || value.Items == nil {
			return errors.New("Warrior running project snapshot is incomplete")
		}
		return nil
	default:
		return errors.New("Warrior is not ready; check its worker status and retry self-host setup archive-team-warrior")
	}
}
