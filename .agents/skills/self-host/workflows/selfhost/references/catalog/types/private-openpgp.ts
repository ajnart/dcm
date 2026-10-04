export type ClientKeyIdentity = { name: string; email: string };
export type ClientKeyCustody = { publicKey: string; fingerprint: string; custodyPath: string };
export type PrivateOpenPgpContext = {
  sourceUrl: string; recipeHash: string; canonicalOrigin: string;
  identity?: ClientKeyIdentity;
};
export type SetupCrypto = {
  ensureClientKey(identity: ClientKeyIdentity): Promise<ClientKeyCustody>;
  inspectPublicKey(input: { publicKey: string; expectedFingerprint: string }): Promise<{ fingerprint: string; identities: string[] }>;
  encryptSign(input: { text: string; recipientPublicKey: string; recipientFingerprint: string }): Promise<string>;
  decryptVerify(input: { armored: string; signerPublicKey: string; signerFingerprint: string }): Promise<string>;
};
