package main

import (
	"flag"
	"fmt"
	"os"
)

func main() {
	stars := flag.Bool("stars", false, "also refresh GitHub star counts (needs GITHUB_TOKEN)")
	flag.Parse()
	steps := []func() error{writeCatalog, writeSelfHost, writeTheme}
	if *stars {
		steps = append(steps, writeStars)
	}
	for _, step := range steps {
		if err := step(); err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
	}
}
