// Playwright CLI run-code function. All paid actions below are intercepted browser fixtures.
async (page) => {
  const assert = (value, message) => { if (!value) throw new Error(message); };
  const requests = [];
  let mode = 'success';
  let release;
  const profile = () => ({version:1, source_url:'https://example.com/', captured_at:new Date().toISOString(), locale:'en-US', positioning:{text:'Sample positioning (browser fixture)',quote:'A sourced sample positioning passage.'},target_customers:[],capabilities:[{text:'Document extraction (browser fixture)',quote:'Extract structured document data.'}]});
  await page.route('**/rest/v1/battlecards?*',async route => {
    const response=await route.fetch(); const rows=await response.json();
    await route.fulfill({response,json:rows.map(row=>({...row,comparison_profile:null}))});
  });
  await page.route('**/api/workspaces/*/comparison',async route=>{
    const body=route.request().postDataJSON(); requests.push(body);
    if(mode==='hold') await new Promise(resolve=>{release=resolve;});
    const p=profile(); p.locale=body.locale;
    if(body.action==='audience') p.audience_analysis={generated_at:new Date().toISOString(),basis_captured_at:p.captured_at,segments:[{label:'Likely research teams (browser fixture)',reasoning:'The product extracts documents for research.',evidence:[p.positioning]}]};
    await route.fulfill({status:mode==='failure'?503:200,json:mode==='failure'?{error:'Internal SQL error: private diagnostic details',stopQueue:true}:{profile:p}});
  });
  const idle = () => page.waitForFunction(()=>![...document.querySelectorAll('button')].some(button=>button.textContent?.startsWith('Updating ')));
  try {
    await page.reload(); await page.setViewportSize({width:1440,height:1000});
    const first=page.getByRole('button',{name:/^Research .+ profile$/}).first(); await first.waitFor();
    const name=(await first.getAttribute('aria-label')).replace(/^Research /,'').replace(/ profile$/,'');
    const count=await page.locator('[aria-label="Competitor profiles"] article').count();
    assert(requests.length===0,'Viewing must never spend credits');
    await first.click(); await idle();
    assert(await page.getByRole('dialog').count()===0,'Research must start without a confirmation popup');
    assert(requests.length===1,'One company click should make one research request');
    assert(requests[0].locale===await page.evaluate(()=>navigator.languages[0]),'Browser language must reach research');
    await page.getByText('Sample positioning (browser fixture)',{exact:true}).first().waitFor();
    const firstCard=page.getByRole('article',{name:`${name} profile`,exact:true});
    await firstCard.locator('summary').filter({hasText:'Evidence (1)'}).first().click();
    await firstCard.getByRole('link',{name:'Open source page',exact:false}).first().waitFor();
    await page.getByRole('button',{name:'Audience',exact:true}).click();
    await page.getByRole('button',{name:`Estimate ${name} audience`,exact:true}).click(); await idle();
    await page.getByText('Likely research teams (browser fixture)',{exact:true}).waitFor();
    await page.getByText('AI estimate',{exact:true}).waitFor();
    await firstCard.getByText('Why this audience?',{exact:true}).click();
    await firstCard.getByText('The product extracts documents for research.',{exact:true}).first().waitFor();
    assert(requests.at(-1).action==='audience','Audience enrichment must be a separate action');
    await page.getByRole('navigation',{name:'Competitors'}).getByRole('button',{name:'All changes',exact:false}).click();
    await page.getByRole('button',{name:'Competitor overview',exact:true}).click();
    await page.getByText('Sample positioning (browser fixture)',{exact:true}).first().waitFor();
    mode='failure'; await page.getByRole('button',{name:`Refresh ${name} profile`,exact:true}).click(); await idle();
    await page.getByText("Last update couldn't finish. Your saved research is still shown.",{exact:true}).waitFor();
    assert(!await page.getByText('Internal SQL error:',{exact:false}).count(),'Private technical errors must never be displayed');
    assert(await page.getByText('Sample positioning (browser fixture)',{exact:true}).first().isVisible(),'Refresh failure must retain saved facts');
    mode='success'; await page.getByRole('button',{name:/^Research \d+ companies$/}).click(); await idle();
    assert(await page.locator('[aria-label="Competitor profiles"] article > div > section > ul > li').filter({hasText:'Sample positioning (browser fixture)'}).count()===count,'Bulk research should fill every card');
    const before=requests.length; mode='hold';
    await page.getByRole('button',{name:'Refresh research',exact:true}).click();
    await page.getByRole('button',{name:'Stop after this company',exact:true}).click();
    assert(typeof release==='function','The held request must be active'); release(); await idle();
    assert(requests.length===before+1,'Stop must prevent additional companies from starting');
    await page.screenshot({path:'output/playwright/overview-desktop-test.png'});
    await page.setViewportSize({width:390,height:844});
    for(const category of ['Audience','Offering','Pricing','Signals','Overview']) {
      await page.getByRole('button',{name:category,exact:true}).click();
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${category} must fit mobile without sideways scrolling`);
    }
    assert(await page.locator('table').count()===0,'Overview must not use an oversized table');
    await page.screenshot({path:'output/playwright/overview-mobile-test.png'});
    await page.evaluate(()=>document.documentElement.setAttribute('data-comparison-test','passed'));
  } finally {await page.unroute('**/api/workspaces/*/comparison');await page.unroute('**/rest/v1/battlecards?*');}
}
