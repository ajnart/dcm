import type { SetupCompatibilityResult, SetupRecord } from "../types/setup";

/** Invocation-local proof bookkeeping, not an authentication verifier.
 * Call only after the app verifies its current credentials/identity or its
 * documented no-account endpoint. The app also owns fresh/resume provenance.
 * Copies, inspection records and serialized historical flags carry no proof.
 */
export function createSetupProofRecorder() {
  const proofs = new WeakMap<SetupRecord, SetupCompatibilityResult>();
  return {
    record(record: SetupRecord, origin: SetupCompatibilityResult["origin"] | null,
      credentialReadback: SetupCompatibilityResult["credentialReadback"]): SetupRecord {
      if (origin !== null) {
        proofs.set(record, Object.freeze({ origin, credentialReadback }));
      }
      return record;
    },
    result(record: SetupRecord): SetupCompatibilityResult | null {
      return proofs.get(record) ?? null;
    },
  };
}
