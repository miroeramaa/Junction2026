// Read-only navigation, deep links and responsive containment against a populated workspace.
async page=>{
 const assert=(ok,message)=>{if(!ok)throw new Error(message);};
 const base=new URL(page.url());base.search='?view=matrix';
 await page.setViewportSize({width:1440,height:1000});await page.goto(base.href);
 const nav=page.getByRole('navigation',{name:'Competitors',exact:true});
 const main=page.getByRole('main');
 await main.getByRole('heading',{name:'Competitor overview',exact:true}).waitFor();
 await main.getByRole('article').first().waitFor();
 assert(!await main.getByRole('region',{name:'Market brief',exact:true}).count(),'Overview must not stack the full brief');
 assert(!await main.getByRole('searchbox').count(),'Overview must not stack feed search');
 await page.screenshot({path:'output/playwright/navigation-overview-desktop.png'});
 await nav.getByRole('button',{name:'All changes',exact:false}).click();
 await main.getByRole('searchbox',{name:'Search change history'}).waitFor();
 assert(!await main.locator('[aria-label="Competitor profiles"]').count(),'Changes must not duplicate company cards');
 assert(!await main.getByRole('region',{name:'Market brief',exact:true}).count(),'Changes must not stack the full brief');
 const diff=main.locator('details').filter({has:page.getByText('View page changes',{exact:true})}).first();
 if(await diff.count()){assert(await diff.getAttribute('open')===null,'Raw diffs must start collapsed');await diff.locator('summary').click();assert(await diff.getAttribute('open')!==null,'Evidence must remain available on demand');await diff.locator('summary').click();}
 await page.screenshot({path:'output/playwright/navigation-changes-desktop.png'});
 await nav.getByRole('button',{name:'Market brief',exact:true}).click();
 await main.getByRole('heading',{name:'Market brief',exact:true}).waitFor();
 await page.setViewportSize({width:1920,height:1080});
 const area=await main.boundingBox(),brief=await main.getByRole('region',{name:'Market brief',exact:true}).boundingBox();
 assert(Math.abs((area.x+area.width/2)-(brief.x+brief.width/2))<=2,'Brief must be centered within the content area');
 await page.screenshot({path:'output/playwright/brief-centered-desktop.png'});
 await page.setViewportSize({width:1440,height:1000});
 assert(!await main.getByRole('searchbox').count(),'Brief must focus on interpretation');
 await nav.getByRole('button',{name:'Manage watchlist',exact:true}).click();
 await main.getByRole('button',{name:'Email digest',exact:true}).click();
 await main.getByRole('heading',{name:'Email digest',exact:true}).waitFor();
 await page.reload();await main.getByRole('heading',{name:'Email digest',exact:true}).waitFor();
 assert(!await main.getByText('Add competitor',{exact:true}).count(),'Digest deep link must retain the isolated settings view');
 await main.getByRole('button',{name:'Competitors & sources',exact:true}).click();
 await main.getByText('Workspace options',{exact:true}).click();
 await main.getByRole('button',{name:'Delete workspace',exact:true}).click();
 await main.getByRole('button',{name:'Permanently delete workspace',exact:true}).waitFor();
 await main.getByRole('button',{name:'Keep workspace',exact:true}).click();
 assert(!await main.getByRole('button',{name:'Permanently delete workspace',exact:true}).count(),'Cancellation must hide the destructive action');
 await nav.getByRole('button',{name:'Competitor overview',exact:true}).click();
 await main.getByRole('button',{name:'Explore company →',exact:true}).first().click();
 const company=main.getByRole('group',{name:'Company view',exact:true});
 await company.getByRole('button',{name:'Pricing',exact:true}).click();
 await main.getByRole('heading',{name:'Pricing now',exact:true}).waitFor();
 assert(!await main.getByRole('heading',{name:'Products & services',exact:true}).count(),'Pricing must not stack research facts');
 await page.reload();await main.getByRole('heading',{name:'Pricing now',exact:true}).waitFor();
 await company.getByRole('button',{name:'Activity',exact:true}).click();
 await main.getByRole('group',{name:'Company changes shown',exact:true}).waitFor();
 await page.screenshot({path:'output/playwright/navigation-profile-desktop.png'});
 await page.setViewportSize({width:390,height:844});
 for(const label of ['Competitor overview','All changes','Market brief','Manage watchlist']){
  const button=nav.getByRole('button',{name:label,exact:label!=='All changes'});await button.click();
  assert(await button.isVisible(),`${label} navigation must be visible on phones`);
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${label} must fit phone width`);
  await page.screenshot({path:`output/playwright/navigation-${label.toLowerCase().replaceAll(' ','-')}-mobile.png`});
 }
 const selector=nav.getByLabel('Open competitor');
 const value=await selector.locator('option').nth(1).getAttribute('value');await selector.selectOption(value);
 await main.getByRole('group',{name:'Company view',exact:true}).waitFor();
 for(const tab of ['Overview','Pricing','Activity']){
  await main.getByRole('group',{name:'Company view',exact:true}).getByRole('button',{name:tab,exact:true}).click();
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`Company ${tab} must fit phone width`);
 }
 await page.goto(base.href);return {result:'passed',views:4,profileTabs:3,phoneWidth:390};
}
