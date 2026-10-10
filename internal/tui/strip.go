package tui

import "github.com/charmbracelet/x/ansi"

func stripANSI(s string) string { return ansi.Strip(s) }
