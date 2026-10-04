import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSetupTransportFacilities } from "../src/control-panel/setup-transport.ts";

const root = await mkdtemp(join(tmpdir(),"selfhost-websocket-"));
let mode = "normal";
let commands = 0;
let authMessages = 0;
let connections = 0;
let mutationCheckpointSeen = false;
let facilities: ReturnType<typeof createSetupTransportFacilities>;
const server = Bun.serve({hostname:"127.0.0.1",port:0,
  fetch(request,server) {
    if (mode === "redirect") return new Response(null,{status:302,headers:{location:`http://127.0.0.1:${server.port}/redirect-target`}});
    if (new URL(request.url).pathname !== "/api/websocket") return new Response("invalid",{status:404});
    if (server.upgrade(request)) return;
    return new Response("upgrade required",{status:400});
  },
  websocket:{
    open(socket) {connections++;socket.send(JSON.stringify({type:"auth_required"}));},
    async message(socket,data) {
      const message=JSON.parse(data.toString());
      if(message.type === "auth") {
        authMessages++;
        assert.equal(message.access_token,"private-fixture-bearer");
        if(mode === "bad-auth") {socket.send(JSON.stringify({type:"auth_invalid",message:"must not leak"}));return;}
        socket.send(JSON.stringify({type:"auth_ok"}));return;
      }
      commands++;
      assert.equal(message.id,1);
      if(message.type === "auth/long_lived_access_token") {
        mutationCheckpointSeen = (await facilities.checkpoint.read())?.attemptedActions.includes("create-token") === true;
      }
      if(mode === "wrong-id") {socket.send(JSON.stringify({type:"result",id:2,success:true,result:"private-leak"}));return;}
      if(mode === "binary") {socket.send(Buffer.from("binary"));return;}
      if(mode === "oversized") {socket.send("x".repeat(1024*1024+1));return;}
      let result: unknown={id:"fixture-owner",is_owner:true,is_admin:true};
      if(message.type === "auth/long_lived_access_token") result="fixture-long-lived-private-token";
      socket.send(JSON.stringify({type:"result",id:1,success:true,result}));
    },
  },
});
try {
  const projectId="websocket-one";
  const directory=join(root,".selfhost","shared",projectId);
  const privateFiles=join(directory,"secrets","home-assistant");
  await mkdir(privateFiles,{recursive:true,mode:0o700});
  const passwordFile=join(privateFiles,"admin-password");
  await writeFile(passwordFile,"fixture-password",{mode:0o600});
  const status={command:"app status",ownerKind:"shared",appId:"home-assistant",projectRoot:root,
    mutation:false,status:"applied",runtime:{state:"running"},projectId,dockerContext:"default",
    port:server.port,url:`http://127.0.0.1:${server.port}`,composeTarget:join(directory,"compose.aaaaaaaaaaaaaaaa.yaml"),
    applyApproval:`SHARED-APPLY:${projectId}:${"a".repeat(64)}`,ownerRevision:1,manifestHash:"b".repeat(64),privateFiles,passwordFile};
  let current=status;
  let approved=false;
  let stale=false;
  const secrets:string[]=[];
  const approvals:string[]=[];
  facilities=createSetupTransportFacilities({appId:"home-assistant",projectRoot:root,
    async readStatus(){return current;},async readHandoff(){throw new Error("unexpected handoff");},
    async approve(_action,token,progress){
      assert.ok(!progress.includes("private-fixture-bearer"));approvals.push(token);
      if(stale) current={...status,ownerRevision:2};
      return approved;
    },approvalQueue:{tail:Promise.resolve()},registerSecret(value){secrets.push(value);},redact(value){return value;},});
  const read={path:"/api/websocket" as const,accessToken:"private-fixture-bearer",type:"auth/current_user" as const};
  assert.deepEqual(await facilities.webSocket.request(read),{id:"fixture-owner",is_owner:true,is_admin:true});
  const mutation={...read,type:"auth/long_lived_access_token" as const,payload:{client_name:"selfhost-homarr",lifespan:3650},
    approval:{action:"create-token",progress:"Create reviewed owner token",once:true},
    beforeSendCheckpoint:{expectedRevision:null,stage:"token-attempted"}};
  const beforeDecline=connections;
  await assert.rejects(facilities.webSocket.request(mutation),/approval was declined/);
  assert.equal(connections,beforeDecline);
  assert.equal(await facilities.checkpoint.read(),null);
  assert.equal(approvals.length,1);
  approved=true;stale=true;
  await assert.rejects(facilities.webSocket.request(mutation),/identity changed/);
  assert.equal(connections,beforeDecline);
  current=status;stale=false;
  assert.equal(await facilities.webSocket.request(mutation),"fixture-long-lived-private-token");
  assert.equal(mutationCheckpointSeen,true);
  assert.ok(secrets.includes("private-fixture-bearer"));
  assert.ok(secrets.includes("fixture-long-lived-private-token"));
  const afterWrite=commands;
  await assert.rejects(facilities.webSocket.request(mutation),/already attempted/);
  assert.equal(commands,afterWrite);
  for(const invalid of [{...read,path:"ws://evil.invalid"},{...read,type:"subscribe_events"},
    {...read,payload:{id:7}},{...mutation,payload:{id:7,client_name:"bad",lifespan:1}},
    {...mutation,approval:undefined},{...read,headers:{Authorization:"private"}}]) {
    await assert.rejects(facilities.webSocket.request(invalid as any));
  }
  for(mode of ["wrong-id","bad-auth","binary","oversized","redirect"]) {
    const beforeAuth=authMessages;
    await assert.rejects(facilities.webSocket.request(read),/Local setup WebSocket/);
    if(mode === "redirect") assert.equal(authMessages,beforeAuth);
  }
} finally {
  server.stop(true);
  await rm(root,{recursive:true,force:true});
}
console.log("setup WebSocket: owned-origin/auth/checkpoint/replay/redirect/payload checks passed");
