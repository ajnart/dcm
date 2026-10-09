package netbird_test

import (
	"crypto/aes"
	"crypto/cipher"
	"encoding/base64"
	"strings"
	"testing"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/apps/netbird"
	"go.yaml.in/yaml/v3"
)

func TestRenderedStoreKeySupportsPinnedEncryptionAndRecreation(t *testing.T) {
	const rawKey = "abcdefghijkmnopqrstuvwxyz2345678"
	for _, tc := range []struct{ name, saved string }{
		{name: "generated raw key", saved: rawKey},
		{name: "existing valid encoded key", saved: base64.StdEncoding.EncodeToString([]byte(rawKey))},
	} {
		t.Run(tc.name, func(t *testing.T) {
			render := func() cipher.AEAD {
				t.Helper()
				files := (netbird.App{}).Files(app.RenderContext{Inputs: map[string]string{"NETBIRD_CANONICAL_ORIGIN": "https://netbird.fixture.test"}}, func(name string) string {
					if name == "store_key" {
						return tc.saved
					}
					return rawKey
				})
				if len(files) != 1 || files[0].Mode != 0o600 {
					t.Fatal("control-plane configuration must remain private")
				}
				var config struct {
					Server struct {
						Store struct {
							EncryptionKey string `yaml:"encryptionKey"`
						} `yaml:"store"`
						Auth struct {
							SessionKey string `yaml:"sessionCookieEncryptionKey"`
						} `yaml:"auth"`
					} `yaml:"server"`
				}
				if err := yaml.Unmarshal([]byte(files[0].Content), &config); err != nil {
					t.Fatal(err)
				}
				if config.Server.Auth.SessionKey != rawKey {
					t.Fatal("session key changed unnecessarily")
				}
				// Pinned util/crypt.NewFieldEncrypt requires standard Base64 and exactly 32 decoded bytes.
				key, err := base64.StdEncoding.DecodeString(config.Server.Store.EncryptionKey)
				if err != nil || len(key) != 32 {
					t.Fatal("rendered datastore key fails the pinned server's AES-256 startup contract")
				}
				if string(key) != rawKey {
					t.Fatal("render changed the persisted datastore encryption key")
				}
				block, err := aes.NewCipher(key)
				if err != nil {
					t.Fatal(err)
				}
				gcm, err := cipher.NewGCM(block)
				if err != nil {
					t.Fatal(err)
				}
				return gcm
			}
			first := render()
			nonce := make([]byte, first.NonceSize())
			ciphertext := first.Seal(nil, nonce, []byte("saved event fixture"), nil)
			recreated := render()
			plaintext, err := recreated.Open(nil, nonce, ciphertext, nil)
			if err != nil || string(plaintext) != "saved event fixture" {
				t.Fatal("recreated configuration cannot read existing encrypted data")
			}
			compose := (netbird.App{}).Compose(app.RenderContext{})
			if strings.Contains(compose, tc.saved) {
				t.Fatal("datastore key escaped into Compose or process arguments")
			}
		})
	}
}

func TestUnsupportedSavedStoreKeysAreNotReplaced(t *testing.T) {
	for _, saved := range []string{"invalid-key-format", strings.Repeat("x", 24), strings.Repeat("x", 44)} {
		files := (netbird.App{}).Files(app.RenderContext{}, func(string) string { return saved })
		var config struct {
			Server struct {
				Store struct {
					Key string `yaml:"encryptionKey"`
				} `yaml:"store"`
			} `yaml:"server"`
		}
		if err := yaml.Unmarshal([]byte(files[0].Content), &config); err != nil {
			t.Fatal(err)
		}
		if config.Server.Store.Key != saved {
			t.Fatal("unsupported existing encryption material was silently replaced")
		}
	}
}
