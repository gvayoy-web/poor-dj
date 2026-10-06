const {test}=require('node:test'),assert=require('node:assert/strict');
const {Engine,affinityPool,guardPlay,settingsOf}=require('../poor-mans-dj.js');
const artist=(id,name)=>({uri:'spotify:artist:'+String(id).padStart(22,'0'),name});
const omar=artist(1,'Omar Courtz'),hesse=artist(2,'Hesse Kassel'),dillom=artist(3,'Dillom'),isma=artist(4,'Isma');
const track=(id,a=omar)=>({uri:'spotify:track:'+String(id).padStart(22,'0'),uid:'u'+id,name:'Song '+id,artists:[a],duration:200000});
function fixture(){let q=[],serial=0,saved;const io={queue:()=>({priority:q.slice(),all:q.slice()}),save:x=>saved=x,candidates:async()=>[2,3,4,5].map(i=>({...track(i),affinity:true,familiar:true,playlist:true,source:'contexto'})),add:async ts=>{const rows=ts.map(t=>({...t,uid:'dj'+serial++}));q.push(...rows);return rows;},remove:async ts=>{q=q.filter(t=>!ts.some(m=>m.uid===t.uid));}};const e=new Engine(io);e.trackChanged(track(1));return {e,io,q:()=>q,set:x=>q=x,saved:()=>saved};}
test('Omar seed rejects unrelated Hesse/Dillom even from an artist overview',()=>{
 const pool=affinityPool(track(1),[],[{tracks:[track(2),track(3,hesse),track(4,dillom)],source:'artista actual'}]);
 assert.deepEqual(pool.map(t=>t.uri),[track(2).uri]);
});
test('old favorite votes cannot admit artists outside the seed sources',()=>{
 const pool=affinityPool(track(1),[],[{tracks:[track(3,dillom)],source:'tu colección',familiar:true}]);assert.equal(pool.length,0);
 const f=fixture();f.e.memory[track(3,dillom).uri]={vote:5,plays:10};f.e.preferences[dillom.uri]=3;
 assert.equal(f.e.select([{...track(3,dillom),familiar:true}],[],3).length,0);
});
test('familiar mode selects only context/history even when viral artist tracks are available',()=>{
 const f=fixture(),pool=affinityPool(track(1),[],[{tracks:[{...track(2),playlist:true}],source:'contexto',familiar:true},{tracks:[track(3)],source:'artista actual'}]);
 assert.deepEqual(f.e.select(pool,[],3).map(t=>t.uri),[track(2).uri]);
 f.e.intent.known=false;f.e.settings.discovery=50;assert.equal(f.e.select(pool,[],3).length,2);
});
test('related artists must be explicitly admitted, acoustic tempo alone cannot qualify them',()=>{
 const pool=affinityPool(track(1),[isma.uri],[{tracks:[{...track(2,isma),audio:{bpm:120}},track(3,dillom)],source:'artista relacionado'}]);assert.deepEqual(pool.map(t=>t.uri),[track(2).uri]);
});
test('familiar status survives duplicate overview/search results',()=>{
 const pool=affinityPool(track(1),[],[{tracks:[track(2)],source:'contexto',familiar:true},{tracks:[track(2)],source:'artista actual'}]);assert.equal(pool[0].familiar,true);
});
test('recent suggestions cannot return after refresh or a restart',async()=>{
 const f=fixture();await f.e.start();const first=f.q()[0];await f.e.fill(true);assert.notEqual(f.q()[0].uri,first.uri);
 const restart=new Engine(f.io,f.saved());restart.current=track(1);restart.anchor=track(1);
 assert.equal(restart.select([{...first,affinity:true,familiar:true,playlist:true}],[],1).length,0);
});
test('empty compatible pool never fills the queue with unrelated music',async()=>{
 const f=fixture();f.io.candidates=async()=>[{...track(3,dillom),familiar:true}];await f.e.start();assert.equal(f.q().length,0);assert.match(f.e.status,/No encontré/);
});
test('changing the anchor with no matches removes stale DJ suggestions',async()=>{
 const f=fixture();await f.e.start();f.io.candidates=async()=>[];await f.e.fill(true);assert.equal(f.q().length,0);assert.equal(f.e.managed.length,0);
});
test('Isma explicit play runs only after DJ queue release, preserving arguments and this',async()=>{
 const f=fixture();await f.e.start();let called=false;const api={play:function(...args){called=true;assert.equal(this,api);assert.equal(f.q().length,0);assert.deepEqual(args,[track(90,isma),{uri:'playlist'},{}]);return 'played';}};
 const original=api.play,undo=guardPlay(api,()=>f.e.active?f.e.yieldToUser():null);
 const result=api.play(track(90,isma),{uri:'playlist'},{});assert.equal(called,false);assert.equal(await result,'played');assert.equal(f.e.active,false);undo();assert.equal(api.play,original);
});
test('a manual playback request invalidates a pending lookup before insertion',async()=>{
 const f=fixture();let resolve;f.io.candidates=()=>new Promise(r=>resolve=r);const start=f.e.start();let played=false;
 const api={play:()=>{played=true;assert.equal(f.q().length,0);}};guardPlay(api,()=>f.e.active?f.e.yieldToUser():null);
 const choice=api.play(track(90,isma));resolve([{...track(2),affinity:true,familiar:true}]);await Promise.all([start,choice]);assert.equal(played,true);assert.equal(f.q().length,0);
});
test('manual queue edits during lookup prevent insertion and preserve the new choice',async()=>{
 const f=fixture();let resolve;f.io.candidates=()=>new Promise(r=>resolve=r);const start=f.e.start();f.set([track(90,isma)]);resolve([{...track(2),affinity:true,familiar:true}]);await start;assert.deepEqual(f.q().map(t=>t.uri),[track(90,isma).uri]);assert.equal(f.e.active,false);
});
test('manual play does not wait for an unresponsive recommendation lookup',async()=>{
 const f=fixture();f.io.candidates=()=>new Promise(()=>{});const start=f.e.start();let played=false;
 const api={play:()=>{played=true;}};guardPlay(api,()=>f.e.active?f.e.yieldToUser():null);
 await api.play(track(90,isma));await start;assert.equal(played,true);assert.equal(f.e.busy,false);assert.equal(f.q().length,0);
});
test('a play request during an acknowledged insertion releases the inserted records',async()=>{
 const f=fixture();let resolve,entered;const ready=new Promise(r=>entered=r),add=f.io.add;
 f.io.add=async ts=>{const rows=await add(ts);entered();await new Promise(r=>resolve=r);return rows;};
 const start=f.e.start();await ready;const choice=f.e.yieldToUser();resolve();await Promise.all([start,choice]);assert.equal(f.q().length,0);assert.equal(f.e.managed.length,0);
});
test('restoration failure retains pending originals and can be retried',async()=>{
 const f=fixture();f.e.settings.takeover=true;f.set([track(99)]);await f.e.start();const add=f.io.add;f.io.add=async()=>{throw Error('offline');};await f.e.stop();assert.equal(f.e.suspended.length,1);assert.equal(f.e.captured,true);
 f.io.add=add;await f.e.stop();assert.equal(f.e.suspended.length,0);assert.equal(f.e.captured,false);assert.deepEqual(f.q().map(t=>t.uri),[track(99).uri]);
});
test('play guard is transparent while DJ is inactive and preserves another wrapper on cleanup',()=>{
 const api={play:()=>7};const undo=guardPlay(api,()=>null);assert.equal(api.play(),7);const replacement=()=>8;api.play=replacement;undo();assert.equal(api.play,replacement);
});
test('unsafe experimental fades cannot be selected from saved settings',()=>{
 for(const transition of ['auto','fixed'])assert.equal(settingsOf({transition}).transition,undefined);assert.equal(settingsOf().queueSize,1);assert.equal(settingsOf().takeover,false);
});
