/* POOR DJ 3.3.0 | MIT */
(function(root){
'use strict';
// Acoustic data is optional. Missing fields never become fabricated measurements.
function audioSummary(raw){
  const t=raw?.track || raw;
  if(!t || typeof t!=='object')return null;
  const finite=(x,min,max)=>typeof x==='number' && Number.isFinite(x) && x>=min && x<=max?x:null;
  const bpm=finite(t.tempo,20,400),key=finite(t.key,0,11),mode=finite(t.mode,0,1);
  const bars=Array.isArray(raw.bars)?raw.bars.filter(b=>finite(b.start,0,86400)!==null).slice(0,1500).map(b=>b.start*1000):[];
  return bpm!==null || (Number.isInteger(key) && Number.isInteger(mode))?{bpm,key:Number.isInteger(key)?key:null,mode:Number.isInteger(mode)?mode:null,loudness:finite(t.loudness,-70,5),bars}:null;
}
function camelot(a){
  if(!a || !Number.isInteger(a.key) || a.key<0 || a.key>11 || ![0,1].includes(a.mode))return null;
  return {number:(a.mode?[8,3,10,5,12,7,2,9,4,11,6,1]:[5,12,7,2,9,4,11,6,1,8,3,10])[a.key],letter:a.mode?'B':'A'};
}
function compatibility(a,b){
  let sum=0,weight=0,tempo=null,key=null;
  if(a?.bpm>0 && b?.bpm>0){tempo=Math.min(...[b.bpm,b.bpm*2,b.bpm/2].map(n=>Math.abs(a.bpm-n)/a.bpm));sum+=.6*(1-Math.min(tempo/.08,1));weight+=.6;}
  const ca=camelot(a),cb=camelot(b);
  if(ca && cb){const d=Math.abs(ca.number-cb.number);key=Math.min(d,12-d)+(ca.letter!==cb.letter?1:0);sum+=.4*(1-Math.min(key/3,1));weight+=.4;}
  return {value:weight?sum/weight:null,coverage:weight,tempo,key};
}
class AudioLibrary{
  constructor(fetcher,saved={},persist=()=>{},now=Date.now,timeout=4000){
    this.fetcher=fetcher;this.persist=persist;this.now=now;this.timeout=timeout;this.epoch=0;
    this.cache=new Map();this.pending=new Map();this.running=0;this.waiting=[];
    for(const [uri,entry]of Object.entries(saved||{}).slice(-150)){
      if(!valid(uri) || !Number.isFinite(entry?.time))continue;
      const raw=entry.data,data=raw?audioSummary({track:{tempo:raw.bpm,key:raw.key,mode:raw.mode,loudness:raw.loudness}}):null;
      if(raw && !data)continue;
      if(data)data.bars=Array.isArray(raw.bars)?raw.bars.filter(t=>Number.isFinite(t) && t>=0 && t<=86400000).slice(0,1500):[];
      this.cache.set(uri,{time:entry.time,data});
    }
  }
  async get(uri){
    if(!valid(uri) || !this.fetcher)return null;
    const old=this.cache.get(uri);if(old && this.now()-old.time<(old.data?7*86400000:3600000)){this.cache.delete(uri);this.cache.set(uri,old);return old.data;}
    if(this.pending.has(uri))return this.pending.get(uri);
    if(this.waiting.length>=16)return null;
    const promise=this.load(uri,this.epoch);this.pending.set(uri,promise);return promise;
  }
  async load(uri,epoch){
    let transferred=false;
    if(this.running>=2){
      const granted=await new Promise(resolve=>{let timer;const grant=()=>{clearTimeout(timer);resolve(true);};this.waiting.push(grant);timer=setTimeout(()=>{this.waiting=this.waiting.filter(x=>x!==grant);resolve(false);},3000);});
      if(!granted){this.pending.delete(uri);return null;}
      transferred=true;
    }
    if(!transferred)this.running++;
    let timer;const request=Promise.resolve().then(()=>epoch===this.epoch?this.fetcher(uri):null).then(audioSummary).catch(()=>null).then(data=>{
      if(epoch!==this.epoch)return null;
      this.cache.set(uri,{time:this.now(),data});while(this.cache.size>150)this.cache.delete(this.cache.keys().next().value);
      try{this.persist(Object.fromEntries(this.cache));}catch(_){}
      return data;
    });
    // A timed-out caller cannot duplicate a request that is still running.
    request.finally(()=>{this.pending.delete(uri);const next=this.waiting.shift();if(next)next();else this.running--;});
    return Promise.race([request,new Promise(r=>{timer=setTimeout(()=>r(null),this.timeout);})]).finally(()=>clearTimeout(timer));
  }
  async enrich(tracks,limit=12){
    // Waiting jobs also have a fixed bound; do not analyse an entire source catalogue.
    const chosen=tracks.slice(0,limit);let timer;
    await Promise.race([Promise.all(chosen.map(async t=>{t.audio=await this.get(t.uri);})),new Promise(r=>{timer=setTimeout(r,4500);})]).finally(()=>clearTimeout(timer));return tracks;
  }
  clear(){this.epoch++;this.cache.clear();this.persist({});}
  dispose(){this.epoch++;}
}

function queryDefinition(graphql,name,hash){
  if(graphql?.Definitions?.[name])return graphql.Definitions[name];
  if(hash)return {name,operation:'query',sha256Hash:hash,value:null};
  throw Error('Esta fuente musical no está disponible');
}
class RequestCache{
  constructor({limit=80,ttl=300000,timeout=10000}={}){this.limit=limit;this.ttl=ttl;this.timeout=timeout;this.cache=new Map();this.pending=new Map();this.disposed=false;this.running=0;this.waiting=[];}
  async run(fetcher){
    if(this.disposed)throw Error('Fuente cerrada');
    if(this.running>=2){if(this.waiting.length>=16)throw Error('Demasiadas consultas pendientes');await new Promise((resolve,reject)=>this.waiting.push({resolve,reject}));}
    else this.running++;
    try{if(this.disposed)throw Error('Fuente cerrada');return await fetcher();}
    finally{const next=this.waiting.shift();if(next)next.resolve();else this.running--;}
  }
  get(key,fetcher){
    const cached=this.cache.get(key);
    if(cached && Date.now()-cached.time<this.ttl){this.cache.delete(key);this.cache.set(key,cached);return Promise.resolve(cached.data);}
    if(this.pending.has(key))return this.pending.get(key);
    let timer;
    const request=Promise.resolve().then(()=>this.run(fetcher)).then(data=>{
      if(data?.errors?.length)throw Error('Fuente musical no disponible');
      if(Number(data?.code)>=400)throw Error('Spotify no autorizó la fuente musical');
      if(!this.disposed){this.cache.set(key,{time:Date.now(),data});while(this.cache.size>this.limit)this.cache.delete(this.cache.keys().next().value);}
      return data;
    });
    const visible=Promise.race([request,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Tiempo de espera agotado')),this.timeout);})]).finally(()=>clearTimeout(timer));
    this.pending.set(key,visible);
    request.finally(()=>this.pending.delete(key)).catch(()=>{});
    return visible;
  }
  dispose(){this.disposed=true;this.cache.clear();for(const job of this.waiting.splice(0))job.reject(Error('Fuente cerrada'));}
}

const VERSION = '3.3.0';
const clamp = (n, a = 0, b = 100) => Math.min(b, Math.max(a, Number(n) || 0));
const valid = uri => /^spotify:track:[A-Za-z0-9]{22}$/.test(uri || '');
const unwrap = x => x?.contextTrack || x?.track?.data || x?.track || x?.item?.data || x?.item || x;
const artistKey = a => a.uri || String(a.name || '').toLowerCase();
function normalize(input, source = 'contexto') {
  const x = unwrap(input), m = x?.metadata || {};
  if (!valid(x?.uri) || x.is_playable === false || x.isPlayable === false || x.playability?.playable === false) return null;
  const items = x.artists?.items || x.artists || [];
  const artists = Array.isArray(items) ? items.map(a => ({uri:a.uri, name:a.profile?.name || a.name || ''})).filter(a=>a.name) : [];
  if (!artists.length && m.artist_name){artists.push({uri:m.artist_uri,name:m.artist_name});for(let i=1;i<12 && m['artist_name:'+i];i++)artists.push({uri:m['artist_uri:'+i],name:m['artist_name:'+i]});}
  const album = x.albumOfTrack || x.album || {};
  return {uri:valid(m.requested_uri)?m.requested_uri:x.uri,uid:x.uid || input?.uid,name:x.name || m.title || '',artists,
    image:x.image || album.coverArt?.sources?.[0]?.url || album.images?.[0]?.url || x.images?.[0]?.url || x.images?.sources?.[0]?.url || m.image_url || '',source,album:typeof album==='string'?album:album.name || m.album_title || '',
    duration:x.duration_ms || x.duration?.totalMilliseconds || x.duration?.milliseconds || (typeof x.duration==='number'?x.duration:0) || Number(m.duration) || 0,
    styles:Array.isArray(x.styles)?x.styles.filter(t=>typeof t==='string').slice(0,5):[],playlist:!!x.playlist,evidence:Array.isArray(x.evidence)?x.evidence.slice(0,3):[],
    explicit:x.explicit === true || x.isExplicit === true || x.contentRating?.label === 'EXPLICIT' || m.is_explicit === 'true'};
}
function collect(data, source) {
  const found = new Map(), visited = new WeakSet();let nodes=0;
  function walk(x, depth) {
    if (!x || typeof x !== 'object' || depth > 16 || visited.has(x) || nodes>=6000 || found.size>=300) return;
    nodes++;
    visited.add(x); const t = normalize(x,source);
    if (t?.name && t.artists.length){const previous=found.get(t.uri);found.set(t.uri,previous?{...t,image:t.image||previous.image,album:t.album||previous.album,duration:t.duration||previous.duration,artists:t.artists.length>=previous.artists.length?t.artists:previous.artists}:t);}
    for (const v of Object.values(x)) if (v && typeof v === 'object') walk(v,depth+1);
  }
  walk(data,0); return [...found.values()];
}
const DEFAULTS={discovery:0,diversity:25,takeover:false,queueSize:1,accent:'spotify',compact:false,mini:true,explicit:true,autoLearn:true,continuity:65,flowStrength:65,voice:true};
function settingsOf(value={}){
  const s=Object.fromEntries(Object.entries(DEFAULTS).map(([key,def])=>[key,value[key]??def]));
  if(!['spotify','theme','blue','violet','rose'].includes(s.accent))s.accent='spotify';
  for(const key of ['discovery','diversity','continuity','flowStrength'])s[key]=clamp(s[key]);
  s.queueSize=Math.round(clamp(s.queueSize,1,3));
  for(const key of ['takeover','compact','mini','explicit','autoLearn','voice'])if(typeof s[key]!=='boolean')s[key]=DEFAULTS[key];
  return s;
}
const reference = t => ({uri:t.uri,uid:t.uid});
const sameEntry = (a,b) => !!a.uid && !!b.uid && a.uid===b.uid && a.uri===b.uri;
class Engine {
  constructor(io,saved={}) {
    saved=migrateProfile(saved);
    this.io=io;this.settings=settingsOf(saved.settings);
    this.intent=intentOf(saved.intent);this.contexts=saved.contexts;this.tags=saved.tags;this.sessionExcluded=new Set();this.artistExcluded=new Set();this.deck=new ChoiceDeck();this.sessionPlaylist=[];this.lastWall=null;this.heardCommitted=false;this.onNarrate=()=>{};this.commandChoices=[];this.commandGeneration=0;
    this.memory=saved.memory && typeof saved.memory==='object'?saved.memory:{};
    this.preferences=saved.preferences && typeof saved.preferences==='object'?saved.preferences:{};
    this.suspended=Array.isArray(saved.recovery?.suspended)?saved.recovery.suspended.filter(t=>t?.uri):[];
    this.managed=Array.isArray(saved.recovery?.managed)?saved.recovery.managed.filter(t=>t?.uri && t?.uid):[];
    this.captured=!!saved.recovery?.captured;this.restoreJournal=saved.recovery?.restoreJournal||null;
    this.active=false;this.busy=false;this.flight=null;this.pendingRebuild=false;this.generation=0;this.recent=[];this.current=null;this.anchor=null;this.preview=[];
    this.pinned=null;this.undoVote=null;this.sessionList=[];this.sessionHeardMs=0;this.discoveries=0;this.artistSet=new Set();
    this.manualFingerprint='';this.manualFlight=null;this.queuePlan=[];
    this.initialManual=[];this.yieldFlight=null;
    this.observedMs=0;this.lastPosition=null;this.feedbackGiven=false;this.lastAttempt=0;this.failures=0;this.played=0;
    this.status=this.captured || this.managed.length?'Tienes una sesión anterior pendiente de restaurar.':'Reproduce una canción y activa el DJ.';
    this.error=false;this.commandArtists=[];this.artistMenu=null;this.mixPlaylist=saved.mixPlaylist;this.onUpdate=()=>{};
  }
  save() {
    const entries=Object.entries(this.memory);if(entries.length>1000)this.memory=Object.fromEntries(entries.sort((a,b)=>Math.max(b[1]?.lastPlayed||0,b[1]?.dismissedAt||0,b[1]?.lastSuggested||0)-Math.max(a[1]?.lastPlayed||0,a[1]?.dismissedAt||0,a[1]?.lastSuggested||0)).slice(0,1000));
    while(Object.keys(this.tags).length>1000)delete this.tags[Object.keys(this.tags)[0]];
    this.io.save({schema:3,settings:this.settings,intent:this.intent,memory:this.memory,preferences:this.preferences,contexts:this.contexts,tags:this.tags,mixPlaylist:this.mixPlaylist,
      recovery:{captured:this.captured,suspended:this.suspended,managed:this.managed,restoreJournal:this.restoreJournal}});
  }
  notify(text,error=false){this.status=text;this.error=error;this.onUpdate();}
  async start(seed=this.current,narrated=false,overlay=false){
    if(this.active || this.busy)return;
    if(!this.current){this.notify('Primero reproduce una canción de Spotify.',true);return;}
    if(this.captured || this.managed.length){await this.stop();if(this.captured || this.managed.length)return;}
    this.active=true;this.sessionOverlay=overlay;this.anchor=seed;this.intent.reference=reference(seed);this.sessionExcluded.clear();this.artistExcluded.clear();this.generation++;this.lastAttempt=0;this.played=0;this.recent=[this.current];
    this.pinned=null;this.sessionList=[];this.sessionHeardMs=0;this.discoveries=0;this.artistSet=new Set(this.current.artists.map(artistKey));
    this.manualFingerprint='';this.queuePlan=[];
    this.initialManual=(this.io.queue()?.priority||[]).map(reference);
    this.save();this.notify('Preparando tu sesión…');if(!narrated){const speech=this.onNarrate('start');if(speech?.then)await speech;}if(this.active)await this.fill();
  }
  stop(){
    if(this.stopping)return this.stopping;
    this.stopping=this.finishStop().finally(()=>{this.stopping=null;});return this.stopping;
  }
  async finishStop(){
    this.io.cancelTransition?.();this.pinned=null;
    this.active=false;this.pendingRebuild=false;this.generation++;this.notify('Devolviendo el control a Spotify…');
    this.cancelLookup?.();
    if(this.flight)await this.flight;
    if(this.manualFlight)await this.manualFlight;
    if(this.yieldFlight)await this.yieldFlight;
    this.busy=true;this.onUpdate();
    try{
      const q=this.io.queue();if(!q)throw new Error('La cola no está disponible. Intenta restaurarla de nuevo.');
      const ours=q.priority.filter(t=>this.managed.some(m=>sameEntry(m,t)));
      const originalStillPresent=q.priority.filter(t=>this.suspended.some(m=>sameEntry(m,t)));
      const cleanup=[...ours,...originalStillPresent];
      if(cleanup.length)await this.io.remove(cleanup);
      this.managed=[];this.preview=[];this.save();
      if(this.suspended.length){
        const pending=this.suspended.slice();
        // Add records one at a time so crash recovery never repeats an already restored batch.
        while(this.suspended.length){
          if(this.restoreJournal){
            const live=this.io.queue();if(!live)throw Error('No se puede confirmar la restauración');
            const restored=live.priority.filter(t=>t.uri===this.restoreJournal.uri && !this.restoreJournal.before.includes(t.uid));
            if(restored.length>1)throw Error('Restauración ambigua: conserva tu cola y reintenta después de revisar sus duplicados');
            if(restored.length===1){this.suspended.shift();this.restoreJournal=null;this.save();continue;}
          }
          this.restoreJournal={uri:this.suspended[0].uri,before:(this.io.queue()?.priority||[]).map(t=>t.uid)};this.save();
          await this.io.add([this.suspended[0]]);this.suspended.shift();this.restoreJournal=null;this.save();
        }
        this.notify(`Sesión terminada. ${pending.length} canciones de tu cola restauradas.`);
      }else this.notify('Sesión terminada. Spotify continúa con tu playlist.');
      this.captured=false;this.sessionExcluded.clear();this.artistExcluded.clear();this.save();
    }catch(e){this.notify(`No pude restaurar toda la cola: ${e.message}`,true);this.save();}
    finally{this.busy=false;this.onUpdate();}
  }
  updateSettings(patch,rebuild=true){
    const old=this.settings;this.settings=settingsOf({...old,...patch});
    if(this.active)this.settings.takeover=old.takeover;
    if(patch.discovery!==undefined)this.intent.known=this.settings.discovery===0;
    if(patch.diversity!==undefined)this.intent.variety=this.settings.diversity;
    this.save();if(rebuild){this.generation++;this.lastAttempt=0;this.cancelLookup?.();}
    this.notify(this.active && rebuild?'Actualizando las siguientes canciones…':'Preferencias guardadas.');
    if(this.active && rebuild)return this.fill(true);
  }
  feedback(amount){return this.feedbackFor(this.current,amount>0?'more':'less');}
  feedbackFor(track,kind){
    if(!track)return;const key=contextKey(this.anchor||this.current,this.intent);
    this.undoVote={uri:track.uri,memory:this.memory[track.uri]?{...this.memory[track.uri]}:null,contexts:JSON.parse(JSON.stringify(this.contexts)),anchor:this.anchor,intent:JSON.parse(JSON.stringify(this.intent)),sessionExcluded:[...this.sessionExcluded],artistExcluded:[...this.artistExcluded],given:this.feedbackGiven};
    this.feedbackGiven=true;
    if(kind==='more'){this.anchor=track;this.intent.reference=reference(track);this.adjust(track,1);this.onNarrate('direction');}
    else{
      this.sessionExcluded.add(track.uri);
      const m=this.memory[track.uri] ||= {plays:0,vote:0,heard:0};m.dismissedAt=Date.now();
      if(kind==='artist')track.artists.forEach(a=>this.artistExcluded.add(artistKey(a)));
      const c=this.contexts[key] ||= {votes:{}};c.votes[track.uri]=clamp((c.votes[track.uri]||0)-1,-5,5);
      this.save();
    }
    this.notify(kind==='more'?'La canción actual guía esta sesión.':kind==='artist'?'Este artista queda fuera de la sesión.':kind==='repeat'?'No volverá a proponerse en esta sesión.':'Anotado: esta propuesta no encaja.');
    return this.refresh();
  }
  undoFeedback(){
    const u=this.undoVote;if(!u)return;
    if(u.memory)this.memory[u.uri]=u.memory;else delete this.memory[u.uri];
    this.contexts=u.contexts;this.anchor=u.anchor;this.intent=intentOf(u.intent);this.sessionExcluded=new Set(u.sessionExcluded);this.artistExcluded=new Set(u.artistExcluded);this.feedbackGiven=u.given;this.undoVote=null;this.save();this.notify('Corrección deshecha.');return this.refresh();
  }
  refresh(){this.generation++;this.cancelLookup?.();this.lastAttempt=0;if(this.active)return this.fill(true);return Promise.resolve();}
  reserve(t){if(!this.preview.some(x=>sameEntry(x,t)))return;this.pinned=this.pinned && sameEntry(this.pinned,t)?null:reference(t);this.notify(this.pinned?'Canción reservada: se conserva al renovar.':'Reserva liberada.');}
  adjust(t,amount){
    const m=this.memory[t.uri] ||= {plays:0,vote:0};m.vote=clamp((m.vote||0)+amount,-5,5);
    if(m.vote>0)m.track={uri:t.uri,name:t.name,artists:t.artists.slice(0,10),image:t.image||'',duration:t.duration||0,explicit:!!t.explicit};
    const key=contextKey(this.anchor||this.current,this.intent),context=this.contexts[key] ||= {votes:{}};context.votes[t.uri]=clamp((context.votes[t.uri]||0)+amount,-5,5);
    while(Object.keys(this.contexts).length>40)delete this.contexts[Object.keys(this.contexts)[0]];
    this.save();
  }
  sample(position,playing,wall=Date.now()){
    if(playing && this.current && this.lastPosition!==null && this.lastWall!==null){
      const delta=position-this.lastPosition,elapsed=wall-this.lastWall;
      if(delta>0 && elapsed>0 && delta<=6000 && delta<=elapsed+800){
        this.observedMs+=delta;if(this.active)this.sessionHeardMs+=delta;
        const threshold=Math.min(60000,this.current.duration>0?this.current.duration*.7:60000);
        if(!this.heardCommitted && this.observedMs>=threshold){
          const m=this.memory[this.current.uri] ||= {plays:0,vote:0,heard:0};m.heard=(m.heard||0)+1;m.plays=(m.plays||0)+1;m.lastPlayed=Date.now();m.track={...this.current,audio:undefined};this.heardCommitted=true;this.save();
        }
      }
    }
    this.lastPosition=position;this.lastWall=wall;
  }
  trackChanged(track,ownSkip=false){
    if(track?.uri===this.current?.uri){
      if(track && (!this.current.name && track.name || !this.current.artists.length && track.artists.length || !this.current.image && track.image)){
        this.current={...this.current,...track,audio:this.current.audio};
        this.recent=this.recent.map(t=>t.uri===track.uri?this.current:t);
        this.sessionList=this.sessionList.map(t=>t.uri===track.uri?this.current:t);
        if(this.memory[track.uri])this.memory[track.uri].track={...this.current,audio:undefined};
        if(this.active)track.artists.forEach(a=>this.artistSet.add(artistKey(a)));
        this.onUpdate();
      }
      return;
    }
    const expected=this.expectedNext && (track?.uid?sameEntry(this.expectedNext,track):this.expectedNext.uri===track?.uri);
    const manualSelection=this.active && track && !expected && !this.managed.some(m=>track.uid?sameEntry(m,track):m.uri===track.uri);
    const endedNaturally=ownSkip==='natural' || this.current?.duration>0 && this.lastPosition>=this.current.duration-2500;
    const manualJump=manualSelection && !ownSkip && !endedNaturally;
    this.expectedNext=null;
    if(this.current && this.active && this.settings.autoLearn && !this.feedbackGiven && !ownSkip && !manualJump && this.observedMs>=2000){
      const ratio=this.current.duration?this.observedMs/this.current.duration:0;
      if(ratio>=.7)this.adjust(this.current,.2);
      else if(track && this.observedMs<15000)this.adjust(this.current,-.5);
      else if(track && this.observedMs<60000)this.adjust(this.current,-.15);
    }
    this.current=track;this.observedMs=0;this.lastPosition=null;this.lastWall=null;this.heardCommitted=false;this.feedbackGiven=false;
    this.undoVote=null;
    if(this.pinned?.uri===track?.uri)this.pinned=null;
    if(track && this.active){
      if(manualSelection && ownSkip===true)this.anchor=track;
      if(manualJump){this.anchor=track;this.yieldToUser();this.onUpdate();return;}
      this.recent.push(track);this.recent=this.recent.slice(-50);this.played++;
      if(!this.memory[track.uri])this.discoveries++;
      const m=this.memory[track.uri] ||= {plays:0,vote:0,heard:0};
      m.track={uri:track.uri,name:track.name,artists:track.artists,image:track.image||'',duration:track.duration||0,explicit:!!track.explicit};
      track.artists.forEach(a=>this.artistSet.add(artistKey(a)));this.sessionList.push({...track});this.sessionList=this.sessionList.slice(-100);
      if(this.played%4===0)this.onNarrate('block');
      this.managed=this.managed.filter(t=>t.uri!==track.uri);this.preview=this.preview.filter(t=>t.uri!==track.uri);this.save();
      this.generation++;this.lastAttempt=0;this.fill();
    }
    this.onUpdate();
  }
  score(t,recent){
    const m=this.memory[t.uri];let score=({'artista relacionado':45,'artista actual':75,contexto:80,'tu colección':80})[t.source]||0;
    const known=knownEvidence(t,m).length>0;
    score+=known?(100-this.settings.discovery)*.35:this.settings.discovery*.2;
    const vote=this.contexts[contextKey(this.anchor||this.current,this.intent)]?.votes?.[t.uri]||0;score+=clamp(vote,-2,2)*6;
    const keys=new Set(t.artists.map(artistKey));
    if(this.intent.artist && hasArtist(t,this.intent.artist))score+=100;
    recent.slice(-4).forEach(r=>{if(r.artists.some(a=>keys.has(artistKey(a))))score-=this.settings.diversity*.025;});
    const from=recent.at(-1)||this.current,comp=transitionFit(from?.audio,t.audio);
    if(comp.value!==null)score+=(comp.value-.5)*this.settings.flowStrength*.6*comp.coverage;
    return score;
  }
  reason(t,from){
    const evidence=knownEvidence(t,this.memory[t.uri]);if(evidence.length)return evidenceLabel(evidence)+' · afinidad con la referencia';
    if((this.memory[t.uri]?.vote||0)>0)return 'Por tu voto · Más así';
    const c=compatibility(from?.audio,t.audio);
    if(c.value>=.7 && c.coverage>=.6)return 'Tempo cercano · continuidad';
    if(t.source==='artista relacionado')return 'Artista relacionado · explorar';
    if(!this.memory[t.uri])return 'Nuevo en tu historial de POOR DJ';
    return 'Afinidad con esta sesión';
  }
  select(candidates,queued,count){
    // Playlist context is eligible: DJ prioritizes its best matches over the playlist's order.
    const blocked=new Set([this.current?.uri,...queued.map(t=>t.uri),...this.recent.map(t=>t.uri),...this.suspended.map(t=>t.uri)]);
    const pool=[...new Map(candidates.slice(0,300).filter(t=>t && t.affinity===true && valid(t.uri) && !blocked.has(t.uri) &&
      (!this.intent.known || isKnown(t,this.memory[t.uri])) &&
      this.eligible(t) && Date.now()-(this.memory[t.uri]?.dismissedAt||this.memory[t.uri]?.lastSuggested||0)>6*3600000).map(t=>[t.uri,t])).values()];
    const result=[],recent=[...this.recent,...queued];
    while(pool.length && result.length<count){
      const ranked=pool.map(t=>({t,score:this.score(t,recent)})).sort((a,b)=>b.score-a.score || a.t.uri.localeCompare(b.t.uri));
      const last=recent.slice(-2),repeated=last.length===2?last[0].artists.filter(a=>last[1].artists.some(b=>artistKey(a)===artistKey(b))).map(artistKey):[];
      let chosen=artistChoice(ranked,recent,this.intent)||(ranked.find(x=>!x.t.artists.some(a=>repeated.includes(artistKey(a))))||ranked[0]).t;
      chosen={...chosen,reason:this.reason(chosen,recent.at(-1)||this.current),compat:transitionFit((recent.at(-1)||this.current)?.audio,chosen.audio),transition:transitionLabel((recent.at(-1)||this.current)?.audio,chosen.audio)};
      result.push(chosen);recent.push(chosen);pool.splice(pool.findIndex(t=>t.uri===chosen.uri),1);
    }
    return result;
  }
  fill(force=false,snapshot){
    if(force)this.pendingRebuild=true;
    if(!this.active || this.busy || this.manualFlight || !this.current)return this.flight || Promise.resolve();
    force=this.pendingRebuild;
    const q=snapshot || this.io.queue();if(!q){this.notify('Esperando a que Spotify cargue la cola…');return Promise.resolve();}
    if(!force && (this.captured || !this.settings.takeover) && q.priority.length>=this.settings.queueSize){
      if(!this.managed.length && this.status!=='Tu cola manual tiene prioridad. El DJ espera a que termine.')this.notify('Tu cola manual tiene prioridad. El DJ espera a que termine.');
      return Promise.resolve();
    }
    if(!force && Date.now()-this.lastAttempt<Math.min(120000,15000*2**this.failures))return Promise.resolve();
    this.pendingRebuild=false;this.busy=true;this.lastAttempt=Date.now();const generation=this.generation;
    this.flight=this.refill(q,force,generation).finally(()=>{this.busy=false;this.flight=null;this.onUpdate();});
    return this.flight;
  }
  async refill(initial,force,generation){
    this.notify('Seleccionando las próximas canciones…');
    try{
      let cancel;
      const cancelled=new Promise(resolve=>{cancel=()=>resolve([]);this.cancelLookup=cancel;});
      let candidates;
      try{candidates=await Promise.race([this.io.candidates(this.anchor || this.current,this.settings,initial.all),cancelled]);}
      finally{if(this.cancelLookup===cancel)this.cancelLookup=null;}
      if(!this.active || generation!==this.generation)return;
      let q=this.io.queue();if(!q)throw new Error('No se puede leer la cola.');
      if(q.priority.some(t=>!this.managed.some(m=>sameEntry(m,t)) && !this.initialManual.some(m=>sameEntry(m,t)))){
        this.active=false;this.generation++;this.pendingRebuild=false;this.io.cancelTransition?.();
        const ours=q.priority.filter(t=>this.managed.some(m=>sameEntry(m,t)));
        if(ours.length)await this.io.remove(ours);
        this.managed=[];this.preview=[];if(!this.suspended.length)this.captured=false;this.save();
        this.notify('Tu elección tiene prioridad. DJ pausado.');return;
      }
      const oldManaged=q.priority.filter(t=>this.managed.some(m=>sameEntry(m,t)));
      const takeover=(this.settings.takeover || this.sessionOverlay) && !this.captured;
      const toRemove=takeover?q.priority:(force?oldManaged.filter(t=>!this.pinned || !sameEntry(t,this.pinned)):[]);
      if(toRemove.some(t=>!t.uid))throw new Error('No puedo identificar las entradas de la cola con seguridad.');
      const kept=q.priority.filter(t=>!toRemove.some(r=>sameEntry(t,r)));
      const selected=this.select(candidates,[...kept,...toRemove],Math.max(0,this.settings.queueSize-kept.length));
      if(!selected.length){
        if(force && toRemove.length){await this.io.remove(toRemove);this.managed=this.managed.filter(m=>!toRemove.some(t=>sameEntry(m,t)));this.preview=this.preview.filter(m=>!toRemove.some(t=>sameEntry(m,t)));this.save();}
        this.notify('No encontré canciones afines en tus fuentes permitidas. Tu playlist sigue; puedes permitir descubrir artistas relacionados.');return;
      }
      if(takeover){this.suspended=toRemove.map(t=>({...t}));this.captured=true;this.save();}
      let removed=false;
      try{
        if(toRemove.length){await this.io.remove(toRemove);removed=true;}
        if(!this.active || generation!==this.generation){
          if(removed && !takeover){const restored=await this.io.add(toRemove);this.managed=[...this.managed.filter(m=>!toRemove.some(t=>sameEntry(t,m))),...restored.map(reference)];this.save();}
          return;
        }
        const inserted=await this.io.add(selected);
        this.managed=[...this.managed.filter(m=>!toRemove.some(t=>sameEntry(t,m))),...inserted.map(reference)];
        this.preview=[...this.preview.filter(t=>kept.some(k=>sameEntry(t,k))),...selected.map((t,i)=>({...t,uid:inserted[i]?.uid}))];
        for(const t of selected){const m=this.memory[t.uri] ||= {plays:0,vote:0};m.lastSuggested=Date.now();}
        this.save();this.failures=0;this.notify('DJ activo. Una elección manual pausa el DJ y libera sus sugerencias.');
      }catch(error){
        if(removed){
          try{
            const restored=await this.io.add(toRemove);
            if(takeover){this.suspended=[];this.captured=false;}
            else this.managed=[...this.managed.filter(m=>!toRemove.some(t=>sameEntry(t,m))),...restored.map(reference)];
          }catch(_){/* Recovery retains the suspended queue for a later retry. */}
        }
        this.save();throw error;
      }
    }catch(error){this.failures++;this.notify(`Spotify no respondió: ${error.message}. Puedes reintentar.`,true);}
  }
  sync(snapshot){
    const q=snapshot || this.io.queue();if(!q)return;
    const head=q.priority[0];if(head && this.managed.some(m=>sameEntry(m,head)))this.expectedNext=reference(head);
    this.managed=this.managed.filter(m=>q.priority.some(t=>sameEntry(t,m)));
    this.preview=this.preview.filter(m=>q.priority.some(t=>sameEntry(t,m)));
    if(this.pinned && !q.priority.some(t=>sameEntry(t,this.pinned)))this.pinned=null;
  }
  yieldToUser(){
    if(this.yieldFlight)return this.yieldFlight;
    this.active=false;this.generation++;this.pendingRebuild=false;this.io.cancelTransition?.();
    this.cancelLookup?.();
    this.notify('Tú eliges. DJ pausado; retirando sus sugerencias…');
    this.yieldFlight=Promise.resolve().then(async()=>{
      if(this.flight)await this.flight;
      this.busy=true;this.onUpdate();
      try{
        const q=this.io.queue();if(!q)throw Error('No se puede leer la cola');
        const ours=q.priority.filter(t=>this.managed.some(m=>sameEntry(m,t)));
        if(ours.length)await this.io.remove(ours);
        this.managed=[];this.preview=[];this.queuePlan=[];
        if(!this.suspended.length)this.captured=false;
        this.save();this.notify(this.suspended.length?'DJ pausado. Tu elección manda. Puedes restaurar la cola guardada con el botón principal.':'DJ pausado. Tu elección manda; Spotify sigue tu lista.');
      }catch(e){this.notify('No pude retirar todas las sugerencias: '+e.message+'. Pulsa Restaurar cola.',true);}
      finally{this.busy=false;this.onUpdate();}
    }).finally(()=>{this.yieldFlight=null;});return this.yieldFlight;
  }
  reconcileManual(snapshot){
    if(!this.active || this.busy)return this.yieldFlight || Promise.resolve();
    const q=snapshot || this.io.queue();if(!q)return Promise.resolve();
    const cue=q.priority.find(t=>!this.managed.some(m=>sameEntry(m,t)) && !this.initialManual.some(m=>sameEntry(m,t)));
    if(cue){this.anchor=cue;return this.yieldToUser();}
    this.queuePlan=q.priority.map(t=>({...this.preview.find(p=>sameEntry(p,t)),...t,manual:!this.managed.some(m=>sameEntry(m,t))}));
    return Promise.resolve();
  }
  eligible(t){
    if(!t || !valid(t.uri) || !t.artists?.length)return false;
    if(this.intent.artistMode==='only' && this.intent.artist && !hasArtist(t,this.intent.artist))return false;
    if(!this.settings.explicit && t.explicit || this.sessionExcluded.has(t.uri))return false;
    if(t.artists.some(a=>this.artistExcluded.has(artistKey(a)) || this.intent.excludedArtists.includes(words(a.name))))return false;
    const styles=[...(t.styles||[]),...(this.tags[t.uri]||[])].map(words);
    return !this.intent.styles.length || this.intent.styles.every(tag=>styles.includes(words(tag)));
  }
  knownTracks(){
    const q=this.io.queue();
    const playlist=[...this.sessionPlaylist,...(this.io.known?.()||[]),...(q?.all||[]).filter(t=>t.playlist)];
    const history=Object.values(this.memory).filter(m=>m.track && m.heard>0).map(m=>({...m.track,playlist:false,evidence:[]}));
    const found=new Map();
    for(const t of [...playlist,...history]){
      const evidence=[...new Set([...knownEvidence(t,this.memory[t.uri]),...(found.get(t.uri)?.evidence||[])])];
      const previous=found.get(t.uri);
      if(isKnown(t,this.memory[t.uri]) && this.eligible(t))found.set(t.uri,{...t,image:t.image||previous?.image||'',album:t.album||previous?.album||'',playlist:evidence.includes('playlist'),evidence,familiar:true});
    }
    const keys=new Set((this.anchor||this.current)?.artists.map(artistKey)||[]);
    return [...found.values()].sort((a,b)=>Number(b.artists.some(x=>keys.has(artistKey(x))))-Number(a.artists.some(x=>keys.has(artistKey(x))))).slice(0,300);
  }
  prepareChoices(){
    this.sessionPlaylist=(this.io.queue()?.all||[]).filter(t=>t.playlist).slice(0,300);
    const candidates=this.knownTracks();
    candidates.sort((a,b)=>this.score(b,[])-this.score(a,[])||a.uri.localeCompare(b.uri));
    this.choosing=true;this.deck.set(candidates);this.onUpdate();this.hydrateChoices();this.syncLibrary();return this.deck.pair;
  }
  async syncLibrary(force=false,playlist=''){
    if(!this.io.loadKnown || this.libraryBusy)return;
    this.libraryBusy=true;this.onUpdate();
    try{await this.io.loadKnown(force,playlist);if(this.choosing){const tracks=this.knownTracks(),signature=tracks.map(t=>t.uri).sort().join('|');if(signature!==this.deck.signature)this.deck.set(tracks);this.hydrateChoices();}if(this.active)await this.refresh();}
    catch(_){this.notify('La biblioteca no respondió. Puedes seguir con las fuentes ya disponibles.');}
    finally{this.libraryBusy=false;this.onUpdate();}
  }
  nextChoices(reset=false){reset?this.deck.reset():this.deck.next();this.onUpdate();this.hydrateChoices();return this.deck.pair;}
  async hydrateChoices(){
    if(!this.io.cardDetails)return;
    const pair=this.deck.pair,results=await Promise.allSettled(pair.map(t=>t.image?Promise.resolve(null):this.io.cardDetails(t)));
    if(!this.choosing || this.deck.pair!==pair)return;
    let changed=false;
    results.forEach((r,i)=>{if(r.status==='fulfilled' && r.value?.image){const t=pair[i];t.image=r.value.image;t.album=r.value.album||t.album;const m=this.memory[t.uri];if(m?.track){m.track={...m.track,image:t.image,album:t.album};changed=true;}}});
    if(changed)this.save();
    this.onUpdate();
  }
  tagPlaylist(styles){
    const tags=intentOf({styles}).styles;if(!tags.length)return;
    const tracks=[...this.sessionPlaylist,...(this.io.queue()?.all||[]).filter(t=>t.playlist)];
    if(this.current)tracks.push(this.current);
    for(const t of tracks)this.tags[t.uri]=tags;
    this.save();this.notify('Etiqueta musical guardada para estas canciones.');if(this.choosing)this.prepareChoices();return this.refresh();
  }
  async playChoice(track,start=false,overlay=false){
    if(!track || !valid(track.uri))throw Error('Elige una canción válida');
    if(!this.io.play)throw Error('Spotify no ofrece reproducción directa');
    const generation=++this.commandGeneration;this.choiceBusy=true;this.onUpdate();
    try{
      if(this.captured)await this.stop();else await this.yieldToUser();
      if(this.captured || this.managed.length)throw Error('Primero hay que restaurar o liberar la cola pendiente');
      if(generation!==this.commandGeneration)return false;
      if(start && this.io.beforeSessionPlay){const allowed=await this.io.beforeSessionPlay(track,this.intent);if(allowed===false || generation!==this.commandGeneration)return false;}
      await this.io.play(track);
      if(generation!==this.commandGeneration)return false;
      this.trackChanged(track);this.anchor=this.current;this.intent.reference=reference(track);this.choosing=false;this.commandChoices=[];this.commandArtists=[];this.artistMenu=null;
      if(start)await this.start(this.current,!!this.io.beforeSessionPlay,overlay);else this.notify('Tu canción está sonando. DJ pausado.');
      return true;
    }finally{this.choiceBusy=false;this.onUpdate();}
  }
  async command(text){
    this.commandChoices=[];this.commandArtists=[];this.artistMenu=null;this.pendingCommand=null;
    const command=parseCommand(text);
    if(!command.ok){this.notify(command.errors.join(' '),true);return command;}
    const generation=++this.commandGeneration;
    if(command.target?.current && !this.current){this.notify('Primero reproduce una canción.',true);return {ok:false};}
    if(command.action==='stop' || command.action==='restore'){await this.stop();return command;}
    let target=command.target?.current?this.current:null;
    if(command.target && !target){
      this.notify('Buscando tu canción…');
      const result=command.action==='search' && this.io.search?await this.io.search(command.target):{tracks:await this.io.resolve?.(command.target)||[],artists:[]};
      const matches=result.tracks||[];this.commandArtists=result.artists||[];
      if(generation!==this.commandGeneration)return {ok:false,errors:['La orden fue sustituida por otra elección.']};
      if(!matches.length && !this.commandArtists.length){this.notify('No encontré esa canción o artista.',true);return {ok:false,errors:['Sin coincidencias']};}
      const exact=matches.filter(t=>songKey(t.name)===songKey(command.target.title) && (!command.target.artist || t.artists.some(a=>words(a.name)===words(command.target.artist))));
      if(command.action==='search' || exact.length!==1){this.commandChoices=(exact.length?exact:matches).slice(0,6);this.pendingCommand=command;this.notify(command.action==='search'?'Elige una canción para comenzar una mezcla con esa referencia.':'Elige la coincidencia correcta. No cambié tu reproducción.');return {...command,choices:this.commandChoices};}
      target=exact[0];
    }
    return this.applyCommand(command,target);
  }
  async applyCommand(command,target){
    const next=intentOf({...this.intent,...command.patch,...(target && ['play','search','reference'].includes(command.action)?{artist:null,artistMode:null}:{}),excludedArtists:[...this.intent.excludedArtists,...(command.patch.excludedArtists||[])]});
    if(target && target.artists.some(a=>next.excludedArtists.includes(words(a.name)))){this.notify('La referencia y el artista excluido se contradicen.',true);return {ok:false};}
    this.intent=next;this.settings.discovery=next.known?0:50;this.settings.diversity=next.variety;
    if(target && command.action==='reference'){this.anchor=target;this.intent.reference=reference(target);}
    this.save();
    if(command.action==='play')return this.playChoice(target,command.start);
    if(command.action==='search')return this.playChoice(target,true,true);
    if(command.action==='reference' && target){
      if(this.active && !this.captured && this.io.queue()?.priority.some(t=>!this.managed.some(m=>sameEntry(m,t))))await this.stop();
      if(!this.active)await this.start(target,false,true);else{await this.refresh();await this.onNarrate('direction');}
      return command;
    }
    if(command.start && !this.active){if(this.intent.known && !target)this.prepareChoices();else await this.start(target||this.current);}
    else if(this.active){await this.refresh();this.onNarrate('direction');}
    else this.notify('Entendido: '+intentLabels(this.intent).join(' · '));
    return command;
  }
  chooseCommand(track){const command=this.pendingCommand;if(!command || !this.commandChoices.some(t=>t.uri===track.uri))return Promise.resolve();this.commandChoices=[];this.pendingCommand=null;return this.applyCommand(command,track);}
  chooseArtist(uri,mode){
    const artist=this.commandArtists.find(a=>a.uri===uri)||this.commandChoices.flatMap(t=>t.artists).find(a=>a.uri===uri);
    if(!artist)return Promise.resolve();if(!mode){this.artistMenu=artist;this.onUpdate();return Promise.resolve();}
    return this.beginArtist(artist,mode);
  }
  async beginArtist(artist,mode){
    if(!['mix','only'].includes(mode))return;
    const generation=++this.commandGeneration;this.choiceBusy=true;this.notify('Preparando el catálogo de '+artist.name+'…');
    try{
      const catalog=await this.io.artistTracks?.(artist)||this.commandChoices.filter(t=>hasArtist(t,artist));
      if(generation!==this.commandGeneration)return;
      const tracks=catalog.filter(t=>hasArtist(t,artist) && (this.settings.explicit || !t.explicit));
      if(!tracks.length){this.notify('No encontré canciones reproducibles de ese artista.',true);return;}
      await this.stop();if(generation!==this.commandGeneration || this.captured || this.managed.length)return;
      this.intent=intentOf({...this.intent,known:false,styles:[],artist,artistMode:mode,excludedArtists:this.intent.excludedArtists.filter(n=>n!==words(artist.name))});this.settings.discovery=50;
      const choices=tracks.filter(t=>t.uri!==this.current?.uri),seed=(choices.length?choices:tracks)[Math.floor(Math.random()*(choices.length||tracks.length))];
      this.commandArtists=[];this.artistMenu=null;this.pendingCommand=null;
      const played=await this.playChoice(seed,true,true);if(!played || !this.active)return;
      this.choiceBusy=true;this.onUpdate();const currentGeneration=this.commandGeneration,pool=await this.io.candidates(this.anchor,this.settings,this.io.queue()?.all||[]);
      if(currentGeneration!==this.commandGeneration || !this.active)return;
      const plan=[seed,...this.preview,...this.select(pool,this.io.queue()?.priority||[],24)].filter((t,i,a)=>a.findIndex(x=>x.uri===t.uri)===i).slice(0,24);
      if(this.io.createMix){this.notify('Guardando la playlist de la mezcla…');const saved=await this.io.createMix(artist,mode,plan);if(currentGeneration!==this.commandGeneration || !this.active)return;this.mixPlaylist=saved;this.save();this.notify('Mezcla iniciada y playlist guardada: '+this.mixPlaylist.name);}
      this.onUpdate();
    }catch(e){this.notify('No pude completar la mezcla: '+e.message,true);}
    finally{this.choiceBusy=false;this.onUpdate();}
  }
  exportProfile(){return {schema:3,version:VERSION,settings:this.settings,intent:this.intent,memory:this.memory,preferences:this.preferences,contexts:this.contexts,tags:this.tags};}
  importProfile(data){
    if(!data || ![1,2,3].includes(data.schema) || !data.memory || typeof data.memory!=='object' || Array.isArray(data.memory))throw Error('El archivo no es un perfil POOR DJ válido.');
    const profile=migrateProfile(data);this.memory=profile.memory;this.preferences=profile.preferences;this.contexts=profile.contexts;this.tags=profile.tags;this.intent=profile.intent;this.updateSettings(profile.settings,false);this.commandGeneration++;return this.refresh();
  }
}

const words=x=>String(x||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[“”"']/g,'').replace(/[()[\]!?¡¿.,;:]/g,' ').replace(/\s+/g,' ').trim();
const STYLE_NAMES={reggaeton:'reggaetón',trap:'trap',rap:'rap',hiphop:'hip hop',pop:'pop',rock:'rock',electronica:'electrónica',jazz:'jazz',salsa:'salsa',bachata:'bachata',alabanzas:'alabanzas',cristiana:'alabanzas',cristiano:'alabanzas',gospel:'gospel',ambient:'ambient',lofi:'lo-fi'};
const songKey=text=>{const key=words(text);return /^(?:[a-z0-9]\s+)+[a-z0-9]$/.test(key)?key.replace(/\s/g,''):key;};
function intentOf(value={}){return {known:value.known!==false,styles:Array.isArray(value.styles)?[...new Set(value.styles.filter(t=>typeof t==='string').map(words))].slice(0,5):[],excludedArtists:Array.isArray(value.excludedArtists)?[...new Set(value.excludedArtists.filter(t=>typeof t==='string').map(words))].slice(0,30):[],variety:clamp(value.variety??25),reference:value.reference||null,artist:value.artist && /^spotify:artist:[A-Za-z0-9]{22}$/.test(value.artist.uri||'')?{uri:value.artist.uri,name:String(value.artist.name||'').slice(0,100)}:null,artistMode:['mix','only'].includes(value.artistMode)?value.artistMode:null};}
function parseCommand(raw){
  let text=words(raw);const patch={},labels=[],errors=[];let action='configure',target=null,start=false;
  if(!text || text.length>240)return {ok:false,errors:['Escribe una instrucción de 1 a 240 caracteres.']};
  const search=text.match(/^(?:busca|buscar|mezcla con|haz una mezcla de|quiero escuchar|dj con) (.+)$/);
  if(search && !/\b(?:solo conocidas|sin |mas variedad|menos variedad)\b/.test(search[1]))return {ok:true,action:'search',target:{title:search[1],artist:''},start:true,patch:{},labels:['Buscar música'],errors:[]};
  if(/menos comercial|mas comercial|menos viral|menos mainstream/.test(text))errors.push('No tengo datos para medir lo comercial. Prueba conocidas o excluye un artista.');
  const take=(re,fn)=>{text=text.replace(re,(...args)=>{fn(...args);return ' ';}).replace(/\s+/g,' ').trim();};
  take(/(?:e |y )?(?:inicia|iniciar|empieza|empezar|activa|activar) (?:el |una |la |mi )?(?:dj|sesion)/g,()=>{start=true;});
  const following=['solo','sin','mas variedad','menos variedad','permite','descubrir','hip hop','lo fi',...Object.keys(STYLE_NAMES)].join('|');
  const split=text.match(new RegExp('^(.*?)(?= y (?:'+following+')\\b|$)'));
  const targetClause=split?.[0]||text;
  const play=targetClause.match(/^(?:pon|reproduce|toca) (.+?)(?: de (.+))?$/);
  const referenceText=targetClause.match(/^(?:sigue|seguir|mas) (?:como|con) (?!esta\b)(.+?)(?: de (.+))?$/);
  if(play || referenceText){const m=play||referenceText;target={title:m[1].trim(),artist:(m[2]||'').trim()};action=play?'play':'reference';text=text.slice(targetClause.length).trim();}
  {
    let known=false,discover=false;
    take(/(?:solo )?(?:musica |canciones |rolas )?(?:que conozco|conocidas|conocidos)|menos descubrimiento|mi musica/g,()=>{known=true;});
    take(/(?:permite |permitir )?(?:descubrir|descubrimiento)|mas descubrimiento|musica nueva|canciones nuevas/g,()=>{discover=true;});
    if(known && discover)errors.push('Elige conocidas o descubrir; las dos órdenes se contradicen.');
    if(known || discover){patch.known=known;labels.push(known?'Solo conocidas':'Permitir descubrir');}
    take(/(?:sigue lo que estoy escuchando|sigue la cancion que estoy escuchando|continua con esta(?: cancion)?|mezcla a partir de esta(?: cancion)?|mas de esta|mas como esta|sigue como esta|(?:sigue|seguir|siguela|siguele)(?: (?:esta|la|esa|lo que suena))?(?: cancion| rola| musica)?|misma vibe|mismo estilo)/g,()=>{action='reference';target={current:true};start=true;labels.push('Seguir esta canción');});
    take(/(?:sin (?!repetir artistas)|evita |excluye |no pongas )(.+?)(?=\s+y\s+|\s+pero\s+|\s+mas variedad\b|\s+menos variedad\b|$)/g,(_,name)=>{(patch.excludedArtists ||= []).push(name.trim());labels.push('Sin '+name.trim());});
    take(/(?:mas variedad|sin repetir artistas|varia artistas)/g,()=>{patch.variety=80;labels.push('Variar artistas');});
    take(/(?:menos variedad|repite artistas)/g,()=>{if(patch.variety===80)errors.push('Más y menos variedad se contradicen.');patch.variety=10;labels.push('Artistas cercanos');});
    take(/otra (?:sugerencia|cancion|rola)|renueva (?:la |las )?(?:cola|sugerencias)/g,()=>{if(action!=='configure')errors.push('Separa la orden de renovar.');action='refresh';});
    take(/(?:deten|termina|para|apaga) (?:el |la )?(?:dj|sesion)/g,()=>{if(action!=='configure')errors.push('Separa la orden de terminar.');action='stop';});
    take(/(?:restaura|restaurar|devuelve) (?:mi |la )?(?:cola|lista)/g,()=>{if(action!=='configure')errors.push('Separa la orden de restaurar.');action='restore';});
    take(/hip hop|lo fi/g,m=>{(patch.styles ||= []).push(m==='hip hop'?'hip hop':'lofi');});
    for(const key of Object.keys(STYLE_NAMES))take(new RegExp('\\b'+key+'\\b','g'),()=>{(patch.styles ||= []).push(STYLE_NAMES[key]);});
    text=text.replace(/\b(?:y|pero|con|algo|de|musica|canciones|por favor|quiero|ponme|me|el|la|un|una)\b/g,' ').replace(/\s+/g,' ').trim();
    if(text){
      if(!target && !Object.keys(patch).length && action==='configure' && !start && !errors.length && !/\b(?:solo|sin|descubr|variedad|termina|deten|restaura|quiero|menos|mas|inicia|dj|sesion)\b/.test(text)){
        action='search';target={title:words(raw),artist:''};start=true;text='';labels.push('Buscar música');
      }else errors.push('No entendí: «'+text+'». Corrige esa parte antes de aplicar.');
    }
  }
  if(start && ['stop','restore'].includes(action))errors.push('Iniciar y terminar se contradicen.');
  if(patch.styles)labels.push(...patch.styles.map(x=>'Estilo: '+x));
  if(!target && !Object.keys(patch).length && action==='configure' && !start)errors.push('Prueba «solo conocidas», «más como esta» o «pon canción de artista».');
  return {ok:!errors.length,action,target,start,patch,labels,errors};
}
function intentLabels(intent){return [intent.known?'Solo conocidas':'Descubrir afines',...(intent.artist?[`${intent.artistMode==='only'?'Solo':'Protagonista'}: ${intent.artist.name}`]:[]),...intent.styles.map(t=>'Estilo: '+t),...intent.excludedArtists.map(t=>'Sin '+t),...(intent.variety>=60?['Variar artistas']:[])];}

function knownEvidence(t,m={}){
  const evidence=[];
  if(t.playlist || t.evidence?.includes('playlist'))evidence.push('playlist');
  if(t.evidence?.includes('megusta'))evidence.push('megusta');
  if(m.heard>0 || t.evidence?.includes('escucha'))evidence.push('escucha');
  if(m.vote>0 || t.evidence?.includes('voto'))evidence.push('voto');
  return [...new Set(evidence)];
}
const evidenceLabel=e=>e.map(x=>({playlist:'Tu playlist',megusta:'Tus Me gusta',escucha:'Escucha registrada',voto:'Voto positivo'})[x]).filter(Boolean).join(' · ');
const isKnown=(t,m)=>knownEvidence(t,m).some(e=>['playlist','megusta','escucha'].includes(e));
function contextKey(seed,intent){return JSON.stringify([intent.styles.slice().sort(),(intent.artist?[intent.artist]:seed?.artists||[]).map(artistKey).sort()]);}
function migrateProfile(data={}){
  if(!data || typeof data!=='object')data={};
  const memory={};
  for(const [uri,m]of Object.entries(data.memory||{}).slice(0,1000)){
    if(!valid(uri) || !m || typeof m!=='object')continue;
    const track=normalize(m.track);
    memory[uri]={plays:clamp(m.plays,0,100000),heard:data.schema===3?clamp(m.heard,0,100000):0,legacyPlays:data.schema===3?clamp(m.legacyPlays,0,100000):clamp(m.plays,0,100000),vote:clamp(m.vote,-5,5),lastPlayed:clamp(m.lastPlayed,0,Date.now()),lastSuggested:clamp(m.lastSuggested,0,Date.now()),dismissedAt:clamp(m.dismissedAt,0,Date.now()),...(track?{track}:{})};
  }
  const preferences={};for(const [key,v]of Object.entries(data.preferences||{}).slice(0,3000))if(!['__proto__','constructor','prototype'].includes(key) && key.length<160)preferences[key]=clamp(v,-3,3);
  const contexts={};
  if(data.schema===3)for(const [key,c]of Object.entries(data.contexts||{}).slice(-40)){
    if(key.length>1000 || !c || typeof c!=='object' || ['__proto__','constructor','prototype'].includes(key))continue;
    const votes={};for(const [uri,v]of Object.entries(c.votes||{}).slice(0,300))if(valid(uri))votes[uri]=clamp(v,-5,5);
    contexts[key]={votes};
  }
  const tags={};for(const [uri,values]of Object.entries(data.tags||{}).slice(0,1000))if(valid(uri) && Array.isArray(values))tags[uri]=intentOf({styles:values}).styles;
  const settings=data.schema===3?data.settings||{}:{...data.settings,discovery:0,diversity:25,queueSize:1,takeover:false,voice:true};
  const mixPlaylist=/^spotify:playlist:[A-Za-z0-9]{22}$/.test(data.mixPlaylist?.uri||'')?{uri:data.mixPlaylist.uri,name:String(data.mixPlaylist.name||'Mezcla POOR DJ').slice(0,200),count:clamp(data.mixPlaylist.count,0,300)}:null;
  return {schema:3,memory,preferences,contexts,tags,intent:intentOf(data.schema===3?data.intent:{}),settings,recovery:data.recovery||{},mixPlaylist};
}
class ChoiceDeck{
  constructor(random=Math.random){this.random=random;this.tracks=[];this.offset=0;this.pair=[];this.signature='';}
  set(tracks){
    const unique=[...new Map(tracks.map(t=>[t.uri,t])).values()].slice(0,300),signature=unique.map(t=>t.uri).sort().join('|');
    if(signature===this.signature && this.tracks.length)return this.next();
    this.signature=signature;this.tracks=unique;this.shuffle();this.offset=0;return this.next();
  }
  shuffle(){for(let i=this.tracks.length-1;i>0;i--){const j=Math.floor(this.random()*(i+1));[this.tracks[i],this.tracks[j]]=[this.tracks[j],this.tracks[i]];}}
  next(){this.pair=this.tracks.slice(this.offset,this.offset+2);this.offset+=this.pair.length;return this.pair;}
  reset(){this.shuffle();this.offset=0;return this.next();}
  get exhausted(){return this.offset>=this.tracks.length;}
}

class MusicLibrary{
  constructor(platform,requests){this.platform=platform;this.requests=requests;this.tracks=new Map();this.playlists=[];this.loadedPlaylists=new Set();this.flight=null;this.updatedAt=0;this.status='Me gusta y playlists todavía sin consultar.';this.disposed=false;}
  read(key,fetcher){return this.requests.get('library:'+key,fetcher);}
  add(data,evidence){
    for(const track of collect(data,'tu colección')){
      const old=this.tracks.get(track.uri),proof=[...new Set([...(old?.evidence||[]),evidence])];
      this.tracks.set(track.uri,{...track,image:track.image||old?.image||'',evidence:proof,playlist:proof.includes('playlist')});
    }
    while(this.tracks.size>1000)this.tracks.delete(this.tracks.keys().next().value);
  }
  snapshot(){return [...this.tracks.values()];}
  async load(context='',force=false,chosen=''){
    if(this.disposed)return [];
    if(this.flight)return this.flight;
    if(!force && !chosen && Date.now()-this.updatedAt<300000)return this.snapshot();
    this.status='Consultando tus Me gusta y playlists…';
    this.flight=this.fetch(context,force,chosen).finally(()=>{this.flight=null;});return this.flight;
  }
  async fetch(context,force,chosen){
    const P=this.platform,stamp=force?Date.now():'';let failures=0;
    const results=await Promise.allSettled([
      P.LibraryAPI?.getTracks?this.read('liked:'+stamp,()=>P.LibraryAPI.getTracks({offset:0,limit:160})):Promise.reject(Error('Me gusta no disponible')),
      P.RootlistAPI?.getContents?this.read('root:'+stamp,()=>P.RootlistAPI.getContents()):Promise.reject(Error('Playlists no disponibles'))
    ]);
    if(this.disposed)return [];
    if(results[0].status==='fulfilled')this.add(results[0].value,'megusta');else failures++;
    if(results[1].status==='fulfilled'){
      const found=new Map(),seen=new WeakSet();let nodes=0;
      const walk=(x,d=0)=>{if(!x || typeof x!=='object' || d>12 || seen.has(x) || nodes++>3000)return;seen.add(x);if(/^spotify:playlist:/.test(x.uri||''))found.set(x.uri,{uri:x.uri,name:x.name||'Playlist'});for(const v of Object.values(x))if(v && typeof v==='object')walk(v,d+1);};
      walk(results[1].value);this.playlists=[...found.values()].slice(0,100);
    }else failures++;
    const selected=chosen?[chosen]:[...new Set([context,...this.playlists.map(p=>p.uri)].filter(uri=>/^spotify:playlist:/.test(uri)))].slice(0,7);
    for(let i=0;i<selected.length && !this.disposed;i+=2){
      const batch=await Promise.allSettled(selected.slice(i,i+2).map(async uri=>{
        if(!P.PlaylistAPI?.getContents)throw Error('Playlist no disponible');
        for(let offset=0;offset<(chosen?300:50);offset+=100){
          const limit=chosen?100:50,data=await this.read(uri+':'+offset+':'+limit+':'+stamp,()=>P.PlaylistAPI.getContents(uri,{offset,limit}));
          if(this.disposed)return;this.add(data,'playlist');
          if((data.items?.length||0)<limit)break;
        }
        this.loadedPlaylists.add(uri);
      }));failures+=batch.filter(r=>r.status==='rejected').length;
    }
    this.updatedAt=Date.now();const liked=this.snapshot().filter(t=>t.evidence.includes('megusta')).length;
    this.status=`${liked} Me gusta cargados · ${this.loadedPlaylists.size}/${this.playlists.length} playlists consultadas · ${this.tracks.size} canciones en estas fuentes.${failures?' Algunas fuentes no respondieron.':''}`;
    return this.snapshot();
  }
  dispose(){this.disposed=true;this.tracks.clear();}
}

function collectArtists(data){
  const found=new Map(),seen=new WeakSet();let nodes=0;
  const walk=(x,d=0)=>{if(!x || typeof x!=='object' || d>12 || seen.has(x) || nodes++>2000)return;seen.add(x);
    const name=x.profile?.name||x.name;
    if(/^spotify:artist:[A-Za-z0-9]{22}$/.test(x.uri||'') && name){const old=found.get(x.uri);found.set(x.uri,{uri:x.uri,name,image:x.visuals?.avatarImage?.sources?.[0]?.url||x.visualIdentity?.squareCoverImage?.sources?.[0]?.url||old?.image||''});}
    for(const v of Object.values(x))if(v && typeof v==='object')walk(v,d+1);
  };walk(data);return [...found.values()].slice(0,6);
}
const hasArtist=(track,artist)=>!!artist && track?.artists?.some(a=>a.uri && artist.uri?a.uri===artist.uri:words(a.name)===words(artist.name));
const mixUris=(pending,key,tracks)=>[...new Set((pending?.key===key && Array.isArray(pending.tracks)?pending.tracks:tracks.map(t=>t.uri)).filter(valid))].slice(0,24);
function artistChoice(ranked,recent,intent){
  if(!intent.artist || intent.artistMode!=='mix')return null;
  let streak=0;for(let i=recent.length-1;i>=0 && hasArtist(recent[i],intent.artist);i--)streak++;
  const target=ranked.find(x=>hasArtist(x.t,intent.artist)),other=ranked.find(x=>!hasArtist(x.t,intent.artist));
  return (streak>=3 && other?other:target||other)?.t||null;
}

function transitionFit(a,b){
  const base=compatibility(a,b);let sum=base.value===null?0:base.value*base.coverage,weight=base.coverage;
  const loudness=Number.isFinite(a?.loudness)&&Number.isFinite(b?.loudness)?Math.abs(a.loudness-b.loudness):null;
  if(loudness!==null){sum+=.2*(1-Math.min(loudness/8,1));weight+=.2;}
  return {value:weight?sum/weight:null,coverage:Math.min(weight,1),tempo:base.tempo,key:base.key,loudness};
}
function transitionLabel(a,b){const f=transitionFit(a,b),parts=[];if(f.tempo!==null && f.tempo<=.06)parts.push('tempo cercano');if(f.key!==null && f.key<=1)parts.push('tono compatible');if(f.loudness!==null && f.loudness<=3)parts.push('nivel parecido');return parts.length?'Continuidad: '+parts.join(' · '):'Sin continuidad acústica verificada; se prioriza la referencia.';}
class NativeTransitions{
  constructor(platform,storage,local){this.platform=platform;this.storage=storage;this.local=local;}
  state(){const s=this.platform.SettingsAPI?.playback;return {enabled:s?.audioCrossfade?.value===true,seconds:Math.round((s?.audioCrossfadeMs?.value||0)/1000),gapless:s?.gapless?.value===true,available:this.local() && typeof s?.audioCrossfade?.setValue==='function' && typeof s?.audioCrossfadeMs?.setValue==='function'};}
  async refresh(){const s=this.platform.SettingsAPI?.playback;await Promise.all(['audioCrossfade','audioCrossfadeMs'].map(k=>s?.[k]?.getValue?.()));return this.state();}
  async apply(seconds){
    await this.refresh();
    if(!this.state().available)throw Error('Las transiciones se ajustan en el dispositivo local compatible.');
    const s=this.platform.SettingsAPI.playback,previous={enabled:s.audioCrossfade.value===true,ms:s.audioCrossfadeMs.value||0};
    if(!this.storage.getItem('poor-dj-transition-recovery'))this.storage.setItem('poor-dj-transition-recovery',previous);
    try{await s.audioCrossfadeMs.setValue(clamp(seconds,0,12)*1000);await s.audioCrossfade.setValue(seconds>0);await this.refresh();if(s.audioCrossfade.value!==(seconds>0)||s.audioCrossfadeMs.value!==clamp(seconds,0,12)*1000)throw Error('Spotify no confirmó el nuevo ajuste de transición.');}
    catch(e){await s.audioCrossfadeMs.setValue(previous.ms);await s.audioCrossfade.setValue(previous.enabled);await this.refresh();throw e;}
    return seconds;
  }
  async restore(){const r=this.storage.getItem('poor-dj-transition-recovery');if(!r)return;if(!this.state().available)throw Error('Vuelve al dispositivo local para restaurar.');const s=this.platform.SettingsAPI.playback;await s.audioCrossfadeMs.setValue(r.ms);await s.audioCrossfade.setValue(r.enabled);await this.refresh();if(s.audioCrossfade.value!==r.enabled || s.audioCrossfadeMs.value!==r.ms)throw Error('Spotify no confirmó la restauración.');this.storage.setItem('poor-dj-transition-recovery',null);}
}

function commentary(event,seed,intent,sequence=0){
  const title=songKey(seed?.name||'esta canción'),artist=intent.artist?.name||seed?.artists?.[0]?.name||'tu referencia';
  const direction=intent.styles.length?intent.styles.map(t=>STYLE_NAMES[words(t)]||t).join(' y '):intent.artistMode==='only'?'solo '+artist:intent.artistMode==='mix'?'la música de '+artist:'el sonido de '+artist;
  const intros=event==='start'?[
    `Tomamos ${title} como referencia.`,`El punto de partida es ${title}.`,`Nos guiamos por ${title}.`,`Arrancamos alrededor de ${title}.`,`La referencia de esta sesión es ${title}.`,`Empezamos desde ${title}.`
  ]:event==='direction'?[
    `La dirección es ${direction}.`,`Nos guiamos por ${direction}.`,`Seguimos con ${direction}.`,`Tu rumbo queda claro: ${direction}.`,`La referencia mantiene ${direction}.`,`Trabajamos con ${direction}.`
  ]:[`Seguimos con ${direction}.`,`Mantenemos ${direction} como guía.`,`El hilo sigue siendo ${direction}.`,`Nos quedamos cerca de ${direction}.`,`La sesión continúa con ${direction}.`,`Conservamos ${direction} como referencia.`];
  const middles=intent.artistMode==='only'?['Dentro de su catálogo.','Sin salir del artista elegido.','También caben sus colaboraciones.','El artista lleva toda la sesión.','Seguimos con sus canciones.','La selección queda centrada en su música.','Tu artista es el límite.']:intent.artistMode==='mix'?['El artista lleva el protagonismo.','Dejamos espacio para música afín.','Sus canciones son la base.','La mayoría será de este artista.','Damos prioridad a su catálogo.','La mezcla gira alrededor de su sonido.','Los otros artistas entran por afinidad.']:intent.known?['Entre tu música conocida.','Desde tus fuentes personales.','Con canciones de tus fuentes permitidas.','Tu biblioteca es la base.','Seguimos con música que ya conoces.','Sin ampliar al catálogo desconocido.','Tus fuentes marcan la selección.']:['Con espacio para descubrir.','Buscamos afinidad con esa referencia.','Las propuestas siguen esta dirección.','Hay espacio para artistas cercanos.','Seguimos las fuentes permitidas.','La afinidad guía las propuestas.','El descubrimiento mantiene esta referencia.'];
  const endings=event==='block'?['Puedes cambiar el rumbo cuando quieras.','Tu elección sigue teniendo prioridad.','Si algo no encaja, puedes indicarlo.','Mantengo tus instrucciones vigentes.','Tú decides hacia dónde seguimos.']:event==='direction'?['Tus instrucciones quedan aplicadas.','Tu elección guía la sesión.','Puedes ajustar el rumbo de nuevo.','Seguimos según lo que pediste.','Tú conservas el control.']:['Tú decides la próxima dirección.','Puedes guiarme cuando quieras.','Tu elección tiene prioridad.','El rumbo lo marcas tú.','Puedes ajustar la sesión a tu gusto.'];
  const n=(Math.abs(Math.floor(sequence))*47)%210;
  return `${intros[n%intros.length]} ${middles[Math.floor(n/6)%middles.length]} ${endings[Math.floor(n/42)%endings.length]}`.split(/\s+/).slice(0,25).join(' ');
}
class Narrator{
  constructor(host,changed=()=>{}){this.host=host;this.changed=changed;this.enabled=true;this.voice=null;this.text='';this.sequence=Math.floor(Math.random()*10000);this.recent=[];this.disposed=false;this.detect=this.detect.bind(this);host.speechSynthesis?.addEventListener?.('voiceschanged',this.detect);this.detect();}
  detect(){if(this.voice || this.disposed)return;let voices=[];try{voices=this.host.speechSynthesis?.getVoices?.()||[];}catch(_){}const local=voices.filter(v=>v.localService===true && /^es(?:-|$)/i.test(v.lang));this.voice=local.find(v=>/sabina/i.test(v.name) && /^es-MX$/i.test(v.lang))||local.find(v=>/^es-MX$/i.test(v.lang))||local[0]||null;this.changed();}
  canSpeak(local=true){return !this.disposed && this.enabled && !!this.voice && local && !!this.host.SpeechSynthesisUtterance;}
  say(event,seed,intent,local=true){
    if(this.disposed)return Promise.resolve({cancelled:true});this.cancel();for(let tries=0;tries<20;tries++){this.text=commentary(event,seed,intent,this.sequence++);if(!this.recent.includes(this.text))break;}this.recent.push(this.text);this.recent=this.recent.slice(-20);this.changed();
    if(!this.canSpeak(local))return Promise.resolve({spoken:false});
    const utterance=new this.host.SpeechSynthesisUtterance(this.text);utterance.voice=this.voice;utterance.lang=this.voice.lang;utterance.rate=this.rate||.96;utterance.pitch=1.02;utterance.volume=1;
    return new Promise(resolve=>{
      const finish=result=>{if(this.finish!==finish)return;clearTimeout(this.watchdog);this.finish=null;this.speaking=false;this.changed();resolve(result);};
      this.finish=finish;this.speaking=true;this.changed();
      utterance.onend=()=>finish({spoken:true});utterance.onerror=()=>{this.voice=null;finish({spoken:false});};
      this.watchdog=setTimeout(()=>{this.voice=null;finish({spoken:false});try{this.host.speechSynthesis.cancel();}catch(_){}},20000);
      try{this.host.speechSynthesis.speak(utterance);}catch(_){this.voice=null;finish({spoken:false});}
    });
  }
  cancel(){this.finish?.({cancelled:true});try{this.host.speechSynthesis?.cancel?.();}catch(_){} }
  toggle(){this.enabled=!this.enabled;if(!this.enabled){this.finish?.({spoken:false});try{this.host.speechSynthesis?.cancel?.();}catch(_){}}this.changed();return this.enabled;}
  dispose(){this.disposed=true;this.cancel();this.host.speechSynthesis?.removeEventListener?.('voiceschanged',this.detect);}
}
// A narration owns only its own pause. User playback, devices and stop revoke it.
class VoiceGate{
  constructor(narrator,music){this.narrator=narrator;this.music=music;this.lease=null;}
  cancel(){this.lease=null;this.narrator.cancel();}
  playbackChanged(){if(this.lease?.expectedPause && !this.music.playing()){this.lease.expectedPause=false;return;}this.cancel();}
  async run(event,seed,intent,{resume=true,local=true}={}){
    const inherited=this.lease;this.cancel();
    if(!this.narrator.canSpeak(local))return this.narrator.say(event,seed,intent,local);
    if(!this.music.pause || !this.music.resume)return this.narrator.say(event,seed,intent,false);
    const playing=this.music.playing(),uri=this.music.uri(),device=this.music.device();
    const lease={uri,device,wasPlaying:playing || !!(inherited?.wasPlaying && inherited.uri===uri && inherited.device===device),expectedPause:playing};this.lease=lease;
    try{
      if(playing)await this.music.pause();
      if(this.lease!==lease)return {cancelled:true};
      const result=await this.narrator.say(event,seed,intent,local);
      if(this.lease!==lease || result.cancelled || this.music.uri()!==lease.uri || this.music.device()!==lease.device){if(this.lease===lease)this.lease=null;return {cancelled:true};}
      this.lease=null;
      if(resume && lease.wasPlaying && this.music.uri()===lease.uri && this.music.device()===lease.device && !this.music.playing())await this.music.resume();
      return result;
    }catch(_){if(this.lease===lease){this.lease=null;if(lease.wasPlaying && resume && this.music.uri()===lease.uri && this.music.device()===lease.device)await this.music.resume();}return {spoken:false};}
  }
}

// Membership is checked against the seed and its explicitly related artists.
// A recursively collected overview can include unrelated tracks and playlists.
function affinityPool(seed,related,groups,intent=intentOf(),tags={}){
  const seedKeys=new Set(seed.artists.map(artistKey));
  const allowed=new Set([...seedKeys,...related]);
  const result=new Map();
  for(const {tracks,source,familiar=false}of groups){
    for(const raw of tracks){
      const t=normalize(raw,source);if(!t || !t.name)continue;
      const styles=[...(t.styles||[]),...(tags[t.uri]||[])].map(words);
      const styleMatch=intent.styles.length && intent.styles.every(tag=>styles.includes(words(tag)));
      if(!t.artists.some(a=>allowed.has(artistKey(a))) && !styleMatch)continue;
      const existing=result.get(t.uri),same=t.artists.some(a=>seedKeys.has(artistKey(a)));
      const evidence=[...new Set([...(raw.evidence||[]),...(existing?.evidence||[]),...(raw.playlist?['playlist']:[])])];
      result.set(t.uri,{...t,styles,source:familiar?source:same?'artista actual':'artista relacionado',affinity:true,evidence,familiar:familiar || !!existing?.familiar});
    }
  }
  return [...result.values()];
}

// Release owned queue entries BEFORE an explicit play command reaches Spotify.
// Song-change remains a fallback for clients bypassing the exposed PlayerAPI.
function guardPlay(api,onRequest){
  if(typeof api?.play!=='function')return ()=>{};
  const original=api.play;
  function guarded(...args){
    const release=onRequest();
    if(!release)return original.apply(this,args);
    return Promise.resolve(release).then(()=>original.apply(this,args));
  }
  try{api.play=guarded;}catch(_){return ()=>{};}
  return ()=>{if(api.play===guarded)api.play=original;};
}

if(typeof module!=='undefined' && module.exports){module.exports={Engine,normalize,compatibility,settingsOf,AudioLibrary,RequestCache,sameEntry,affinityPool,guardPlay,parseCommand,intentOf,intentLabels,knownEvidence,migrateProfile,ChoiceDeck,Narrator,VoiceGate,MusicLibrary,isKnown,collectArtists,hasArtist,mixUris,artistChoice,transitionFit,transitionLabel,NativeTransitions,commentary,contextKey,words,songKey,queryDefinition};return;}
const CSS=".pd,.pd-mini{--pd-accent:#1ed760;--pd-ink:#000;--pd-bg:var(--spice-main,#121212);--pd-text:var(--spice-text,#fff);--pd-sub:var(--spice-subtext,#b3b3b3);color:var(--pd-text);font-family:inherit;box-sizing:border-box}\n.pd[data-accent=theme],.pd-mini[data-accent=theme]{--pd-accent:var(--spice-button,#1ed760)}\n.pd[data-accent=blue],.pd-mini[data-accent=blue]{--pd-accent:#74b9ff}.pd[data-accent=violet],.pd-mini[data-accent=violet]{--pd-accent:#c4a3ff}.pd[data-accent=rose],.pd-mini[data-accent=rose]{--pd-accent:#ff9cbd}\n.pd{background:var(--pd-bg);padding:24px;width:100%;max-width:700px;border-radius:8px;font-size:14px;line-height:1.5}.pd *{box-sizing:border-box}.pd button,.pd input,.pd select{font:inherit}.pd button{cursor:pointer;color:inherit}.pd button:disabled{opacity:.5;cursor:wait}.pd button:focus-visible,.pd input:focus-visible,.pd select:focus-visible,.pd summary:focus-visible{outline:2px solid var(--pd-accent);outline-offset:3px}.pd [hidden],.pd-mini[hidden]{display:none!important}\n.pd-header,.pd-brand,.pd-queuehead,.pd-feedback{display:flex;align-items:center;gap:12px}.pd-header{justify-content:space-between}.pd-brand>svg{color:var(--pd-accent);width:24px;height:24px}.pd h1{font-size:22px;letter-spacing:-.5px;font-weight:750;margin:0}.pd h1 small{font-size:11px;color:var(--pd-sub);font-weight:400;margin-left:5px}.pd-live{font-size:12px;color:var(--pd-sub)}.pd-live.pd-active{color:var(--pd-accent)}.pd-live.pd-active:before{content:'●';padding-right:6px}.pd-intro,.pd-explanation,.pd-note{color:var(--pd-sub);font-size:12px;margin:8px 0 18px}\n.pd-playing{display:flex;align-items:center;gap:12px;padding:12px;background:var(--spice-card,#181818);border-radius:6px;margin-bottom:18px}.pd-cover{height:56px;width:56px;position:relative;display:grid;place-items:center;background:var(--spice-highlight,#282828);border-radius:4px;flex-shrink:0;overflow:hidden}.pd-cover img{position:absolute;width:100%;height:100%;object-fit:cover}.pd-playing>div:last-child{min-width:0}.pd-playing small{font-size:11px;color:var(--pd-sub)}.pd h2{font-size:16px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin:1px 0;font-weight:650}.pd-playing p{font-size:12px;color:var(--pd-sub);margin:0}\n.pd-feedback{margin:18px 0;padding-bottom:18px;border-bottom:1px solid var(--spice-highlight,#282828)}.pd-feedback>span{margin-right:auto;color:var(--pd-sub);font-size:12px}.pd-feedback button,.pd-profile button,.pd-details button{background:none;border:1px solid var(--spice-button-disabled,#666);border-radius:20px;font-size:11px;font-weight:600;padding:6px 12px}.pd-feedback button:hover,.pd-profile button:hover,.pd-details button:hover{border-color:var(--pd-text)}\n.pd-queuehead{margin-bottom:7px}.pd h3{font-size:14px;margin:0;flex:1}.pd-queuehead small{font-size:11px;color:var(--pd-sub)}.pd-queuehead button,.pd-next>button{background:none;border:0;font-size:22px;color:var(--pd-sub);border-radius:50%;width:30px;height:30px;line-height:1}.pd-queuehead button:hover,.pd-next>button:hover{color:var(--pd-text);background:var(--spice-highlight,#282828)}.pd-next{display:flex;align-items:center;gap:12px;padding:9px 4px;border-radius:4px}.pd-next:hover{background:var(--spice-highlight,#242424)}.pd-index{color:var(--pd-sub);font-size:12px;width:12px;text-align:right}.pd-next>div{flex:1;min-width:0}.pd-next b{display:block;font-size:12px;font-weight:600;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}.pd-next small{display:block;font-size:11px;color:var(--pd-sub);overflow:hidden;white-space:nowrap;text-overflow:ellipsis}.pd-empty{font-size:12px;color:var(--pd-sub);padding:12px 0;margin:0 0 12px}\n.pd-primary{display:block;width:100%;background:var(--pd-accent);color:var(--pd-ink)!important;border:0;border-radius:24px;padding:11px;margin-top:16px;font-size:14px;font-weight:700}.pd-primary:hover{filter:brightness(1.06)}.pd-status{font-size:11px;color:var(--pd-sub);margin:10px 0;line-height:1.5}.pd-error{color:#ffa59c}.pd-link{border:0;background:none;text-decoration:underline;color:var(--pd-sub);font-size:12px}.pd-details{border-top:1px solid var(--spice-highlight,#282828);padding:11px 0;font-size:12px;color:var(--pd-sub)}.pd-details summary{cursor:pointer;color:var(--pd-text);font-size:12px;font-weight:600}.pd-details p{margin:10px 0;line-height:1.6}.pd-details a{display:inline-block;color:var(--pd-text);margin:10px 0 0 10px;font-size:11px}.pd-options{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:13px 0}.pd-options label{display:grid;gap:6px}.pd select{width:100%;background:var(--spice-card,#242424);color:var(--pd-text);border:1px solid var(--spice-button-disabled,#666);border-radius:4px;padding:7px;font-size:12px}.pd-check{display:flex;align-items:center;gap:8px;margin:12px 0}.pd-check input{accent-color:var(--pd-accent)}.pd-profile{display:flex;gap:7px;flex-wrap:wrap}.pd-note{font-size:10px;margin:8px 0}\n.pd-compact{padding:16px}.pd-compact .pd-intro,.pd-compact .pd-sliders small{display:none}.pd-compact .pd-playing{margin-top:12px;margin-bottom:12px;padding:8px}.pd-compact .pd-cover{width:42px;height:42px}.pd-compact .pd-feedback{margin:12px 0;padding-bottom:12px}.pd-compact .pd-next{padding:5px 4px}\n.pd-mini{position:fixed;bottom:100px;right:24px;z-index:1000;display:flex;align-items:center;background:var(--spice-card,#202020);border:1px solid var(--spice-highlight,#444);border-radius:30px;box-shadow:0 4px 20px #0006;padding:5px}.pd-mini button{display:flex;gap:8px;align-items:center;background:none;border:0;color:var(--pd-text);padding:8px 10px;font:inherit;font-size:12px;cursor:pointer;border-radius:24px}.pd-mini button:hover{background:var(--spice-highlight,#333)}.pd-mini svg,.pd-mini small{color:var(--pd-accent)}.pd-mini small{font-size:11px}.pd-mini button:focus-visible{outline:2px solid var(--pd-accent)}\n@media(max-width:540px){.pd{padding:16px}.pd-modes{gap:4px}.pd-modes button{padding:7px 9px;font-size:11px}.pd-sliders{gap:16px}.pd-feedback{gap:7px}.pd-options{grid-template-columns:1fr}.pd-mini{right:12px;bottom:95px}.pd h1{font-size:20px}}\n.pd-sr{position:absolute;clip:rect(0,0,0,0);width:1px;height:1px;overflow:hidden}.pd-bars{display:inline-flex;align-items:end;gap:2px;height:11px;margin-left:5px}.pd-bars i{display:block;background:var(--pd-accent);height:4px;width:2px}.pd[data-playing=true] .pd-bars i{animation:pd-pulse 1s ease-in-out infinite alternate}.pd[data-playing=true] .pd-bars i:nth-child(2){animation-delay:-.4s}.pd[data-playing=true] .pd-bars i:nth-child(3){animation-delay:-.7s}.pd .pd-next .pd-reason{color:var(--pd-accent);font-size:10px;margin-top:3px}.pd-next [data-pin][aria-pressed=true]{color:var(--pd-accent)}.pd-presets{display:flex;gap:6px;flex-wrap:wrap;margin:14px 0}.pd .pd-primary{font-weight:700}.pd button{transition:background-color .15s,color .15s,filter .15s}.pd-feedback{flex-wrap:wrap}.pd-details>label{display:grid;gap:6px;margin:12px 0}.pd-compact .pd-compact .pd-reason{display:none}\n@keyframes pd-pulse{to{height:11px}}@media(prefers-reduced-motion:reduce){.pd button{transition:none}.pd[data-playing=true] .pd-bars i{animation:none}}\n@media(max-width:420px){.pd-feedback button{padding:6px 9px}.pd-sliders{grid-template-columns:1fr}.pd-next{gap:7px}}\n.pd-reference{font-size:12px;margin:12px 0}.pd-reference small{color:var(--pd-sub)}.pd-reference p{margin:3px 0;overflow-wrap:anywhere}.pd-chips,.pd-examples,.pd-pickeractions{display:flex;gap:6px;flex-wrap:wrap;margin:10px 0}.pd-chip{background:var(--spice-highlight,#282828);padding:4px 9px;border-radius:16px;font-size:11px}.pd-command label{display:block;font-weight:600;margin:12px 0 7px}.pd-command>div{display:flex;gap:8px}.pd input[type=text],.pd input:not([type]){min-width:0;width:100%;background:var(--spice-card,#242424);color:var(--pd-text);border:1px solid #666;border-radius:8px;padding:10px;font:inherit}.pd-command button,.pd-examples button,.pd-presets button,.pd-pickeractions button,.pd-narration button,.pd-secondary{border:1px solid var(--spice-button-disabled,#666);background:transparent;color:var(--pd-text);border-radius:20px;padding:7px 12px;font-size:12px}.pd-presets button.pd-selected{background:var(--pd-accent);border-color:var(--pd-accent);color:#000}.pd-examples button{font-size:10px;padding:4px 9px}.pd-cards{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin:12px 0}.pd-choice{display:grid;gap:5px;min-width:0;text-align:left;border:0;border-radius:8px;padding:12px;background:var(--spice-card,#181818);animation:pd-enter .18s ease-out}.pd-choice:hover{background:var(--spice-highlight,#282828)}.pd-choice b,.pd-choice small{overflow-wrap:anywhere}.pd-choice b{font-size:13px}.pd-choice small{font-size:11px;color:var(--pd-sub)}.pd-choice .pd-evidence{color:var(--pd-accent);font-size:10px}.pd-choicecover{position:relative;display:grid;place-items:center;aspect-ratio:1;border-radius:5px;overflow:hidden;background:var(--spice-highlight,#282828);margin-bottom:4px}.pd-choicecover>img{width:100%;height:100%;object-fit:cover}.pd-choiceplay{position:absolute;bottom:8px;right:8px;border-radius:50%;background:var(--pd-accent);color:#000;padding:8px 12px;box-shadow:0 3px 12px #0007}.pd-picker{border:1px solid var(--spice-highlight,#333);padding:14px;border-radius:10px;margin:14px 0;animation:pd-enter .2s ease-out}.pd-picker>p{font-size:12px;color:var(--pd-sub)}.pd-narration{background:var(--spice-card,#181818);border-left:3px solid var(--pd-accent);padding:12px;border-radius:6px;margin:16px 0}.pd-narration p{font-size:13px;margin:0 0 10px}.pd-narration small{display:block;color:var(--pd-sub);font-size:10px;margin-top:8px}.pd .pd-other{width:auto;height:auto;font-size:11px;line-height:1.4;border:1px solid #666;border-radius:20px;padding:6px 10px}.pd-secondary{display:block;width:100%;margin:8px 0}.pd [data-tag]{display:grid;gap:8px;margin:12px 0}.pd button{transition:background-color .18s,color .18s,transform .18s,opacity .18s}.pd button:not(:disabled):active{transform:scale(.98)}\n@keyframes pd-enter{from{opacity:0;transform:translateY(7px)}to{opacity:1;transform:translateY(0)}}\n@media(prefers-reduced-motion:reduce){.pd *{animation:none!important;transition:none!important}}@media(max-width:350px){.pd-cards{gap:7px}.pd-choice{padding:8px}.pd-command>div{flex-wrap:wrap}.pd-command button{width:100%}}\n.pd-artist-photo{border-radius:50%}.pd [data-matches]{padding:12px;border:1px solid var(--spice-highlight,#333);border-radius:8px}.pd .pd-next .pd-flow{font-size:10px;color:var(--pd-sub)}\n\n/* POOR DJ: a small music desk, with the daily controls always in reach. */\n.pd{max-width:640px;padding:22px;border-radius:12px}.pd-header{margin:0}.pd h1{letter-spacing:-1px;font-size:24px}.pd-byline{display:flex;justify-content:space-between;gap:12px;color:var(--pd-sub);font-size:11px;margin:5px 0 18px}.pd-header .pd-voice,.pd-follow{border:0;background:var(--spice-highlight,#252525);border-radius:22px;padding:7px 12px;font-size:11px}.pd-follow{margin:0 0 10px}.pd-reference{margin:10px 0;font-size:11px}.pd-reference p{margin:1px 0}.pd-playing{margin-bottom:10px}.pd-command label{font-size:14px}.pd-command button{white-space:nowrap;padding:8px 11px;font-size:11px}.pd-feedback{margin:12px 0;padding-bottom:12px;gap:8px}.pd-feedbackmore{margin-left:auto;position:relative;font-size:11px}.pd-feedbackmore summary{cursor:pointer;color:var(--pd-sub);padding:6px}.pd-feedbackmore[open]{width:100%;margin:0}.pd-feedbackmore button{margin:5px 4px 0 0}.pd-customize{margin-top:14px;border-top:1px solid var(--spice-highlight,#282828);padding-top:14px}.pd-customize>summary{font-size:12px;cursor:pointer;color:var(--pd-sub)}.pd-customize .pd-details{margin-top:10px}.pd-narration{padding:10px 12px;margin:12px 0}.pd-narration p{margin:0;font-size:12px}.pd .pd-note{font-size:11px;line-height:1.5}.pd-choicecover{max-height:118px;aspect-ratio:auto;height:118px}.pd-choiceplay{padding:6px 10px;font-size:12px}.pd-choice{padding:10px}.pd-picker{padding:12px;margin:12px 0}.pd-picker>p{font-size:11px;margin:6px 0}.pd-presets{margin:12px 0}.pd-presets button{font-size:11px;padding:6px 10px}.pd [data-matches]{max-height:320px;overflow-y:auto;overscroll-behavior:contain;padding:10px}.pd-results{display:grid;gap:5px;margin-top:8px}.pd-results .pd-choice{display:grid;grid-template-columns:42px minmax(0,1fr);column-gap:10px;row-gap:2px;padding:7px;align-items:center}.pd-results .pd-choicecover{grid-row:1/4;width:42px;height:42px;margin:0}.pd-results .pd-choice b,.pd-results .pd-choice small{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;overflow-wrap:normal}.pd-results .pd-choiceplay{display:none}.pd-artistmenu{padding:14px;background:var(--spice-card,#181818);border-radius:10px;animation:pd-enter .18s ease-out}.pd-artistmenu p{font-size:11px;color:var(--pd-sub);margin:8px 0}.pd-menuhead{display:flex;align-items:center;gap:10px}.pd-menuhead button{background:none;border:0;font-size:11px;color:var(--pd-sub)}.pd-mode{border:1px solid var(--spice-highlight,#333);padding:14px;align-content:start}.pd-mode:hover{border-color:var(--pd-accent)}.pd-mode b{color:var(--pd-accent)}.pd-primary{margin-top:12px}.pd-compact .pd-reference{font-size:10px}.pd-compact .pd-choicecover{height:90px}.pd-cover>svg{color:var(--pd-accent)}\n@media(max-width:540px){.pd{padding:16px}.pd-byline{font-size:10px}.pd h1{font-size:22px}.pd-header .pd-voice{padding:6px 9px;font-size:10px}.pd-command>div{gap:6px}.pd-command input{font-size:12px}.pd-cards{gap:8px}}\n@media(prefers-reduced-motion:reduce){.pd *{animation:none!important;transition:none!important}}\n";
function mountUI(S,engine,{audio,queue,narrator,voiceGate,library,transitions,recovery,recoverVolume}){
  const style=document.createElement('style');style.id='poor-dj-style';style.textContent=CSS;document.head.append(style);
  let panel;const mini=document.createElement('aside');mini.className='pd-mini';mini.hidden=true;mini.setAttribute('aria-label','Sesión POOR DJ');
  mini.innerHTML=`<button data-open>${ICON}<span>POOR DJ</span></button><button data-stop aria-label="Terminar DJ">■</button>`;document.body.append(mini);
  const perform=async work=>{try{await work();}catch(e){engine.notify(e.message,true);}finally{update();}};
  mini.querySelector('[data-open]').onclick=()=>open();mini.querySelector('[data-stop]').onclick=()=>perform(()=>engine.stop());
  const playbar=new S.Playbar.Button('POOR DJ',ICON,()=>open());
  const theme=node=>{node.dataset.accent=engine.settings.accent;node.classList.toggle('pd-compact',engine.settings.compact);};
  const text=(key,value)=>{const n=panel?.querySelector(`[data-${key}]`);if(n && n.textContent!==String(value))n.textContent=value;};
  const download=(data,name)=>{const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
  function cards(tracks,kind){
    return tracks.map(t=>`<button class="pd-choice" data-${kind}="${esc(t.uri)}" ${engine.choiceBusy?'disabled':''}><span class="pd-choicecover">${imageURL(t.image)?`<img src="${esc(imageURL(t.image))}" alt="" loading="eager">`:ICON}<span class="pd-choiceplay">▶</span></span><b>${esc(t.name)}</b><small>${esc(t.artists.map(a=>a.name).join(', '))}</small><small class="pd-evidence">${esc(evidenceLabel(t.evidence||knownEvidence(t,engine.memory[t.uri]))||t.album||'Resultado de Spotify')}</small></button>`).join('');
  }
  function update(){
    playbar.active=engine.active;theme(mini);mini.hidden=!engine.settings.mini || !engine.active;
    if(!panel?.isConnected)return;theme(panel);panel.dataset.playing=String(engine.active && S.Player.isPlaying());
    text('live',narrator.speaking?'DJ hablando':engine.choiceBusy?'Reproduciendo':engine.active?(engine.busy?'Eligiendo':'DJ activo'):'Tú tienes el control');
    panel.querySelector('[data-live]').classList.toggle('pd-active',engine.active);
    panel.querySelector('.pd-reference').hidden=!engine.active;
    panel.querySelector('.pd-feedback').hidden=!engine.active;
    panel.querySelector('.pd-queuehead').hidden=!engine.active;
    panel.querySelector('[data-next]').hidden=!engine.active;
    panel.querySelector('[data-session]').hidden=!engine.active && !engine.sessionHeardMs;
    panel.querySelector('[data-savedmix]').hidden=!engine.mixPlaylist;
    text('title',engine.current?.name||'Reproduce algo que te guste');text('artist',engine.current?.artists.map(a=>a.name).join(', ')||'Tu próxima sesión empieza contigo.');
    const img=panel.querySelector('[data-cover]'),url=imageURL(engine.current?.image);img.hidden=!url;if(url && img.getAttribute('src')!==url)img.src=url;
    text('reference',engine.anchor?`${engine.anchor.name} · ${engine.anchor.artists.map(a=>a.name).join(', ')}`:'Elige una referencia al empezar.');
    const labels=intentLabels(engine.intent),chips=panel.querySelector('[data-intent]');if(chips._key!==JSON.stringify(labels)){chips._key=JSON.stringify(labels);chips.innerHTML=labels.map(label=>`<span class="pd-chip">${esc(label)}</span>`).join('');}
    text('status',engine.status);panel.querySelector('[data-status]').classList.toggle('pd-error',engine.error);
    const toggle=panel.querySelector('[data-toggle]');toggle.textContent=engine.active?'Terminar DJ':engine.intent.known?'Elegir música conocida':'Empezar DJ';toggle.disabled=!!engine.choiceBusy || engine.busy;toggle.hidden=engine.choosing && !engine.active;
    panel.querySelector('[data-restore]').hidden=!(engine.captured || engine.managed.length && !engine.active);panel.querySelector('[data-restore]').disabled=engine.busy || !!engine.choiceBusy;
    panel.querySelector('[data-refresh]').disabled=!engine.active || engine.busy;
    panel.querySelector('[data-undo]').disabled=!engine.undoVote;
    panel.querySelectorAll('[data-feedback]').forEach(b=>b.disabled=!engine.current || !!engine.choiceBusy);
    panel.querySelectorAll('[data-known]').forEach(b=>{const on=(b.dataset.known==='true')===engine.intent.known;b.classList.toggle('pd-selected',on);b.setAttribute('aria-pressed',String(on));});
    const chooser=panel.querySelector('[data-picker]');chooser.hidden=!engine.choosing;
    const cardKey=JSON.stringify([engine.deck.pair.map(t=>[t.uri,t.name,t.image,t.evidence]),engine.choiceBusy]);if(chooser._key!==cardKey){chooser._key=cardKey;panel.querySelector('[data-cards]').innerHTML=cards(engine.deck.pair,'choice');}
    text('pickernote',engine.deck.pair.length?`${engine.deck.tracks.length} canciones conocidas · ${Math.max(0,engine.deck.tracks.length-engine.deck.offset)} por explorar. Elige una para guiar la sesión.`:engine.deck.tracks.length?'Ya viste todas las opciones. Reinicia la selección para revisarlas.':'No hay canciones conocidas disponibles. Lee una playlist, actualiza tus Me gusta o permite descubrir.');
    panel.querySelector('[data-again]').disabled=engine.deck.exhausted || !!engine.choiceBusy;panel.querySelector('[data-resetdeck]').hidden=!engine.deck.exhausted || !engine.deck.tracks.length;
    const matchBox=panel.querySelector('[data-matches]'),menu=panel.querySelector('[data-artistmenu]');
    const hasResults=!!(engine.commandChoices.length || engine.commandArtists.length || engine.artistMenu);
    matchBox.hidden=!hasResults || !!engine.artistMenu;menu.hidden=!engine.artistMenu;
    panel.querySelector('[data-closesearch]').hidden=!hasResults;panel.querySelector('[data-closesearch]').disabled=!!engine.choiceBusy;
    const matchKey=JSON.stringify([engine.commandChoices.map(t=>[t.uri,t.name,t.image]),engine.commandArtists]);
    if(matchBox._key!==matchKey){matchBox._key=matchKey;
      const artists=engine.commandArtists.length?engine.commandArtists:[...new Map(engine.commandChoices.flatMap(t=>t.artists).filter(a=>words(a.name).includes(words(engine.pendingCommand?.target?.title))).map(a=>[a.uri,a])).values()];
      matchBox.innerHTML='<small>Resultados de Spotify</small><div class="pd-results">'+artists.map(a=>`<button class="pd-choice pd-result" data-mixartist="${esc(a.uri)}"><span class="pd-choicecover pd-artist-photo">${imageURL(a.image)?`<img src="${esc(imageURL(a.image))}" alt="" loading="eager">`:ICON}</span><b>${esc(a.name)}</b><small>Artista · elegir mezcla</small></button>`).join('')+cards(engine.commandChoices,'match')+'</div>';
    }
    if(engine.artistMenu && menu._key!==engine.artistMenu.uri){const a=engine.artistMenu;menu._key=a.uri;
      menu.innerHTML=`<div class="pd-menuhead"><h3>${esc(a.name)}</h3><button data-closeartist aria-label="Volver a resultados">← Volver</button></div><p>Elige el rumbo. Guardamos una playlist privada y devolvemos tu cola al terminar.</p><div class="pd-cards"><button class="pd-choice pd-mode" data-artistmode="mix" data-artisturi="${esc(a.uri)}" aria-label="Aleatorio"><b>Aleatorio ↗</b><small>Mucho de este artista, con canciones afines entre medias.</small></button><button class="pd-choice pd-mode" data-artistmode="only" data-artisturi="${esc(a.uri)}" aria-label="Artista"><b>Solo artista ↻</b><small>Su catálogo y colaboraciones. Toda la mezcla gira alrededor de él.</small></button></div>`;
    }
    panel.querySelectorAll('[data-mixartist],[data-match],[data-artistmode]').forEach(n=>n.disabled=!!engine.choiceBusy);
    const ordered=engine.active?(queue()?.priority||[]).slice(0,8).map(t=>({...t,...engine.preview.find(p=>sameEntry(p,t)),manual:!engine.managed.some(m=>sameEntry(m,t))})):[];
    const key=JSON.stringify(ordered.map(t=>[t.uri,t.uid,t.reason,t.manual,engine.pinned && sameEntry(t,engine.pinned)]));
    const list=panel.querySelector('[data-next]');if(list._key!==key){list._key=key;list.innerHTML=ordered.map((t,i)=>`<div class="pd-next"><span class="pd-index">${i+1}</span><div><b>${esc(t.name)}</b><small>${esc(t.artists.map(a=>a.name).join(', '))}</small><small class="pd-reason">${esc(t.manual?'Tu elección tiene prioridad':t.reason||engine.reason(t,engine.current))}</small>${t.manual?'':`<small class="pd-flow">${esc(t.transition||transitionLabel(engine.current?.audio,t.audio))}</small>`}</div>${t.manual?'':`<button data-pin="${esc(t.uid)}" aria-label="Reservar ${esc(t.name)}" aria-pressed="${!!(engine.pinned && sameEntry(engine.pinned,t))}">○</button><button data-reject="${esc(t.uid)}" aria-label="No encaja: ${esc(t.name)}">×</button>`}</div>`).join('')||'<p class="pd-empty">Las sugerencias aparecerán aquí. Si no hay una afín, continúa tu playlist.</p>';}
    text('session',`${Math.floor(engine.sessionHeardMs/60000)} min escuchados · ${engine.artistSet.size} artistas en esta sesión`);
    text('library',engine.libraryBusy?'Leyendo tu biblioteca…':library.status);panel.querySelector('[data-librarysync]').disabled=!!engine.libraryBusy;
    const playlists=panel.querySelector('[data-playlists]'),playlistKey=JSON.stringify(library.playlists);if(playlists._key!==playlistKey){const selected=playlists.value;playlists._key=playlistKey;playlists.innerHTML='<option value="">Elige una playlist de tu biblioteca</option>'+library.playlists.map(p=>`<option value="${esc(p.uri)}">${esc(p.name)}</option>`).join('');playlists.value=selected;}panel.querySelector('[data-loadplaylist]').disabled=!!engine.libraryBusy;
    text('caption',narrator.text||'');panel.querySelector('[data-narration]').hidden=!narrator.text;
    const native=transitions.state();text('transitionstatus',native.enabled?`Crossfade de Spotify: ${native.seconds} s. Se priorizan tempo, tono y nivel cuando hay datos.`:'Crossfade de Spotify apagado. Se prioriza continuidad musical cuando hay datos.');panel.querySelector('[data-applytransition]').disabled=!native.available;panel.querySelector('[data-restoretransition]').disabled=!native.available;
    text('savedmix',engine.mixPlaylist?`${engine.mixPlaylist.name} · ${engine.mixPlaylist.count} canciones`:'');panel.querySelector('[data-openmix]').hidden=!engine.mixPlaylist;
    text('voicestatus',narrator.voice?`Voz local: ${narrator.voice.name}`:'Este cliente no ofrece voz local en español. Los comentarios siguen por escrito.');
    const voice=panel.querySelector('[data-voice]');voice.disabled=!narrator.voice;voice.textContent=narrator.enabled?'Silenciar voz':'Activar voz';voice.setAttribute('aria-pressed',String(narrator.enabled));
    panel.querySelector('[data-recovervolume]').hidden=!recovery();
    panel.querySelectorAll('[data-select]').forEach(input=>{if(document.activeElement!==input)input.value=engine.settings[input.dataset.select];});
    panel.querySelectorAll('[data-setting]').forEach(input=>{input.checked=engine.settings[input.dataset.setting];input.disabled=input.dataset.setting==='takeover' && (engine.active || engine.busy);});
    panel.querySelector('[data-sessionexport]').disabled=!engine.sessionList.length;
  }
  function open(){
    if(panel?.isConnected){update();return;}
    panel=document.createElement('section');panel.className='pd';
    panel.innerHTML=`<header class="pd-header"><div class="pd-brand">${ICON}<h1>POOR DJ <small>${VERSION}</small></h1></div><button class="pd-voice" data-voice></button></header><div class="pd-byline"><span>Tu música. Tu mando.</span><span class="pd-live" data-live></span></div>
      <div class="pd-playing"><div class="pd-cover">${ICON}<img data-cover alt="Portada actual" hidden></div><div><small>Sonando ahora <span class="pd-bars" aria-hidden="true"><i></i><i></i><i></i></span></small><h2 data-title></h2><p data-artist></p></div></div>
      <div class="pd-reference"><small>Referencia de la sesión</small><p data-reference></p></div><div class="pd-chips" data-intent aria-label="Instrucciones vigentes"></div>
      <form data-command class="pd-command"><label for="pd-command">¿Qué quieres escuchar?</label><div><input id="pd-command" name="command" autocomplete="off" maxlength="240" placeholder="Yoko, L A K E N O S H I o sigue esta canción" required><button type="submit">Buscar / aplicar</button></div></form>
      <p class="pd-note">Busca una canción o artista, o escribe una dirección para la mezcla. Tú eliges cuándo empezar.</p>
      <button class="pd-follow" aria-label="Seguir esta canción" data-follow>Seguir esta canción ↗</button>
      <div data-matches hidden></div><section data-artistmenu class="pd-artistmenu" hidden aria-label="Mezcla del artista"></section><button data-closesearch class="pd-secondary" hidden>Cerrar resultados</button>
      <div class="pd-presets" role="group" aria-label="Selección musical"><button data-known="true">Solo música conocida</button><button data-known="false">Descubrir afines</button></div>
      <section data-picker class="pd-picker" hidden aria-label="Elige tu primera canción"><h3>Tu música conocida</h3><p data-pickernote></p><div class="pd-cards" data-cards></div><div class="pd-pickeractions"><button data-again>Otra vez</button><button data-resetdeck hidden>Reiniciar selección</button><button data-closepicker>Cancelar</button></div></section>
      <div class="pd-feedback"><button data-feedback="more">Más como esta</button><button data-feedback="less">No encaja</button><details class="pd-feedbackmore"><summary>Más opciones</summary><button data-feedback="artist">Este artista no, por hoy</button><button data-feedback="repeat">Demasiado repetida</button><button data-undo>Deshacer</button></details></div>
      <div class="pd-queuehead"><h3>A continuación</h3><button data-refresh class="pd-other">Otra sugerencia</button></div><div data-next></div>
      <button class="pd-primary" data-toggle></button><button class="pd-secondary" data-restore hidden>Restaurar cola guardada</button><p class="pd-status" data-status role="status" aria-live="polite"></p>
      <section class="pd-narration" data-narration hidden aria-label="Comentarios del DJ"><p data-caption aria-live="polite"></p></section><p class="pd-note" data-session></p>
      <p class="pd-note" data-savedmix></p><button class="pd-secondary" data-openmix hidden>Abrir última playlist guardada</button>
      <details class="pd-customize"><summary>Personalizar y ajustes</summary><p class="pd-note" data-voicestatus></p><details class="pd-details"><summary>Transiciones</summary><label>Continuidad musical<select data-select="flowStrength"><option value="40">Equilibrada</option><option value="65">Suave</option><option value="90">Más continuidad</option></select></label><p data-transitionstatus></p><label>Solapamiento nativo<select data-crossfade><option value="2">Breve · 2 segundos</option><option value="4" selected>Suave · 4 segundos</option><option value="6">Continua · 6 segundos</option><option value="0">Sin solapamiento</option></select></label><button data-applytransition>Aplicar en Spotify</button><button data-restoretransition>Restaurar ajuste anterior</button><p>Este ajuste también afecta a Spotify fuera del DJ. Automix puede decidir las transiciones en playlists compatibles. POOR DJ no baja el volumen ni salta el final de las canciones.</p></details>
      <details class="pd-details"><summary>Ajustes</summary><div class="pd-options"><label>Acento<select data-select="accent"><option value="spotify">Verde Spotify</option><option value="theme">Mi tema</option><option value="blue">Azul</option><option value="violet">Violeta</option><option value="rose">Rosa</option></select></label><label>Canciones pendientes<select data-select="queueSize"><option>1</option><option>2</option><option>3</option></select></label></div>${[['mini','Control compacto'],['compact','Panel compacto'],['explicit','Permitir contenido explícito'],['autoLearn','Aprender de mi escucha'],['takeover','Suspender mi cola manual al iniciar (opcional)']].map(([key,label])=>`<label class="pd-check"><input type="checkbox" data-setting="${key}">${label}</label>`).join('')}<p>Spotify controla las transiciones nativas. El DJ no cambia tu volumen ni adelanta canciones.</p><button data-settings>Abrir configuración de Spotify</button><button data-recovervolume hidden>Recuperar volumen anterior</button></details>
      <details class="pd-details"><summary>Etiquetas musicales</summary><p>Las etiquetas son tuyas. Para filtrar por género, etiqueta las canciones de tu playlist actual; no deducimos género por tempo ni tus creencias por lo que escuchas.</p><form data-tag><label for="pd-tag">Estilos, separados por coma</label><input id="pd-tag" maxlength="100" placeholder="reggaetón, trap"><button type="submit">Etiquetar playlist actual y canción</button></form></details>
      <details class="pd-details"><summary>Mi biblioteca y fuentes</summary><p data-library></p><button data-librarysync>Actualizar Me gusta y playlists</button><select data-playlists aria-label="Playlist de mi biblioteca"></select><button data-loadplaylist>Leer esta playlist</button><p>Solo usamos Me gusta, playlists y escuchas registradas como música conocida. Leemos una parte limitada; puedes elegir una playlist para consultar hasta 300 canciones. Spotify no ofrece aquí tus estadísticas completas.</p></details><details class="pd-details"><summary>Mis datos</summary><p>Playlist, escucha registrada y voto son fuentes diferentes de familiaridad. No consultamos todo tu historial de Spotify. Tus datos y la lógica del DJ permanecen en este cliente.</p><div class="pd-profile"><button data-export>Exportar perfil</button><button data-import>Importar perfil</button><button data-sessionexport>Guardar sesión</button><button data-reset>Borrar aprendizaje</button><button data-cacheclear>Borrar caché acústica</button><input data-file type="file" accept=".json,application/json" hidden></div><p>POOR DJ ${VERSION} · sin servidor propio, IA ni claves adicionales.</p></details>
      <details class="pd-details"><summary>Cómo funciona</summary><p>Elige una canción conocida o inicia desde lo que suena. Escribe instrucciones combinables y revisa las etiquetas. Una elección manual pausa el DJ y retira sus sugerencias. Terminar devuelve la cola suspendida; las playlists nunca se editan.</p><p>Prueba «solo conocidas y más variedad», «reggaetón y más variedad», «pon SIN UN PLAN (TEGOCALDERON) de Isma» o «termina el DJ». Una orden incompleta no se aplica a medias.</p></details></details>`;
    panel.onclick=event=>{
      event.stopPropagation();
      const button=event.target.closest('button');if(!button || !panel.contains(button))return;
      const d=button.dataset;
      if(d.choice)perform(()=>engine.playChoice(engine.deck.pair.find(t=>t.uri===d.choice),true));
      else if(d.match)perform(()=>engine.chooseCommand(engine.commandChoices.find(t=>t.uri===d.match)));
      else if(d.mixartist)perform(async()=>{await engine.chooseArtist(d.mixartist);queueMicrotask(()=>panel?.querySelector('[data-artistmode]')?.focus({preventScroll:true}));});
      else if(d.artistmode)perform(()=>engine.chooseArtist(d.artisturi,d.artistmode));
      else if('closeartist'in d){const uri=engine.artistMenu?.uri;engine.artistMenu=null;update();panel.querySelectorAll('[data-mixartist]').forEach(n=>{if(n.dataset.mixartist===uri)n.focus({preventScroll:true});});}
      else if('closesearch'in d){engine.commandGeneration++;engine.commandChoices=[];engine.commandArtists=[];engine.artistMenu=null;engine.pendingCommand=null;update();}
      else if('openmix'in d && engine.mixPlaylist)S.Platform.History.push('/playlist/'+engine.mixPlaylist.uri.split(':').pop());
      else if('applytransition'in d)perform(async()=>{await transitions.apply(Number(panel.querySelector('[data-crossfade]').value));engine.notify('Transición nativa aplicada en Spotify.');});
      else if('restoretransition'in d)perform(async()=>{await transitions.restore();engine.notify('Ajuste de transición anterior restaurado.');});
      else if('follow'in d)perform(()=>engine.command('sigue esta canción'));
      else if('librarysync'in d)perform(()=>engine.syncLibrary(true));
      else if('loadplaylist'in d){const uri=panel.querySelector('[data-playlists]').value;if(uri)perform(()=>engine.syncLibrary(true,uri));}
      else if('again'in d)engine.nextChoices();else if('resetdeck'in d)engine.nextChoices(true);
      else if('closepicker'in d){engine.choosing=false;update();}
      else if('known'in d)perform(async()=>{await engine.updateSettings({discovery:d.known==='true'?0:50});if(!engine.active && d.known==='true')engine.prepareChoices();});
      else if('toggle'in d)perform(()=>engine.active?engine.stop():engine.intent.known?engine.prepareChoices():engine.start());
      else if('restore'in d)perform(()=>engine.stop());else if('refresh'in d)perform(()=>engine.refresh());
      else if(d.feedback)perform(()=>engine.feedbackFor(engine.current,d.feedback));else if('undo'in d)perform(()=>engine.undoFeedback());
      else if(d.reject)perform(()=>engine.feedbackFor(engine.preview.find(t=>t.uid===d.reject),'less'));
      else if(d.pin)engine.reserve(engine.preview.find(t=>t.uid===d.pin));
      else if(d.example){panel.querySelector('#pd-command').value=d.example;panel.querySelector('#pd-command').focus();}
      else if('voice'in d){narrator.toggle();engine.updateSettings({voice:narrator.enabled},false);}
      else if('settings'in d){S.PopupModal.hide();S.Platform.History.push('/preferences');}
      else if('recovervolume'in d)recoverVolume();
      else if('export'in d)download(engine.exportProfile(),'poor-dj-profile.json');
      else if('sessionexport'in d)download({schema:1,version:VERSION,heardMs:engine.sessionHeardMs,tracks:engine.sessionList.map(t=>({uri:t.uri,name:t.name,artists:t.artists}))},'poor-dj-session.json');
      else if('import'in d)panel.querySelector('[data-file]').click();
      else if('reset'in d && root.confirm('¿Borrar el aprendizaje local de POOR DJ?')){engine.memory={};engine.contexts={};engine.preferences={};engine.undoVote=null;engine.save();engine.refresh();}
      else if('cacheclear'in d){audio.clear();engine.notify('Caché acústica borrada.');}
    };
    panel.querySelector('[data-command]').onsubmit=event=>{event.preventDefault();perform(()=>engine.command(panel.querySelector('#pd-command').value));};
    panel.querySelector('[data-tag]').onsubmit=event=>{event.preventDefault();perform(()=>engine.tagPlaylist(panel.querySelector('#pd-tag').value.split(',').map(words).filter(Boolean)));};
    panel.querySelectorAll('[data-select]').forEach(input=>input.onchange=()=>perform(()=>engine.updateSettings({[input.dataset.select]:['queueSize','flowStrength'].includes(input.dataset.select)?Number(input.value):input.value},input.dataset.select==='queueSize')));
    panel.querySelectorAll('[data-setting]').forEach(input=>input.onchange=()=>perform(()=>engine.updateSettings({[input.dataset.setting]:input.checked},['explicit','takeover'].includes(input.dataset.setting))));
    panel.querySelector('[data-file]').onchange=event=>perform(async()=>{const file=event.target.files[0];if(!file)return;if(file.size>2000000)throw Error('El perfil supera 2 MB');await engine.importProfile(JSON.parse(await file.text()));narrator.enabled=engine.settings.voice;event.target.value='';});
    S.PopupModal.display({title:'POOR DJ',content:panel,isLarge:true});update();transitions.refresh().then(update).catch(()=>{});panel.querySelector('#pd-command').focus();
  }
  return {open,update,dispose:()=>{if(panel?.isConnected)S.PopupModal.hide();panel?.remove();mini.remove();style.remove();playbar.deregister?.();}};
}

const ICON='<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2"/><path d="M5 12a7 7 0 0 1 7-7m0 14a7 7 0 0 0 7-7M7 15V9h3"/></svg>';
const esc=x=>String(x||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
const imageURL=uri=>uri?.startsWith('spotify:image:')?`https://i.scdn.co/image/${uri.split(':').pop()}`:uri;
async function boot(){
  const S=root.Spicetify;
  if(!S?.Player?.data || !S?.CosmosAsync || !S?.Playbar?.Button || !S?.PopupModal || !S?.Platform?.LocalStorageAPI){setTimeout(boot,500);return;}
  if(root.PoorDJ?.version===VERSION)return;
  if(root.PoorMansDJ){S.showNotification?.('POOR DJ: elimina la instalación duplicada y reinicia Spotify.',true);return;}
  const storage=S.Platform.LocalStorageAPI,requests=new RequestCache(),library=new MusicLibrary(S.Platform,requests);
  let audioSaved={};try{audioSaved=storage.getItem('poor-dj-audio-v2')||{};}catch(_){}
  const audio=new AudioLibrary(S.getAudioData?uri=>S.getAudioData(uri):null,audioSaved,data=>storage.setItem('poor-dj-audio-v2',data));
  const hashes={queryArtistOverview:'9f8134ef565e78621f1e1793555bd6633c5ac144ae0f89604ed3ae3f80b3c8e6',searchTracks:'b02683192a98dde7966b5e6655a79eeb62713eab703eda9902c932818dd52751',searchArtists:'7bf95d754fdbe32c8b161fbbe54d1ae50974900df4dce4c8f1afcbcad153224d',queryArtistDiscographyAll:'5e07d323febb57b4a56a42abbf781490e58764aa45feb6e3dc0591564fc56599',getAlbum:'6a74b456cd1735c9193d9e8ec8cc5184cad7ce13572210315229db3975964361'};
  function query(name,variables){
    return requests.get(name+JSON.stringify(variables),()=>{
      if(typeof S.GraphQL?.Request!=='function')throw Error('Spotify aún no ofrece consultas musicales');
      return S.GraphQL.Request(queryDefinition(S.GraphQL,name,hashes[name]),variables);
    });
  }
  function queue(){
    const q=S.Queue;if(!Array.isArray(q?.nextTracks))return null;
    const result={all:[],priority:[]};
    for(const t of q.nextTracks){
      const track=normalize(t)||{uri:unwrap(t)?.uri,uid:unwrap(t)?.uid || t.uid,name:unwrap(t)?.metadata?.title||'',artists:[],source:'contexto'};
      if(track.uri){track.playlist=t.provider==='context' && /^spotify:playlist:/.test(S.Player.data?.context?.uri||'');result.all.push(track);if(t.provider==='queue')result.priority.push(track);}
    }
    return result;
  }
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  async function add(tracks){
    if(!S.Player.origin?._queue?.addToQueue)throw new Error('El control de cola no está disponible');
    const before=queue();if(!before)throw new Error('Cola no disponible');
    let failure;try{await S.addToQueue(tracks.map(t=>({uri:t.uri})));}catch(e){failure=e;}
    let inserted=[];
    for(let i=0;i<40;i++){
      const q=queue();
      inserted=(q?.priority||[]).filter(t=>t.uid && !before.priority.some(b=>sameEntry(t,b)));
      const remaining=inserted.slice(),ordered=tracks.map(t=>{const n=remaining.findIndex(x=>x.uri===t.uri);return n>=0?remaining.splice(n,1)[0]:null;});
      if(ordered.every(Boolean))return ordered;
      await sleep(150);
    }
    // Never leave untracked DJ entries if Spotify does not acknowledge the whole write.
    const partial=inserted.filter(t=>tracks.some(x=>x.uri===t.uri));
    if(partial.length)await remove(partial);
    throw failure || new Error('Spotify no confirmó la inserción completa');
  }
  async function remove(tracks){
    if(tracks.some(t=>!t.uid))throw new Error('Entrada de cola sin identificador');
    let failure;try{await S.removeFromQueue(tracks.map(reference));}catch(e){failure=e;}
    for(let i=0;i<40;i++){const q=queue();if(q && tracks.every(t=>!q.priority.some(x=>sameEntry(t,x))))return;await sleep(150);}
    throw failure || new Error('Spotify no confirmó la retirada');
  }
  async function candidates(seed,settings,all){
    if(engine.intent.artist)seed={...seed,artists:[engine.intent.artist]};
    await library.load(S.Player.data?.context?.uri||'');
    if(!engine.active)return [];
    const local=engine.knownTracks();
    const groups=[{tracks:local,source:'tu colección',familiar:true}];
    if(engine.intent.artist)groups.push({tracks:await artistTracks(engine.intent.artist),source:'artista actual'});
    let unique=affinityPool(seed,[],groups,engine.intent,engine.tags);
    const usable=tracks=>tracks.filter(t=>engine.eligible(t) && t.uri!==engine.current?.uri && !engine.recent.some(r=>r.uri===t.uri) && !(queue()?.priority||[]).some(r=>r.uri===t.uri) && Date.now()-(engine.memory[t.uri]?.dismissedAt||engine.memory[t.uri]?.lastSuggested||0)>21600000);
    // Familiar local candidates require no catalogue request or acoustic lookup.
    if(engine.intent.known && usable(unique).length>=settings.queueSize)return unique;
    let overview;const artist=seed.artists.find(a=>a.uri?.startsWith('spotify:artist:'));
    if(artist){try{overview=await query('queryArtistOverview',{uri:artist.uri,locale:'',preReleaseV2:false});groups.push({tracks:collect(overview,'artista actual'),source:'artista actual'});}catch(_) {}}
    const related=new Map(),seen=new WeakSet();
    function find(x,inRelated=false){
      if(!x || typeof x!=='object' || seen.has(x))return;seen.add(x);
      if(inRelated && x.uri?.startsWith('spotify:artist:') && x.uri!==artist?.uri)related.set(x.uri,x);
      for(const [k,v]of Object.entries(x))if(v && typeof v==='object')find(v,inRelated||/related|similar/i.test(k));
    }
    find(overview);const artists=[...related.keys()];
    const chosen=!engine.intent.known && engine.intent.artistMode!=='only'?artists.slice(0,2):[];
    const responses=await Promise.allSettled(chosen.map(uri=>query('queryArtistOverview',{uri,locale:'',preReleaseV2:false})));
    responses.forEach(r=>{if(r.status==='fulfilled')groups.push({tracks:collect(r.value,'artista relacionado'),source:'artista relacionado'});});
    const name=seed.artists[0]?.name||'';
    if(name && !engine.intent.known){
      try{groups.push({tracks:collect(await query('searchTracks',{searchTerm:name,offset:0,limit:40,numberOfTopResults:5,includeAudiobooks:false,includePreReleases:false,includeAlbumPreReleases:false}),'artista actual'),source:'artista actual'});}catch(_){}
    }
    unique=affinityPool(seed,artists,groups,engine.intent,engine.tags).slice(0,300);
    if(!engine.active)return [];
    const current=engine.current;
    if(current){const data=await audio.get(current.uri);if(engine.active && engine.current===current)current.audio=data;}
    unique.sort((a,b)=>engine.score(b,engine.recent)-engine.score(a,engine.recent));
    const excluded=new Set([engine.current?.uri,...(queue()?.priority||[]).map(t=>t.uri),...engine.recent.map(t=>t.uri),...engine.suspended.map(t=>t.uri)]);
    let analyzed=unique.filter(t=>!excluded.has(t.uri) && (settings.explicit || !t.explicit) && (engine.memory[t.uri]?.vote||0)>-2 && Date.now()-(engine.memory[t.uri]?.lastPlayed||0)>86400000);
    if(engine.intent.artistMode==='mix')analyzed=[...analyzed.filter(t=>hasArtist(t,engine.intent.artist)).slice(0,6),...analyzed.filter(t=>!hasArtist(t,engine.intent.artist)).slice(0,2)];
    await audio.enrich(analyzed,8);
    return unique;
  }
  let saved={};try{saved=storage.getItem('poor-dj-v3')||storage.getItem('poor-dj-v2')||storage.getItem('poor-mans-dj-v1')||{};if(!storage.getItem('poor-dj-v3'))storage.setItem('poor-dj-before-v3',saved);}catch(_){}
  let view,narrator,voiceGate,internalPlay=false,stopped=false,reconcile=null,progressUI=0;
  const api=()=>typeof S.Platform.PlayerAPI?.play==='function'?S.Platform.PlayerAPI:S.Player.origin;
  async function play(track){
    if(typeof api()?.play!=='function')throw Error('Reproducción directa no disponible');
    const manual=(queue()?.priority||[]).filter(t=>!engine.managed.some(m=>sameEntry(m,t)));
    let request;internalPlay=true;try{request=api().play({uri:track.uri},{},{});}finally{internalPlay=false;}
    await request;
    for(let i=0;i<40;i++){
      if(normalize(S.Player.data?.item)?.uri===track.uri){
        // Restore manual entries only if the play operation cleared them.
        const remaining=queue()?.priority||[],used=new Set();
        const missing=manual.filter(t=>{const index=remaining.findIndex((r,i)=>!used.has(i) && r.uri===t.uri);if(index<0)return true;used.add(index);return false;});
        if(missing.length)await add(missing);return;
      }
      await sleep(150);
    }
    throw Error('Spotify no confirmó la canción elegida');
  }
  async function resolve(target){
    const data=await query('searchTracks',{searchTerm:[songKey(target.title),target.artist].filter(Boolean).join(' '),offset:0,limit:20,numberOfTopResults:5,includeAudiobooks:false,includePreReleases:false,includeAlbumPreReleases:false});
    return collect(data,'búsqueda').filter(t=>!target.artist || t.artists.some(a=>words(a.name).includes(words(target.artist)))).slice(0,6).map(t=>({...t,evidence:library.tracks.get(t.uri)?.evidence||t.evidence}));
  }
  async function search(target){const results=await Promise.allSettled([resolve(target),query('searchArtists',{searchTerm:target.title,offset:0,limit:6,numberOfTopResults:5,includeAudiobooks:false})]);return {tracks:results[0].status==='fulfilled'?results[0].value:[],artists:results[1].status==='fulfilled'?collectArtists(results[1].value):[]};}
  async function artistTracks(artist){
    const overview=await query('queryArtistOverview',{uri:artist.uri,locale:'',preReleaseV2:false}),tracks=collect(overview,'artista actual');
    try{const disc=await query('queryArtistDiscographyAll',{uri:artist.uri,offset:0,limit:12}),albums=new Set(),seen=new WeakSet();let nodes=0;
      const walk=(x,d=0)=>{if(!x || typeof x!=='object' || d>15 || seen.has(x) || nodes++>2000)return;seen.add(x);if(x.uri?.startsWith('spotify:album:'))albums.add(x.uri);for(const v of Object.values(x))if(v && typeof v==='object')walk(v,d+1);};walk(disc);
      const choices=[...albums].filter((_,i)=>i%3===0).slice(0,4);
      for(let i=0;i<choices.length;i+=2){const data=await Promise.allSettled(choices.slice(i,i+2).map(uri=>query('getAlbum',{uri,offset:0,limit:50,locale:''})));for(const r of data)if(r.status==='fulfilled'){const album=r.value.data?.albumUnion;tracks.push(...collect(r.value,'artista actual').map(t=>({...t,image:t.image||album?.coverArt?.sources?.[0]?.url||'',album:t.album||album?.name||''})));}}
    }catch(_){}
    return [...new Map(tracks.filter(t=>hasArtist(t,artist)).map(t=>[t.uri,t])).values()].slice(0,300);
  }
  async function createMix(artist,mode,tracks){
    const P=S.Platform;if(!P.RootlistAPI?.createPlaylist || !P.PlaylistAPI?.add || !P.RootlistAPI?.setPublishedState)throw Error('Este cliente no permite guardar una playlist privada.');
    const name=`POOR DJ · ${artist.name} · ${mode==='only'?'Artista':'Aleatorio'}`;
    const pending=storage.getItem('poor-dj-pending-mix'),key=artist.uri+':'+mode;
    const uri=pending?.key===key?pending.uri:await P.RootlistAPI.createPlaylist(name,{after:'end'},true);
    if(!uri?.startsWith('spotify:playlist:'))throw Error('Spotify no confirmó la creación de la playlist.');
    const planned=mixUris(pending,key,tracks);storage.setItem('poor-dj-pending-mix',{key,uri,name,tracks:planned});
    await P.RootlistAPI.setPublishedState(uri,false);
    const existing=await P.PlaylistAPI.getContents(uri,{offset:0,limit:100}),present=new Set((existing.items||[]).map(t=>t.uri));
    const missing=planned.filter(uri=>!present.has(uri));if(missing.length)await P.PlaylistAPI.add(uri,missing,{after:'end'});
    const verify=await P.PlaylistAPI.getContents(uri,{offset:0,limit:100});if(!planned.every(uri=>verify.items?.some(t=>t.uri===uri)))throw Error('Spotify no confirmó todas las canciones de la mezcla.');
    storage.setItem('poor-dj-pending-mix',null);return {uri,name,count:verify.items.length};
  }
  const cardDetails=async track=>{if(!track.name || !track.artists.length)return null;const matches=await resolve({title:track.name,artist:track.artists[0].name}),same=matches.find(t=>t.uri===track.uri);if(same)return same;const exact=matches.filter(t=>songKey(t.name)===songKey(track.name) && t.artists.some(a=>words(a.name)===words(track.artists[0].name)) && (!track.album || words(t.album)===words(track.album)));return exact.length===1?exact[0]:null;};
  const engine=new Engine({queue,candidates,add,remove,play,resolve,search,artistTracks,createMix,cardDetails,known:()=>library.snapshot(),loadKnown:(force,playlist)=>library.load(S.Player.data?.context?.uri||'',force,playlist),beforeSessionPlay:async(track,intent)=>!(await voiceGate.run('start',track,intent,{resume:false,local:localPlayback()})).cancelled,cancelTransition:()=>voiceGate?.cancel(),save:data=>{try{storage.setItem('poor-dj-v3',data);}catch(_){S.showNotification?.('No pude guardar tu perfil local de POOR DJ.',true);}}},saved);
  const localPlayback=()=>{try{return S.Platform.ConnectAPI?.getState()?.activeDevice?.isLocal===true || S.Player.data?.isLocal===true || S.Player.data?.device?.is_local===true;}catch(_){return false;}};
  const transitions=new NativeTransitions(S.Platform,storage,localPlayback);
  narrator=new Narrator(root,()=>view?.update());narrator.enabled=engine.settings.voice;
  const pauseMusic=typeof S.Platform.PlayerAPI?.pause==='function'?()=>S.Platform.PlayerAPI.pause():typeof S.Player.pause==='function'?()=>S.Player.pause():null;
  const resumeMusic=typeof S.Platform.PlayerAPI?.resume==='function'?()=>S.Platform.PlayerAPI.resume():typeof S.Player.play==='function'?()=>S.Player.play():null;
  voiceGate=new VoiceGate(narrator,{playing:()=>S.Player.isPlaying(),uri:()=>normalize(S.Player.data?.item)?.uri,device:()=>S.Platform.ConnectAPI?.getState()?.activeDevice?.id,pause:pauseMusic?async()=>{await pauseMusic();for(let i=0;i<20 && S.Player.isPlaying();i++)await sleep(50);if(S.Player.isPlaying())throw Error('No se confirmó la pausa');}:null,resume:resumeMusic});
  engine.onNarrate=event=>voiceGate.run(event,engine.anchor||engine.current,engine.intent,{local:localPlayback()});
  const playGuards=[...new Set([S.Platform.PlayerAPI,S.Player.origin].filter(Boolean))].map(player=>guardPlay(player,()=>{
    if(internalPlay)return null;
    engine.commandGeneration++;engine.choosing=false;engine.commandChoices=[];engine.commandArtists=[];engine.artistMenu=null;voiceGate.cancel();
    return engine.active || engine.managed.length?engine.yieldToUser():null;
  }));
  const recovery=()=>{try{return storage.getItem('poor-dj-volume-recovery');}catch(_){return null;}};
  view=mountUI(S,engine,{audio,queue,narrator,voiceGate,library,transitions,recovery,recoverVolume:()=>{const r=recovery(),device=S.Platform.ConnectAPI?.getState()?.activeDevice?.id;if(r && localPlayback() && (!r.device || r.device===device) && typeof S.Player.setVolume==='function'){S.Player.setVolume(clamp(r.volume,0,1));storage.setItem('poor-dj-volume-recovery',null);engine.notify('Volumen anterior recuperado.');}else engine.notify('Recupera el volumen en el dispositivo original.',true);}});
  engine.save();
  const sample=()=>{if(stopped || engine.interrupted)return;try{if(!engine.current?.name || !engine.current?.artists.length || !engine.current?.image)observe();engine.sample(S.Player.getProgress(),S.Player.isPlaying());if(Date.now()-progressUI>5000){progressUI=Date.now();view.update();}}catch(_){};};
  const observe=()=>{
    if(stopped)return;const track=normalize(S.Player.data?.item);
    if(!track){engine.interrupted=true;engine.lastPosition=null;engine.lastWall=null;voiceGate.cancel();if(engine.active)engine.notify('Spotify está reproduciendo contenido fuera del DJ. Esperaré a la música.');return;}
    const natural=engine.interrupted;engine.interrupted=false;engine.trackChanged(track,natural?'natural':false);
  };
  const paused=()=>{voiceGate.playbackChanged();engine.lastPosition=null;engine.lastWall=null;view.update();};
  S.Player.addEventListener('songchange',observe);S.Player.addEventListener('onprogress',sample);S.Player.addEventListener('onplaypause',paused);
  let device=S.Platform.ConnectAPI?.getState()?.activeDevice?.id;
  const reconcileQueue=()=>{
    if(stopped)return;
    const nextDevice=S.Platform.ConnectAPI?.getState()?.activeDevice?.id;
    if(nextDevice!==device){device=nextDevice;voiceGate.cancel();engine.commandGeneration++;if(engine.active)engine.yieldToUser();}
    if(engine.active && !engine.busy && !engine.interrupted){const q=queue();if(q){engine.sync(q);engine.reconcileManual(q);engine.fill(false,q);}}
  };
  // Spotify exposes no documented, stable queue event; active-only fallback.
  engine.onUpdate=()=>{if(engine.active && !reconcile)reconcile=setInterval(reconcileQueue,1000);if(!engine.active && reconcile){clearInterval(reconcile);reconcile=null;}view.update();};
  observe();
  const unload=()=>voiceGate.cancel();root.addEventListener('beforeunload',unload);
  root.PoorDJ={engine,open:view.open,version:VERSION,audio,narrator,voiceGate,transitions,command:text=>engine.command(text),dispose:()=>{stopped=true;engine.commandGeneration++;engine.active=false;engine.generation++;engine.cancelLookup?.();clearInterval(reconcile);playGuards.forEach(undo=>undo());voiceGate.cancel();narrator.dispose();audio.dispose();requests.dispose();library.dispose();for(const [event,fn]of [['songchange',observe],['onprogress',sample],['onplaypause',paused]])S.Player.removeEventListener?.(event,fn);root.removeEventListener('beforeunload',unload);view.dispose();}};
  root.PoorMansDJ=root.PoorDJ;
}
boot();

})(typeof window!=='undefined'?window:globalThis);
