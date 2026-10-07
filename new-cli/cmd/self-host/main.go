package main

import (
	"context"
	"os"
	"os/signal"

	"github.com/ajnart/self-host/internal/cli"
	"github.com/ajnart/self-host/internal/system"
)

var version = "dev"

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	code := cli.Run(ctx, system.Real(version), os.Args[1:])
	stop()
	os.Exit(code)
}
