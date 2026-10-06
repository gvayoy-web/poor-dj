// Current UI with demo data; no Spotify account or remote artwork.
const {chromium}=require('playwright'),{pathToFileURL}=require('node:url'),path=require('node:path');
(async()=>{const browser=await chromium.launch({headless:true,channel:'msedge'});try{
 const page=await browser.newPage({viewport:{width:760,height:1500},deviceScaleFactor:1.5});
 await page.goto(pathToFileURL(path.join(__dirname,'fixture.html')).href+'?fresh');
 await page.evaluate(()=>{
  const e=PoorDJ.engine;
  e.current={...e.current,name:'Canción de referencia',artists:[{name:'Artista de demostración',uri:'spotify:artist:0000000000000000000001'}],image:''};
  e.anchor=e.current;e.prepareChoices();
  e.deck.pair[0]={...e.deck.pair[0],name:'Tu próxima canción',image:'',artists:e.current.artists,evidence:['playlist']};
  e.deck.pair[1]={...e.deck.pair[1],name:'Otra de tus favoritas',image:'',artists:e.current.artists,evidence:['megusta']};
  e.status='Elige una canción para comenzar. Tú decides la dirección.';
  PoorDJ.open();e.onUpdate();document.querySelector('#pd-command').blur();
 });
 await page.locator('[data-choice]').first().waitFor({state:'visible'});
 await page.locator('.pd').screenshot({path:path.join(__dirname,'../preview.png'),animations:'disabled'});
 await page.evaluate(()=>{
  const e=PoorDJ.engine;e.choosing=false;
  e.artistMenu={name:'Artista de demostración',uri:'spotify:artist:0000000000000000000001'};
  document.querySelector('#pd-command').value='Artista de demostración';e.onUpdate();
 });
 await page.getByRole('button',{name:'Aleatorio',exact:true}).waitFor({state:'visible'});
 await page.locator('.pd').screenshot({path:path.join(__dirname,'../assets/artist-modes.png'),animations:'disabled'});
 console.log('Current panel and artist modes saved with demo data.');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
