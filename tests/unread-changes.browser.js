// Browser-only read receipts and intercepted event fixtures; no database writes.
async page => {
 const assert=(value,message)=>{if(!value)throw new Error(message);};
 await page.setViewportSize({width:1440,height:1000});
 const initialUrl=page.url();const url=new URL(initialUrl);url.search='?view=matrix';
 const workspaceId=url.pathname.split('/').at(-1);
 const key=`kestrel:read-changes:${workspaceId}`;
 const backup=await page.evaluate(key=>localStorage.getItem(key),key);
 await page.unrouteAll({behavior:'ignoreErrors'});
 const responsePromise=page.waitForResponse(r=>r.url().includes('/rest/v1/events?')&&r.request().method()==='GET');
 await page.reload();
 const original=await (await responsePromise).json();
 assert(Array.isArray(original)&&original.length>1,'Fixture needs a populated workspace');
 let inject=false,competitorId='';
 const handler=async route=>{
  const base=original.find(e=>e.competitor_id===competitorId);
  const data=inject&&base?[{...base,id:'00000000-0000-4000-8000-000000000099',title:'New unread browser fixture',received_at:new Date().toISOString()},...original]:original;
  await route.fulfill({json:data});
 };
 await page.route('**/rest/v1/events?**',handler);
 try{
  await page.evaluate(key=>localStorage.removeItem(key),key);await page.goto(url.href);
  const nav=page.getByRole('navigation',{name:'Competitors'});
  await nav.locator('[title*="unread change"]').first().waitFor();
  const competitor=nav.getByRole('button').filter({has:page.locator('[title*="unread change"]')}).nth(1);
  const name=await competitor.locator('span.block.truncate').innerText();
  const badge=nav.getByRole('button',{name:new RegExp(`^${name}`)}).locator('[title*="unread change"]');
  await competitor.click();
  competitorId=new URL(page.url()).searchParams.get('c');
  await badge.waitFor({state:'detached'});
  assert(await nav.getByRole('button',{name:/All changes/}).locator('[title*="unread change"]').count()===1,'Other competitors must remain unread');
  await page.reload();await nav.getByRole('button',{name:new RegExp(`^${name}`)}).waitFor();
  assert(!await nav.getByRole('button',{name:new RegExp(`^${name}`)}).locator('[title*="unread change"]').count(),'Read state must survive reload');
  await nav.getByRole('button',{name:'Competitor overview',exact:true}).click();
  assert(original.some(e=>e.competitor_id===competitorId),'Fixture needs the selected competitor event');
  inject=true;await page.reload();
  const updated=nav.getByRole('button',{name:new RegExp(`^${name}`)});
  await updated.locator('[title="1 unread change"]').waitFor();
  await nav.getByRole('button',{name:/All changes/}).click();
  await nav.locator('[title*="unread change"]').first().waitFor({state:'detached'});
  assert(await nav.locator('[title*="unread change"]').count()===0,'Viewing all changes must clear every badge');
  await page.reload();await nav.getByRole('button',{name:'All changes',exact:true}).waitFor();
  assert(await nav.locator('[title*="unread change"]').count()===0,'Read-all must persist');
  return {result:'passed',competitor:name,newEventRestoresBadge:true};
 }finally{
  await page.unroute('**/rest/v1/events?**',handler);
  await page.evaluate(({key,backup})=>{if(backup===null)localStorage.removeItem(key);else localStorage.setItem(key,backup);},{key,backup});
  await page.goto(initialUrl);
 }
}
