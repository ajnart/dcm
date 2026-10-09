package systemtest_test

import (
	"bytes"
	"context"
	"errors"
	"io"
	"testing"

	"github.com/ajnart/self-host/internal/system"
	"github.com/ajnart/self-host/internal/systemtest"
)

func TestStreamIOFakePreservesSeparateBinaryStreams(t *testing.T) {
	runner := &systemtest.Runner{}
	payload := []byte{0, 255, 42, 128}
	runner.OnStreamIO("archive", func(ctx context.Context, cmd system.Cmd, stdin io.Reader, stdout, stderr io.Writer) error {
		if _, err := io.Copy(stdout, stdin); err != nil {
			return err
		}
		_, err := io.WriteString(stderr, "synthetic diagnostic")
		return err
	})
	var stdout, stderr bytes.Buffer
	if err := runner.StreamIO(context.Background(), system.Cmd{Name: "archive"}, bytes.NewReader(payload), &stdout, &stderr); err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(stdout.Bytes(), payload) || stderr.String() != "synthetic diagnostic" {
		t.Fatal("fake Runner mixed or changed binary/diagnostic streams")
	}
	if calls := runner.Calls(); len(calls) != 1 || calls[0] != "archive" {
		t.Fatalf("streamed invocation not recorded once: %v", calls)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := runner.StreamIO(ctx, system.Cmd{Name: "archive"}, nil, io.Discard, io.Discard); !errors.Is(err, context.Canceled) {
		t.Fatalf("canceled stream must return cancellation: %v", err)
	}
	if len(runner.Calls()) != 1 {
		t.Fatal("canceled streaming command was invoked")
	}
}
