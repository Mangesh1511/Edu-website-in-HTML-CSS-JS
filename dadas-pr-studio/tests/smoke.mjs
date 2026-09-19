import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';

const candidates=[
  process.env.CHROME_BIN,
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser'
].filter(Boolean);
const executablePath=candidates.find(p=>fs.existsSync(p));
if(!executablePath)throw new Error('Chrome executable not found');

const browser=await chromium.launch({
  headless:true,
  executablePath,
  args:['--no-sandbox','--autoplay-policy=no-user-gesture-required']
});
const page=await browser.newPage({viewport:{width:412,height:915},deviceScaleFactor:2});
const pageErrors=[];
page.on('pageerror',e=>pageErrors.push(e.message));
page.on('console',msg=>{if(msg.type()==='error')pageErrors.push('console: '+msg.text())});

const base='http://127.0.0.1:4173/dadas-pr-studio/?smoke=1';
await page.goto(base,{waitUntil:'networkidle'});
await page.fill('#pin','2580');
await page.click('button.primary');
await page.waitForSelector('#studio.page.active');

const extensionDetection=await page.evaluate(()=>detectFileType({type:'',name:'phone-recording.MP4'}));
if(extensionDetection!=='video')throw new Error('Blank-MIME MP4 extension detection failed');

await page.fill('#topic','कार्यक्रमाची माहिती');
await page.fill('#place','धाराशिव');
await page.fill('#facts','कार्यक्रमाची पडताळलेली माहिती.');

const sample=path.resolve('dadas-pr-studio/tests/sample.mp4');
await page.setInputFiles('#mediaInput',sample);
await page.waitForFunction(()=>{
  const t=document.querySelector('#mediaHint')?.textContent||'';
  return /usable media selected/.test(t);
},{timeout:25000});
if(await page.locator('.mcard').count()!==1)throw new Error('Selected video card did not appear');

await page.waitForFunction(()=>/Analysis complete/.test(document.querySelector('#analysisStatus')?.textContent||''),{timeout:25000});

await page.waitForFunction(()=>window.LocalAI && window.LocalAI.version,{timeout:20000});
const unicodeScore=await page.evaluate(()=>window.LocalAI.relevance('पाणी काम कार्यक्रम','पाणी काम कार्यक्रम ठिकाण'));
if(unicodeScore<=0)throw new Error('Unicode work relevance scoring failed');

await page.click('.focusbtn');
if(!(await page.locator('.focusbtn').getAttribute('class')).includes('on'))throw new Error('Primary subject marking failed');

await page.click('button[onclick="runLocalAI()"]');
await page.waitForFunction(()=>{
  const t=document.querySelector('#analysisStatus')?.textContent||'';
  return /Local AI scan complete|AI scan error/.test(t);
},{timeout:150000});
const aiStatus=await page.locator('#analysisStatus').textContent();
if(!/Local AI scan complete/.test(aiStatus||''))throw new Error('Local AI model scan failed: '+aiStatus);

await page.click('button.style:nth-child(4)');
if(!(await page.locator('button.style:nth-child(4)').getAttribute('class')).includes('sel'))throw new Error('Style selection failed');

await page.click('.tabs button:nth-child(2)');
await page.waitForSelector('#designs.page.active');
await page.click('#designs button.primary');
await page.waitForSelector('#po a',{timeout:10000});

await page.click('.tabs button:nth-child(3)');
await page.waitForSelector('#calendar.page.active');
if(await page.locator('.festival').count()<5)throw new Error('Calendar did not render');

await page.click('.tabs button:nth-child(1)');
await page.check('input[name="dur"][value="15"]');
await page.click('button[onclick="renderReel()"]');
await page.waitForFunction(()=>document.querySelector('#output a')!==null,{timeout:35000});
const renderStatus=await page.locator('#rs').textContent();
if(!/Render complete/.test(renderStatus||''))throw new Error('Reel render did not complete: '+renderStatus);

await page.click('button[onclick="resetMedia()"]');
if(await page.locator('.mcard').count()!==0)throw new Error('Reset media failed');

const sw=await page.evaluate(async()=>{
  if(!('serviceWorker' in navigator))return 'unsupported';
  const reg=await navigator.serviceWorker.ready;
  return reg.active?.state||'none';
});
if(sw!=='activated'&&sw!=='unsupported')throw new Error('Service worker not activated: '+sw);

if(pageErrors.length)throw new Error('Browser errors: '+pageErrors.join(' | '));

console.log('DADAS_PR_SMOKE_OK');
await browser.close();
