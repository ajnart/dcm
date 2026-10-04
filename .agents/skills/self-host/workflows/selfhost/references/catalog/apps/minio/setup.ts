import { isAbsolute } from "node:path";
import { appliedStatus, setupRecord, type SetupAdapter, type SetupInspectionContext } from "../../types/setup.ts";
import { compileAistorConfiguration, type AistorConfigurationInput } from "./configuration.ts";
import { listBucketsHeaders } from "./s3-auth.ts";

function xmlEnvelope(body: string, root: string): boolean {
  return body.length <= 1048576 && !/<!DOCTYPE|<!ENTITY/i.test(body)
    && new RegExp(`^(?:<\\?xml[^?]*\\?>\\s*)?<${root}(?:\\s+xmlns="http://s3.amazonaws.com/doc/2006-03-01/")?>[\\s\\S]*</${root}>\\s*$`).test(body.trim());
}

async function verify(context: SetupInspectionContext) {
  if (context.appId !== "minio") throw new Error("AIStor setup received a different app ID");
  const status = appliedStatus(context, await context.status());
  const derived = setupRecord(status.derivedRecipe, "AIStor derived recipe");
  const binding = setupRecord(derived.configuration, "AIStor configuration binding");
  const selection = setupRecord(binding.selection, "AIStor product selection");
  const compiled = compileAistorConfiguration(selection as AistorConfigurationInput);
  if (derived.appId !== "minio" || derived.configurationFilesVerified !== true
    || binding.configurationFingerprint !== compiled.binding.configurationFingerprint
    || binding.imageDigest !== compiled.binding.imageDigest || status.username !== selection.rootUsername
    || typeof status.passwordFile !== "string" || !isAbsolute(status.passwordFile)
    || typeof status.url !== "string") {
    throw new Error("AIStor has no exact licensed-product and private root-credential binding");
  }
  const password = await context.secrets.readAdminPassword();
  const headers = listBucketsHeaders(status.url, status.username as string, password);
  const anonymous = await context.http.request({ method: "GET", path: "/" });
  const anonymousBody = await anonymous.text();
  if (anonymous.status !== 403 || !xmlEnvelope(anonymousBody, "Error")
    || !/<Code>AccessDenied<\/Code>/.test(anonymousBody)) {
    throw new Error("AIStor did not reject anonymous S3 ListBuckets");
  }
  let wrongPrefix = "A";
  if (password[0] === "A") wrongPrefix = "B";
  const wrongPassword = `${wrongPrefix}${password.slice(1)}`;
  const wrong = await context.http.request({ method: "GET", path: "/",
    headers: listBucketsHeaders(status.url, status.username as string, wrongPassword) });
  const wrongBody = await wrong.text();
  if (wrong.status !== 403 || !xmlEnvelope(wrongBody, "Error")
    || !/<Code>SignatureDoesNotMatch<\/Code>/.test(wrongBody)) {
    throw new Error("AIStor did not reject an incorrect S3 root signature");
  }
  const response = await context.http.request({ method: "GET", path: "/", headers });
  const body = await response.text();
  if (response.status !== 200 || !response.ok || !xmlEnvelope(body, "ListAllMyBucketsResult")
    || !/<Buckets(?:\s*\/|>[\s\S]*<\/Buckets)>/.test(body)
    || !/<Owner>[\s\S]*<ID>[^<]+<\/ID>[\s\S]*<\/Owner>/.test(body)) {
    throw new Error("AIStor did not verify the saved S3 root credentials");
  }
  return { appId: "minio", projectRoot: context.projectRoot, stage: "root-s3-auth-verified",
    username: status.username, credentialRef: status.passwordFile, licenseVerified: false,
    storageWriteVerified: false, scopedAccessKeyCreated: false, backupVerified: false };
}

const adapter: SetupAdapter = {
  appId: "minio", sharedOwner: true, credentialCommand: "app handoff", apiKey: "not-created",
  healthSource: null, homarrIntegration: null,
  ready(record) {
    return record.appId === "minio" && record.stage === "root-s3-auth-verified"
      && typeof record.username === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{19,31}$/.test(record.username)
      && !/^minioadmin/i.test(record.username) && typeof record.credentialRef === "string"
      && isAbsolute(record.credentialRef) && record.licenseVerified === false
      && record.storageWriteVerified === false && record.scopedAccessKeyCreated === false
      && record.backupVerified === false;
  },
  firstRun: verify,
  inspect: verify,
};
export default adapter;
