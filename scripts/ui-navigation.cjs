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
  if(mode==='clear'||mode==='liquid')await page.waitForFunction(mode=>{
    const hero=document.querySelector('.hero-card'),id=hero.style.getPropertyValue('--glass-filter').match(/#([^)]*)/)?.[1];
    return hero.dataset.glassActive==='true'&&id&&document.getElementById(id)?.querySelectorAll('feDisplacementMap').length===(mode==='liquid'?1:3);
  },mode);
}
module.exports={openSection,selectMaterial};
