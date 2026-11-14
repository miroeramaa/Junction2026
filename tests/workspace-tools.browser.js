// Playwright CLI: open a populated watching workspace before running this file.
// All writes are intercepted; no preferences, feedback or monitor schedules are changed.
async page => {
 const assert = (ok, message) => { if (!ok) throw new Error(message); };
 let loadError = true, writeError = false, saves = 0, schedules = 0, feedback = 0;
 let settings = {email:'', digest_enabled:false, signals:['pricing','launches','news','hiring','positioning']};
 const alertHandler = async route => {
  if (route.request().method() === 'GET') return route.fulfill({status:loadError?503:200,json:loadError?{error:'private database diagnostic'}:settings});
  saves++;
  if (writeError) return route.fulfill({status:500,json:{error:'private database diagnostic'}});
  settings = route.request().postDataJSON();
  await route.fulfill({json:settings});
 };
 const scheduleHandler = async route => {
  schedules++;
  assert(route.request().postDataJSON().schedule.frequency === 2,'Chosen frequency must reach the API');
  await route.fulfill({status:writeError?503:200,json:{ok:!writeError,error:writeError?'private upstream diagnostic':undefined}});
 };
 const feedbackHandler = async route => {
  feedback++;
  await route.fulfill({status:writeError?503:200,json:{ok:!writeError}});
 };
 await page.route('**/api/workspaces/*/alerts',alertHandler);
 await page.route('**/api/workspaces/*/monitors/schedule',scheduleHandler);
 await page.route('**/api/workspaces/*/events/*/feedback',feedbackHandler);
 try {
  const url=new URL(page.url());url.search='?view=manage&settings=digest';await page.goto(url.toString()); await page.setViewportSize({width:1440,height:1000});
  const tools = page.getByRole('main');
  await tools.getByText('Email preferences aren’t available right now.',{exact:true}).waitFor();
  assert(!await tools.getByRole('button',{name:'Save preferences'}).count(),'Failed load must not allow overwriting settings');
  loadError=false; await tools.getByRole('button',{name:'Try again',exact:true}).click();
  await tools.getByLabel('Send to',{exact:true}).fill('person@example.com');
  await tools.getByRole('switch').focus(); await page.keyboard.press('Space');
  await tools.getByLabel('Pricing',{exact:true}).focus(); await page.keyboard.press('Space');
  writeError=true;await tools.getByRole('button',{name:'Save preferences'}).click();
  await tools.getByText('Couldn’t save your preferences. Please try again.',{exact:true}).waitFor();
  assert(await tools.getByLabel('Send to',{exact:true}).inputValue()==='person@example.com','Failed save must keep the draft');
  writeError=false;await tools.getByRole('button',{name:'Save preferences'}).click();
  await tools.getByText('Preferences saved.',{exact:true}).waitFor();
  assert(saves===2 && settings.digest_enabled && !settings.signals.includes('pricing'),'Save must preserve chosen settings');
  await page.screenshot({path:'output/playwright/tools-digest-desktop.png'});
  await page.getByRole('button',{name:'Manage watchlist',exact:true}).click();await page.getByRole('button',{name:'Competitors & sources',exact:true}).click();await page.getByText('Monitoring frequency',{exact:true}).click();
  assert(!await tools.getByRole('heading',{name:'Your daily catch-up'}).isVisible(),'Only one settings panel should be open');
  const options=tools.getByLabel('Source',{exact:true}).locator('option');
  const selected=await options.nth(1).getAttribute('value');
  assert(selected,'Fixture workspace needs at least one monitor');
  await tools.getByLabel('Source',{exact:true}).selectOption(selected);
  await tools.getByLabel('Check frequency',{exact:true}).selectOption('2h');
  writeError=true;await tools.getByRole('button',{name:'Apply frequency'}).click();
  await tools.getByText('Couldn’t update this source. Please try again.',{exact:true}).waitFor();
  writeError=false;await tools.getByRole('button',{name:'Apply frequency'}).click();
  await tools.getByText('Monitoring frequency updated.',{exact:true}).waitFor();
  assert(schedules===2,'Schedule retries must be explicit');
  await page.screenshot({path:'output/playwright/tools-monitoring-desktop.png'});
  await page.getByRole('navigation',{name:'Competitors',exact:true}).getByRole('button',{name:'All changes',exact:true}).click();await page.getByRole('group',{name:'Changes shown',exact:true}).getByRole('button',{name:'All changes',exact:true}).click();
  const search=tools.getByRole('searchbox',{name:'Search change history'});
  await search.fill('Nitori');
  const result=tools.getByRole('region',{name:'Changes',exact:true}).getByRole('listitem').filter({has:page.getByRole('button',{name:'Hide this update',exact:true})}).first(); await result.waitFor();
  writeError=true;await result.getByRole('button',{name:'Hide this update',exact:true}).click();
  await result.getByText('Couldn’t save your preference. Try again.',{exact:true}).waitFor();
  writeError=false;await result.getByRole('button',{name:'Hide this update',exact:true}).click();
  await tools.getByRole('region',{name:'Changes',exact:true}).getByRole('button',{name:'Keep this update',exact:true}).first().waitFor();
  assert(feedback===2,'Feedback must be sent once per action');
  await search.fill('no-such-competitor-123'); await tools.getByText('No matching changes',{exact:true}).waitFor();
  await tools.getByRole('button',{name:'Clear search',exact:true}).first().click();
  assert(await search.inputValue()==='','Clear must reset search');
  assert(await search.evaluate(el=>el===document.activeElement),'Clear must return keyboard focus to search');
  await search.fill('Nitori'); await page.setViewportSize({width:390,height:844});
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Search must fit a phone viewport');
  await page.screenshot({path:'output/playwright/tools-search-mobile.png'});
  await page.getByRole('button',{name:'Manage watchlist',exact:true}).click();await tools.getByRole('button',{name:'Email digest',exact:true}).click();
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Digest must fit a phone viewport');
  await page.screenshot({path:'output/playwright/tools-digest-mobile.png'});
  await tools.getByRole('button',{name:'Competitors & sources',exact:true}).click();await tools.getByText('Monitoring frequency',{exact:true}).click();
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Monitoring must fit a phone viewport');
  await page.screenshot({path:'output/playwright/tools-monitoring-mobile.png'});
  assert(!await tools.getByText(/private .* diagnostic/).count(),'Internal errors must stay out of the UI');
  return {result:'passed',saves,schedules,feedback};
 } finally {
  await page.unroute('**/api/workspaces/*/alerts',alertHandler);
  await page.unroute('**/api/workspaces/*/monitors/schedule',scheduleHandler);
  await page.unroute('**/api/workspaces/*/events/*/feedback',feedbackHandler);
 }
}
