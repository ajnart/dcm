import assert from "node:assert/strict";
import {
  arrApiKeyEvalScript,
  captureArrApiKeyField,
  captureHomarrMcpKeyCode,
  fillBrowserApiKey,
  homarrMcpKeyEvalScript,
  keyRefsFromSnapshot,
} from "./browser-api-key.ts";
import { SESSION_PASSWORD_SCHEME } from "./lib/session-context.ts";

const snapshot = (refs) => JSON.stringify({
  success: true,
  data: { refs, snapshot: '- textbox "API Key" [ref=e7]: synthetic-private-value' },
});
assert.equal(keyRefsFromSnapshot(snapshot({ e7: { name: "API Key", role: "textbox" } })), "@e7");
assert.throws(() => keyRefsFromSnapshot(snapshot({ e7: { name: "synthetic-private-value", role: "textbox" } })));
assert.throws(() => keyRefsFromSnapshot(snapshot({ e7: { name: "API Key", role: "button" } })));
assert.throws(() => keyRefsFromSnapshot(snapshot({
  e7: { name: "API Key", role: "textbox" },
  e8: { name: "API Key", role: "textbox" },
})));
assert.throws(() => keyRefsFromSnapshot(JSON.stringify({ success: false })));

const session = {
  runId: "key-fixture",
  manifest: {
    AGENT_BROWSER_SESSION: "auto-stack-key-fixture",
    HOMARR_PORT: "21006",
    JELLYFIN_PORT: "21004",
    PROWLARR_PORT: "21000",
    QBITTORRENT_PORT: "21003",
    RADARR_PORT: "21001",
    SEERR_PORT: "21005",
    SESSION_PASSWORD_SCHEME,
    SONARR_PORT: "21002",
  },
  secrets: { SONARR_API_KEY: "d".repeat(32) },
};
const rejectedCalls = [];
await assert.rejects(
  fillBrowserApiKey(session, "sonarr", "@e8", {
    invokeBrowserImplementation: async (args, input) => {
      rejectedCalls.push({ args, input });
      if (args.includes("url")) {
        return "http://127.0.0.1:21002/settings/general";
      }
      return snapshot({
        e7: { name: "API Key", role: "textbox" },
        e8: { name: "Username", role: "textbox" },
      });
    },
  }),
  /does not match the fresh form/,
);
assert.equal(rejectedCalls.length, 2);
assert.equal(rejectedCalls.some((call) => call.args.includes("batch")), false);
assert.equal(rejectedCalls.some((call) => String(call.input).includes("d".repeat(32))), false);

const acceptedCalls = [];
await fillBrowserApiKey(session, "sonarr", "@e7", {
  invokeBrowserImplementation: async (args, input) => {
    acceptedCalls.push({ args, input });
    if (args.includes("url")) {
      return "http://127.0.0.1:21002/settings/general";
    }
    if (args.includes("snapshot")) {
      return snapshot({ e7: { name: "apiKey", role: "textbox" } });
    }
    return "";
  },
});
assert.equal(acceptedCalls.length, 3);
assert.equal(acceptedCalls.at(-1).args.includes("batch"), true);
assert.deepEqual(JSON.parse(acceptedCalls.at(-1).input), [["fill", "@e7", "d".repeat(32)]]);

const fieldCaptureCalls = [];
await captureArrApiKeyField(session, "sonarr", {
  invokeBrowserImplementation: async (args, input) => {
    fieldCaptureCalls.push({ args, input });
    if (args.includes("url")) {
      return "http://127.0.0.1:21002/settings/general";
    }
    return JSON.stringify("d".repeat(32));
  },
});
assert.equal(fieldCaptureCalls.length, 2);
assert.deepEqual(fieldCaptureCalls[1].args, ["--session", "auto-stack-key-fixture", "eval", "--stdin"]);
assert.equal(fieldCaptureCalls[1].input, `${arrApiKeyEvalScript()}\n`);
assert.equal(fieldCaptureCalls[1].input.includes("d".repeat(32)), false);

function runArrFieldEval({ count = 1, name = "apiKey", pathname = "/settings/general" } = {}) {
  const fields = Array.from({ length: count }, () => ({
    name,
    readOnly: true,
    type: "text",
    value: "d".repeat(32),
  }));
  const execute = new Function("window", "document", `return ${arrApiKeyEvalScript()}`);
  return execute(
    { location: { pathname } },
    { querySelectorAll: () => fields },
  );
}
assert.equal(runArrFieldEval(), "d".repeat(32));
assert.throws(() => runArrFieldEval({ count: 0 }), /one Arr API key field/);
assert.throws(() => runArrFieldEval({ count: 2 }), /one Arr API key field/);
assert.throws(() => runArrFieldEval({ name: "username" }), /Arr API key field is invalid/);
assert.throws(() => runArrFieldEval({ pathname: "/settings/indexers" }), /invalid Arr general settings location/);

const wrongArrPageCalls = [];
await assert.rejects(
  captureArrApiKeyField(session, "sonarr", {
    invokeBrowserImplementation: async (args) => {
      wrongArrPageCalls.push(args);
      return "http://127.0.0.1:21001/settings/general";
    },
  }),
  /not on the selected Arr general settings page/,
);
assert.equal(wrongArrPageCalls.length, 1);

const homarrKey = `${"a".repeat(16)}.${"b".repeat(16)}`;
const captureCalls = [];
let storedKey = null;
let writtenRunId = null;
await captureHomarrMcpKeyCode(session, {
  invokeBrowserImplementation: async (args, input) => {
    captureCalls.push({ args, input });
    if (args.includes("url")) {
      return "http://127.0.0.1:21006/init";
    }
    return JSON.stringify(homarrKey);
  },
  storeImplementation: (_session, value) => {
    storedKey = value;
  },
  writeConnectionsImplementation: (runId) => {
    writtenRunId = runId;
  },
});
assert.equal(storedKey, homarrKey);
assert.equal(writtenRunId, "key-fixture");
assert.equal(captureCalls.length, 2);
assert.deepEqual(captureCalls[1].args, ["--session", "auto-stack-key-fixture", "eval", "--stdin"]);
assert.equal(captureCalls[1].input, `${homarrMcpKeyEvalScript()}\n`);
assert.equal(captureCalls[1].input.includes(homarrKey), false);
assert.equal(homarrMcpKeyEvalScript().includes('button[aria-label="Copy API key"]'), true);
assert.equal(homarrMcpKeyEvalScript().includes(":scope > code"), true);

function runHomarrEval({ buttons = 1, codes = 1, pathname = "/init" } = {}) {
  const codeNodes = Array.from({ length: codes }, () => ({ textContent: homarrKey }));
  const buttonNodes = Array.from({ length: buttons }, () => ({
    parentElement: { querySelectorAll: () => codeNodes },
  }));
  const execute = new Function("window", "document", `return ${homarrMcpKeyEvalScript()}`);
  return execute(
    { location: { pathname } },
    { querySelectorAll: () => buttonNodes },
  );
}
assert.equal(runHomarrEval(), homarrKey);
assert.throws(() => runHomarrEval({ buttons: 0 }), /one Homarr MCP key button/);
assert.throws(() => runHomarrEval({ buttons: 2 }), /one Homarr MCP key button/);
assert.throws(() => runHomarrEval({ codes: 0 }), /one Homarr MCP key code/);
assert.throws(() => runHomarrEval({ codes: 2 }), /one Homarr MCP key code/);
assert.throws(() => runHomarrEval({ pathname: "/manage/tools/api" }), /invalid Homarr onboarding location/);

const wrongOriginCalls = [];
await assert.rejects(
  captureHomarrMcpKeyCode(session, {
    invokeBrowserImplementation: async (args) => {
      wrongOriginCalls.push(args);
      return "http://127.0.0.1:21002/init";
    },
  }),
  /not on Homarr MCP onboarding/,
);
assert.equal(wrongOriginCalls.length, 1);

for (const invalidValue of ["", "not-a-key"]) {
  let storeCalls = 0;
  await assert.rejects(
    captureHomarrMcpKeyCode(session, {
      invokeBrowserImplementation: async (args) => (
        args.includes("url") ? "http://127.0.0.1:21006/init" : JSON.stringify(invalidValue)
      ),
      storeImplementation: () => {
        storeCalls += 1;
      },
      writeConnectionsImplementation: () => {},
    }),
  );
  assert.equal(storeCalls, 0);
}
process.stdout.write("PASS private key reference discovery and guarded fill\n");
