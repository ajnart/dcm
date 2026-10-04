import assert from "node:assert/strict";
import { isPublicOrSpecialSuffix } from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/types/domain-policy.ts";

for (const domain of ["com", "co.uk", "github.io", "s3.amazonaws.com", "home.arpa",
  "stack.home.arpa", "localhost", "auth.localhost", "example.com", "auth.example.com",
  "a.test", "a.invalid", "demo.unknown", "127.0.0.1", "https://house.net", "HOUSE.net", "house.net."]) {
  assert.equal(isPublicOrSpecialSuffix(domain), true, domain);
}
for (const domain of ["house.net", "auth.house.net", "house.co.uk", "house.github.io"]) {
  assert.equal(isPublicOrSpecialSuffix(domain), false, domain);
}
console.log("cookie domain policy: pass");
