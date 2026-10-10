package cloudflare

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"slices"
	"strconv"
	"strings"
	"time"
)

// Host is one App published at a name.
type Host struct {
	// App is the App's ID; Name is its full host name; Origin is where the
	// connector reaches it inside the Project, such as http://jellyfin:8096.
	App, Name, Origin string
}

// Spec is everything Publish needs to know.
type Spec struct {
	Domain string
	// TunnelName, PolicyName and Comment are how self-host recognises what it
	// made: the tunnel, the Access policy and every DNS record.
	TunnelName, PolicyName, Comment string
	// Emails are the people allowed past the login page.
	Emails []string
	Hosts  []Host
	// Dropped are names published before and not any more.
	Dropped []string
}

// Probe is what an unauthenticated visitor gets at a name.
type Probe struct {
	Status   int
	Location string
}

// Hooks are the parts of Publish that are not API calls.
type Hooks struct {
	// Progress reports each stage in plain words.
	Progress func(msg string)
	// StartConnector runs cloudflared with the tunnel's run token.
	StartConnector func(ctx context.Context, runToken string) error
	StopConnector  func(ctx context.Context) error
	// Probe asks for a name from outside the Project, with no cookies.
	Probe func(ctx context.Context, name string) (Probe, error)
}

func (h Hooks) progress(msg string) {
	if h.Progress != nil {
		h.Progress(msg)
	}
}

// Failure is a name that was not left published.
type Failure struct {
	Name, Reason string
}

// Result says what is published now.
type Result struct {
	Team string
	// Verified are the names that answered with the login page.
	Verified []string
	// Failed are names whose DNS record was deleted again.
	Failed []Failure
}

// Publish makes every host reachable behind the login page, in an order that
// never lets a name answer before its login page exists, and checks each name
// from outside. Running it again changes nothing that is already right.
func Publish(ctx context.Context, c *Client, spec Spec, hooks Hooks) (Result, error) {
	res, err := publish(ctx, c, spec, hooks)
	return res, explain(err)
}

func publish(ctx context.Context, c *Client, spec Spec, hooks Hooks) (res Result, runErr error) {
	hooks.progress("checking your domain and Zero Trust on Cloudflare")
	zone, account, err := c.zone(ctx, spec.Domain)
	if err != nil {
		return res, err
	}
	if res.Team, err = c.team(ctx, account); err != nil {
		return res, err
	}
	if err := c.constrain(ctx, account, zone); err != nil {
		return res, err
	}
	for _, name := range spec.Dropped {
		if err := c.unpublish(ctx, zone, name, spec.Comment); err != nil {
			return res, err
		}
	}

	hooks.progress("creating the one-time PIN login")
	idp, err := c.otpLogin(ctx, account)
	if err != nil {
		return res, err
	}

	hooks.progress("creating the tunnel")
	tunnel, found, err := c.tunnel(ctx, account, spec.TunnelName)
	if err != nil {
		return res, err
	}
	if found && tunnel != c.Ownership.TunnelID {
		return res, fmt.Errorf("tunnel name collision: ownership is unproven; left untouched")
	}
	if !found && c.Ownership.TunnelID != "" {
		return res, fmt.Errorf("owned tunnel is missing; ownership receipt retained for review")
	}
	if !found {
		if tunnel, err = c.createTunnel(ctx, account, spec.TunnelName); err != nil {
			return res, err
		}
		c.Ownership.TunnelID = tunnel
		if err := c.remember(ctx); err != nil {
			return res, err
		}
	}
	defer func() {
		if runErr == nil {
			return
		}
		cleanup, cancel := context.WithTimeout(context.WithoutCancel(ctx), 30*time.Second)
		defer cancel()
		names := slices.Clone(spec.Dropped)
		for _, h := range spec.Hosts {
			names = append(names, h.Name)
		}
		if !found {
			runErr = errors.Join(runErr, Remove(cleanup, c, RemoveSpec{Domain: spec.Domain, TunnelName: spec.TunnelName, PolicyName: spec.PolicyName, Comment: spec.Comment, Names: names}, RemoveHooks{StopConnector: hooks.StopConnector}))
		} else {
			for _, name := range names {
				runErr = errors.Join(runErr, c.unpublish(cleanup, zone, name, spec.Comment))
			}
		}
	}()
	runToken, err := c.tunnelToken(ctx, account, tunnel)
	if err != nil {
		return res, err
	}

	hooks.progress("putting the login page in front of each name")
	policy, err := c.ensurePolicy(ctx, account, spec)
	if err != nil {
		return res, err
	}
	auds := map[string]string{}
	for _, h := range spec.Hosts {
		if auds[h.Name], err = c.ensureAccessApp(ctx, account, h, policy, idp); err != nil {
			return res, err
		}
	}

	hooks.progress("telling the tunnel where each App lives")
	if err := c.ensureIngress(ctx, account, tunnel, spec, res.Team, auds); err != nil {
		return res, err
	}
	for _, name := range spec.Dropped {
		if err := c.dropAccessApp(ctx, account, name); err != nil {
			return res, err
		}
	}

	hooks.progress("starting the connector")
	if hooks.StartConnector != nil {
		if err := hooks.StartConnector(ctx, runToken); err != nil {
			return res, err
		}
	}

	hooks.progress("pointing your web addresses at the tunnel")
	existing := map[string]*dnsRecord{}
	for _, h := range spec.Hosts {
		records, err := c.dnsRecords(ctx, zone, h.Name)
		if err != nil {
			return res, err
		}
		for i, r := range records {
			if r.Type != "CNAME" || r.Comment != spec.Comment || c.Ownership.DNS[h.Name] != r.ID {
				return res, &ForeignRecordError{Name: h.Name}
			}
			existing[h.Name] = &records[i]
		}
	}
	records := map[string]string{}
	for _, h := range spec.Hosts {
		id, err := c.ensureRecord(ctx, zone, h.Name, tunnel, spec.Comment, existing[h.Name])
		if err != nil {
			return res, err
		}
		records[h.Name] = id
	}

	hooks.progress("checking each address from outside")
	for _, h := range spec.Hosts {
		reason := checkLogin(ctx, hooks, h.Name, res.Team)
		if reason == "" {
			res.Verified = append(res.Verified, h.Name)
			continue
		}
		if err := c.deleteRecord(ctx, zone, records[h.Name]); err != nil {
			return res, err
		}
		res.Failed = append(res.Failed, Failure{Name: h.Name, Reason: reason})
	}
	return res, nil
}

// checkLogin is empty when the name answers with a redirect to the login page.
func checkLogin(ctx context.Context, hooks Hooks, name, team string) string {
	if hooks.Probe == nil {
		return "it could not be checked from this computer"
	}
	probe, err := hooks.Probe(ctx, name)
	if err != nil {
		return "it could not be reached from this computer: " + err.Error()
	}
	if probe.Status == 302 {
		if target, err := url.Parse(probe.Location); err == nil && target.Scheme == "https" && target.User == nil && strings.EqualFold(target.Host, team+TeamSuffix) {
			return ""
		}
	}
	if probe.Status == 200 {
		return "it opened without asking for a login (the login page did not show)"
	}
	return "it did not show the login page (it answered " + strconv.Itoa(probe.Status) + ")"
}

func (c *Client) ensurePolicy(ctx context.Context, account string, spec Spec) (string, error) {
	emails := make([]string, len(spec.Emails))
	for i, e := range spec.Emails {
		emails[i] = strings.ToLower(e)
	}
	policy, err := c.policy(ctx, account, spec.PolicyName)
	if err != nil {
		return "", err
	}
	if policy != nil && policy.ID != c.Ownership.PolicyID {
		return "", fmt.Errorf("policy name collision: ownership is unproven; left untouched")
	}
	if policy == nil && c.Ownership.PolicyID != "" {
		return "", fmt.Errorf("owned policy is missing; ownership receipt retained for review")
	}
	path := "/accounts/" + account + "/access/policies"
	switch {
	case policy == nil:
		var created idRef
		if err := c.do(ctx, "POST", path, nil, policyBody(spec.PolicyName, spec.Emails), &created); err != nil {
			return "", err
		}
		c.Ownership.PolicyID = created.ID
		if err := c.remember(ctx); err != nil {
			return "", err
		}
		return created.ID, nil
	case !sameSet(policy.emails(), emails) || len(policy.Include) != len(policy.emails()) || policy.Decision != "allow" || len(policy.Exclude) != 0 || len(policy.Require) != 0:
		return policy.ID, c.do(ctx, "PUT", path+"/"+policy.ID, nil, policyBody(spec.PolicyName, spec.Emails), nil)
	}
	return policy.ID, nil
}

func sameSet(a, b []string) bool {
	a, b = slices.Clone(a), slices.Clone(b)
	slices.Sort(a)
	slices.Sort(b)
	return slices.Equal(slices.Compact(a), slices.Compact(b))
}

func (c *Client) ensureAccessApp(ctx context.Context, account string, h Host, policy, idp string) (string, error) {
	apps, err := c.accessApps(ctx, account, h.Name)
	if err != nil {
		return "", err
	}
	path := "/accounts/" + account + "/access/apps"
	if len(apps) == 0 {
		if c.Ownership.Apps[h.Name] != "" {
			return "", fmt.Errorf("owned Access app is missing; ownership receipt retained for review")
		}
		var created accessApp
		if err := c.do(ctx, "POST", path, nil, accessAppBody(h.App, h.Name, policy, idp), &created); err != nil {
			return "", err
		}
		c.Ownership.Apps[h.Name] = created.ID
		if err := c.remember(ctx); err != nil {
			return "", err
		}
		if created.AUD == "" {
			return "", fmt.Errorf("%s has no Access audience tag; it cannot be published safely", h.Name)
		}
		return created.AUD, nil
	}
	app := apps[0]
	if len(apps) != 1 || app.Name != accessAppPrefix+h.App || app.ID != c.Ownership.Apps[h.Name] {
		return "", fmt.Errorf("%s already has a login page managed by another tool; it was left alone", h.Name)
	}
	if app.AUD == "" {
		return "", fmt.Errorf("%s has no Access audience tag; it cannot be published safely", h.Name)
	}
	if !slices.Equal(ids(app.Policies), []string{policy}) || !slices.Equal(app.AllowedIDPs, []string{idp}) {
		if err := c.do(ctx, "PUT", path+"/"+app.ID, nil, accessAppBody(h.App, h.Name, policy, idp), nil); err != nil {
			return "", err
		}
	}
	return app.AUD, nil
}

func (c *Client) dropAccessApp(ctx context.Context, account, name string) error {
	apps, err := c.accessApps(ctx, account, name)
	if err != nil {
		return err
	}
	for _, app := range apps {
		if app.ID == c.Ownership.Apps[name] {
			if err := c.do(ctx, "DELETE", "/accounts/"+account+"/access/apps/"+app.ID, nil, nil, nil); err != nil {
				return err
			}
			delete(c.Ownership.Apps, name)
			if err := c.remember(ctx); err != nil {
				return err
			}
		}
	}
	return nil
}

// ensureIngress reads the tunnel's rules, replaces only the ones self-host
// owns and writes the list back, since a write replaces the whole list.
func (c *Client) ensureIngress(ctx context.Context, account, tunnel string, spec Spec, team string, auds map[string]string) error {
	config, err := c.ingress(ctx, account, tunnel)
	if err != nil {
		return err
	}
	ours := make([]map[string]any, len(spec.Hosts))
	owned := slices.Clone(spec.Dropped)
	for i, h := range spec.Hosts {
		owned = append(owned, h.Name)
		ours[i] = map[string]any{
			"hostname": h.Name,
			"service":  h.Origin,
			"originRequest": map[string]any{"access": map[string]any{
				"required": true, "teamName": team, "audTag": []string{auds[h.Name]},
			}},
		}
	}
	merged, changed := mergeIngress(config, ours, owned)
	if !changed {
		return nil
	}
	return c.setIngress(ctx, account, tunnel, merged)
}

// mergeIngress keeps every rule that is not in owned, then ours, then the
// catch-all, and says whether that differs from what the tunnel has.
func mergeIngress(config map[string]any, ours []map[string]any, owned []string) (map[string]any, bool) {
	var rules []map[string]any
	if list, ok := config["ingress"].([]any); ok {
		for _, r := range list {
			if m, ok := r.(map[string]any); ok {
				rules = append(rules, m)
			}
		}
	}
	catchAll := map[string]any{"service": "http_status:404"}
	if n := len(rules); n > 0 && rules[n-1]["hostname"] == nil {
		catchAll, rules = rules[n-1], rules[:n-1]
	}
	var merged []map[string]any
	for _, r := range rules {
		if host, _ := r["hostname"].(string); !slices.Contains(owned, host) {
			merged = append(merged, r)
		}
	}
	merged = append(append(merged, ours...), catchAll)

	next := map[string]any{}
	for k, v := range config {
		next[k] = v
	}
	next["ingress"] = merged
	before, _ := json.Marshal(config)
	after, _ := json.Marshal(next)
	return next, string(before) != string(after)
}

func (c *Client) ensureRecord(ctx context.Context, zone, name, tunnel, comment string, existing *dnsRecord) (string, error) {
	target := tunnelTarget(tunnel)
	body := map[string]any{"type": "CNAME", "name": name, "content": target, "proxied": true, "ttl": 1, "comment": comment}
	path := "/zones/" + zone + "/dns_records"
	if existing == nil {
		var created idRef
		if err := c.do(ctx, "POST", path, nil, body, &created); err != nil {
			return "", err
		}
		c.Ownership.DNS[name] = created.ID
		if err := c.remember(ctx); err != nil {
			return "", err
		}
		return created.ID, nil
	}
	if existing.Content != target || !existing.Proxied {
		if err := c.do(ctx, "PATCH", path+"/"+existing.ID, nil, map[string]any{"content": target, "proxied": true}, nil); err != nil {
			return "", err
		}
	}
	return existing.ID, nil
}

// unpublish deletes the DNS records self-host made for a name.
func (c *Client) unpublish(ctx context.Context, zone, name, comment string) error {
	records, err := c.dnsRecords(ctx, zone, name)
	if err != nil {
		return err
	}
	for _, r := range records {
		if r.Type == "CNAME" && r.Comment == comment && c.Ownership.DNS[name] == r.ID {
			if err := c.deleteRecord(ctx, zone, r.ID); err != nil {
				return err
			}
		}
	}
	return nil
}

// RemoveSpec says what Remove takes down.
type RemoveSpec struct {
	Domain                          string
	TunnelName, PolicyName, Comment string
	Names                           []string
}

// RemoveHooks are the parts of Remove that are not API calls.
type RemoveHooks struct {
	Progress func(msg string)
	// StopConnector takes cloudflared down.
	StopConnector func(ctx context.Context) error
}

// Remove undoes Publish in reverse: the names stop answering first, then the
// ingress, the login pages, the policy, the connector and the tunnel. The
// one-time PIN login and the Zero Trust organization are shared, so they stay.
func Remove(ctx context.Context, c *Client, spec RemoveSpec, hooks RemoveHooks) error {
	return explain(remove(ctx, c, spec, hooks))
}

func remove(ctx context.Context, c *Client, spec RemoveSpec, hooks RemoveHooks) error {
	progress := func(msg string) {
		if hooks.Progress != nil {
			hooks.Progress(msg)
		}
	}
	progress("looking up your domain on Cloudflare")
	zone, account, err := c.zone(ctx, spec.Domain)
	if err != nil {
		return err
	}
	if err := c.constrain(ctx, account, zone); err != nil {
		return err
	}
	ownedNames := slices.DeleteFunc(slices.Clone(spec.Names), func(name string) bool { return c.Ownership.Apps[name] == "" && c.Ownership.DNS[name] == "" })
	progress("taking your web addresses off the internet")
	for _, name := range ownedNames {
		if err := c.unpublish(ctx, zone, name, spec.Comment); err != nil {
			return err
		}
	}
	tunnel, found, err := c.tunnel(ctx, account, spec.TunnelName)
	if err != nil {
		return err
	}
	if found && tunnel != c.Ownership.TunnelID {
		return fmt.Errorf("tunnel ownership is unproven; left untouched")
	}
	if !found && c.Ownership.TunnelID != "" {
		return fmt.Errorf("owned tunnel is missing or renamed; retain its receipt and review Cloudflare before cleanup")
	}
	if found {
		config, err := c.ingress(ctx, account, tunnel)
		if err != nil {
			return err
		}
		if merged, changed := mergeIngress(config, nil, ownedNames); changed {
			if err := c.setIngress(ctx, account, tunnel, merged); err != nil {
				return err
			}
		}
	}
	progress("removing the login pages")
	for _, name := range ownedNames {
		if err := c.dropAccessApp(ctx, account, name); err != nil {
			return err
		}
	}
	var policy *policyInfo
	if c.Ownership.PolicyID != "" {
		policy, err = c.policy(ctx, account, spec.PolicyName)
		if err != nil {
			return err
		}
		if policy == nil {
			return fmt.Errorf("owned policy is missing or renamed; retain its receipt for review")
		}
	}
	if policy != nil {
		if policy.ID != c.Ownership.PolicyID {
			return fmt.Errorf("policy ownership is unproven; left untouched")
		}
		if err := c.do(ctx, "DELETE", "/accounts/"+account+"/access/policies/"+policy.ID, nil, nil, nil); err != nil {
			return err
		}
		c.Ownership.PolicyID = ""
		if err := c.remember(ctx); err != nil {
			return err
		}
	}
	if found {
		config, err := c.ingress(ctx, account, tunnel)
		if err != nil {
			return err
		}
		if rules, ok := config["ingress"].([]any); ok {
			for _, rule := range rules {
				if route, ok := rule.(map[string]any); ok && route["hostname"] != nil {
					return fmt.Errorf("the tunnel still serves other routes; its connector and tunnel were left running")
				}
			}
		}
	}
	progress("stopping the connector and deleting the tunnel")
	if hooks.StopConnector != nil {
		if err := hooks.StopConnector(ctx); err != nil {
			return err
		}
	}
	if found {
		base := "/accounts/" + account + "/cfd_tunnel/" + tunnel
		if err := c.do(ctx, "DELETE", base+"/connections", nil, nil, nil); err != nil {
			return err
		}
		if err := c.do(ctx, "DELETE", base, nil, nil, nil); err != nil {
			return err
		}
		c.Ownership.TunnelID = ""
		if err := c.remember(ctx); err != nil {
			return err
		}
	}
	return nil
}
