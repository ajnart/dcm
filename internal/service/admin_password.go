package service

import (
	"crypto/rand"
	"math/big"
)

// Administrator logins need the common upper/lower/digit/special policy.
// Keep punctuation to !: it is safe in dotenv, quoted shell values and URIs.
// Application API keys and other opaque secrets keep their existing generators.
func generateAdminPassword() string {
	const length = 20
	classes := []string{"ABCDEFGHJKLMNPQRSTUVWXYZ", "abcdefghijkmnopqrstuvwxyz", "23456789", "!"}
	alphabet := passwordAlphabet + "!"
	pick := func(size int) int {
		number, err := rand.Int(rand.Reader, big.NewInt(int64(size)))
		if err != nil {
			panic(err)
		}
		return int(number.Int64())
	}
	password := make([]byte, length)
	for i, class := range classes {
		password[i] = class[pick(len(class))]
	}
	for i := len(classes); i < len(password); i++ {
		password[i] = alphabet[pick(len(alphabet))]
	}
	for i := len(password) - 1; i > 0; i-- {
		j := pick(i + 1)
		password[i], password[j] = password[j], password[i]
	}
	return string(password)
}
