import { createHmac } from "node:crypto";
import { POST as webhook } from "../app/api/webhooks/context/[monitorId]/route";
import { processEvent } from "../lib/pipeline";
import assert from "node:assert/strict";
import test from "node:test";
import { addCompetitor, addSource, changeSource, removeCompetitor, publicUrl } from "../lib/source-controls";
import { GET as monitorList } from "../app/api/workspaces/[id]/monitors/route";
import { PATCH } from "../app/api/workspaces/[id]/monitors/[monitorId]/route";
import { sweepWorkspace } from "../lib/monitors";

const ws="11111111-1111-4111-8111-111111111111", cid="22222222-2222-4222-8222-222222222222", mid="33333333-3333-4333-8333-333333333333";
test("source controls are scoped, preserve configuration and report partial failures honestly",async t=>{
 t.mock.method(console,"error",()=>{});
 const before=globalThis.fetch;
 const envKeys=["NEXT_PUBLIC_SUPABASE_URL","SUPABASE_SERVICE_ROLE_KEY","CONTEXT_DEV_API_KEY","APP_URL"];
 const old=Object.fromEntries(envKeys.map(k=>[k,process.env[k]]));
 process.env.NEXT_PUBLIC_SUPABASE_URL="https://database.example.com";process.env.SUPABASE_SERVICE_ROLE_KEY="fake-service";process.env.CONTEXT_DEV_API_KEY="fake-context";process.env.APP_URL="https://app.example.com";
 type Row=Record<string,any>;
 let tables:Record<string,Row[]>={},remote:Row={},calls:Row[]=[],failRemote=false,failSave=false;
 function reset(){
  tables={workspaces:[{id:ws,domain:"ours.example.com"}],competitors:[{id:cid,workspace_id:ws,name:"Example",domain:"competitor.example.com",homepage_url:"https://competitor.example.com/",confirmed:true}],monitors:[{id:mid,competitor_id:cid,signal:"positioning",status:"active",context_monitor_id:"mon_remote",webhook_secret:"never-expose",target:{type:"page",url:"https://competitor.example.com/",instructions:"Only report the main headline",include_selectors:["main"]}}],battlecards:[{competitor_id:cid,pricing:null}],events:[]};
  remote={id:"mon_remote",status:"active",target:{...tables.monitors[0].target}};calls=[];failRemote=false;failSave=false;
 }
 reset();
 globalThis.fetch=async(input,options)=>{
  const req=input instanceof Request?input:new Request(input,options),url=new URL(req.url);
  if(url.hostname==="database.example.com"){
   const table=url.pathname.split('/').at(-1)!;
   const rows=tables[table]??=[];
   const match=(row:Row)=>[...url.searchParams].every(([field,value])=>{
    if(["select","order","limit","on_conflict"].includes(field))return true;
    let actual=row[field];if(field==="competitors.workspace_id")actual=tables.competitors.find(c=>c.id===row.competitor_id)?.workspace_id;
    if(value.startsWith("eq."))return String(actual)===value.slice(3);
    if(value.startsWith("in.("))return value.slice(4,-1).split(',').includes(String(actual));
    if(value==="not.is.null")return actual!=null;
    return true;
   });
   let selected=rows.filter(match);
   if(req.method==="POST"){
    const body=await req.json();const inserts=Array.isArray(body)?body:[body];
    if(inserts.some(v=>v.id&&rows.some(row=>row.id===v.id)))return Response.json({message:"duplicate",code:"23505"},{status:409});
    rows.push(...inserts);selected=inserts;
   }
   if(req.method==="PATCH"){
    const patch=await req.json();
    if(failSave&&table==="monitors"&&patch.target)return Response.json({message:"private storage failure"},{status:500});
    selected.forEach(row=>Object.assign(row,patch));
   }
   if(req.method==="DELETE"){calls.push({method:"local-delete",table});tables[table]=rows.filter(row=>!match(row));}
   const object=req.headers.get('accept')?.includes('vnd.pgrst.object');
   return Response.json(object?selected[0]??null:selected);
  }
  if(url.hostname==="api.context.dev"){
   const body=req.method==='PATCH'||req.method==='POST'?await req.json().catch(()=>null):null;
   calls.push({method:req.method,path:url.pathname,body});
   if(failRemote&&req.method!=='GET')return Response.json({error:"private account diagnostic"},{status:503});
   if(req.method==='GET')return Response.json(remote);
   if(req.method==='PATCH'){Object.assign(remote,body);return Response.json(remote);}
   if(req.method==='POST'&&url.pathname.endsWith('/run'))return Response.json({queued:true});
   if(req.method==='POST')return Response.json({id:`mon_${calls.length}`,status:'active',target:body.target,webhook:{secret:'new-secret'}});
   return Response.json({});
  }
  throw new Error(`Unexpected host ${url.hostname}`);
 };
 try{
  await t.test("public input validation rejects local addresses, credentials and non-web schemes",()=>{
   for(const value of ['http://localhost','http://127.0.0.1/path','http://[::1]','https://name:password@example.com','file:///tmp/test','https://private.internal','https://example.com:9000'])assert.throws(()=>publicUrl(value));
   assert.equal(publicUrl('https://jobs.example.com/openings#top'),'https://jobs.example.com/openings');
  });
  await t.test("another workspace cannot change or remove a competitor/source",async()=>{
   reset();await assert.rejects(changeSource('other',mid,{action:'pause'}));await assert.rejects(removeCompetitor('other',cid));assert.equal(calls.length,0);
  });
  await t.test("bad source input is rejected before an upstream call",async()=>{
   reset();await assert.rejects(addSource(ws,cid,{signal:'hiring',url:'http://localhost'}));assert.equal(calls.length,0);
   const response=await PATCH(new Request('http://app.test',{method:'PATCH',body:'{bad'}),{params:Promise.resolve({id:ws,monitorId:mid})});assert.equal(response.status,400);
  });
  await t.test("pause and resume reach Context.dev without touching the target or secrets",async()=>{
   reset();await changeSource(ws,mid,{action:'pause'});assert.equal(tables.monitors[0].status,'paused');assert.equal(remote.status,'paused');
   assert.deepEqual(calls.find(c=>c.method==='PATCH')?.body,{status:'paused'});
   await changeSource(ws,mid,{action:'resume'});assert.equal(tables.monitors[0].status,'active');assert.equal(tables.monitors[0].webhook_secret,'never-expose');
  });
  await t.test("editing a paused target preserves instructions/selectors and remains paused",async()=>{
   reset();tables.monitors[0].status='paused';remote.status='paused';
   await changeSource(ws,mid,{action:'update',url:'https://competitor.example.com/about'});
   const patch=calls.find(c=>c.method==='PATCH')!.body;
   assert.equal(patch.target.instructions,'Only report the main headline');assert.deepEqual(patch.target.include_selectors,['main']);assert.deepEqual(patch.change_detection,{type:'semantic'});
   assert.equal(patch.status,'paused');assert.equal(tables.monitors[0].status,'paused');assert.equal(tables.competitors[0].homepage_url,'https://competitor.example.com/about');
  });
  await t.test("pricing correction updates the pipeline URL and clears only current prices, not history",async()=>{
   reset();tables.monitors[0].signal='pricing';tables.competitors[0].pricing_url='https://competitor.example.com/old';tables.battlecards[0].pricing={plans:[{price:10}]};
   await changeSource(ws,mid,{action:'update',url:'https://competitor.example.com/pricing'});
   assert.equal(tables.competitors[0].pricing_url,'https://competitor.example.com/pricing');assert.equal(tables.battlecards[0].pricing,null);assert.equal(tables.monitors[0].status,'baseline');
  });
  await t.test("failed upstream changes retain rows and retry reconciles remote truth",async()=>{
   reset();failRemote=true;await assert.rejects(changeSource(ws,mid,{action:'pause'}),/couldn’t finish/);assert.equal(tables.monitors.length,1);assert.match(tables.monitors[0].status,/error/);
   failRemote=false;await changeSource(ws,mid,{action:'pause'});assert.equal(tables.monitors[0].status,'paused');
  });
  await t.test("a failed local save never reports success and can be recovered",async()=>{
   reset();failSave=true;await assert.rejects(changeSource(ws,mid,{action:'update',url:'https://competitor.example.com/new'}));assert.match(tables.monitors[0].status,/error/);
   failSave=false;remote.status='paused';await changeSource(ws,mid,{action:'retry'});assert.equal(tables.monitors[0].target.url,'https://competitor.example.com/new');assert.equal(tables.monitors[0].status,'paused');
  });
  await t.test("pending source operations reject overlapping actions",async()=>{
   reset();tables.monitors[0].status='updating';await assert.rejects(changeSource(ws,mid,{action:'pause'}));assert.equal(calls.length,0);
  });
  await t.test("a failed setup row is retried instead of creating another source",async()=>{
   reset();tables.monitors[0].context_monitor_id=null;tables.monitors[0].status='error: setup';await changeSource(ws,mid,{action:'resume'});
   assert.equal(tables.monitors.length,1);assert.ok(tables.monitors[0].context_monitor_id);assert.equal(tables.monitors[0].status,'baseline');
  });
  await t.test("adding a source rejects duplicates and supports exact sitemap URLs",async()=>{
   reset();await assert.rejects(addSource(ws,cid,{signal:'positioning',url:'https://competitor.example.com/'}));assert.equal(calls.length,0);
   await addSource(ws,cid,{signal:'launches',url:'https://competitor.example.com/news/sitemap.xml'});
   const added=tables.monitors.find(m=>m.signal==='launches')!;assert.equal(added.target.url,'https://competitor.example.com/news/sitemap.xml');assert.equal(added.target.include,undefined);
  });
  await t.test("adding a competitor seeds its card and starts only homepage/press sources",async()=>{
   reset();const result=await addCompetitor(ws,{name:'New Co',website:'new.example.com'});assert.equal(result.incomplete_sources.length,0);
   assert.equal(tables.competitors.length,2);assert.ok(tables.battlecards.some(c=>c.competitor_id===result.competitor.id));assert.equal(calls.filter(c=>c.method==='POST').length,2);
   await assert.rejects(addCompetitor(ws,{name:'Duplicate',website:'https://www.new.example.com/'}));
  });
  await t.test("failed new-competitor monitoring is reported while retaining a retryable watchlist entry",async()=>{
   reset();failRemote=true;const result=await addCompetitor(ws,{name:'New Co',website:'new.example.com'});assert.equal(result.incomplete_sources.length,2);assert.equal(tables.competitors.length,2);assert.equal(tables.monitors.filter(m=>m.status.startsWith('error')).length,2);
  });
  await t.test("removal stops remote monitors before deleting local history; failures retain the competitor",async()=>{
   reset();failRemote=true;await assert.rejects(removeCompetitor(ws,cid));assert.equal(tables.competitors.length,1);
   failRemote=false;await removeCompetitor(ws,cid);assert.equal(tables.competitors.length,0);assert.ok(calls.findIndex(c=>c.method==='DELETE')<calls.findIndex(c=>c.method==='local-delete'));
  });
  await t.test("late signed webhooks cannot reactivate a paused source",async()=>{
   reset();tables.monitors[0].status='paused';
   const body=JSON.stringify({id:'signed-event',event:'run.completed',data:{run:{completed_at:new Date().toISOString()}}});
   const stamp=Math.floor(Date.now()/1000);const signature=createHmac('sha256','never-expose').update(`${stamp}.${body}`).digest('hex');
   const response=await webhook(new Request('http://app.test',{method:'POST',body,headers:{'x-context-signature':`t=${stamp},v1=${signature}`,'x-context-id':'signed-event'}}),{params:Promise.resolve({monitorId:mid})});
   assert.equal(response.status,204);assert.equal(tables.monitors[0].status,'paused');assert.equal(calls.length,0);
  });
  await t.test("obvious website noise is retained and processed without paid card updates",async()=>{
   reset();tables.events=[{id:'noise',signal:'pricing',title:'Pricing page footer updated',summary:'Only the cookie banner changed',importance:'high',competitor_id:cid,raw:{data:{change:{added_urls:[]}}}}];
   await processEvent('noise');assert.ok(tables.events[0].processed_at);assert.equal(tables.battlecards[0].updated_at,undefined);assert.equal(calls.length,0);
  });
  await t.test("monitor listing exposes safe source metadata and sweep excludes paused/updating sources",async()=>{
   reset();tables.monitors.push({...tables.monitors[0],id:'paused',context_monitor_id:'mon_paused',status:'paused'},{...tables.monitors[0],id:'updating',context_monitor_id:'mon_updating',status:'updating'});
   const response=await monitorList(new Request('http://app.test'),{params:Promise.resolve({id:ws})});const data=await response.json();assert.equal(data[0].target_type,'page');assert.doesNotMatch(JSON.stringify(data),/secret|context_monitor_id|instructions/);
   const result=await sweepWorkspace(ws);assert.equal(result.total,1);assert.equal(calls.filter(c=>c.path.endsWith('/run')).length,1);
  });
 }finally{globalThis.fetch=before;for(const key of envKeys){if(old[key]===undefined)delete process.env[key];else process.env[key]=old[key];}}
});
