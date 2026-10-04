import { compileAutheliaUserDatabase, verifyAutheliaUserDatabase } from "./bootstrap.ts";
import { privateIdentityHasher, parsePrivateIdentityYaml } from "../../types/private-identity.ts";
import type { MutableConfigContext, MutableConfigHook } from "../../types/mutable-config.ts";

function identity(context: MutableConfigContext) {
  const { username, displayName, email } = context.inputs;
  if (context.recipe.appId !== "authelia" || context.configId !== "users"
    || typeof username !== "string" || typeof displayName !== "string" || typeof email !== "string"
    || context.recipe.onboarding?.username !== username || context.recipe.onboarding?.configId !== "users") {
    throw new Error("Authelia user database has another owned identity");
  }
  return { username, displayName, email };
}

export const mutableConfigHook: MutableConfigHook = {
  async initialize(context) {
    return compileAutheliaUserDatabase(identity(context), await context.readPrivateFile("admin-password"), privateIdentityHasher);
  },
  async validate(content, context) {
    await verifyAutheliaUserDatabase(await parsePrivateIdentityYaml(content), identity(context),
      await context.readPrivateFile("admin-password"), privateIdentityHasher);
  },
};
