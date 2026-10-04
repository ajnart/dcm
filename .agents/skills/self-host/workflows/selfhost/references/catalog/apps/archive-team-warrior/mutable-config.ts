import { warriorIdleConfig, verifyWarriorIdleConfig } from "./idle-config.ts";
import provenance from "./runtime-provenance.json";

type Context = { recipe: Record<string, any>; inputs: Record<string, any>; readPrivateFile(id: string): Promise<string> };
async function expected(context: Context) {
  if (context.recipe.appId !== "archive-team-warrior"
    || context.inputs?.selectedProject !== "none"
    || context.inputs?.concurrency !== 1
    || provenance.containerUid !== 1000 || provenance.platform !== "linux/amd64"
    || context.recipe.mutableConfigs?.[0]?.containerUid !== provenance.containerUid
    || context.recipe.mutableConfigs?.[0]?.containerUidEvidence?.uid !== provenance.containerUid
    || context.recipe.mutableConfigs?.[0]?.containerUidEvidence?.officialUrl !== `https://atdr.meo.ws/v2/archiveteam/warrior-dockerfile/blobs/${provenance.configDigest}`
    || context.recipe.services?.[0]?.imageTag !== `atdr.meo.ws/archiveteam/warrior-dockerfile@${provenance.imageDigest}`
    || context.recipe.services?.[0]?.imageSource !== `https://atdr.meo.ws/v2/archiveteam/warrior-dockerfile/blobs/${provenance.configDigest}`) {
    throw new Error("Warrior mutable config has another workload policy");
  }
  return { downloader: context.inputs.downloader,
    username: "warrior-admin", password: await context.readPrivateFile("admin-password") };
}

export const mutableConfigHook = {
  async initialize(context: Context): Promise<string> {
    return warriorIdleConfig(await expected(context));
  },
  async validate(content: string, context: Context): Promise<void> {
    // Preserve upstream identity and all other valid runner fields: validation
    // checks idle/auth policy only and never serializes or rewrites resumed data.
    verifyWarriorIdleConfig(content, await expected(context));
  },
};
