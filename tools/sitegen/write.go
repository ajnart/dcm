package main

import (
	"fmt"
	"os"
	"path/filepath"
)

// writeFile writes one generated file and prints its path.
func writeFile(path string, content []byte) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	if err := os.WriteFile(path, content, 0o644); err != nil {
		return err
	}
	fmt.Println(path)
	return nil
}
