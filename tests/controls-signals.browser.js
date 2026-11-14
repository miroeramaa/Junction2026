// Full rendered flows with intercepted writes; never alters real competitors or paid monitors.
async page=>{
 const assert=(ok,message)=>{if(!ok)throw new Error(message);};
 const initial=page.url(), base=new URL(initial);base.search='?view=manage';
 const workspaceId=base.pathname.split('/').at(-1), storageKey=`kestrel:read-changes:${workspaceId}`;
 const savedRead=await page.evaluate(key=>localStorage.getItem(key),storageKey);
 const compResponse=page.waitForResponse(r=>r.url().includes('/rest/v1/competitors?')&&r.request().method()==='GET');
 const eventResponse=page.waitForResponse(r=>r.url().includes('/rest/v1/events?')&&r.request().method()==='GET');
 await page.reload();let comps=await(await compResponse).json();const originalEvents=await(await eventResponse).json();
 const monitorResponse=await page.request.get(`${base.origin}/api/workspaces/${workspaceId}/monitors`);let monitors=await monitorResponse.json();
 assert(comps.length&&originalEvents.length,'Needs a populated workspace');
 const c=comps.find(c=>c.id===originalEvents[0].competitor_id);const template=originalEvents[0];
 let feedback={},patchError=false,patches=0,deletes=0,creates=0,sourceCreates=0;
 const first={...template,id:'browser-main',competitor_id:c.id,signal:'pricing',importance:'high',title:'Pro subscription price increased from 10 to 20',summary:'The published monthly Pro price changed from 10 to 20.',diff:'-10\n+20',received_at:new Date().toISOString()};
 const fixtures=[first,{...first,id:'browser-copy',received_at:new Date(Date.now()-1000).toISOString()},{...first,id:'browser-noise',title:'Pricing page footer updated',summary:'Only the cookie banner and footer changed.',diff:''}];
 await page.route('**/rest/v1/competitors?**',route=>route.fulfill({json:comps}));
 await page.route('**/rest/v1/events?**',route=>route.fulfill({json:fixtures}));
 await page.route('**/api/workspaces/*/monitors',route=>route.fulfill({json:monitors}));
 await page.route('**/api/workspaces/*/events/feedback',route=>route.fulfill({json:{feedback}}));
 await page.route('**/api/workspaces/*/events/*/feedback',async route=>{const id=route.request().url().split('/').at(-2);feedback[id]=route.request().postDataJSON().rating;await route.fulfill({json:{ok:true}});});
 await page.route('**/api/workspaces/*/monitors/*',async route=>{
  if(route.request().method()!=='PATCH')return route.fallback();
  patches++;if(patchError)return route.fulfill({status:502,json:{error:'We couldn’t finish updating this source. Retry to sync its latest state.'}});
  const id=route.request().url().split('/').at(-1),body=route.request().postDataJSON();
  monitors=monitors.map(m=>m.id!==id?m:{...m,status:body.action==='pause'?'paused':body.action==='resume'?'active':m.status==='paused'?'paused':'baseline',...(body.url?{url:body.url}:{}),...(body.query?{query:body.query}:{})});
  await route.fulfill({json:{ok:true}});
 });
 await page.route('**/api/workspaces/*/competitors',async route=>{
  creates++;const body=route.request().postDataJSON();const competitor={...comps[0],id:'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',name:body.name,domain:'fixture.example.com',homepage_url:'https://fixture.example.com/',logo_url:null};comps=[...comps,competitor];
  await route.fulfill({json:{competitor,incomplete_sources:[]}});
 });
 await page.route('**/api/workspaces/*/competitors/*/sources',async route=>{
  sourceCreates++;const competitorId=route.request().url().split('/').at(-2),body=route.request().postDataJSON();
  monitors=[...monitors,{id:'browser-added-source',competitor_id:competitorId,signal:body.signal,url:body.url??null,query:body.query??null,target_type:body.signal==='news'?'search':'page',status:'baseline',last_run_at:null}];
  await route.fulfill({json:{id:'browser-added-source'}});
 });
 await page.route('**/api/workspaces/*/competitors/*',async route=>{
  if(route.request().method()!=='DELETE')return route.fallback();
  deletes++;const id=route.request().url().split('/').at(-1);comps=comps.filter(c=>c.id!==id);monitors=monitors.filter(m=>m.competitor_id!==id);await route.fulfill({json:{ok:true}});
 });
 try{
  const url=new URL(base);url.search='?view=changes';await page.goto(url.href);await page.setViewportSize({width:1440,height:1000});
  const focus=page.getByRole('region',{name:'Signal filtering'});const feed=page.getByRole('region',{name:'Changes',exact:true});
  await feed.getByText(first.title,{exact:true}).waitFor();assert(await feed.getByText(first.title,{exact:true}).count()===1,'Important mode must collapse duplicates');
  assert(!await feed.getByText('Pricing page footer updated',{exact:true}).count(),'Important mode must suppress page chrome');
  await focus.getByRole('button',{name:'All changes',exact:true}).click();await feed.getByText('Pricing page footer updated',{exact:true}).waitFor();
  assert(await feed.getByText(first.title,{exact:true}).count()===2,'All mode must retain both captured reports');
  await focus.getByRole('button',{name:'Important',exact:true}).click();await feed.getByRole('button',{name:'Hide this update',exact:true}).click();
  await feed.getByText('No changes in this view',{exact:true}).waitFor();
  await focus.getByRole('button',{name:'All changes',exact:true}).click();
  await feed.getByRole('button',{name:'Keep this update',exact:true}).first().click();
  await focus.getByRole('button',{name:'Important',exact:true}).click();await feed.getByText(first.title,{exact:true}).waitFor();
  await page.screenshot({path:'output/playwright/filtered-signals-desktop.png'});
  await page.getByRole('navigation',{name:'Competitors'}).getByRole('button',{name:'Manage watchlist',exact:true}).click();
  const manage=page.getByRole('region',{name:'Competitors & sources'});
  await manage.getByRole('button',{name:'+ Add competitor',exact:true}).click();await manage.getByLabel('Company name',{exact:true}).fill('Browser fixture company');await manage.getByLabel('Company website',{exact:true}).fill('fixture.example.com');
  await manage.getByRole('button',{name:'Add and start watching',exact:true}).click();
  const company=manage.locator('details').filter({has:page.locator('summary').filter({hasText:'Browser fixture company'})});
  await company.locator('summary').waitFor();assert(creates===1,'One add click must create one competitor');await company.locator('summary').click();
  await company.getByRole('button',{name:'+ Add a source',exact:true}).click();await company.getByRole('combobox').selectOption('pricing');await company.getByLabel('Watched URL',{exact:true}).fill('https://fixture.example.com/pricing');await company.getByRole('button',{name:'Start monitoring',exact:true}).click();
  const source=company.getByRole('article',{name:'Pricing source'});await source.waitFor();assert(sourceCreates===1,'A source must start once');
  patchError=true;await source.getByRole('button',{name:'Pause',exact:true}).click();await source.getByText('We couldn’t finish updating this source. Retry to sync its latest state.',{exact:true}).waitFor();
  patchError=false;await source.getByRole('button',{name:'Pause',exact:true}).click();await source.getByRole('button',{name:'Resume',exact:true}).waitFor();
  await source.getByRole('button',{name:'Edit',exact:true}).click();await source.getByLabel('Watched URL',{exact:true}).fill('https://fixture.example.com/plans');await source.getByRole('button',{name:'Save source',exact:true}).click();await source.getByText('https://fixture.example.com/plans',{exact:true}).waitFor();
  assert(await source.getByRole('button',{name:'Resume',exact:true}).isVisible(),'Editing a paused source must keep it paused');
  await source.getByRole('button',{name:'Resume',exact:true}).click();await source.getByRole('button',{name:'Pause',exact:true}).waitFor();
  await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Manage controls must fit a phone');await source.scrollIntoViewIfNeeded();await page.screenshot({path:'output/playwright/manage-mobile.png'});
  await company.getByRole('button',{name:'Remove from watchlist',exact:true}).click();await company.getByRole('button',{name:'Keep competitor',exact:true}).click();assert(deletes===0,'Cancellation must not delete');
  await company.getByRole('button',{name:'Remove from watchlist',exact:true}).click();await company.getByRole('button',{name:'Remove competitor',exact:true}).click();await company.waitFor({state:'detached'});assert(deletes===1,'Confirmed removal must delete once');
  return {result:'passed',creates,sourceCreates,patches,deletes};
 }finally{
  await page.unrouteAll({behavior:'ignoreErrors'});
  await page.evaluate(({key,value})=>{if(value===null)localStorage.removeItem(key);else localStorage.setItem(key,value);},{key:storageKey,value:savedRead});
  await page.goto(initial);
 }
}
