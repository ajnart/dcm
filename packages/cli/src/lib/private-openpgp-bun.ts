import { readSync } from "node:fs";
import * as pgp from "openpgp";

const limit = 1024 * 1024;
const config = { maxDecompressedMessageSize: 65536, v6Keys: false };
// Library background failures must never print private runtime diagnostics.
for (const event of ["uncaughtException", "unhandledRejection"] as const) {
  process.on(event, () => { process.stderr.write("Private OpenPGP background failure\n"); process.exitCode = 1; });
}
function reject(): never { throw new Error("Private OpenPGP request rejected"); }
function text(value: unknown, maximum: number): string {
  if (typeof value !== "string" || !value.length || Buffer.byteLength(value) > maximum || value.includes("\0")) reject();
  return value;
}
function identity(value: any): void {
  if (!value || Object.keys(value).sort().join(",") !== "email,name"
    || typeof value.name !== "string" || !value.name.trim() || value.name.length > 200 || /[\r\n\0<>]/.test(value.name)
    || typeof value.email !== "string" || !/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(value.email) || value.email.length > 254) reject();
}
function fingerprint(value: unknown): string {
  const result = text(value, 40).toUpperCase();
  if (!/^[0-9A-F]{40}$/.test(result)) reject();
  return result;
}
async function publicKey(armor: unknown, expected: unknown) {
  const key = await pgp.readKey({ armoredKey: text(armor, 65536), config });
  if (key.isPrivate() || key.getFingerprint().toUpperCase() !== fingerprint(expected)) reject();
  await key.getSigningKey();
  await key.getEncryptionKey();
  return key;
}
async function custody(value: any) {
  if (!value || Object.keys(value).sort().join(",") !== "encryptedPrivateKey,fingerprint,identity,passphrase,publicKey,revocationCertificate") reject();
  identity(value.identity);
  const locked = await pgp.readPrivateKey({ armoredKey: text(value.encryptedPrivateKey, 65536), config });
  if (locked.isDecrypted() || locked.getFingerprint().toUpperCase() !== fingerprint(value.fingerprint)
    || locked.users.length !== 1 || locked.users[0].userID?.name !== value.identity.name
    || locked.users[0].userID?.email !== value.identity.email) reject();
  const advertised = await publicKey(value.publicKey, value.fingerprint);
  if (advertised.getFingerprint() !== locked.getFingerprint()) reject();
  text(value.revocationCertificate, 16384);
  const key = await pgp.decryptKey({ privateKey: locked, passphrase: text(value.passphrase, 256), config });
  await key.getSigningKey();
  await key.getEncryptionKey();
  return key;
}
async function main(): Promise<void> {
  if (process.argv.length !== 2 || process.stdin.isTTY) reject();
  const chunks: Buffer[] = [];
  let length = 0;
  for (;;) {
    const chunk = Buffer.alloc(4096);
    const size = readSync(0, chunk, 0, chunk.length, null);
    if (!size) break;
    length += size;
    if (length > limit) reject();
    chunks.push(chunk.subarray(0, size));
  }
  const request = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (!request || typeof request !== "object" || Array.isArray(request)) reject();
  const keys = Object.keys(request).sort().join(",");
  let value: unknown;
  if (request.operation === "generate" && keys === "identity,operation,passphrase") {
    identity(request.identity);
    if (!/^[A-Za-z0-9_-]{64}$/.test(text(request.passphrase, 256))) reject();
    const generated = await pgp.generateKey({ type: "rsa", rsaBits: 4096, userIDs: [request.identity],
      passphrase: request.passphrase, format: "armored", config });
    const key = await pgp.readKey({ armoredKey: generated.publicKey, config });
    value = { identity: request.identity, passphrase: request.passphrase,
      encryptedPrivateKey: generated.privateKey, publicKey: generated.publicKey,
      fingerprint: key.getFingerprint().toUpperCase(), revocationCertificate: generated.revocationCertificate };
    await custody(value);
  } else if (request.operation === "inspect-public" && keys === "fingerprint,operation,publicKey") {
    const key = await publicKey(request.publicKey, request.fingerprint);
    value = { fingerprint: key.getFingerprint().toUpperCase(), identities: key.getUserIDs() };
  } else if (request.operation === "validate-custody" && keys === "custody,operation") {
    await custody(request.custody);
    value = true;
  } else if (request.operation === "encrypt-sign" && keys === "custody,fingerprint,operation,publicKey,text") {
    const key = await custody(request.custody);
    const recipient = await publicKey(request.publicKey, request.fingerprint);
    value = await pgp.encrypt({ message: await pgp.createMessage({ text: text(request.text, 32768) }),
      encryptionKeys: recipient, signingKeys: key, format: "armored", config });
  } else if (request.operation === "decrypt-verify" && keys === "armored,custody,fingerprint,operation,publicKey") {
    const key = await custody(request.custody);
    const signer = await publicKey(request.publicKey, request.fingerprint);
    const result = await pgp.decrypt({ message: await pgp.readMessage({ armoredMessage: text(request.armored, 128 * 1024), config }),
      decryptionKeys: key, verificationKeys: signer, expectSigned: true, format: "utf8", config });
    if (!result.signatures.length) reject();
    for (const signature of result.signatures) {
      await signature.verified;
      await signature.signature;
    }
    value = text(result.data, 32768);
  } else reject();
  const output = JSON.stringify({ value });
  if (Buffer.byteLength(output) > limit) reject();
  process.stdout.write(output);
}
try { await main(); }
catch { process.stderr.write("Private OpenPGP operation failed\n"); process.exitCode = 1; }
