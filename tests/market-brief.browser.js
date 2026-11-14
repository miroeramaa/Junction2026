// Run with Playwright CLI; all brief GET/POST responses are isolated browser fixtures.
async page=>{
 const assert=(condition,message)=>{if(!condition)throw new Error(message);};
 const id='browser-evidence';let row=null,posts=0,mode='success';
 const evidence={id,competitor_id:'one',competitor_name:'Sample competitor',signal:'hiring',importance:'medium',title:'Business account team expands (browser fixture)',summary:'A captured company announcement describes additional business-account roles.',diff:'',url:'https://example.com/company-update',at:new Date().toISOString()};
 const content={version:1,locale:'en-US',window_start:new Date().toISOString(),considered_events:2,insights:[{headline:'Possible business-market focus (browser fixture)',interpretation:'Related changes may suggest greater focus on business customers.',relevance:'Investigate overlap with the workspace company’s business furnishing offer.',next_step:'Compare delivery terms and design services for business buyers.',confidence:'moderate',kind:'pattern',evidence:[evidence,{...evidence,id:'second',url:'https://example.com/business'}]}]};
 const handler=async route=>{
  if(route.request().method()==='POST'){
   posts++;
   if(mode==='error'){await route.fulfill({status:503,json:{code:'generation',error:'Internal private backend failure'}});return;}
   row={workspace_id:'fixture',content,generated_at:new Date().toISOString(),status:'ready',input_fingerprint:'fixture',last_attempt_at:null,lease_until:null};
   await route.fulfill({json:{row}});return;
  }
  await route.fulfill({json:{row,eligible_events:2,stale:false,can_generate:true}});
 };
 await page.route('**/api/workspaces/*/brief**',handler);
 try{
  await page.reload();await page.setViewportSize({width:1440,height:1000});
  const panel=page.getByRole('region',{name:'Market brief',exact:true});
  await panel.getByRole('button',{name:'Generate brief',exact:true}).waitFor();
  assert(posts===0,'Viewing the dashboard must not generate or spend credits');
  await panel.getByRole('button',{name:'Generate brief',exact:true}).click();
  await panel.getByRole('heading',{name:'Possible business-market focus (browser fixture)',exact:true}).waitFor();
  assert(posts===1,'One generation click must make exactly one request');
  assert(await page.getByRole('dialog').count()===0,'Generation must not open a confirmation popup');
  await panel.getByText('Observed changes (2)',{exact:true}).click();
  const links=panel.getByRole('link',{name:'Business account team expands (browser fixture)',exact:false});
  assert(await links.count()===2,'Every observed change needs its actual source link');
  assert(await links.first().getAttribute('href')==='https://example.com/company-update','Source URL must be preserved');
  await page.screenshot({path:'output/playwright/market-brief-desktop.png',animations:'disabled'});
  mode='error';await panel.getByRole('button',{name:'Refresh brief',exact:true}).click();
  await panel.getByText('The update couldn’t finish. Your saved insights are still available.',{exact:true}).waitFor();
  assert(await panel.getByRole('heading',{name:'Possible business-market focus (browser fixture)',exact:true}).isVisible(),'A failed refresh must retain the good brief');
  assert(!await page.getByText('Internal private backend failure',{exact:true}).count(),'Internal diagnostics must stay out of the customer UI');
  await page.setViewportSize({width:390,height:844});
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Brief must not cause mobile horizontal overflow');
  await page.screenshot({path:'output/playwright/market-brief-mobile.png',animations:'disabled'});
  await page.evaluate(()=>document.documentElement.setAttribute('data-market-brief-test','passed'));
 }finally{await page.unroute('**/api/workspaces/*/brief**',handler);}
}
