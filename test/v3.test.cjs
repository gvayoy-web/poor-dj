const {test}=require('node:test'),assert=require('node:assert/strict'),{performance}=require('node:perf_hooks');
const {Engine,parseCommand,intentOf,knownEvidence,migrateProfile,ChoiceDeck,Narrator,commentary,contextKey,affinityPool}=require('../poor-mans-dj.js');
test('linked Spotify editions keep requested identity, full metadata and artist collaborators',()=>{const {normalize}=require('../poor-mans-dj.js'),a='spotify:track:0000000000000000000001',b='spotify:track:0000000000000000000002';const row=normalize({uri:b,uid:'q',duration:{milliseconds:214080},metadata:{requested_uri:a,title:'De Ti',artist_name:'Alex Rose','artist_name:1':'Jay Wheeler'}});assert.equal(row.uri,a);assert.equal(row.name,'De Ti');assert.equal(row.artists.length,2);assert.equal(row.duration,214080);});
const t=(id,name='Song '+id,artist='Omar Courtz')=>({uri:'spotify:track:'+String(id).padStart(22,'0'),uid:'u'+id,name,artists:[{name:artist}],duration:200000,playlist:true,affinity:true,evidence:['playlist']});
function fixture(saved={}){let q=[],serial=0,writes=0,played=[];const io={queue:()=>({priority:q.slice(),all:q.slice()}),save:()=>writes++,candidates:async()=>[t(2),t(3),t(4)],add:async ts=>{const rows=ts.map(x=>({...x,uid:'dj'+serial++}));q.push(...rows);return rows;},remove:async ts=>{q=q.filter(x=>!ts.some(y=>y.uid===x.uid));},play:async x=>{played.push(x);},resolve:async()=>[]};const e=new Engine(io,saved);e.trackChanged(t(1));return {e,io,q:()=>q,set:rows=>q=rows,writes:()=>writes,played};}
test('compound parser accepts accents, punctuation, exclusions and variety',()=>{
 const c=parseCommand('¡Solo CONOCIDAS, sin Dillom y más variedad!');assert.equal(c.ok,true);assert.deepEqual(c.patch,{known:true,excludedArtists:['dillom'],variety:80});
 const ref=parseCommand('sigue como Lakenoshi de Omar Courtz y solo conocidas y sin Dillom');assert.equal(ref.ok,true);assert.deepEqual(ref.target,{title:'lakenoshi',artist:'omar courtz'});assert.equal(ref.patch.known,true);
});
test('explicit song request can start DJ and keeps the full title',()=>{const c=parseCommand('pon SIN UN PLAN(TEGOCALDERON) de Isma e inicia el DJ');assert.equal(c.ok,true);assert.equal(c.start,true);assert.equal(c.target.artist,'isma');assert.equal(c.target.title,'sin un plan tegocalderon');});
test('all declared styles can follow an explicit song request without becoming part of its artist',()=>{for(const style of ['rock','jazz','salsa','bachata','hip hop','electrónica']){const c=parseCommand('pon canción de artista y '+style);assert.equal(c.ok,true,style);assert.equal(c.target.artist,'artista');assert.equal(c.patch.styles.length,1);}});
test('unknown, commercial and contradictory commands are never partially applied',async()=>{
 const f=fixture(),before=JSON.stringify(f.e.intent);
 for(const text of ['solo conocidas y música de otro planeta','solo conocidas y permite descubrir','menos comercial','más variedad y menos variedad','inicia el DJ y termina el DJ']){assert.equal(parseCommand(text).ok,false,text);await f.e.command(text);assert.equal(JSON.stringify(f.e.intent),before);}
});
test('supported style filters are explicit rather than tempo inference',()=>{const c=parseCommand('reggaetón y sin repetir artistas');assert.equal(c.ok,true);assert.deepEqual(c.patch.styles,['reggaetón']);const f=fixture();f.e.intent=intentOf({styles:c.patch.styles});assert.equal(f.e.eligible({...t(2),audio:{bpm:95}}),false);f.e.tags[t(2).uri]=['reggaeton'];assert.equal(f.e.eligible(t(2)),true);});
test('schema migration preserves votes, tracks, pending recovery and legacy history honestly',()=>{
 const original={schema:2,memory:{[t(1).uri]:{plays:7,vote:1,track:t(1)}},recovery:{captured:true,suspended:[t(4)]},preferences:{'Omar':2}};
 const p=migrateProfile(original);assert.equal(p.memory[t(1).uri].heard,0);assert.equal(p.memory[t(1).uri].legacyPlays,7);assert.equal(p.memory[t(1).uri].vote,1);assert.equal(p.recovery.suspended[0].uri,t(4).uri);
 assert.deepEqual(knownEvidence({...t(1),playlist:false,evidence:[]},p.memory[t(1).uri]),['voto']);
});
test('known evidence separates playlist, verified listening and votes',()=>{assert.deepEqual(knownEvidence(t(1),{heard:2,vote:1}),['playlist','escucha','voto']);assert.deepEqual(knownEvidence({...t(1),playlist:false,evidence:[]},{plays:10}),[]);});
test('legacy plays alone do not enter the known picker',()=>{const f=fixture({schema:2,memory:{[t(2).uri]:{plays:3,track:{...t(2),playlist:false,evidence:[]}}}});assert.equal(f.e.prepareChoices().length,0);});
test('picker changes pairs without mutating Spotify, exhausts, and resets explicitly',()=>{
 const f=fixture();f.set([t(2),t(3),t(4),t(5),t(6)]);const before=f.q().map(t=>t.uid);assert.equal(f.e.prepareChoices().length,2);
 const first=f.e.deck.pair.map(t=>t.uri);assert.equal(f.e.nextChoices().length,2);assert.ok(f.e.deck.pair.every(t=>!first.includes(t.uri)));assert.equal(f.e.nextChoices().length,1);assert.equal(f.e.deck.exhausted,true);assert.equal(f.e.nextChoices().length,0);assert.equal(f.e.nextChoices(true).length,2);assert.deepEqual(f.q().map(t=>t.uid),before);assert.equal(f.played.length,0);
});
test('empty, single and duplicate card pools have deterministic behavior',()=>{const deck=new ChoiceDeck();assert.deepEqual(deck.set([]),[]);assert.equal(deck.set([t(1),t(1)]).length,1);assert.equal(deck.exhausted,true);assert.equal(deck.next().length,0);assert.equal(deck.reset().length,1);});
test('choosing a card plays it before starting and preserves manual queue',async()=>{const f=fixture();f.set([t(99)]);f.e.prepareChoices();const choice=f.e.deck.pair[0];await f.e.playChoice(choice,true);assert.equal(f.played[0].uri,choice.uri);assert.equal(f.e.active,true);assert.equal(f.e.anchor.uri,choice.uri);assert.equal(f.q()[0].uid,'u99');});
test('verified listening commits once at threshold, not on track entry or each progress event',()=>{
 const f=fixture();f.e.sample(0,true,1000);for(let i=1;i<=60;i++)f.e.sample(i*1000,true,1000+i*1000);assert.equal(f.e.memory[t(1).uri].heard,1);assert.equal(f.writes(),1);
 for(let i=61;i<90;i++)f.e.sample(i*1000,true,1000+i*1000);assert.equal(f.writes(),1);
});
test('pause and seek do not create verified listens; short songs use 70 percent',()=>{
 const f=fixture();f.e.current.duration=20000;f.e.sample(0,true,0);f.e.sample(14000,true,100);assert.equal(f.e.observedMs,0);f.e.sample(14000,false,1000);f.e.sample(14000,false,60000);assert.equal(f.e.observedMs,0);
 f.e.trackChanged(t(2));f.e.current.duration=20000;f.e.sample(0,true,1000);for(let i=1;i<=14;i++)f.e.sample(i*1000,true,1000+i*1000);assert.equal(f.e.memory[t(2).uri].heard,1);
});
test('preferences in another context do not raise current session affinity',()=>{
 const f=fixture();f.e.anchor=t(1);const current=contextKey(t(1),f.e.intent),other=contextKey(t(9,'other','Dillom'),f.e.intent),base=f.e.score(t(2),[]);f.e.contexts[other]={votes:{[t(2).uri]:5}};assert.equal(f.e.score(t(2),[]),base);f.e.contexts[current]={votes:{[t(2).uri]:2}};assert.ok(f.e.score(t(2),[])>base);
});
test('artist exclusions are session scoped, undo restores reference and filters',async()=>{
 const f=fixture();await f.e.start();const anchor=f.e.anchor;await f.e.feedbackFor(f.e.current,'artist');assert.equal(f.e.eligible(t(2)),false);await f.e.undoFeedback();assert.equal(f.e.eligible(t(2)),true);assert.equal(f.e.anchor.uri,anchor.uri);await f.e.feedbackFor(f.e.current,'artist');await f.e.stop();assert.equal(f.e.eligible(t(2)),true);
});
test('no three same-artist suggestions when compatible alternatives exist',()=>{
 const f=fixture();f.e.recent=[t(1),t(2)];const picks=f.e.select([t(3),t(4,'other','Related')],[],1);assert.equal(picks[0].artists[0].name,'Related');
});
test('declared shared style permits another artist; unknown genre is excluded',()=>{
 const seed=t(1),intent=intentOf({styles:['alabanzas']}),pool=affinityPool(seed,[],[{tracks:[t(2,'other','Related'),t(3,'unrelated','Dillom')],source:'contexto',familiar:true}],intent,{[t(2).uri]:['alabanzas']});assert.deepEqual(pool.map(t=>t.uri),[t(2).uri]);
});
test('ambiguous search presents choices without committing filters or playback',async()=>{
 const f=fixture();f.io.resolve=async()=>[t(90,'SIN UN PLAN','Isma'),t(91,'SIN UN PLAN','Isma')];const before=JSON.stringify(f.e.intent);const result=await f.e.command('pon SIN UN PLAN de Isma y permite descubrir');assert.equal(result.choices.length,2);assert.equal(f.played.length,0);assert.equal(JSON.stringify(f.e.intent),before);await f.e.chooseCommand(f.e.commandChoices[0]);assert.equal(f.played.length,1);assert.equal(f.e.active,false);assert.equal(f.e.intent.known,false);
});
test('unique exact match plays and pauses; starting DJ must be explicit',async()=>{
 const f=fixture();f.io.resolve=async()=>[t(90,'SIN UN PLAN','Isma')];await f.e.start();await f.e.command('pon SIN UN PLAN de Isma');assert.equal(f.played[0].uri,t(90).uri);assert.equal(f.e.active,false);assert.equal(f.q().length,0);await f.e.command('pon SIN UN PLAN de Isma e inicia el DJ');assert.equal(f.e.active,true);
});
test('reference command changes anchor without interrupting current song',async()=>{const f=fixture();f.io.resolve=async()=>[t(90,'Lakenoshi','Omar Courtz')];await f.e.command('sigue como Lakenoshi de Omar Courtz');assert.equal(f.e.anchor.uri,t(90).uri);assert.equal(f.e.current.uri,t(1).uri);assert.equal(f.played.length,0);});
test('new command invalidates old ambiguous choices and pending searches',async()=>{
 const f=fixture();let resolve;f.io.resolve=()=>new Promise(r=>resolve=r);const old=f.e.command('pon foo de bar');await f.e.command('solo conocidas');resolve([t(90,'foo','bar')]);assert.equal((await old).ok,false);assert.equal(f.played.length,0);assert.equal(f.e.commandChoices.length,0);
});
test('restart recovery recognizes a previously inserted restore record without duplicating it',async()=>{
 const f=fixture({schema:3,recovery:{captured:true,suspended:[t(99)],managed:[],restoreJournal:{uri:t(99).uri,before:[]}}});f.set([{...t(99),uid:'restored'}]);await f.e.stop();assert.equal(f.q().length,1);assert.equal(f.e.suspended.length,0);assert.equal(f.e.captured,false);
});
test('schema 3 export/import retains hearing, contexts and labels',async()=>{const f=fixture();f.e.tags[t(2).uri]=['trap'];f.e.memory[t(2).uri]={heard:3,vote:1,track:t(2)};f.e.contexts.foo={votes:{[t(2).uri]:2}};const exported=f.e.exportProfile(),fresh=fixture();await fresh.e.importProfile(exported);assert.equal(fresh.e.memory[t(2).uri].heard,3);assert.deepEqual(fresh.e.tags[t(2).uri],['trap']);assert.equal(fresh.e.contexts.foo.votes[t(2).uri],2);});
test('queue update arriving before song change does not misclassify the DJ transition as manual',async()=>{const f=fixture();await f.e.start();const next=f.q()[0];f.e.sync();f.set([]);f.e.sync();f.e.trackChanged(next);assert.equal(f.e.active,true);if(f.e.flight)await f.e.flight;});
test('late metadata refreshes the current track without restarting listening or the session',async()=>{const f=fixture();await f.e.start();f.e.current.name='';f.e.current.artists=[];f.e.observedMs=20000;const played=f.e.played,reference=f.e.anchor.uri;f.e.trackChanged(t(1,'Hydrated','Omar Courtz'));assert.equal(f.e.current.name,'Hydrated');assert.equal(f.e.observedMs,20000);assert.equal(f.e.played,played);assert.equal(f.e.anchor.uri,reference);assert.equal(f.e.active,true);});
test('natural playlist continuation keeps session direction when no DJ match was available',async()=>{const f=fixture();await f.e.start();const anchor=f.e.anchor.uri;f.e.lastPosition=199000;f.e.trackChanged(t(90,'Other','Related'));assert.equal(f.e.active,true);assert.equal(f.e.anchor.uri,anchor);if(f.e.flight)await f.e.flight;});
test('return from an interruption keeps the DJ reference without counting interrupted progress',async()=>{const f=fixture();await f.e.start();const anchor=f.e.anchor.uri;f.e.lastPosition=null;f.e.lastWall=null;f.e.trackChanged(t(90,'After advertisement','Related'),'natural');assert.equal(f.e.active,true);assert.equal(f.e.anchor.uri,anchor);assert.equal(f.e.observedMs,0);if(f.e.flight)await f.e.flight;});
test('reserved suggestion survives a refresh with no alternative matches',async()=>{const f=fixture();await f.e.start();const next=f.e.preview[0];f.e.reserve(next);f.io.candidates=async()=>[];await f.e.fill(true);assert.equal(f.q()[0].uid,next.uid);});
test('transport supplies a compatible definition when Spotify omits searchTracks',()=>{const {queryDefinition,songKey}=require('../poor-mans-dj.js');assert.deepEqual(queryDefinition({Definitions:{}},'searchTracks','hash'),{name:'searchTracks',operation:'query',sha256Hash:'hash',value:null});assert.equal(songKey('L a k e n o s h i'),songKey('Lakenoshi'));});
function speech(voices){let spoken=[],cancelled=0,listener;return {host:{speechSynthesis:{getVoices:()=>voices,addEventListener:(event,fn)=>listener=fn,removeEventListener:()=>listener=null,speak:u=>spoken.push(u),cancel:()=>cancelled++},SpeechSynthesisUtterance:class{constructor(text){this.text=text;}}},spoken,cancelled:()=>cancelled,listener:()=>listener};}
test('narrator selects a single local Spanish voice and rejects remote voices',()=>{
 const local={name:'Microsoft Sabina',lang:'es-MX',localService:true},f=speech([{name:'Neural',lang:'es-MX',localService:false},local]),n=new Narrator(f.host);assert.equal(n.voice,local);n.say('start',t(1),intentOf());assert.equal(f.spoken.length,1);assert.equal(f.spoken[0].voice,local);n.toggle();n.say('block',t(1),intentOf());assert.equal(f.spoken.length,1);n.dispose();assert.equal(f.listener(),null);
});
test('missing local voice and remote playback retain subtitles without speaking',()=>{const f=speech([]),n=new Narrator(f.host);n.say('start',t(1),intentOf());assert.ok(n.text);assert.equal(f.spoken.length,0);const v=speech([{name:'Sabina',lang:'es-MX',localService:true}]),nv=new Narrator(v.host);nv.say('start',t(1),intentOf(),false);assert.equal(v.spoken.length,0);});
test('narration mentions only declared musical labels, varies and stays within 25 words',()=>{const intent=intentOf(),plain=commentary('start',t(1),intent);assert.ok(!plain.includes('alabanzas'));intent.styles=['alabanzas'];const a=commentary('direction',t(1),intent,1),b=commentary('block',t(1),intent,2);assert.ok(a.includes('alabanzas'));assert.notEqual(a,b);assert.ok(a.split(/\s+/).length<=25);assert.ok(b.split(/\s+/).length<=25);});
test('parser and selection meet the 50 ms local budget with 300 tracks',()=>{const f=fixture(),tracks=Array.from({length:300},(_,i)=>t(i+2));const started=performance.now();for(let i=0;i<10;i++){parseCommand('solo conocidas y sin Dillom y más variedad');f.e.select(tracks,[],3);}const elapsed=(performance.now()-started)/10;assert.ok(elapsed<50,elapsed+' ms');console.log('Local parser + 300-track selection: '+elapsed.toFixed(2)+' ms');});
