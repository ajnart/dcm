package helpers

import (
	"bytes"
	"context"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"

	"go.yaml.in/yaml/v3"
)

// Extractor pulls one value out of a config file's bytes. found is false while
// the file has not been written far enough yet, which ConfigValue retries.
type Extractor func(data []byte) (value string, found bool, err error)

// ConfigValue polls the App's file at rel (relative to its Dir) until extract
// finds a value, then returns it.
func (h *H) ConfigValue(ctx context.Context, rel string, extract Extractor, timeout time.Duration) (string, error) {
	if timeout == 0 {
		timeout = 2 * time.Minute
	}
	path := filepath.Join(h.Dir, rel)
	var value string
	err := h.Poll(ctx, timeout, func(context.Context) (bool, error) {
		data, err := os.ReadFile(path)
		if err != nil {
			return false, err
		}
		extracted, found, err := extract(data)
		if err != nil {
			return false, err
		}
		if !found {
			return false, errors.New("the value is not in " + rel + " yet")
		}
		value = extracted
		return true, nil
	})
	return value, err
}

// XMLElement reads the text of the first element named name, wherever it sits
// in the document.
func XMLElement(name string) Extractor {
	return func(data []byte) (string, bool, error) {
		decoder := xml.NewDecoder(bytes.NewReader(data))
		for {
			token, err := decoder.Token()
			if err == io.EOF {
				return "", false, nil
			}
			if err != nil {
				return "", false, err
			}
			start, ok := token.(xml.StartElement)
			if !ok || start.Name.Local != name {
				continue
			}
			var value string
			if err := decoder.DecodeElement(&value, &start); err != nil {
				return "", false, err
			}
			if value == "" {
				return "", false, nil
			}
			return value, true, nil
		}
	}
}

// INIKey reads key from the named [section] of an INI file.
func INIKey(section, key string) Extractor {
	return func(data []byte) (string, bool, error) {
		current := ""
		for _, line := range strings.Split(string(data), "\n") {
			line = strings.TrimSpace(line)
			if line == "" || strings.HasPrefix(line, "#") || strings.HasPrefix(line, ";") {
				continue
			}
			if strings.HasPrefix(line, "[") && strings.HasSuffix(line, "]") {
				current = strings.TrimSpace(line[1 : len(line)-1])
				continue
			}
			if current != section {
				continue
			}
			name, value, ok := strings.Cut(line, "=")
			if !ok || strings.TrimSpace(name) != key {
				continue
			}
			value = strings.TrimSpace(value)
			if value == "" {
				return "", false, nil
			}
			return value, true, nil
		}
		return "", false, nil
	}
}

// YAMLPath reads a dotted path such as "auth.apikey" from a YAML document.
func YAMLPath(path string) Extractor {
	return func(data []byte) (string, bool, error) {
		var doc map[string]any
		if err := yaml.Unmarshal(data, &doc); err != nil {
			return "", false, err
		}
		var node any = doc
		for _, part := range strings.Split(path, ".") {
			mapping, ok := node.(map[string]any)
			if !ok {
				return "", false, nil
			}
			node, ok = mapping[part]
			if !ok {
				return "", false, nil
			}
		}
		switch value := node.(type) {
		case nil:
			return "", false, nil
		case string:
			if value == "" {
				return "", false, nil
			}
			return value, true, nil
		default:
			return fmt.Sprint(value), true, nil
		}
	}
}
