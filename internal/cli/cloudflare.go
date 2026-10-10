package cli

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/ajnart/self-host/internal/service"
	"github.com/spf13/cobra"
)

func (a *program) cloudflareCmd() *cobra.Command {
	root := &cobra.Command{Use: "cloudflare", Short: "Your own web address, with a login page"}
	for _, operation := range []string{"plan", "publish", "remove"} {
		var opts service.CloudflareOptions
		var files []string
		cmd := &cobra.Command{Use: operation, Args: cobra.NoArgs}
		cmd.RunE = func(cmd *cobra.Command, _ []string) error {
			for _, ref := range files {
				key, path, ok := strings.Cut(ref, "=")
				if !ok || key != "cloudflare.api_token" || path == "" || opts.APITokenFile != "" {
					return fmt.Errorf("use one --set-file cloudflare.api_token=PATH (or =- for stdin)")
				}
				opts.APITokenFile = path
			}
			if operation == "plan" {
				a.document = true
				plan, err := a.service().CloudflarePlan(cmd.Context(), opts)
				if err != nil {
					return a.fail(err)
				}
				if a.json {
					return json.NewEncoder(a.deps.Out).Encode(plan)
				}
				fmt.Fprintln(a.deps.Out, plan.Risk)
				for _, app := range plan.Publish {
					fmt.Fprintln(a.deps.Out, app.Address)
					if app.Warning != "" {
						fmt.Fprintln(a.deps.Out, app.Warning)
					}
				}
				for _, app := range plan.Refused {
					fmt.Fprintln(a.deps.Out, app.Reason)
				}
				return nil
			}
			if operation == "remove" {
				if !opts.AcceptPublic {
					return a.fail(fmt.Errorf("removal takes your published Addresses off the internet; confirm with --yes"))
				}
				return a.fail(a.service().CloudflareRemove(cmd.Context(), opts))
			}
			_, err := a.service().CloudflarePublish(cmd.Context(), opts)
			return a.fail(err)
		}
		if operation != "remove" {
			cmd.Flags().StringVar(&opts.Domain, "domain", "", "main domain already active on Cloudflare, like example.com")
			cmd.Flags().StringSliceVar(&opts.Emails, "email", nil, "email allowed to sign in (repeatable)")
			cmd.Flags().StringSliceVar(&opts.Apps, "app", nil, "App chosen individually (repeatable; full desired list)")
			cmd.Flags().StringSliceVar(&opts.Allow, "allow-private", nil, "name a normally private App you deliberately want public")
		}
		if operation == "publish" {
			cmd.Flags().BoolVar(&opts.AcceptPublic, "accept-public", false, "separate yes: strangers can reach the login page; a flaw could let them in; Cloudflare sees traffic")
		}
		if operation == "remove" {
			cmd.Flags().BoolVar(&opts.AcceptPublic, "yes", false, "take the published Addresses off the internet")
		}
		if operation != "plan" {
			cmd.Flags().StringArrayVar(&files, "set-file", nil, "private API token: cloudflare.api_token=PATH or =-; never stored")
		}
		root.AddCommand(cmd)
	}
	return root
}
