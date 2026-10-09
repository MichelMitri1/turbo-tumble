import puppeteer from 'puppeteer-core';
import assert from 'node:assert/strict';
const base=process.argv[2]||'http://127.0.0.1:5173';
const browser=await puppeteer.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--enable-gpu','--ignore-gpu-blocklist','--use-angle=metal']});
try {
 const page=await browser.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 for(const path of ['/velora','/velora/','/velora/?test','/velora/index.html']) {
  await page.goto(base+path,{waitUntil:'networkidle0'});
  await page.waitForFunction(()=>document.querySelector('#start')?.disabled===false);
  assert.equal(await page.title(),'Velora · After Hours');
  console.log('Route OK:',path);
 }
 await page.goto(base,{waitUntil:'networkidle0'});
 await Promise.all([page.waitForNavigation({waitUntil:'networkidle0'}),page.click('a[href="/velora/index.html"]')]);
 await page.waitForFunction(()=>document.querySelector('#start')?.disabled===false);
 await page.click('#start');
 await page.waitForFunction(()=>document.querySelector('#menu').style.display==='none');
 await page.keyboard.press('KeyF');
 await page.waitForFunction(()=>document.querySelector('#vehicle').textContent.includes('VESPER'));
 assert.deepEqual(errors,[]);
 console.log('PASS: hub → Velora → Enter Velora → enter vehicle; no runtime errors.');
} finally {await browser.close();}
