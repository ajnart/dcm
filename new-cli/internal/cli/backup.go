package cli

import (
	"bufio"
	"fmt"
	"strings"

	"github.com/spf13/cobra"
)

// passphrase reads SELF_HOST_BACKUP_PASSPHRASE or asks on a terminal.
func (a *program) passphrase(prompt string) string {
	if value := a.deps.Getenv("SELF_HOST_BACKUP_PASSPHRASE"); value != "" {
		return value
	}
	if !a.deps.Interactive || a.deps.In == nil {
		return ""
	}
	fmt.Fprint(a.deps.Out, prompt)
	line, _ := bufio.NewReader(a.deps.In).ReadString('\n')
	return strings.TrimRight(line, "\r\n")
}

func (a *program) backupCmds() []*cobra.Command {
	var out string
	var encrypt bool
	backupCmd := &cobra.Command{
		Use:   "backup [app...]",
		Short: "Write one compressed archive of App configuration, databases and secrets",
		RunE: func(cmd *cobra.Command, args []string) error {
			pass := ""
			if encrypt {
				if pass = a.passphrase("Backup passphrase: "); pass == "" {
					return a.fail(fmt.Errorf("--encrypt needs a passphrase: set SELF_HOST_BACKUP_PASSPHRASE"))
				}
			}
			_, err := a.service().Backup(cmd.Context(), args, out, pass)
			return a.fail(err)
		},
	}
	backupCmd.Flags().StringVarP(&out, "output", "o", "", "archive path (default ~/.self-host/backups/selfhost-DATE.tar.zst)")
	backupCmd.Flags().BoolVar(&encrypt, "encrypt", false, "encrypt with an age passphrase (SELF_HOST_BACKUP_PASSPHRASE)")

	var yes bool
	restoreCmd := &cobra.Command{
		Use:   "restore <file> [app...]",
		Short: "Restore every App in a Backup, or only the named ones",
		Args:  cobra.MinimumNArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			question := "Replace the current data of the restored Apps with the backup?"
			if !yes && !a.confirm(question) {
				return a.fail(fmt.Errorf("not confirmed; pass --yes to restore without asking"))
			}
			pass := a.deps.Getenv("SELF_HOST_BACKUP_PASSPHRASE")
			err := a.service().Restore(cmd.Context(), args[0], args[1:], pass)
			if err != nil && strings.Contains(err.Error(), "encrypted") && pass == "" && a.deps.Interactive {
				if pass = a.passphrase("Backup passphrase: "); pass != "" {
					err = a.service().Restore(cmd.Context(), args[0], args[1:], pass)
				}
			}
			return a.fail(err)
		},
	}
	restoreCmd.Flags().BoolVarP(&yes, "yes", "y", false, "do not ask for confirmation")
	return []*cobra.Command{backupCmd, restoreCmd}
}
