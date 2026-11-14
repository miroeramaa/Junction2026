import assert from "node:assert/strict";
import test from "node:test";
import { buildBriefTask, selectBriefEvidence, validateBriefOutput } from "../lib/market-brief";
import type { Competitor, EventRow, Workspace } from "../lib/types";
const now=Date.parse("2026-11-14T12:00:00Z");
const workspace={id:"ours",name:"Our company",domain:"ours.test",description:"Home furnishings"} as Workspace;
const competitors=[{id:"one",workspace_id:"ours",name:"Competitor",confirmed:true,is_sandbox:false},{id:"demo",workspace_id:"ours",name:"Demo",confirmed:true,is_sandbox:true},{id:"other",workspace_id:"theirs",confirmed:true,is_sandbox:false}] as Competitor[];
const event=(id:string,patch:Partial<EventRow>={})=>({id,competitor_id:"one",signal:"hiring",importance:"medium",title:`Change ${id}`,summary:"New roles in a business team",url:`https://competitor.test/${id}`,processed_at:"2026-11-14T10:00:00Z",detected_at:"2026-11-14T09:00:00Z",received_at:"2026-11-14T09:01:00Z",...patch}) as EventRow;
const modelInsight=(ids:string[],patch:Record<string,unknown>={})=>({headline:"A possible business expansion",interpretation:"The signals may suggest expansion.",relevance:"Compare overlap with our furnishing offer.",next_step:"Inspect the business offering and delivery terms.",confidence:"moderate",kind:"pattern",evidence_ids:ids,...patch});
test("brief inputs are scoped, recent, processed, non-demo and meaningful",()=>{
 const evidence=selectBriefEvidence(workspace,competitors,[event("good"),event("low",{importance:"low"}),event("demo",{competitor_id:"demo"}),event("cross",{competitor_id:"other"}),event("old",{detected_at:"2025-01-01"}),event("future",{detected_at:"2027-01-01"}),event("pending",{processed_at:null}),event("unsafe",{url:"javascript:alert(1)"})],now);
 assert.deepEqual(evidence.map(e=>e.id),["good"]);
});
test("syndicated or repeated headlines do not count as independent observations",()=>{
 const evidence=selectBriefEvidence(workspace,competitors,[event("one",{title:"Product launch"}),event("two",{title:" Product launch "})],now);
 assert.equal(evidence.length,1);
});
test("an insight needs valid evidence IDs belonging to one competitor",()=>{
 const evidence=selectBriefEvidence(workspace,competitors,[event("one"),event("two")],now);
 assert.equal(validateBriefOutput({insights:[modelInsight(["one","missing"])]},evidence).length,0);
 const cross=[evidence[0],{...evidence[1],competitor_id:"different"}];
 assert.equal(validateBriefOutput({insights:[modelInsight(["one","two"])]},cross).length,0);
});
test("patterns require separate observations from separate pages",()=>{
 const evidence=selectBriefEvidence(workspace,competitors,[event("one"),event("two")],now);
 assert.equal(validateBriefOutput({insights:[modelInsight(["one"])]},evidence).length,0);
 assert.equal(validateBriefOutput({insights:[modelInsight(["one","two"])]},evidence).length,1);
 assert.equal(validateBriefOutput({insights:[modelInsight(["one","two"])]},evidence.map(e=>({...e,url:"https://competitor.test/same"}))).length,0);
});
test("one high-impact change can support an assessment, never a trend or moderate confidence",()=>{
 const evidence=selectBriefEvidence(workspace,competitors,[event("one",{importance:"high"})],now);
 const insight=validateBriefOutput({insights:[modelInsight(["one"],{kind:"single_change"})]},evidence)[0];
 assert.equal(insight.confidence,"tentative");
 assert.equal(insight.headline,evidence[0].title);
 assert.equal(validateBriefOutput({insights:[modelInsight(["one"],{kind:"single_change"})]},evidence.map(e=>({...e,importance:"medium"}))).length,0);
});
test("observed facts and URLs come from captured data, never generated model source fields",()=>{
 const evidence=selectBriefEvidence(workspace,competitors,[event("one"),event("two")],now);
 const result=validateBriefOutput({insights:[modelInsight(["one","two"],{url:"https://invented.test",evidence:[{title:"Invented"}]})]},evidence);
 assert.deepEqual(result[0].evidence,evidence);
 assert.equal((result[0] as unknown as {url?:string}).url,undefined);
});
test("reusing the same evidence cannot produce three duplicate insights",()=>{
 const evidence=selectBriefEvidence(workspace,competitors,[event("one"),event("two")],now);
 assert.equal(validateBriefOutput({insights:[modelInsight(["one","two"]),modelInsight(["two","one"])]},evidence).length,1);
 assert.deepEqual(validateBriefOutput({insights:[]},evidence),[]);
});
test("large evidence sets fit the real Answers task limit and retain only supplied identifiers",()=>{
 const evidence=selectBriefEvidence(workspace,competitors,Array.from({length:80},(_,i)=>event(`event-${i}`,{title:`Important business change ${i}`,summary:"Business details ".repeat(100)})),now);
 const prompt=buildBriefTask({name:"Our company",description:"What we do"},evidence,"en-US");
 assert.ok(prompt.task.length<=2000);
 assert.ok(prompt.evidence.length>=2);
 assert.ok(prompt.evidence.length<evidence.length);
 assert.match(prompt.task,/p0/);
 prompt.evidence.forEach(item=>assert.ok(evidence.some(source=>source.id===item.id)));
});
