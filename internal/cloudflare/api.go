package cloudflare

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"strings"
)

// Scopes are the permissions of the one API token the person creates, scoped
// to one account and the one domain. Nothing else is needed.
var Scopes = []string{
	"Account > Cloudflare Tunnel > Edit",
	"Account > Access: Apps and Policies > Edit",
	"Account > Access: Organizations, Identity Providers, and Groups > Edit",
	"Zone > DNS > Edit",
	"Zone > Zone > Read",
}

// TeamSuffix ends the address of a Zero Trust team's login page.
const TeamSuffix = ".cloudflareaccess.com"

// accessAppPrefix names every Access application self-host creates, which is
// how it recognises its own when removing.
const accessAppPrefix = "self-host: "

// PermissionError means Cloudflare refused the token.
type PermissionError struct{ Cause *Error }

func (e *PermissionError) Error() string {
	return "Cloudflare refused the API token (" + e.Cause.Method + " " + e.Cause.Path + "). Make it with exactly these permissions, " +
		"for this one account and this one domain: " + strings.Join(Scopes, "; ")
}

func (e *PermissionError) Unwrap() error { return e.Cause }

// NotOnboardedError means the account has no Zero Trust organization yet.
type NotOnboardedError struct{}

func (*NotOnboardedError) Error() string {
	return "Cloudflare Zero Trust is not set up on this account yet. Open https://one.dash.cloudflare.com, choose a team name, " +
		"pick the Free plan (a payment method is asked for but not charged), then run this again"
}

// NotActiveError means the domain is not an active zone on the account.
type NotActiveError struct{ Domain string }

func (e *NotActiveError) Error() string {
	return e.Domain + " is not an active domain on this Cloudflare account. Use your main domain (like example.com), not a sub-domain, " +
		"add it to Cloudflare and wait until Cloudflare shows it as active"
}

// ForeignRecordError means a name already has a DNS record self-host did not create.
type ForeignRecordError struct{ Name string }

func (e *ForeignRecordError) Error() string {
	return e.Name + " already has a DNS record that self-host did not create, so it was left alone. Pick another App or remove that record yourself"
}

func explain(err error) error {
	var api *Error
	if errors.As(err, &api) && api.Denied() {
		return &PermissionError{Cause: api}
	}
	return err
}

type idRef struct {
	ID string `json:"id"`
}

func (r *idRef) UnmarshalJSON(data []byte) error {
	var s string
	if json.Unmarshal(data, &s) == nil {
		r.ID = s
		return nil
	}
	var obj struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(data, &obj); err != nil {
		return err
	}
	r.ID = obj.ID
	return nil
}

func ids(refs []idRef) []string {
	out := make([]string, len(refs))
	for i, r := range refs {
		out[i] = r.ID
	}
	return out
}

type zoneInfo struct {
	ID, Name string
	Account  idRef
}

func (c *Client) zone(ctx context.Context, domain string) (zoneID, accountID string, err error) {
	var zones []zoneInfo
	q := url.Values{"name": {domain}, "status": {"active"}}
	if err := c.list(ctx, "/zones", q, &zones); err != nil {
		return "", "", err
	}
	for _, z := range zones {
		if strings.EqualFold(z.Name, domain) {
			return z.ID, z.Account.ID, nil
		}
	}
	return "", "", &NotActiveError{Domain: domain}
}

func (c *Client) team(ctx context.Context, account string) (string, error) {
	var org struct {
		AuthDomain string `json:"auth_domain"`
	}
	err := c.do(ctx, http.MethodGet, "/accounts/"+account+"/access/organizations", nil, nil, &org)
	var api *Error
	if errors.As(err, &api) && !api.Denied() && (api.Status == http.StatusNotFound || api.Status == http.StatusBadRequest) {
		return "", &NotOnboardedError{}
	}
	if err != nil {
		return "", err
	}
	team := strings.TrimSuffix(org.AuthDomain, TeamSuffix)
	if team == "" {
		return "", &NotOnboardedError{}
	}
	return team, nil
}

func (c *Client) otpLogin(ctx context.Context, account string) (string, error) {
	var idps []struct{ ID, Type string }
	path := "/accounts/" + account + "/access/identity_providers"
	if err := c.list(ctx, path, nil, &idps); err != nil {
		return "", err
	}
	for _, idp := range idps {
		if idp.Type == "onetimepin" {
			return idp.ID, nil
		}
	}
	var created idRef
	body := map[string]any{"name": "One-time PIN login", "type": "onetimepin", "config": map[string]any{}}
	if err := c.do(ctx, http.MethodPost, path, nil, body, &created); err != nil {
		return "", err
	}
	return created.ID, nil
}

func (c *Client) tunnel(ctx context.Context, account, name string) (id string, found bool, err error) {
	var tunnels []struct{ ID, Name string }
	q := url.Values{"name": {name}, "is_deleted": {"false"}}
	if err := c.list(ctx, "/accounts/"+account+"/cfd_tunnel", q, &tunnels); err != nil {
		return "", false, err
	}
	for _, t := range tunnels {
		if t.Name == name {
			return t.ID, true, nil
		}
	}
	return "", false, nil
}

func (c *Client) createTunnel(ctx context.Context, account, name string) (string, error) {
	var created idRef
	body := map[string]any{"name": name, "config_src": "cloudflare"}
	if err := c.do(ctx, http.MethodPost, "/accounts/"+account+"/cfd_tunnel", nil, body, &created); err != nil {
		return "", err
	}
	return created.ID, nil
}

func (c *Client) tunnelToken(ctx context.Context, account, tunnel string) (string, error) {
	var token string
	if err := c.do(ctx, http.MethodGet, "/accounts/"+account+"/cfd_tunnel/"+tunnel+"/token", nil, nil, &token); err != nil {
		return "", err
	}
	return token, nil
}

func (c *Client) ingress(ctx context.Context, account, tunnel string) (map[string]any, error) {
	var result struct {
		Config map[string]any `json:"config"`
	}
	if err := c.do(ctx, http.MethodGet, "/accounts/"+account+"/cfd_tunnel/"+tunnel+"/configurations", nil, nil, &result); err != nil {
		return nil, err
	}
	if result.Config == nil {
		result.Config = map[string]any{}
	}
	return result.Config, nil
}

func (c *Client) setIngress(ctx context.Context, account, tunnel string, config map[string]any) error {
	return c.do(ctx, http.MethodPut, "/accounts/"+account+"/cfd_tunnel/"+tunnel+"/configurations", nil, map[string]any{"config": config}, nil)
}

type policyInfo struct {
	ID, Name string
	Include  []map[string]map[string]string
}

func (c *Client) policy(ctx context.Context, account, name string) (*policyInfo, error) {
	var policies []policyInfo
	if err := c.list(ctx, "/accounts/"+account+"/access/policies", nil, &policies); err != nil {
		return nil, err
	}
	for i := range policies {
		if policies[i].Name == name {
			return &policies[i], nil
		}
	}
	return nil, nil
}

func (p *policyInfo) emails() []string {
	var out []string
	for _, rule := range p.Include {
		if email, ok := rule["email"]["email"]; ok {
			out = append(out, strings.ToLower(email))
		}
	}
	return out
}

func policyBody(name string, emails []string) map[string]any {
	include := make([]map[string]any, len(emails))
	for i, e := range emails {
		include[i] = map[string]any{"email": map[string]string{"email": e}}
	}
	return map[string]any{"name": name, "decision": "allow", "include": include, "session_duration": "24h"}
}

type accessApp struct {
	ID, Name, Domain, AUD string
	Policies              []idRef
	AllowedIDPs           []string `json:"allowed_idps"`
}

func (c *Client) accessApps(ctx context.Context, account, domain string) ([]accessApp, error) {
	var apps []accessApp
	q := url.Values{"domain": {domain}, "exact": {"true"}}
	if err := c.list(ctx, "/accounts/"+account+"/access/apps", q, &apps); err != nil {
		return nil, err
	}
	var out []accessApp
	for _, a := range apps {
		if strings.EqualFold(a.Domain, domain) {
			out = append(out, a)
		}
	}
	return out, nil
}

func accessAppBody(app, host, policy, idp string) map[string]any {
	return map[string]any{
		"name":                      accessAppPrefix + app,
		"type":                      "self_hosted",
		"domain":                    host,
		"destinations":              []map[string]string{{"type": "public", "uri": host}},
		"policies":                  []string{policy},
		"allowed_idps":              []string{idp},
		"auto_redirect_to_identity": false,
		"session_duration":          "24h",
		"app_launcher_visible":      false,
	}
}

type dnsRecord struct {
	ID, Type, Name, Content, Comment string
	Proxied                          bool
}

func (c *Client) dnsRecords(ctx context.Context, zone, name string) ([]dnsRecord, error) {
	var records []dnsRecord
	if err := c.list(ctx, "/zones/"+zone+"/dns_records", url.Values{"name": {name}}, &records); err != nil {
		return nil, err
	}
	var out []dnsRecord
	for _, r := range records {
		if strings.EqualFold(r.Name, name) {
			out = append(out, r)
		}
	}
	return out, nil
}

func (c *Client) deleteRecord(ctx context.Context, zone, id string) error {
	return c.do(ctx, http.MethodDelete, "/zones/"+zone+"/dns_records/"+id, nil, nil, nil)
}

func tunnelTarget(tunnel string) string { return tunnel + ".cfargotunnel.com" }
