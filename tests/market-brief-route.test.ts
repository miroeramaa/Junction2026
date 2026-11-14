import assert from "node:assert/strict";
import test from "node:test";
import { GET, POST } from "../app/api/workspaces/[id]/brief/route";
import type { BriefRow } from "../lib/market-brief";
import { refreshMarketBriefAfterEvent } from "../lib/market-brief-service";

test("market brief routes preserve cache, scope, cost bounds and failure behavior",async t=>{
 t.mock.method(console,"error",()=>{});
 const workspaceId="11111111-1111-4111-8111-111111111111";
 const competitorId="22222222-2222-4222-8222-222222222222";
 const keys=["NEXT_PUBLIC_SUPABASE_URL","SUPABASE_SERVICE_ROLE_KEY","CONTEXT_DEV_API_KEY"];
 const original=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
 process.env.NEXT_PUBLIC_SUPABASE_URL="https://database.example.com";process.env.SUPABASE_SERVICE_ROLE_KEY="test-only-service-key";process.env.CONTEXT_DEV_API_KEY="test-only-context-key";
 const fetchBefore=globalThis.fetch;
 let row:BriefRow|null=null, paid=0, missingStorage=false, failAI=false, invalidCitations=false, sequence=1;
 let hold:Promise<void>|null=null;
 const now=()=>new Date().toISOString();
 const events=()=>[{id:`event-${sequence}`,competitor_id:competitorId,signal:"pricing",importance:"high",title:`Pricing changed ${sequence}`,summary:"The published delivery charge changed.",url:"https://company.example.com/delivery",processed_at:now(),received_at:"2026-11-14T00:00:00Z",detected_at:"2026-11-14T00:00:00Z"}];
 // Stable timestamps make identical-input cache tests meaningful.
 const stableEvents=events();stableEvents[0].received_at=now();stableEvents[0].detected_at=now();stableEvents[0].processed_at=now();
 globalThis.fetch=async(input,options)=>{
  const req=input instanceof Request?input:new Request(input,options);const url=new URL(req.url);
  const object=req.headers.get("accept")?.includes("vnd.pgrst.object");
  const respond=(data:unknown|null)=>Response.json(object?data:data?[data]:[]);
  if(url.hostname==="database.example.com"){
   if(url.pathname.endsWith("/workspaces")){assert.equal(url.searchParams.get("id"),`eq.${workspaceId}`);return respond({id:workspaceId,name:"Our company",domain:"ours.test",description:"Furniture for homes"});}
   if(url.pathname.endsWith("/competitors")){assert.equal(url.searchParams.get("workspace_id"),`eq.${workspaceId}`);return Response.json([{id:competitorId,workspace_id:workspaceId,name:"Competitor",confirmed:true,is_sandbox:false}]);}
   if(url.pathname.endsWith("/events")){assert.equal(url.searchParams.get("competitor_id"),`in.(${competitorId})`);return Response.json(stableEvents);}
   if(url.pathname.endsWith("/market_briefs")){
    if(missingStorage)return Response.json({code:"PGRST205",message:"table missing"},{status:404});
    if(req.method==="POST"){row??={workspace_id:workspaceId,content:null,generated_at:null,input_fingerprint:null,status:"idle",last_attempt_at:null,lease_until:null};return Response.json(null,{status:201});}
    if(req.method==="PATCH"){
     assert.equal(url.searchParams.get("workspace_id"),`eq.${workspaceId}`);
     const patch=await req.json();
     if(patch.status==="generating"&&row?.lease_until&&Date.parse(row.lease_until)>Date.now())return respond(null);
     row={...row!,...patch};return respond(row);
    }
    return respond(row);
   }
  }
  if(url.href==="https://api.context.dev/v1/web/answers"){
   assert.ok((await req.json()).task.length<=2000,"Answers task must respect the documented request limit");
   paid++;if(hold)await hold;
   if(failAI)return Response.json({error:"Upstream private detail"},{status:500});
   return Response.json({json_content:{insights:[{headline:"Delivery pricing deserves attention",interpretation:"A delivery-price change may affect the value proposition.",relevance:"Compare this with our delivery terms before drawing conclusions.",next_step:"Review delivery terms for equivalent basket sizes.",confidence:"moderate",kind:"single_change",evidence_ids:[invalidCitations?"invented":stableEvents[0].id]}]},sources:[]});
  }
  throw new Error(`Unexpected request ${url.origin}${url.pathname}`);
 };
 const params={params:Promise.resolve({id:workspaceId})};
 const post=()=>POST(new Request(`http://localhost/api/workspaces/${workspaceId}/brief`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({locale:"en-US"})}),params);
 const get=()=>GET(new Request(`http://localhost/api/workspaces/${workspaceId}/brief?locale=en-US`),params);
 try{
  await t.test("missing migration is detected before any AI call",async()=>{missingStorage=true;assert.equal((await post()).status,503);assert.equal(paid,0);missingStorage=false;});
  await t.test("GET only loads data and never generates or spends credits",async()=>{const response=await get();assert.equal(response.status,200);assert.equal((await response.json()).can_generate,true);assert.equal(paid,0);});
  await t.test("automatic generation is off until the workspace generates its first brief",async()=>{await refreshMarketBriefAfterEvent(workspaceId);assert.equal(paid,0);});
  await t.test("generation stores sourced workspace-relevant insights",async()=>{assert.equal((await post()).status,200);assert.equal(paid,1);assert.equal(row?.content?.insights[0].confidence,"tentative");assert.equal(row?.content?.insights[0].evidence[0].id,stableEvents[0].id);});
  await t.test("unchanged inputs reuse the saved brief without spending again",async()=>{assert.equal((await post()).status,200);assert.equal(paid,1);});
  await t.test("new evidence marks the cache stale and rapid retries are bounded",async()=>{stableEvents[0].summary="A newer published delivery change";assert.equal((await(await get()).json()).stale,true);assert.equal((await post()).status,429);assert.equal(paid,1);});
  await t.test("concurrent generation claims only one paid request",async()=>{
   row!.last_attempt_at="2000-01-01T00:00:00Z";let release!:()=>void;let started!:()=>void;
   const start=new Promise<void>(resolve=>{started=resolve;});hold=new Promise<void>(resolve=>{release=resolve;});
   const originalFetch=globalThis.fetch;globalThis.fetch=async(input,opts)=>{const req=input instanceof Request?input:new Request(input,opts);if(req.url.includes("/web/answers"))started();return originalFetch(input,opts);};
   const first=post();await start;assert.equal((await post()).status,409);release();assert.equal((await first).status,200);hold=null;globalThis.fetch=originalFetch;assert.equal(paid,2);
  });
  await t.test("provider errors retain the last good brief",async()=>{const old=row!.content;stableEvents[0].summary="Another meaningful observation";row!.last_attempt_at="2000-01-01T00:00:00Z";failAI=true;const response=await post();assert.equal(response.status,503);assert.deepEqual(row!.content,old);assert.equal(row!.status,"error");assert.doesNotMatch(JSON.stringify(await response.json()),/Upstream private/);failAI=false;});
  await t.test("invented citations cannot overwrite a good saved interpretation",async()=>{row!.last_attempt_at="2000-01-01T00:00:00Z";invalidCitations=true;const old=row!.content;assert.equal((await post()).status,503);assert.deepEqual(row!.content,old);invalidCitations=false;});
  await t.test("enabled webhook refresh updates changed evidence and reuses unchanged evidence",async()=>{row!.last_attempt_at="2000-01-01T00:00:00Z";const before=paid;await refreshMarketBriefAfterEvent(workspaceId);assert.equal(paid,before+1);assert.equal(row!.status,"ready");await refreshMarketBriefAfterEvent(workspaceId);assert.equal(paid,before+1);});
  await t.test("routine-only changes produce no strategy story and no paid generation",async()=>{stableEvents[0].importance="low";row!.last_attempt_at="2000-01-01T00:00:00Z";const before=paid;assert.equal((await post()).status,200);assert.deepEqual(row!.content?.insights,[]);assert.equal(paid,before);});
 }finally{globalThis.fetch=fetchBefore;for(const key of keys){if(original[key]===undefined)delete process.env[key];else process.env[key]=original[key];}}
});
