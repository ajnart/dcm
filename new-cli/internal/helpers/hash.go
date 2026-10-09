package helpers

import (
	"crypto/rand"
	"encoding/base64"
	"fmt"

	"golang.org/x/crypto/argon2"
	"golang.org/x/crypto/bcrypt"
)

// HashKind names a password hash an App's config expects.
type HashKind string

const (
	// Bcrypt is the modular crypt $2a$ hash Traefik and Node-RED accept.
	Bcrypt HashKind = "bcrypt"
	// Argon2id is the PHC $argon2id$ digest Authelia's file backend wants.
	Argon2id HashKind = "argon2id"
)

// Argon2id parameters, matching Authelia's documented defaults.
const (
	argon2Memory      = 64 * 1024
	argon2Iterations  = 3
	argon2Parallelism = 1
	argon2KeyLength   = 32
	argon2SaltLength  = 16
)

// HashPassword hashes password in the form the App's config expects. The
// plaintext never leaves this call.
func HashPassword(kind HashKind, password string) (string, error) {
	switch kind {
	case Bcrypt:
		hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
		if err != nil {
			return "", err
		}
		return string(hash), nil
	case Argon2id:
		return argon2id(password)
	default:
		return "", fmt.Errorf("unknown password hash kind %q", kind)
	}
}

func argon2id(password string) (string, error) {
	salt := make([]byte, argon2SaltLength)
	if _, err := rand.Read(salt); err != nil {
		return "", err
	}
	key := argon2.IDKey([]byte(password), salt, argon2Iterations, argon2Memory, argon2Parallelism, argon2KeyLength)
	return fmt.Sprintf("$argon2id$v=19$m=%d,t=%d,p=%d$%s$%s",
		argon2Memory, argon2Iterations, argon2Parallelism,
		base64.RawStdEncoding.EncodeToString(salt),
		base64.RawStdEncoding.EncodeToString(key)), nil
}
