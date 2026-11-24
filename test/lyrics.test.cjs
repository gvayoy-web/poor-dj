const {test}=require('node:test'),assert=require('node:assert/strict');
const {parseLrc,lyricsFromSpotify,lyricsFromLrclib,activeLine,LyricsProvider,settingsOf,isGap}=require('../poor-mans-dj.js');
const track={uri:'spotify:track:abc',name:'Canción',artists:[{name:'A'}],duration:200000};
test('LRC admite varias marcas, centésimas y ordena',()=>{
  const l=parseLrc('[00:12.50]Hola\n[00:05.00][01:00.123]Coro\n[ar:x]\n[00:20]');
  assert.deepEqual(l.map(x=>[x.t,x.text]),[[5000,'Coro'],[12500,'Hola'],[20000,''],[60123,'Coro']]);
});
test('letra de Spotify sincronizada y sin sincronizar',()=>{
  const s=lyricsFromSpotify({lyrics:{syncType:'LINE_SYNCED',language:'es',lines:[{startTimeMs:'2000',words:'b'},{startTimeMs:'1000',words:'a'},{startTimeMs:'x',words:'mala'}]}});
  assert.equal(s.synced,true);assert.deepEqual(s.lines.map(x=>x.text),['a','b']);
  const u=lyricsFromSpotify({lyrics:{syncType:'UNSYNCED',lines:[{startTimeMs:'0',words:'uno'},{words:'dos'}]}});
  assert.equal(u.synced,false);assert.equal(u.lines[0].t,null);
  assert.equal(lyricsFromSpotify({lyrics:{syncType:'LINE_SYNCED',lines:[{startTimeMs:'0',words:'♪'}]}}),null);
  assert.equal(lyricsFromSpotify(null),null);
});
test('LRCLIB: instrumental, sincronizada y texto plano',()=>{
  assert.equal(lyricsFromLrclib({instrumental:true}),null);
  assert.equal(lyricsFromLrclib({syncedLyrics:'[00:01.00]x'}).synced,true);
  const p=lyricsFromLrclib({plainLyrics:'a\n\nb'});assert.equal(p.synced,false);assert.equal(p.lines.length,3);
});
test('línea activa por búsqueda binaria',()=>{
  const lines=[{t:1000},{t:2000},{t:3000}];
  assert.equal(activeLine(lines,0),-1);assert.equal(activeLine(lines,1000),0);assert.equal(activeLine(lines,2999),1);assert.equal(activeLine(lines,99999),2);assert.equal(activeLine([],5),-1);
  assert.equal(isGap({text:'♪ ♪'}),true);assert.equal(isGap({text:'hola'}),false);
});
test('proveedor: caché, deduplicación y respaldo solo si se pide',async()=>{
  let spotify=0,external=0;
  const p=new LyricsProvider({spotify:async()=>{spotify++;return {lyrics:{syncType:'LINE_SYNCED',lines:[{startTimeMs:'0',words:'hola'}]}};},external:async()=>{external++;return null;}});
  const [a,b]=await Promise.all([p.get(track),p.get(track)]);
  assert.equal(a.state,'ready');assert.equal(a,b);await p.get(track);assert.equal(spotify,1);assert.equal(external,0);
});
test('proveedor: sin letra no consulta fuera salvo opt-in y recuerda la ausencia',async()=>{
  let external=0,saved;
  const miss=async()=>{const e=Error('404');e.status=404;throw e;};
  const p=new LyricsProvider({spotify:miss,external:async()=>{external++;return {syncedLyrics:'[00:01]x'};},persist:d=>saved=d});
  assert.equal((await p.get(track)).state,'none');assert.equal(external,0);assert.ok(Object.keys(saved).length);
  assert.equal((await p.get(track)).state,'none');
  assert.equal((await p.get(track,{fallback:true})).state,'ready');assert.equal(external,1);
});
test('proveedor: un fallo de red no se recuerda como ausencia',async()=>{
  let n=0;const p=new LyricsProvider({spotify:async()=>{n++;throw Error('timeout');}});
  assert.equal((await p.get(track)).state,'error');assert.equal((await p.get(track)).state,'error');assert.equal(n,2);
});
test('ajustes de letras se validan',()=>{
  const s=settingsOf({lyricsSize:'x',lyricsOffset:99999,lyrics:'si',lyricsExternal:1});
  assert.equal(s.lyricsSize,'m');assert.equal(s.lyricsOffset,3000);assert.equal(s.lyrics,true);assert.equal(s.lyricsExternal,false);
  assert.equal(settingsOf({}).lyricsExternal,false);
});
const {Narrator,commentary,intentOf}=require('../poor-mans-dj.js');
const speechHost=voices=>({speechSynthesis:{getVoices:()=>voices,addEventListener(){},removeEventListener(){},speak(){},cancel(){}},SpeechSynthesisUtterance:class{constructor(t){this.text=t;}}});
test('voz: ranking, automática solo local y elección explícita de una voz en línea',()=>{
  const a={name:'Microsoft Helena',lang:'es-ES',localService:true},b={name:'Microsoft Sabina',lang:'es-MX',localService:true},c={name:'Microsoft Dalia Online (Natural)',lang:'es-MX',localService:false},en={name:'Zira',lang:'en-US',localService:true};
  const n=new Narrator(speechHost([a,en,b,c]));
  assert.deepEqual(n.voices().map(v=>v.name),[c.name,b.name,a.name]);
  assert.equal(n.voice,b);n.prefer(c.name);assert.equal(n.voice,c);n.prefer('no existe');assert.equal(n.voice,b);n.prefer('');assert.equal(n.voice,b);
});
test('comentario «next» nombra canción y artista, y cita la procedencia si existe',()=>{
  const seed={name:'Yoko',artists:[{name:'Omar Courtz'}],evidence:'Tu playlist'};
  const t=commentary('next',seed,intentOf(),0);assert.match(t,/yoko/i);assert.match(t,/Omar Courtz/);assert.match(t,/tu playlist/);
  assert.doesNotMatch(commentary('next',{...seed,evidence:''},intentOf(),0),/undefined/);
  assert.ok(commentary('next',seed,intentOf(),0)!==commentary('next',seed,intentOf(),1));
});
test('ajuste de frecuencia del DJ se valida',()=>{assert.equal(settingsOf({talk:'x'}).talk,'few');assert.equal(settingsOf({talk:'often'}).talk,'often');assert.equal(settingsOf({voiceName:5}).voiceName,'');});
const {compatReport,Engine}=require('../poor-mans-dj.js');
test('informe de compatibilidad señala lo que no responde',()=>{
  const r=compatReport({api:{queue:true,play:true,audio:false,playlists:true,voice:true,lyrics:true},probes:{search:true,artists:false}});
  assert.equal(r.problems,2);assert.equal(r.rows.find(x=>x.name==='Búsqueda de artistas').ok,false);assert.equal(compatReport({api:{}}).rows.find(x=>x.name==='Búsqueda de canciones').ok,null);
  assert.match(compatReport({api:{spicy:true}}).rows.at(-1).detail,/Spicy/);
});
test('comentarios usan datos reales del historial local',()=>{
  const seed={name:'Yoko',artists:[{name:'A'}],evidence:'',plays:7,minutes:30};
  const all=new Set(Array.from({length:12},(_,i)=>commentary('next',seed,intentOf(),i)));
  assert.ok([...all].some(x=>/7 veces/.test(x)));assert.ok([...all].some(x=>/30 minutos/.test(x)));
  assert.ok(![...new Set(Array.from({length:12},(_,i)=>commentary('next',{...seed,plays:1,minutes:2},intentOf(),i)))].some(x=>/veces|minutos/.test(x)));
});
test('guardar sesión: crea una playlist con las canciones únicas y recuerda el resultado',async()=>{
  const uri=n=>'spotify:track:'+String(n).padStart(22,'0'),calls=[];let saved;
  const e=new Engine({queue:()=>({all:[],priority:[]}),save:d=>saved=d,createMix:async(a,m,ts)=>{calls.push([a,m,ts.length]);return {uri:'spotify:playlist:'+'x'.repeat(22),name:a.name,count:ts.length};}},{});
  e.notify=()=>{};await e.saveSession();assert.equal(calls.length,0);
  e.sessionList=[1,2,2,3].map(n=>({uri:uri(n),name:'t'+n,artists:[]}));await e.saveSession();
  assert.deepEqual([calls[0][1],calls[0][2]],['session',3]);assert.match(e.mixPlaylist.name,/^Sesión /);assert.equal(saved.mixPlaylist.count,3);
});
const {moodOf}=require('../poor-mans-dj.js');
test('ánimo: solo con tempo y tono medidos, sin inventar',()=>{
  assert.equal(moodOf({bpm:78,mode:0,loudness:-9}),'melancolica');assert.equal(moodOf({bpm:85,mode:1,loudness:-10}),'tranquila');
  assert.equal(moodOf({bpm:128,mode:1,loudness:-7}),'animada');assert.equal(moodOf({bpm:140,mode:0,loudness:-5}),'intensa');
  assert.equal(moodOf({bpm:110,mode:1}),null);assert.equal(moodOf(null),null);assert.equal(moodOf({bpm:null,mode:0}),null);assert.equal(moodOf({bpm:80,mode:null}),null);
});
test('comentarios inteligentes: ánimo, cambio de ambiente y género declarado',()=>{
  const base={name:'Yoko (feat. X)',artists:[{name:'Omar'}]};
  const sad=Array.from({length:8},(_,i)=>commentary('next',{...base,audio:{bpm:78,mode:0,key:1}},intentOf(),i));
  assert.ok(sad.every(x=>/Yoko,/.test(x) && !/feat/.test(x) && !/bpm/i.test(x)));assert.ok(sad.some(x=>/melanc|sentimental|luz/i.test(x)));
  const shift=commentary('next',{...base,audio:{bpm:78,mode:0},prevAudio:{bpm:128,mode:1}},intentOf(),0);assert.match(shift,/Cambiamos de ambiente: ahora algo más melancólico/);
  const g=Array.from({length:8},(_,i)=>commentary('next',{...base,styles:['reggaeton']},intentOf(),i));assert.ok(g.some(x=>/perreo|flow/i.test(x)));
  const none=Array.from({length:8},(_,i)=>commentary('next',base,intentOf(),i));
  assert.ok(none.every(x=>!/perreo|flow|bpm|melanc|energía|tono/i.test(x)));
  assert.match(commentary('next',{...base,hour:23},intentOf(),0),/noche/);assert.doesNotMatch(commentary('next',{...base,hour:15},intentOf(),0),/noche/);
});
const {fadePlan,transitionLabel}=require('../poor-mans-dj.js');
test('crossfade recomendado según la pareja de canciones',()=>{
  const a={bpm:120,key:0,mode:1,loudness:-8};
  assert.equal(fadePlan(a,{bpm:121,key:0,mode:1,loudness:-8}),6);
  assert.equal(fadePlan(a,{bpm:200,key:6,mode:0,loudness:-20}),0);
  assert.equal(fadePlan(null,a),null);assert.equal(fadePlan({bpm:120},{loudness:-8}),null);
  const mid=fadePlan(a,{bpm:127,key:0,mode:1,loudness:-9});assert.ok([2,4,6].includes(mid));
});
test('etiqueta de transición en lenguaje claro',()=>{
  const a={bpm:120,key:0,mode:1,loudness:-8};
  assert.match(transitionLabel(a,{bpm:121,key:0,mode:1,loudness:-8}),/mantiene el pulso, encaja en tono, suena al mismo nivel/);
  assert.match(transitionLabel(null,a),/Sin datos/);
});
test('el set evita saltos bruscos de ritmo',()=>{
  const e=new Engine({queue:()=>({all:[],priority:[]}),save(){}},{});e.current={uri:'x',name:'x',artists:[{name:'A'}],audio:{bpm:120,key:0,mode:1,loudness:-8}};
  const t=(bpm,loud)=>({uri:'spotify:track:'+'a'.repeat(22),name:'t',artists:[{name:'B'}],source:'contexto',audio:{bpm,key:0,mode:1,loudness:loud}});
  assert.ok(e.score(t(122,-8),[])>e.score(t(175,-8),[]));
  assert.ok(e.score(t(122,-8),[])>e.score(t(122,-20),[]));
});
test('proveedor: Spotify colgado agota el tiempo y se trata como error recuperable',async()=>{
  const p=new LyricsProvider({spotify:()=>new Promise(()=>{}),timeout:30});
  const r=await p.get(track);assert.equal(r.state,'error');assert.match(r.message,/Tiempo/);
});
test('narrador: voiceschanged conserva la voz elegida',()=>{
  let handler;const a={name:'A',lang:'es-MX',localService:true},b={name:'B',lang:'es-ES',localService:false};
  const host={speechSynthesis:{getVoices:()=>[a,b],addEventListener:(e,fn)=>handler=fn,removeEventListener(){},speak(){},cancel(){}},SpeechSynthesisUtterance:class{}};
  const n=new Narrator(host);n.prefer('B');assert.equal(n.voice,b);handler({type:'voiceschanged'});assert.equal(n.voice,b);
});
