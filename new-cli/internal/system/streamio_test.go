package system_test

import (
	"bytes"
	"context"
	"errors"
	"io"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/ajnart/self-host/internal/system"
)

func TestStreamIOSendsBinaryBeforeInputEndsAndSeparatesDiagnostics(t *testing.T) {
	runner, ok := system.Real("test").Runner.(system.StreamIORunner)
	if !ok {
		t.Fatal("real Runner must support separate streaming I/O")
	}
	input, producer := io.Pipe()
	defer input.Close()
	defer producer.Close()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	payload := []byte{0, 255, 128, '\n', 0, 42}
	stdout := &notifyingWriter{first: make(chan struct{})}
	var stderr bytes.Buffer
	done := make(chan error, 1)
	go func() {
		done <- runner.StreamIO(ctx, streamCommand("echo"), input, stdout, &stderr)
	}()
	wrote := make(chan error, 1)
	go func() {
		_, err := producer.Write(payload)
		wrote <- err
	}()
	select {
	case <-stdout.first:
	case <-time.After(2 * time.Second):
		cancel()
		producer.Close()
		<-done
		t.Fatal("binary output was buffered until input ended")
	}
	if err := <-wrote; err != nil {
		t.Fatal(err)
	}
	producer.Close()
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(stdout.Bytes(), payload) {
		t.Fatal("binary stdout was changed or mixed with diagnostic bytes")
	}
	if stderr.String() != "synthetic diagnostic\n" {
		t.Fatal("diagnostics were not delivered separately")
	}
}

func TestStreamIOCancelsRunningCommand(t *testing.T) {
	runner, ok := system.Real("test").Runner.(system.StreamIORunner)
	if !ok {
		t.Fatal("real Runner must support separate streaming I/O")
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	started := &notifyingWriter{first: make(chan struct{})}
	done := make(chan error, 1)
	go func() {
		done <- runner.StreamIO(ctx, streamCommand("wait"), nil, started, io.Discard)
	}()
	select {
	case <-started.first:
	case <-time.After(2 * time.Second):
		t.Fatal("command did not start")
	}
	cancel()
	select {
	case err := <-done:
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("canceled command must return context cancellation: %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("canceled command kept running")
	}
}

func streamCommand(mode string) system.Cmd {
	return system.Cmd{Name: os.Args[0], Args: []string{"-test.run=^TestStreamIOProcessHelper$"}, Env: []string{"SELFHOST_STREAM_TEST_MODE=" + mode}, Stdin: []byte("fallback input")}
}

type notifyingWriter struct {
	buffer bytes.Buffer
	first  chan struct{}
	once   sync.Once
}

func (w *notifyingWriter) Write(data []byte) (int, error) {
	n, err := w.buffer.Write(data)
	w.once.Do(func() { close(w.first) })
	return n, err
}

func (w *notifyingWriter) Bytes() []byte { return w.buffer.Bytes() }

func TestStreamIOProcessHelper(t *testing.T) {
	switch os.Getenv("SELFHOST_STREAM_TEST_MODE") {
	case "echo":
		io.WriteString(os.Stderr, "synthetic diagnostic\n")
		io.Copy(os.Stdout, os.Stdin)
		os.Exit(0)
	case "wait":
		io.WriteString(os.Stdout, "started\n")
		time.Sleep(time.Minute)
		os.Exit(0)
	}
}
