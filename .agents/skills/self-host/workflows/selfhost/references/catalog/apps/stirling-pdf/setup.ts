import { createNoAccountReadOnlyAdapter } from "../../shared/no-account-get";
import type { SetupInspectionContext } from "../../types/setup";

const APP_ID = "stirling-pdf";

async function verify(context: Pick<SetupInspectionContext, "appId" | "projectRoot" | "http">) {
  const response = await context.http.request({ method: "GET", path: "/" });
  if (response.status !== 200 || !response.ok) {
    throw new Error("Stirling PDF did not serve its local application page");
  }
  const page = await response.text();
  if (!/<html\b/i.test(page) || !/Stirling[ -]PDF/i.test(page)) {
    throw new Error("Stirling PDF's local application page was not identifiable");
  }
}

const adapter = createNoAccountReadOnlyAdapter({
  appId: APP_ID,
  sharedOwner: true,
  stage: "local-page-ready",
  recordFields: { account: "none" },
  healthSource: null,
  homarrIntegration: null,
  verify,
});

export default adapter;
