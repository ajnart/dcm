import type { SharedPrestartAdapter } from "../../types/pre-start.ts";
import { compileWarriorRecipe } from "./configuration.ts";

/** Only the common gate creates this context from the real retained owner and
 * derived binding. Policy strings are selections, not approved/pass booleans.
 * SHARED apply/add review includes this source graph, effects and exact inputs. */
const adapter: SharedPrestartAdapter = {
  appId: "archive-team-warrior",
  async verify(context) {
    const binding = context.derived;
    if (context.appId !== "archive-team-warrior" || !binding
      || binding.selection.appId !== context.appId
      || binding.derived.input.appId !== context.appId
      || binding.derived.peerAppIds.length !== 0) {
      throw new Error("Warrior requires its exact retained shared idle recipe before start");
    }
    const expected = compileWarriorRecipe(binding.derived.input.inputs);
    if (JSON.stringify(binding.derived.recipe) !== JSON.stringify(expected.recipe)
      || JSON.stringify(binding.selection.recipe) !== JSON.stringify(expected.recipe)
      || JSON.stringify(binding.derived.configuration) !== JSON.stringify(expected.configuration)) {
      throw new Error("Warrior retained outbound/workload/resource policy differs before start");
    }
    await context.revalidate();
  },
};
export default adapter;
