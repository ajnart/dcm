// Package minio is MinIO AIStor (licensed): private S3 object storage with a
// separate console, keyed by the shared Admin login and an operator license.
package minio

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/helpers"
)

// App is MinIO AIStor (licensed). Traps: docs/catalog/traps/minio.md.
type App struct{}

const image = "quay.io/minio/aistor/minio:RELEASE.2026-09-19T17-05-25Z.hotfix.4ef74f03d6f2"

func (App) Info() app.Info {
	return app.Info{
		ID: "minio", Name: "MinIO AIStor", Category: "Storage",
		Description:   "Private S3-compatible object storage with a web console, for backups and app data",
		Image:         image,
		Docs:          "https://docs.min.io/aistor/installation/container/install/",
		Port:          9000,
		ContainerPort: 9000,
		Service:       "minio",
	}
}

// Inputs requires the operator-obtained AIStor license file, supplied through
// the documented MINIO_LICENSE path variable (never a file: URI).
func (App) Inputs() []app.Input {
	return []app.Input{{
		Key:      "MINIO_LICENSE_FILE",
		Prompt:   "Path to the AIStor license file you obtained from MinIO",
		Help:     "Download the license from MinIO and pass its absolute path. See https://docs.min.io/aistor/installation/container/install/",
		Required: true,
	}}
}

func (App) Compose(rc app.RenderContext) string {
	port := strconv.Itoa(rc.Port)
	console := strconv.Itoa(rc.Port + 1)
	license := rc.Inputs["MINIO_LICENSE_FILE"]
	return `services:
  minio:
    image: quay.io/minio/aistor/minio:RELEASE.2026-09-19T17-05-25Z.hotfix.4ef74f03d6f2
    restart: unless-stopped
    command: ["minio", "server", "/mnt/data", "--console-address", ":9001"]
    environment:
      TZ: ${TZ}
      MINIO_ROOT_USER: ${ADMIN_USER}
      MINIO_ROOT_PASSWORD_FILE: /run/secrets/root-password
      MINIO_SITE_REGION: us-east-1
      MINIO_LICENSE: /run/secrets/aistor-license
    volumes:
      - ./data:/mnt/data
      - ./root-password:/run/secrets/root-password:ro
      - ` + license + `:/run/secrets/aistor-license:ro
    ports:
      - ${BIND_IP}:` + port + `:9000
      - ${BIND_IP}:` + console + `:9001
`
}

// Files writes the root password file AIStor reads at startup: the shared
// Admin password, never a generated per-App credential.
func (App) Files(_ app.RenderContext, secret func(string) string) []app.File {
	return []app.File{{Path: "root-password", Content: secret("ADMIN_PASSWORD"), Mode: 0600}}
}

// signedListBuckets sends the fixed read-only ListBuckets signature the S3 API
// requires; anonymous health and the console do not authenticate that API.
func signedListBuckets(ctx context.Context, h *helpers.H) (helpers.Response, error) {
	base, err := url.Parse(h.BaseURL)
	if err != nil {
		return helpers.Response{}, err
	}
	user, password := h.AdminUser(), h.AdminPassword()
	if user == "" || password == "" {
		return helpers.Response{}, errors.New("the Admin login is missing from secrets.env")
	}
	timestamp := h.Now().UTC().Format("20060102T150405Z")
	date := timestamp[:8]
	payload := hexSHA256(nil)
	signed := "host;x-amz-content-sha256;x-amz-date"
	canonical := "GET\n/\n\nhost:" + base.Host + "\nx-amz-content-sha256:" + payload + "\nx-amz-date:" + timestamp + "\n\n" + signed + "\n" + payload
	scope := date + "/us-east-1/s3/aws4_request"
	toSign := "AWS4-HMAC-SHA256\n" + timestamp + "\n" + scope + "\n" + hexSHA256([]byte(canonical))
	key := hmacSHA256(hmacSHA256(hmacSHA256(hmacSHA256([]byte("AWS4"+password), date), "us-east-1"), "s3"), "aws4_request")
	signature := hex.EncodeToString(hmacSHA256(key, toSign))
	authorization := "AWS4-HMAC-SHA256 Credential=" + user + "/" + scope + ", SignedHeaders=" + signed + ", Signature=" + signature
	return h.HTTP(ctx, helpers.Request{Header: map[string]string{
		"Authorization":        authorization,
		"x-amz-date":           timestamp,
		"x-amz-content-sha256": payload,
	}})
}

func hexSHA256(data []byte) string {
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}

func hmacSHA256(key []byte, value string) []byte {
	mac := hmac.New(sha256.New, key)
	mac.Write([]byte(value))
	return mac.Sum(nil)
}

func rootWorks(ctx context.Context, h *helpers.H) (bool, error) {
	resp, err := signedListBuckets(ctx, h)
	if err != nil {
		return false, err
	}
	if resp.Status != http.StatusOK {
		return false, nil
	}
	body := string(resp.Body)
	return strings.Contains(body, "<Owner>") && strings.Contains(body, "<ListAllMyBucketsResult"), nil
}

func (App) Setup(ctx context.Context, h *helpers.H) error {
	if err := h.Ready(ctx, "/"); err != nil {
		return err
	}
	return h.Step(ctx, "root-s3-auth", "the S3 API accepts the saved root credentials", helpers.StepSpec{
		Check: func(ctx context.Context) (bool, error) { return rootWorks(ctx, h) },
		Do: func(context.Context) error {
			return errors.New("the root credentials are read from secrets.env when the container starts")
		},
		Hint:       "Recreate the container so it reads " + h.AdminUser() + " and the password from secrets.env: self-host start minio",
		Credential: "admin",
	})
}

func (App) Check(ctx context.Context, h *helpers.H) error {
	ok, err := rootWorks(ctx, h)
	if err != nil {
		return err
	}
	if !ok {
		return fmt.Errorf("the S3 root login %s was rejected", h.AdminUser())
	}
	return nil
}

func (App) Links() []app.Link { return nil }
