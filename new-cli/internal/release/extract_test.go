package release

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"strings"
	"testing"
)

func archiveWith(t *testing.T, binary string) []byte {
	t.Helper()
	var buf bytes.Buffer
	gz := gzip.NewWriter(&buf)
	tw := tar.NewWriter(gz)
	if err := tw.WriteHeader(&tar.Header{Name: "self-host", Mode: 0o755, Size: int64(len(binary))}); err != nil {
		t.Fatal(err)
	}
	tw.Write([]byte(binary))
	tw.Close()
	gz.Close()
	return buf.Bytes()
}

func TestExtractFailsInsteadOfTruncatingABinaryOverTheCap(t *testing.T) {
	archive := archiveWith(t, strings.Repeat("x", 20))

	if got, err := extract(archive, 20); err != nil || len(got) != 20 {
		t.Fatalf("binary at the cap: %d bytes, %v", len(got), err)
	}
	if _, err := extract(archive, 19); err == nil {
		t.Fatal("a binary over the cap was accepted")
	}
}
