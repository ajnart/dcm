package service

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
)

func TestCredentialsIncludesSavedAdminEmailAndOmitsAbsentEmail(t *testing.T) {
	for _, email := range []string{"operator@example.test", ""} {
		h := newHarness(t, &testApp{id: "one", done: map[string]bool{}})
		if err := h.install("one"); err != nil {
			t.Fatal(err)
		}
		p, err := h.svc.Project()
		if err != nil {
			t.Fatal(err)
		}
		values := map[string]string{"ADMIN_USER": "operator", "ADMIN_PASSWORD": "synthetic-password"}
		if email != "" {
			values["ADMIN_EMAIL"] = email
		}
		if err := p.SaveSecrets(values); err != nil {
			t.Fatal(err)
		}
		creds, err := h.svc.Credentials(context.Background())
		if err != nil {
			t.Fatal(err)
		}
		data, err := json.Marshal(creds)
		if err != nil {
			t.Fatal(err)
		}
		if email != "" && !strings.Contains(string(data), `"email":"operator@example.test"`) {
			t.Fatal("Credentials must expose saved Admin email additively")
		}
		if email == "" && strings.Contains(string(data), `"email"`) {
			t.Fatal("absent Admin email must not change existing JSON fields")
		}
		if creds.Admin.Username != "operator" || creds.Admin.Password != "synthetic-password" || len(creds.Apps) != 0 {
			t.Fatal("existing credential fields changed")
		}
	}
}
