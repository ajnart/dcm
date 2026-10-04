import { createHash, createHmac } from "node:crypto";
import { generatedPrivateFileLength } from "../../types/private-file.ts";

const ROOT_PASSWORD = new RegExp(`^[A-Za-z0-9]{${generatedPrivateFileLength(48, "alphanumeric")}}$`);

const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const hmac = (key: string | Buffer, value: string) => createHmac("sha256", key).update(value).digest();

/** Fixed read-only ListBuckets signature. No arbitrary paths, queries or write bodies. */
export function listBucketsHeaders(origin: string, username: string, password: string, now = new Date()): Record<string, string> {
  const url = new URL(origin);
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || !url.port
    || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("AIStor signing requires the exact saved loopback S3 origin");
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{19,31}$/.test(username)
    || !ROOT_PASSWORD.test(password)) {
    throw new Error("AIStor signing requires the declared root credential format");
  }
  const timestamp = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const date = timestamp.slice(0, 8);
  const payload = digest("");
  const signed = "host;x-amz-content-sha256;x-amz-date";
  const canonical = `GET\n/\n\nhost:${url.host}\nx-amz-content-sha256:${payload}\nx-amz-date:${timestamp}\n\n${signed}\n${payload}`;
  const scope = `${date}/us-east-1/s3/aws4_request`;
  const key = hmac(hmac(hmac(hmac(`AWS4${password}`, date), "us-east-1"), "s3"), "aws4_request");
  const signature = createHmac("sha256", key).update(`AWS4-HMAC-SHA256\n${timestamp}\n${scope}\n${digest(canonical)}`).digest("hex");
  // Host is transport-owned. Its automatic value must match the exact saved URL above.
  return { Authorization: `AWS4-HMAC-SHA256 Credential=${username}/${scope}, SignedHeaders=${signed}, Signature=${signature}`,
    "x-amz-date": timestamp, "x-amz-content-sha256": payload };
}
