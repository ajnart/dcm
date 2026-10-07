package helpers_test

import (
	"encoding/base64"
	"strings"
	"testing"

	"github.com/ajnart/self-host/internal/helpers"
	"golang.org/x/crypto/argon2"
	"golang.org/x/crypto/bcrypt"
)

func TestHashPasswordBcryptVerifies(t *testing.T) {
	hash, err := helpers.HashPassword(helpers.Bcrypt, "correct-horse")
	if err != nil {
		t.Fatalf("HashPassword: %v", err)
	}
	if err := bcrypt.CompareHashAndPassword([]byte(hash), []byte("correct-horse")); err != nil {
		t.Fatalf("bcrypt hash does not verify: %v", err)
	}
}

func TestHashPasswordArgon2idIsAPHCDigestThatVerifies(t *testing.T) {
	hash, err := helpers.HashPassword(helpers.Argon2id, "correct-horse")
	if err != nil {
		t.Fatalf("HashPassword: %v", err)
	}
	if !strings.HasPrefix(hash, "$argon2id$v=19$m=65536,t=3,p=1$") {
		t.Fatalf("hash = %q, want an argon2id PHC string", hash)
	}

	parts := strings.Split(hash, "$")
	if len(parts) != 6 {
		t.Fatalf("hash = %q, want six $-separated PHC parts", hash)
	}
	salt, err := base64.RawStdEncoding.DecodeString(parts[4])
	if err != nil {
		t.Fatalf("salt: %v", err)
	}
	want, err := base64.RawStdEncoding.DecodeString(parts[5])
	if err != nil {
		t.Fatalf("key: %v", err)
	}
	got := argon2.IDKey([]byte("correct-horse"), salt, 3, 65536, 1, 32)
	if base64.RawStdEncoding.EncodeToString(got) != base64.RawStdEncoding.EncodeToString(want) {
		t.Fatal("argon2id digest does not verify")
	}
}

func TestHashPasswordUnknownKind(t *testing.T) {
	if _, err := helpers.HashPassword(helpers.HashKind("md5"), "pw"); err == nil {
		t.Fatal("HashPassword = nil error, want an unknown-kind error")
	}
}
