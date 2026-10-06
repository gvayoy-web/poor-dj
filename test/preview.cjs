// Representative UI preview with public album artwork; no Spotify account data.
const {chromium}=require('playwright'),{pathToFileURL}=require('node:url'),path=require('node:path');
(async()=>{const browser=await chromium.launch({headless:true,channel:'msedge'});try{
 const page=await browser.newPage({viewport:{width:760,height:1500},deviceScaleFactor:1.5});
 await page.goto(pathToFileURL(path.join(__dirname,'fixture.html')).href+'?fresh');
 await page.evaluate(()=>{const e=PoorDJ.engine,cover='https://i.scdn.co/image/ab67616d0000b27390af5246adcaa93acb721c17';e.current={...e.current,name:'L a k e n o s h i',image:cover};e.anchor=e.current;e.prepareChoices();e.deck.pair[0]={...e.deck.pair[0],name:'KOKO',image:cover};e.deck.pair[1]={...e.deck.pair[1],name:'UNA NOTi',image:cover};e.status='Elige una canción para comenzar. Tú decides la dirección.';PoorDJ.open();e.onUpdate();document.querySelector('#pd-command').blur();});
 await page.locator('.pd-choicecover img').first().waitFor({state:'visible'});await page.waitForFunction(()=>[...document.images].every(i=>i.complete));
 await page.locator('.pd').screenshot({path:path.join(__dirname,'../preview.png'),animations:'disabled'});
 console.log('Representative panel preview saved.');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
