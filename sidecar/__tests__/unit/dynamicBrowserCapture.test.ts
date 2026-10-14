import {describe,it,expect} from 'vitest';import {chromium} from 'playwright';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {captureProtectedPage} from '../../src/dynamic/browser/capture.js';
describe('Protected browser pixel capture',()=>{
 it('masks known text/input/password/iframe surfaces without modifying app values',async()=>{
  const browser=await chromium.launch({headless:true});const root=fs.mkdtempSync(path.join(os.tmpdir(),'centinel-privacy-'));
  try{const page=await browser.newPage();await page.setContent('<p>known-seed-918</p><input value="known-seed-918"><input type="password" value="unknown-password"><iframe srcdoc="<p>known-seed-918</p>"></iframe>');
   const boxes=await Promise.all([page.locator('p').boundingBox(),page.locator('input').first().boundingBox(),page.locator('input').nth(1).boundingBox()]);
   const result=await captureProtectedPage(page,path.join(root,'safe.png'),{secrets:['known-seed-918']});expect(result.masked).toBe(true);
   const pixels=await page.evaluate(async({encoded,boxes})=>{const image=new Image();image.src='data:image/png;base64,'+encoded;await image.decode();const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;const ctx=canvas.getContext('2d')!;ctx.drawImage(image,0,0);return boxes.map(box=>{if(!box)throw Error('Missing mask region');return [...ctx.getImageData(Math.floor(box.x+box.width/2),Math.floor(box.y+box.height/2),1,1).data];});},{encoded:fs.readFileSync(path.join(root,'safe.png')).toString('base64'),boxes});
   for(const pixel of pixels)expect(pixel).toEqual([17,24,39,255]);expect(fs.statSync(path.join(root,'safe.png')).size).toBeGreaterThan(100);expect(await page.locator('input').first().inputValue()).toBe('known-seed-918');expect(await page.frameLocator('iframe').locator('p').innerText()).toBe('known-seed-918');
  }finally{await browser.close();fs.rmSync(root,{recursive:true,force:true});}
 });
 it('blocks opaque visual surfaces and cancelled capture before retaining pixels',async()=>{
  const browser=await chromium.launch({headless:true});const root=fs.mkdtempSync(path.join(os.tmpdir(),'centinel-privacy-'));
  try{const page=await browser.newPage();await page.setContent('<canvas width="200" height="100"></canvas>');const file=path.join(root,'unsafe.png');await expect(captureProtectedPage(page,file,{secrets:['known-secret']})).rejects.toThrow('cannot be safely captured');expect(fs.existsSync(file)).toBe(false);const controller=new AbortController();controller.abort();await expect(captureProtectedPage(page,file,{signal:controller.signal})).rejects.toThrow('cancelled');expect(fs.existsSync(file)).toBe(false);
  }finally{await browser.close();fs.rmSync(root,{recursive:true,force:true});}
 });
});
