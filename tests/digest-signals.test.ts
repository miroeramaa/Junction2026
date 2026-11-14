import assert from "node:assert/strict";
import test from "node:test";
import { GET } from "../app/api/cron/daily-digest/route";

test("daily digest ranks important changes, excludes noise/feedback/duplicates and advances only after delivery",async t=>{
 const keys=['NEXT_PUBLIC_SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','RESEND_API_KEY','DIGEST_FROM_EMAIL','CRON_SECRET'];
 const previous=Object.fromEntries(keys.map(key=>[key,process.env[key]]));const fetchBefore=globalThis.fetch;
 Object.assign(process.env,{NEXT_PUBLIC_SUPABASE_URL:'https://database.example.com',SUPABASE_SERVICE_ROLE_KEY:'test-key',RESEND_API_KEY:'test-resend',DIGEST_FROM_EMAIL:'digest@example.com',CRON_SECRET:'test-secret'});
 let quietOnly=false,failSend=false,deliveries:any[]=[],updates:any[]=[],queries:URL[]=[];
 const row=(id:string,title:string,importance='medium',received_at=new Date().toISOString())=>({id,competitor_id:'company',signal:'news',title,summary:title,importance,url:'https://example.com/news',received_at,processed_at:received_at,competitors:{name:'Example <company>'}});
 globalThis.fetch=async(input,options)=>{
  const req=input instanceof Request?input:new Request(input,options),url=new URL(req.url);
  if(url.pathname.endsWith('/workspace_alert_settings')){
   if(req.method==='PATCH'){updates.push(await req.json());return Response.json(null);}
   return Response.json([{workspace_id:'workspace',email:'recipient@example.com',signals:['news'],last_digest_at:null}]);
  }
  if(url.pathname.endsWith('/event_feedback'))return Response.json([{event_id:'muted',rating:'not_useful'}]);
  if(url.pathname.endsWith('/events')){
   queries.push(url);
   const noise=row('noise','Only cookie banner and footer updated','high');if(quietOnly)return Response.json([noise]);
   const high=row('high','Company announces a significant acquisition of a competitor','high',new Date(Date.now()-3600000).toISOString());
   return Response.json([noise,row('muted','Company announces major layoffs','high'),...Array.from({length:8},(_,i)=>row(`medium-${i}`,`Company opens a new store number ${i}`)),high,{...high,id:'copy',received_at:new Date().toISOString()}]);
  }
  if(url.href==='https://api.resend.com/emails'){
   deliveries.push(await req.json());return Response.json({id:'fake-delivery'},{status:failSend?503:200});
  }
  throw new Error(`Unexpected ${url.pathname}`);
 };
 const run=()=>GET(new Request('http://localhost/api/cron/daily-digest',{headers:{authorization:'Bearer test-secret'}}));
 try{
  await t.test('unauthorized requests do no work',async()=>{assert.equal((await GET(new Request('http://localhost'))).status,401);assert.equal(deliveries.length,0);});
  await t.test('high importance outranks newer medium changes and duplicates appear only once',async()=>{
   const response=await run();assert.equal((await response.json()).sent,1);const html=deliveries[0].html as string;
   assert.doesNotMatch(html,/cookie banner|major layoffs/);assert.equal((html.match(/significant acquisition/g)??[]).length,2); // title + summary in one entry
   assert.equal((html.match(/<li>/g)??[]).length,5);assert.ok(html.indexOf('significant acquisition')<html.indexOf('store number'));assert.match(html,/Example &lt;company&gt;/);
   assert.equal(queries[0].searchParams.get('limit'),'300');assert.ok(queries[0].searchParams.getAll('received_at').some(value=>value.startsWith('lte.')),'The cursor must use the query cutoff, not a later send time');assert.equal(updates.length,1);
  });
  await t.test('quiet days send no email',async()=>{quietOnly=true;const before=deliveries.length;assert.equal((await(await run()).json()).sent,0);assert.equal(deliveries.length,before);quietOnly=false;});
  await t.test('failed delivery leaves the digest cursor unchanged for retry',async()=>{failSend=true;const count=updates.length;await assert.rejects(run(),/Digest email failed/);assert.equal(updates.length,count);});
 }finally{globalThis.fetch=fetchBefore;for(const key of keys){if(previous[key]===undefined)delete process.env[key];else process.env[key]=previous[key];}}
});
