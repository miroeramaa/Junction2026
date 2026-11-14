import assert from "node:assert/strict";
import test from "node:test";
import { assessSignal, importantSignals, triageSignals } from "../lib/signals";
import type { EventRow } from "../lib/types";
const event=(patch:Partial<EventRow>={}):EventRow=>({id:"first",competitor_id:"company",monitor_id:null,signal:"positioning",context_event_id:"context",title:"Main headline changed",summary:"A new value proposition is on the homepage.",importance:"medium",url:"https://example.com",diff:null,received_at:"2026-11-14T12:00:00Z",detected_at:null,processed_at:"2026-11-14T12:00:01Z",battlecard_updated_at:null,...patch});

test("cosmetic noise is quiet even on a pricing page; actual business changes stay visible",()=>{
 assert.equal(assessSignal(event({title:"Pricing page layout updated",summary:"Cookie banner and footer updated",importance:"high"})).priority,"quiet");
 assert.equal(assessSignal(event({signal:"pricing",title:"Pricing page updated",summary:"Pro price increased from $10 to $20; footer changed too",importance:"low"})).priority,"normal");
 assert.equal(assessSignal(event({title:"Possible exposure of customer data",summary:"Cookie banner updated after a breach",importance:"high"})).priority,"high");
});
test("unrated ambiguous changes remain visible, low routine changes can be inspected in all mode",()=>{
 assert.equal(assessSignal(event({title:"A company update",summary:"Something on the website changed",importance:null})).priority,"normal");
 const rows=triageSignals([event({importance:"low",title:"Image refreshed",summary:"Updated rotating image"})]);
 assert.equal(rows.length,1);assert.equal(rows[0].assessment.priority,"quiet");assert.equal(importantSignals(rows).length,0);
});
test("repeated news is collapsed without merging separate competitors or distinct price changes",()=>{
 const base=event({signal:"news",title:"Company opens a new flagship store in Helsinki",summary:"New location",importance:"high"});
 const repeated={...base,id:"second",url:"https://news.example.com",received_at:"2026-11-14T13:00:00Z"};
 const other={...base,id:"third",competitor_id:"other"};
 assert.equal(importantSignals([base,repeated,other]).length,2);
 const pricing=event({signal:"pricing",title:"Pricing changed",summary:"Pro price $10",diff:"- $5\n+ $10"});
 assert.equal(importantSignals([pricing,{...pricing,id:"different",summary:"Pro price $20",diff:"- $10\n+ $20"}]).length,2);
 assert.equal(importantSignals([base,{...repeated,received_at:"2026-11-17T13:00:00Z"}]).length,2);
});
test("team overrides beat automatic filtering and high priority is ranked first",()=>{
 const quiet=event({id:"cookie",title:"Cookie banner updated",summary:"Minor layout change",importance:"low"});
 assert.equal(importantSignals([quiet],{cookie:"useful"})[0].assessment.priority,"high");
 assert.equal(importantSignals([event()],{first:"not_useful"}).length,0);
 assert.equal(importantSignals([event(),event({id:"copy"})],{first:"not_useful"}).length,0);
 const rows=importantSignals([event(),event({id:"high",importance:"high",received_at:"2026-11-13T01:00:00Z"})]);
 assert.equal(rows[0].id,"high");
});
test("taxonomy and removal-only sitemap churn are quiet, product pages are retained",()=>{
 assert.equal(assessSignal(event({signal:"launches",title:"New pages found",summary:"URL inventory changed",added_urls:["https://example.com/tag/news","https://example.com/blog/page/2"]})).priority,"quiet");
 assert.equal(assessSignal(event({signal:"launches",title:"Removed pages",summary:"Old pages disappeared",added_urls:[]})).priority,"quiet");
 assert.notEqual(assessSignal(event({signal:"launches",title:"Product launched",added_urls:["https://example.com/products/new"]})).priority,"quiet");
});
test("captured input objects and source evidence are not mutated by filtering",()=>{
 const original=event();const snapshot=JSON.stringify(original);const output=triageSignals([original]);
 assert.equal(JSON.stringify(original),snapshot);assert.equal(output[0].url,original.url);assert.equal(output[0].summary,original.summary);
});
