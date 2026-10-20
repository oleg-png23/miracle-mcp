/* Shared browser-test actions for the responsive workspace navigation. */
async function openSection(page,key) {
  const menu=page.locator('#sectionMenu');
  const link=page.locator('.navigation a[href="#'+key+'"]');
  if(await menu.isVisible()) await menu.locator('a[href="#'+key+'"]').click();
  else if(await link.isVisible()) await link.click();
  else {await page.locator('#openSections').click();await menu.locator('a[href="#'+key+'"]').click();}
  await page.locator('[data-workspace-screen="'+key+'"]').waitFor({state:'visible'});
}
async function selectMaterial(page,mode) {
  await openSection(page,'appearance');await page.locator('[data-material="'+mode+'"]').click();await openSection(page,'overview');
  if(mode==='clear'||mode==='beautify')await page.waitForFunction(()=>document.querySelector('.hero-card').dataset.glassActive==='true');
}
module.exports={openSection,selectMaterial};
