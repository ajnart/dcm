package main

import (
	"fmt"
	"os"
)

var version = "dev"

func main() {
	if len(os.Args) > 1 && os.Args[1] == "--version" {
		fmt.Println(version)
		return
	}
	fmt.Fprintln(os.Stderr, "self-host: not implemented yet")
	os.Exit(1)
}
