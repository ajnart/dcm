package helpers_test

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/ajnart/self-host/internal/helpers"
)

func TestXMLElementReadsNestedValue(t *testing.T) {
	doc := []byte(`<?xml version="1.0"?>
<Config>
  <BindAddress>*</BindAddress>
  <ApiKey>abc123</ApiKey>
</Config>`)
	value, found, err := helpers.XMLElement("ApiKey")(doc)
	if err != nil || !found || value != "abc123" {
		t.Fatalf("XMLElement = %q, %v, %v; want abc123", value, found, err)
	}
}

func TestXMLElementMissingIsNotFound(t *testing.T) {
	_, found, err := helpers.XMLElement("ApiKey")([]byte(`<Config><BindAddress>*</BindAddress></Config>`))
	if err != nil || found {
		t.Fatalf("XMLElement = found %v, err %v; want not found", found, err)
	}
}

func TestINIKeyReadsTheNamedSection(t *testing.T) {
	doc := []byte("[misc]\napi_key = deadbeef\n\n[servers]\napi_key = other\n")
	value, found, err := helpers.INIKey("misc", "api_key")(doc)
	if err != nil || !found || value != "deadbeef" {
		t.Fatalf("INIKey = %q, %v, %v; want deadbeef", value, found, err)
	}
}

func TestYAMLPathReadsDottedPath(t *testing.T) {
	doc := []byte("auth:\n  apikey: yaml-key\n")
	value, found, err := helpers.YAMLPath("auth.apikey")(doc)
	if err != nil || !found || value != "yaml-key" {
		t.Fatalf("YAMLPath = %q, %v, %v; want yaml-key", value, found, err)
	}
}

func TestConfigValuePollsUntilTheExtractorFindsAValue(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "config.xml"), []byte("<Config></Config>"), 0o600); err != nil {
		t.Fatal(err)
	}
	h := newH(t, nil, nil, nil)
	h.Dir = dir
	calls := 0
	extract := func([]byte) (string, bool, error) {
		calls++
		if calls < 3 {
			return "", false, nil
		}
		return "found-it", true, nil
	}

	value, err := h.ConfigValue(context.Background(), "config.xml", extract, time.Minute)
	if err != nil {
		t.Fatalf("ConfigValue: %v", err)
	}
	if value != "found-it" {
		t.Errorf("value = %q, want found-it", value)
	}
	if calls < 3 {
		t.Errorf("extractor called %d times, want at least 3", calls)
	}
}
