import type { SharedProjectState } from "../../../../../../../../packages/cli/src/lib/shared-project-state.ts";
import type { SharedProjectInput } from "../../../../../../../../packages/cli/src/lib/shared-compose-project.ts";

/** Explicit planned selections, never a fabricated completed journal owner. */
export type SharedDerivedRecipeCreateSource = { kind: "new-shared-project"; input: SharedProjectInput };
export type SharedDerivedRecipeSource = SharedProjectState | SharedDerivedRecipeCreateSource;

/** Explicit non-secret pre-start choices. App adapters own their interpretation. */
export type SharedDerivedRecipeInput = { appId: string; inputs: Record<string, string> };

export type SharedDerivedRecipeAdapter = {
  appId: string;
  /** Canonical app-relative dependencies, hashed only for this executable adapter. */
  sourceFiles: readonly string[];
  inputDefinitions: Record<string, { description: string; maxLength: number }>;
  derive(state: SharedDerivedRecipeSource, inputs: Readonly<Record<string, string>>): {
    recipe: Record<string, any>;
    configuration: Record<string, any>;
    peerAppIds: string[];
  };
};

export type SharedDerivedRecipe = {
  input: SharedDerivedRecipeInput;
  recipe: Record<string, any>;
  configuration: Record<string, any>;
  peerAppIds: string[];
  sourceSha256: string;
  recipeSha256: string;
};
