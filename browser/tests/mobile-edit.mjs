import { createRequire } from 'node:module';
import { PDFDocument } from 'pdf-lib';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
const {chromium}=require('C:/Users/lil_c/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH || 'C:/Users/lil_c/AppData/Local/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-win64/chrome-headless-shell.exe'});
const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:1});
const page=await context.newPage(); const errors=[]; page.on('pageerror',e=>errors.push(e.message));
try {
 const pdf=await PDFDocument.create(); pdf.addPage([595,842]);
 await page.goto(process.env.FOLIO_URL || 'http://127.0.0.1:4331/app/');
 await page.getByTestId('open-input').setInputFiles({name:'mobile.pdf',mimeType:'application/pdf',buffer:Buffer.from(await pdf.save())});
 await page.waitForFunction(()=>document.querySelector('.paper canvas')?.width>0);
 assert.equal(await page.locator('.pages').count(),0);
 for(const width of [360,390]) {
  await page.setViewportSize({width,height:844});
  for(const name of ['View','Add text','Draw / sign','Highlight']) {
   const b=await page.getByRole('button',{name,exact:true}).boundingBox();
   assert.ok(b && b.x>=0 && b.x+b.width<=width && b.height>=44, name+' visible touch target');
  }
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 }
 await page.getByRole('button',{name:'Add text',exact:true}).tap();
 await page.getByLabel('Text to add').fill('Mobile edit works');
 assert.equal(await page.locator('.editing-hint').textContent(),'Tap the page to place your text.');
 const paper=await page.locator('.annotation-overlay').boundingBox();
 await page.touchscreen.tap(paper.x+35,paper.y+55);
 await page.getByRole('button',{name:'Done',exact:true}).tap();
 await page.waitForFunction(()=>document.querySelector('.paper canvas')?.width>0);
 await page.getByRole('button',{name:'More tools',exact:true}).tap();
 await page.getByRole('button',{name:'Search document',exact:true}).tap();
 await page.getByLabel('Find text',{exact:true}).fill('Mobile edit works');
 await page.getByRole('button',{name:'Search',exact:true}).tap();
 await page.locator('.search-result').waitFor();
 await page.getByRole('button',{name:'Close panel',exact:true}).tap();
 const download=page.waitForEvent('download');
 await page.getByRole('button',{name:'Download PDF',exact:true}).tap();
 assert.ok((await download).suggestedFilename().endsWith('.pdf'));
 await page.getByRole('button',{name:'Highlight',exact:true}).tap();
 assert.ok(await page.locator('.editing-hint').isVisible());
 await page.screenshot({path:'tests/mobile-edit.png'});
 await page.getByLabel('Appearance').selectOption('dark');
 await page.screenshot({path:'tests/mobile-edit-dark.png'});
 assert.deepEqual(errors,[]);
 console.log('PASS: touch editing at 360/390px, visible 44px tools, text placement verified through PDF search, Save download, hints and no browser errors');
} finally {await browser.close();}
