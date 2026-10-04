import type { SharedProjectState } from "../../../../../../../../packages/cli/src/lib/shared-project-state.ts";
import type { SharedDerivedRecipeBinding } from "../../../../../../../../packages/cli/src/lib/shared-derived-recipe.ts";
import type { DockerApiAuthorityInput } from "../../../../../../../../packages/cli/src/lib/docker-api-authority.ts";
import type { CloudflareProviderObservation } from "../../../../../../../../packages/cli/src/control-panel/setup-cloudflare-provider.ts";

export type SharedPrestartOperation = "apply" | "add" | "start" | "recreate" | "probe";
export type SharedPrestartContext = {
  appId: string;
  operation: SharedPrestartOperation;
  manifest: Record<string, any>;
  serviceIds: string[];
  state: SharedProjectState;
  derived: SharedDerivedRecipeBinding | null;
  /** Reload exact journal/source/code before and after external observations. */
  revalidate(): Promise<void>;
  /** Code-owned no-argument Docker prerequisite callback. App code cannot
   * select another owner, endpoint, method or manufacture an observation. */
  requireDockerAuthority?(): Promise<void>;
  /** Replayed owner directory and approved TLS daemon must match the observed local daemon. */
  requireSameDaemonDirectory?(): Promise<void>;
  /** Fixed Cloudflare GET producer; no caller URL, API response or credential. */
  readCloudflareProvider?(): Promise<CloudflareProviderObservation>;
};
export type SharedPrestartAdapter = {
  appId: string;
  verify(context: SharedPrestartContext): Promise<void>;
  /** Expected app target only. This function cannot mint observations or consent. */
  assertAuthority?(context: SharedPrestartContext, input: DockerApiAuthorityInput): void;
};
