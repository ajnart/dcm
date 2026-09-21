#!/usr/bin/env bun
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { loadSession } from "./lib/session-context.ts";

export const PROCEDURES = [
  "widget.indexerManager.getIndexersStatus",
  "widget.downloads.getJobsAndStatuses",
  "widget.mediaRequests.getStats",
  "widget.mediaServer.getCurrentStreams",
  "widget.calendar.findAllEvents",
  "widget.mediaOrganizer.getData",
  "widget.mediaRelease.getMediaReleases",
];

function fail(message) { throw new Error(message); }
function isRecord(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }

function validateBoardName(boardName) {
  if (typeof boardName !== "string" || !/^[A-Za-z0-9][A-Za-z0-9 _-]{0,63}$/.test(boardName)) fail("Homarr board name is invalid");
  return boardName;
}

export function validateWidgetProof(proof, boardName) {
  validateBoardName(boardName);
  if (!isRecord(proof) || Object.keys(proof).sort().join(",") !== "board,rows" || proof.board !== boardName || !Array.isArray(proof.rows)) fail("Homarr widget proof is invalid");
  if (proof.rows.length !== PROCEDURES.length) fail("Homarr widget proof is incomplete");
  for (const procedure of PROCEDURES) {
    const matches = proof.rows.filter((row) => row?.procedure === procedure);
    if (matches.length !== 1) fail("Homarr widget proof procedure set is invalid");
    const row = matches[0];
    const expectedKeys = procedure === "widget.mediaRelease.getMediaReleases"
      ? ["classification", "failedIntegrations", "method", "path", "procedure", "releases", "status"]
      : ["classification", "method", "path", "procedure", "status"];
    if (!isRecord(row) || Object.keys(row).sort().join(",") !== expectedKeys.join(",")) fail("Homarr widget proof row schema is invalid");
    if (row.method !== "GET" || row.path !== `/api/trpc/${procedure}` || row.status !== 200 || row.classification !== "result") {
      fail(`Homarr widget proof failed for ${procedure}`);
    }
    if (procedure === "widget.mediaRelease.getMediaReleases") {
      if (!Number.isSafeInteger(row.releases) || row.releases < 0 || !Number.isSafeInteger(row.failedIntegrations) || row.failedIntegrations < 0) {
        fail("Homarr media-release proof counts are invalid");
      }
      if (row.failedIntegrations !== 0) fail("Homarr media-release proof has failed integrations");
    }
  }
  return proof;
}

export function widgetProofEval(origin, boardName) {
  validateBoardName(boardName);
  const expectedOrigin = JSON.stringify(origin);
  const expectedBoard = JSON.stringify(boardName);
  const expectedPath = JSON.stringify(`/boards/${encodeURIComponent(boardName)}`);
  const procedures = JSON.stringify(PROCEDURES);
  return `(async()=>{
    const expectedOrigin=${expectedOrigin};
    const expectedBoard=${expectedBoard};
    const procedures=${procedures};
    if(location.origin!==expectedOrigin||location.pathname!==${expectedPath})throw new Error("unexpected Homarr page");
    const call=async(procedure,input)=>{
      const path="/api/trpc/"+procedure;
      const url=path+"?input="+encodeURIComponent(JSON.stringify({json:input}));
      const response=await fetch(url,{method:"GET",headers:{Accept:"application/json"},credentials:"same-origin",redirect:"manual"});
      const text=await response.text();
      if(text.length>8388608)throw new Error("response too large");
      let payload=null;try{payload=JSON.parse(text)}catch{}
      const json=payload?.result?.data?.json;
      const row={procedure,method:"GET",path,status:response.status,classification:json!==undefined&&!payload?.error?"result":"error"};
      if(procedure==="widget.mediaRelease.getMediaReleases"&&json!==undefined){row.releases=Array.isArray(json.releases)?json.releases.length:-1;row.failedIntegrations=Array.isArray(json.failedIntegrations)?json.failedIntegrations.length:-1}
      return row;
    };
    const boardResponse=await fetch("/api/trpc/board.getBoardByName?input="+encodeURIComponent(JSON.stringify({json:{name:expectedBoard}})),{method:"GET",headers:{Accept:"application/json"},credentials:"same-origin",redirect:"manual"});
    const boardPayload=await boardResponse.json();
    const board=boardPayload?.result?.data?.json;
    if(boardResponse.status!==200||board?.name!==expectedBoard||board?.isPublic!==false||!Array.isArray(board.items))throw new Error("board unavailable");
    const expectedIntegrationCounts={calendar:2,mediaMissing:2,indexerManager:1,downloads:1,"mediaRequests-requestStats":1,mediaServer:1,mediaReleases:1};
    const item=(kind)=>{const matches=board.items.filter((candidate)=>candidate?.kind===kind);if(matches.length!==1||!Array.isArray(matches[0].integrationIds)||matches[0].integrationIds.length!==expectedIntegrationCounts[kind])throw new Error("widget unavailable");return matches[0]};
    const now=new Date();
    const inputs={
      "widget.indexerManager.getIndexersStatus":{integrationIds:item("indexerManager").integrationIds},
      "widget.downloads.getJobsAndStatuses":{integrationIds:item("downloads").integrationIds,limitPerIntegration:50},
      "widget.mediaRequests.getStats":{integrationIds:item("mediaRequests-requestStats").integrationIds},
      "widget.mediaServer.getCurrentStreams":{integrationIds:item("mediaServer").integrationIds,showOnlyPlaying:false},
      "widget.calendar.findAllEvents":{integrationIds:item("calendar").integrationIds,year:now.getFullYear(),month:now.getMonth()+1,releaseType:["inCinemas","digitalRelease"],showUnmonitored:false},
      "widget.mediaOrganizer.getData":{integrationIds:item("mediaMissing").integrationIds,pageSize:10},
      "widget.mediaRelease.getMediaReleases":{integrationIds:item("mediaReleases").integrationIds}
    };
    const rows=[];for(const procedure of procedures)rows.push(await call(procedure,inputs[procedure]));
    return {board:expectedBoard,rows};
  })()`;
}

export function proveHomarrWidgets(session, boardName, run = spawnSync) {
  validateBoardName(boardName);
  const origin = `http://127.0.0.1:${session.manifest.HOMARR_PORT}`;
  const result = run("agent-browser", ["--session", session.manifest.AGENT_BROWSER_SESSION, "eval", "--stdin"], {
    encoding: "utf8",
    input: widgetProofEval(origin, boardName),
    maxBuffer: 9 * 1024 * 1024,
    timeout: 30_000,
  });
  if (result.status !== 0 || typeof result.stdout !== "string") fail("Homarr widget browser proof failed");
  let proof;
  try { proof = JSON.parse(result.stdout); } catch { fail("Homarr widget browser proof returned invalid JSON"); }
  return validateWidgetProof(proof, boardName);
}

export function printWidgetProof(proof) {
  for (const row of proof.rows) {
    let suffix = "";
    if (row.procedure === "widget.mediaRelease.getMediaReleases") suffix = ` releases=${row.releases} failedIntegrations=${row.failedIntegrations}`;
    console.log(`PASS GET ${row.path} status=200 envelope=result${suffix}`);
  }
}

if (Bun.argv[1] && pathToFileURL(Bun.argv[1]).href === import.meta.url) {
  try {
    if (Bun.argv.length !== 4) throw new Error("usage");
    printWidgetProof(proveHomarrWidgets(loadSession(Bun.argv[2]), Bun.argv[3]));
  } catch {
    console.error("FAIL Homarr generated-widget proof");
    process.exitCode = 1;
  }
}
