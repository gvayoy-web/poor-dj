/* POOR DJ 3.4.0 | MIT */
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

const VERSION = '3.4.0';
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
const DEFAULTS={discovery:0,diversity:25,takeover:false,queueSize:1,accent:'spotify',compact:false,mini:true,explicit:true,autoLearn:true,continuity:65,flowStrength:65,voice:true,lyrics:true,lyricsExternal:false,lyricsSize:'m',lyricsOffset:0,ambient:true,talk:'few',voiceName:'',autoFade:false};
function settingsOf(value={}){
  const s=Object.fromEntries(Object.entries(DEFAULTS).map(([key,def])=>[key,value[key]??def]));
  if(!['spotify','theme','blue','violet','rose'].includes(s.accent))s.accent='spotify';
  for(const key of ['discovery','diversity','continuity','flowStrength'])s[key]=clamp(s[key]);
  s.queueSize=Math.round(clamp(s.queueSize,1,3));
  if(!['s','m','l'].includes(s.lyricsSize))s.lyricsSize='m';
  if(!['start','few','often'].includes(s.talk))s.talk='few';
  s.voiceName=typeof s.voiceName==='string'?s.voiceName.slice(0,120):'';
  s.lyricsOffset=Math.round(clamp(s.lyricsOffset,-3000,3000)/50)*50;
  for(const key of ['takeover','compact','mini','explicit','autoLearn','voice','lyrics','lyricsExternal','ambient','autoFade'])if(typeof s[key]!=='boolean')s[key]=DEFAULTS[key];
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
  async saveSession(){
    const tracks=[...new Map(this.sessionList.filter(t=>valid(t.uri)).map(t=>[t.uri,t])).values()];
    if(tracks.length<2){this.notify('Aún hay pocas canciones para guardar la sesión.',true);return;}
    if(!this.io.createMix){this.notify('Este cliente no permite guardar playlists.',true);return;}
    this.sessionStamp||=Date.now();
    try{this.notify('Guardando la sesión como playlist privada…');
      const label=new Date(this.sessionStamp).toLocaleDateString('es',{day:'numeric',month:'short'})+' '+new Date(this.sessionStamp).toLocaleTimeString('es',{hour:'2-digit',minute:'2-digit'});
      const saved=await this.io.createMix({uri:'session:'+this.sessionStamp,name:'Sesión '+label},'session',tracks);
      this.mixPlaylist=saved;this.sessionStamp=null;this.save();this.notify('Sesión guardada: '+saved.name);
    }catch(e){this.notify(e.message||'No pude guardar la sesión.',true);}
    finally{this.onUpdate();}
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
      const every={few:5,often:3}[this.settings.talk];if(every && this.played%every===0)this.onNarrate('next');
      this.managed=this.managed.filter(t=>t.uri!==track.uri);this.preview=this.preview.filter(t=>t.uri!==track.uri);this.save();
      this.generation++;this.lastAttempt=0;this.fill();
    }
    this.onUpdate();
  }
  score(t,recent){
    const m=this.memory[t.uri];let score=({'artista relacionado':45,'artista actual':75,contexto:80,'tu colección':80})[t.source]||0;
    const known=knownEvidence(t,m).length>0;
    score+=known?(100-this.settings.discovery)*.35:this.settings.discovery*.2;
    const vote=this.contexts[contex--pd-ink)!important;border:0;border-radius:24px;padding:11px;margin-top:16px;font-size:14px;font-weight:700}.pd-primary:hover{filter:brightness(1.06)}.pd-status{font-size:11px;color:var(--pd-sub);margin:10px 0;line-height:1.5}.pd-error{color:#ffa59c}.pd-link{border:0;background:none;text-decoration:underline;color:var(--pd-sub);font-size:12px}.pd-details{border-top:1px solid var(--spice-highlight,#282828);padding:11px 0;font-size:12px;color:var(--pd-sub)}.pd-details summary{cursor:pointer;color:var(--pd-text);font-size:12px;font-weight:600}.pd-details p{margin:10px 0;line-height:1.6}.pd-details a{display:inline-block;color:var(--pd-text);margin:10px 0 0 10px;font-size:11px}.pd-options{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:13px 0}.pd-options label{display:grid;gap:6px}.pd select{width:100%;background:var(--spice-card,#242424);color:var(--pd-text);border:1px solid var(--spice-button-disabled,#666);border-radius:4px;padding:7px;font-size:12px}.pd-check{display:flex;align-items:center;gap:8px;margin:12px 0}.pd-check input{accent-color:var(--pd-accent)}.pd-profile{display:flex;gap:7px;flex-wrap:wrap}.pd-note{font-size:10px;margin:8px 0}\n.pd-compact{padding:16px}.pd-compact .pd-intro,.pd-compact .pd-sliders small{display:none}.pd-compact .pd-playing{margin-top:12px;margin-bottom:12px;padding:8px}.pd-compact .pd-cover{width:42px;height:42px}.pd-compact .pd-feedback{margin:12px 0;padding-bottom:12px}.pd-compact .pd-next{padding:5px 4px}\n.pd-mini{position:fixed;bottom:100px;right:24px;z-index:1000;display:flex;align-items:center;background:var(--spice-card,#202020);border:1px solid var(--spice-highlight,#444);border-radius:30px;box-shadow:0 4px 20px #0006;padding:5px}.pd-mini button{display:flex;gap:8px;align-items:center;background:none;border:0;color:var(--pd-text);padding:8px 10px;font:inherit;font-size:12px;cursor:pointer;border-radius:24px}.pd-mini button:hover{background:var(--spice-highlight,#333)}.pd-mini svg,.pd-mini small{color:var(--pd-accent)}.pd-mini small{font-size:11px}.pd-mini button:focus-visible{outline:2px solid var(--pd-accent)}\n@media(max-width:540px){.pd{padding:16px}.pd-modes{gap:4px}.pd-modes button{padding:7px 9px;font-size:11px}.pd-sliders{gap:16px}.pd-feedback{gap:7px}.pd-options{grid-template-columns:1fr}.pd-mini{right:12px;bottom:95px}.pd h1{font-size:20px}}\n.pd-sr{position:absolute;clip:rect(0,0,0,0);width:1px;height:1px;overflow:hidden}.pd-bars{display:inline-flex;align-items:end;gap:2px;height:11px;margin-left:5px}.pd-bars i{display:block;background:var(--pd-accent);height:4px;width:2px}.pd[data-playing=true] .pd-bars i{animation:pd-pulse 1s ease-in-out infinite alternate}.pd[data-playing=true] .pd-bars i:nth-child(2){animation-delay:-.4s}.pd[data-playing=true] .pd-bars i:nth-child(3){animation-delay:-.7s}.pd .pd-next .pd-reason{color:var(--pd-accent);font-size:10px;margin-top:3px}.pd-next [data-pin][aria-pressed=true]{color:var(--pd-accent)}.pd-presets{display:flex;gap:6px;flex-wrap:wrap;margin:14px 0}.pd .pd-primary{font-weight:700}.pd button{transition:background-color .15s,color .15s,filter .15s}.pd-feedback{flex-wrap:wrap}.pd-details>label{display:grid;gap:6px;margin:12px 0}.pd-compact .pd-compact .pd-reason{display:none}\n@keyframes pd-pulse{to{height:11px}}@media(prefers-reduced-motion:reduce){.pd button{transition:none}.pd[data-playing=true] .pd-bars i{animation:none}}\n@media(max-width:420px){.pd-feedback button{padding:6px 9px}.pd-sliders{grid-template-columns:1fr}.pd-next{gap:7px}}\n.pd-reference{font-size:12px;margin:12px 0}.pd-reference small{color:var(--pd-sub)}.pd-reference p{margin:3px 0;overflow-wrap:anywhere}.pd-chips,.pd-examples,.pd-pickeractions{display:flex;gap:6px;flex-wrap:wrap;margin:10px 0}.pd-chip{background:var(--spice-highlight,#282828);padding:4px 9px;border-radius:16px;font-size:11px}.pd-command label{display:block;font-weight:600;margin:12px 0 7px}.pd-command>div{display:flex;gap:8px}.pd input[type=text],.pd input:not([type]){min-width:0;width:100%;background:var(--spice-card,#242424);color:var(--pd-text);border:1px solid #666;border-radius:8px;padding:10px;font:inherit}.pd-command button,.pd-examples button,.pd-presets button,.pd-pickeractions button,.pd-narration button,.pd-secondary{border:1px solid var(--spice-button-disabled,#666);background:transparent;color:var(--pd-text);border-radius:20px;padding:7px 12px;font-size:12px}.pd-presets button.pd-selected{background:var(--pd-accent);border-color:var(--pd-accent);color:#000}.pd-examples button{font-size:10px;padding:4px 9px}.pd-cards{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin:12px 0}.pd-choice{display:grid;gap:5px;min-width:0;text-align:left;border:0;border-radius:8px;padding:12px;background:var(--spice-card,#181818);animation:pd-enter .18s ease-out}.pd-choice:hover{background:var(--spice-highlight,#282828)}.pd-choice b,.pd-choice small{overflow-wrap:anywhere}.pd-choice b{font-size:13px}.pd-choice small{font-size:11px;color:var(--pd-sub)}.pd-choice .pd-evidence{color:var(--pd-accent);font-size:10px}.pd-choicecover{position:relative;display:grid;place-items:center;aspect-ratio:1;border-radius:5px;overflow:hidden;background:var(--spice-highlight,#282828);margin-bottom:4px}.pd-choicecover>img{width:100%;height:100%;object-fit:cover}.pd-choiceplay{position:absolute;bottom:8px;right:8px;border-radius:50%;background:var(--pd-accent);color:#000;padding:8px 12px;box-shadow:0 3px 12px #0007}.pd-picker{border:1px solid var(--spice-highlight,#333);padding:14px;border-radius:10px;margin:14px 0;animation:pd-enter .2s ease-out}.pd-picker>p{font-size:12px;color:var(--pd-sub)}.pd-narration{background:var(--spice-card,#181818);border-left:3px solid var(--pd-accent);padding:12px;border-radius:6px;margin:16px 0}.pd-narration p{font-size:13px;margin:0 0 10px}.pd-narration small{display:block;color:var(--pd-sub);font-size:10px;margin-top:8px}.pd .pd-other{width:auto;height:auto;font-size:11px;line-height:1.4;border:1px solid #666;border-radius:20px;padding:6px 10px}.pd-secondary{display:block;width:100%;margin:8px 0}.pd [data-tag]{display:grid;gap:8px;margin:12px 0}.pd button{transition:background-color .18s,color .18s,transform .18s,opacity .18s}.pd button:not(:disabled):active{transform:scale(.98)}\n@keyframes pd-enter{from{opacity:0;transform:translateY(7px)}to{opacity:1;transform:translateY(0)}}\n@media(prefers-reduced-motion:reduce){.pd *{animation:none!important;transition:none!important}}@media(max-width:350px){.pd-cards{gap:7px}.pd-choice{padding:8px}.pd-command>div{flex-wrap:wrap}.pd-command button{width:100%}}\n.pd-artist-photo{border-radius:50%}.pd [data-matches]{padding:12px;border:1px solid var(--spice-highlight,#333);border-radius:8px}.pd .pd-next .pd-flow{font-size:10px;color:var(--pd-sub)}\n\n/* POOR DJ: a small music desk, with the daily controls always in reach. */\n.pd{max-width:640px;padding:22px;border-radius:12px}.pd-header{margin:0}.pd h1{letter-spacing:-1px;font-size:24px}.pd-byline{display:flex;justify-content:space-between;gap:12px;color:var(--pd-sub);font-size:11px;margin:5px 0 18px}.pd-header .pd-voice,.pd-follow{border:0;background:var(--spice-highlight,#252525);border-radius:22px;padding:7px 12px;font-size:11px}.pd-follow{margin:0 0 10px}.pd-reference{margin:10px 0;font-size:11px}.pd-reference p{margin:1px 0}.pd-playing{margin-bottom:10px}.pd-command label{font-size:14px}.pd-command button{white-space:nowrap;padding:8px 11px;font-size:11px}.pd-feedback{margin:12px 0;padding-bottom:12px;gap:8px}.pd-feedbackmore{margin-left:auto;position:relative;font-size:11px}.pd-feedbackmore summary{cursor:pointer;color:var(--pd-sub);padding:6px}.pd-feedbackmore[open]{width:100%;margin:0}.pd-feedbackmore button{margin:5px 4px 0 0}.pd-customize{margin-top:14px;border-top:1px solid var(--spice-highlight,#282828);padding-top:14px}.pd-customize>summary{font-size:12px;cursor:pointer;color:var(--pd-sub)}.pd-customize .pd-details{margin-top:10px}.pd-narration{padding:10px 12px;margin:12px 0}.pd-narration p{margin:0;font-size:12px}.pd .pd-note{font-size:11px;line-height:1.5}.pd-choicecover{max-height:118px;aspect-ratio:auto;height:118px}.pd-choiceplay{padding:6px 10px;font-size:12px}.pd-choice{padding:10px}.pd-picker{padding:12px;margin:12px 0}.pd-picker>p{font-size:11px;margin:6px 0}.pd-presets{margin:12px 0}.pd-presets button{font-size:11px;padding:6px 10px}.pd [data-matches]{max-height:320px;overflow-y:auto;overscroll-behavior:contain;padding:10px}.pd-results{display:grid;gap:5px;margin-top:8px}.pd-results .pd-choice{display:grid;grid-template-columns:42px minmax(0,1fr);column-gap:10px;row-gap:2px;padding:7px;align-items:center}.pd-results .pd-choicecover{grid-row:1/4;width:42px;height:42px;margin:0}.pd-results .pd-choice b,.pd-results .pd-choice small{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;overflow-wrap:normal}.pd-results .pd-choiceplay{display:none}.pd-artistmenu{padding:14px;background:var(--spice-card,#181818);border-radius:10px;animation:pd-enter .18s ease-out}.pd-artistmenu p{font-size:11px;color:var(--pd-sub);margin:8px 0}.pd-menuhead{display:flex;align-items:center;gap:10px}.pd-menuhead button{background:none;border:0;font-size:11px;color:var(--pd-sub)}.pd-mode{border:1px solid var(--spice-highlight,#333);padding:14px;align-content:start}.pd-mode:hover{border-color:var(--pd-accent)}.pd-mode b{color:var(--pd-accent)}.pd-primary{margin-top:12px}.pd-compact .pd-reference{font-size:10px}.pd-compact .pd-choicecover{height:90px}.pd-cover>svg{color:var(--pd-accent)}\n@media(max-width:540px){.pd{padding:16px}.pd-byline{font-size:10px}.pd h1{font-size:22px}.pd-header .pd-voice{padding:6px 9px;font-size:10px}.pd-command>div{gap:6px}.pd-command input{font-size:12px}.pd-cards{gap:8px}}\n@media(prefers-reduced-motion:reduce){.pd *{animation:none!important;transition:none!important}}\n\n/* POOR DJ 3.4: tinte de portada, pestañas, transporte y letras. */\n.pd{--pd-tint:transparent;position:relative;background:linear-gradient(180deg,color-mix(in srgb,var(--pd-tint) 38%,var(--pd-bg)) 0,var(--pd-bg) 340px) var(--pd-bg);transition:background .6s}\n.pd-tabs{display:flex;gap:4px;padding:4px;background:var(--spice-card,#1c1c1c);border-radius:24px;margin:0 0 14px}.pd-tabs button{flex:1;border:0;background:none;border-radius:20px;padding:7px;font-size:12px;font-weight:650;color:var(--pd-sub)}.pd .pd-tabs button.pd-selected{background:var(--pd-accent);color:var(--pd-ink)}\n.pd-playing{background:color-mix(in srgb,var(--pd-tint) 18%,var(--spice-card,#181818));box-shadow:0 8px 24px #0004}.pd-cover{width:68px;height:68px;border-radius:8px;box-shadow:0 6px 18px #0006}.pd-compact .pd-cover{width:48px;height:48px}\n.pd-transport{display:flex;align-items:center;gap:8px;margin:0 0 14px;font-size:11px;color:var(--pd-sub)}.pd-transport button{border:0;background:none;font-size:14px;width:32px;height:32px;border-radius:50%;padding:0}.pd-transport button:hover{background:var(--spice-highlight,#282828)}.pd .pd-transport .pd-playbtn{background:var(--pd-text);color:var(--pd-bg);font-size:12px}.pd-progress{flex:1;height:14px;display:flex;align-items:center;cursor:pointer}.pd-progress:before{content:'';display:block;height:4px;width:100%;border-radius:2px;background:linear-gradient(90deg,var(--pd-accent) calc(var(--p,0)*100%),var(--spice-highlight,#3a3a3a) 0)}.pd-progress:hover:before{height:6px}.pd-progress i{display:none}\n.pd-lyricspane{display:flex;flex-direction:column;gap:10px}.pd-lyricshead{display:flex;justify-content:space-between;gap:10px;color:var(--pd-sub);overflow:hidden}.pd-lyricshead small{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}\n.pd-lyricsscroll{height:min(52vh,430px);overflow-y:auto;overscroll-behavior:contain;scrollbar-width:none;padding:34% 4px;mask-image:linear-gradient(transparent,#000 14%,#000 82%,transparent);-webkit-mask-image:linear-gradient(transparent,#000 14%,#000 82%,transparent);border-radius:10px}.pd-lyricsscroll::-webkit-scrollbar{display:none}\n.pd-lines{display:grid;gap:.55em}.pd-line{margin:0;font-size:22px;line-height:1.25;font-weight:750;letter-spacing:-.4px;color:var(--pd-text);opacity:.36;filter:blur(.6px);transform-origin:left center;transition:opacity .35s,transform .35s,filter .35s;cursor:pointer}.pd-line:hover{opacity:.7}.pd-line[data-d=\"1\"]{opacity:.5}.pd-line[data-d=\"2\"]{opacity:.38}.pd-line[data-d=\"3\"]{opacity:.28;filter:blur(1.2px)}.pd .pd-line.pd-now{opacity:1;filter:none;transform:scale(1.03);text-shadow:0 0 22px color-mix(in srgb,var(--pd-accent) 45%,transparent)}.pd-line.pd-gap{font-size:14px;letter-spacing:4px}\n.pd[data-lsize=s] .pd-line{font-size:17px}.pd[data-lsize=l] .pd-line{font-size:28px}\n.pd-lyricstools{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.pd-lyricstools>span{display:flex;align-items:center;gap:6px;margin-left:auto;color:var(--pd-sub);font-size:11px}.pd-lyricstools button{border:1px solid var(--spice-button-disabled,#666);background:none;border-radius:20px;padding:5px 11px;font-size:12px}.pd-lyricstools button:hover{border-color:var(--pd-text)}\n.pd:fullscreen{max-width:none;width:100vw;height:100vh;border-radius:0;padding:5vh 6vw;overflow:auto}.pd:fullscreen .pd-lyricsscroll{height:62vh}.pd:fullscreen .pd-line{font-size:clamp(26px,4vw,52px)}\n.pd[data-lyrics=false] .pd-tabs{display:none}.pd-lyricsscroll:focus-visible{outline:2px solid var(--pd-accent)}\n.pd-choice,.pd-next,.pd-details{border-radius:10px}.pd-primary{box-shadow:0 6px 18px color-mix(in srgb,var(--pd-accent) 28%,transparent)}\n@media(prefers-reduced-motion:reduce){.pd-line,.pd{transition:none!important}}\n@media(max-width:540px){.pd-line{font-size:19px}.pd-lyricsscroll{height:46vh}}\n\n/* Página de letras de escritorio (/PoorDJ). */\n.pd-page{position:absolute;inset:0;z-index:5;max-width:none;width:auto;border-radius:inherit;display:grid;grid-template-columns:minmax(220px,32%) 1fr;gap:4vw;padding:4vh 4vw;overflow:hidden;background:linear-gradient(135deg,color-mix(in srgb,var(--pd-tint) 55%,#000),var(--pd-bg) 70%) var(--pd-bg)}\n.pd-pagecover{display:flex;flex-direction:column;justify-content:center;gap:10px;min-width:0}.pd-bigcover{width:100%;height:auto;aspect-ratio:1;max-width:340px;border-radius:12px;box-shadow:0 18px 48px #0008}.pd-page h2{font-size:22px;white-space:normal}.pd-page .pd-pagecover p{margin:0;color:var(--pd-sub)}\n.pd-pagelyrics{display:flex;flex-direction:column;gap:10px;min-height:0;min-width:0}.pd-pagelyrics .pd-lyricsscroll{flex:1;height:auto;padding:30vh 4px}.pd-page .pd-line{font-size:clamp(24px,3vw,44px)}.pd-page[data-lsize=s] .pd-line{font-size:clamp(18px,2.2vw,32px)}.pd-page[data-lsize=l] .pd-line{font-size:clamp(30px,4vw,58px)}\n.pd-page .pd-secondary{width:auto;align-self:flex-start;margin:2px 0}.pd-page:fullscreen{position:fixed}\n@media(max-width:760px){.pd-page{grid-template-columns:1fr}.pd-pagecover{display:none}}\n\n/* El DJ como pista: tarjeta con identidad propia mientras habla. */\n.pd[data-dj=true] .pd-playing{background:linear-gradient(120deg,color-mix(in srgb,var(--pd-accent) 28%,var(--spice-card,#181818)),var(--spice-card,#181818));border:1px solid color-mix(in srgb,var(--pd-accent) 50%,transparent)}\n.pd[data-dj=true] .pd-cover{background:var(--pd-accent);color:var(--pd-ink)}.pd[data-dj=true] .pd-cover>svg{color:var(--pd-ink);transform:scale(1.4)}.pd[data-dj=true] .pd-playing p{white-space:normal;color:var(--pd-text)}\n.pd-options{grid-template-columns:repeat(2,minmax(0,1fr))}.pd-customize>.pd-check{margin:8px 0}\n\n.pd-toastdj{position:fixed;left:50%;bottom:110px;transform:translateX(-50%);max-width:min(560px,90vw);z-index:100000;background:var(--spice-card,#181818);color:var(--spice-text,#fff);border:1px solid #1ed760;border-radius:14px;padding:10px 16px;font-size:14px;box-shadow:0 8px 28px #000a;animation:pd-enter .2s ease-out}.pd-toastdj[hidden]{display:none}.pd-toastdj b{color:#1ed760;margin-right:6px}\n.pd-transport [data-openspicy]{width:auto;border-radius:16px;padding:0 10px;font-size:11px;border:1px solid var(--spice-button-disabled,#666)}\n\n.pd-diag{list-style:none;padding:0;margin:8px 0;font-size:12px;display:grid;gap:4px}.pd-diag:empty{display:none}\n\n/* 3.4 simplificada: una tarjeta de inicio, después lo demás. */\n.pd-start{display:grid;gap:10px;padding:14px;margin:0 0 14px;background:var(--spice-card,#181818);border-radius:14px}\n.pd-start .pd-presets{display:flex;gap:4px;padding:4px;margin:0;background:var(--spice-main,#121212);border-radius:24px}.pd-start .pd-presets button{flex:1;border:0;border-radius:20px;padding:8px 6px;font-size:12px;font-weight:650;color:var(--pd-sub)}.pd .pd-start .pd-presets button.pd-selected{background:var(--pd-text);color:var(--pd-bg)}\n.pd-start .pd-primary{margin:0;padding:13px;font-size:15px}.pd .pd-primary.pd-stop{background:transparent;color:var(--pd-text)!important;border:1px solid var(--spice-button-disabled,#666);box-shadow:none}\n.pd-start .pd-follow{margin:0;background:none;color:var(--pd-sub);text-decoration:underline;justify-self:center;font-size:12px;padding:2px}.pd-start .pd-status{margin:0;text-align:center}.pd-start .pd-secondary{margin:0}\n.pd-command{margin:16px 0 0}.pd-command label{font-size:13px;color:var(--pd-sub);font-weight:600}\n.pd-queuehead{margin-top:14px}\n.pd-credit{margin:18px 0 0;padding-top:12px;border-top:1px solid var(--spice-highlight,#282828);text-align:center;font-size:11px;color:var(--pd-sub)}.pd-credit b{color:var(--pd-text);letter-spacing:.8px}\n\n/* Robustez y pulido de 3.4. */\n.pd-lyricspane:fullscreen,.pd-page:fullscreen{background:var(--pd-bg,#121212);color:var(--pd-text,#fff);padding:5vh 6vw;display:flex;flex-direction:column}.pd-lyricspane:fullscreen .pd-lyricsscroll{flex:1;height:auto}.pd-lyricspane:fullscreen .pd-line{font-size:clamp(26px,4vw,52px)}\n.pd button:focus-visible,.pd-tabs button:focus-visible{outline:2px solid var(--pd-accent);outline-offset:2px}\n.pd-narration{font-style:italic}.pd-narration p{line-height:1.45}\n.pd-live{display:inline-flex;align-items:center;gap:4px;padding:2px 10px;border-radius:12px;background:var(--spice-card,#1c1c1c)}.pd-live.pd-active{background:color-mix(in srgb,var(--pd-accent) 18%,var(--spice-card,#1c1c1c))}\n.pd-next{transition:background-color .15s}.pd-chip{border:1px solid var(--spice-highlight,#333);background:transparent}\n.pd-toastdj{pointer-events:none}\n";
function mountUI(S,engine,{audio,queue,narrator,voiceGate,library,transitions,recovery,recoverVolume,lyrics,diagnose}){
  const style=document.createElement('style');style.id='poor-dj-style';style.textContent=CSS;document.head.append(style);
  let panel;const mini=document.createElement('aside');mini.className='pd-mini';mini.hidden=true;mini.setAttribute('aria-label','Sesión POOR DJ');
  mini.innerHTML=`<button data-open>${ICON}<span>POOR DJ</span></button><button data-stop aria-label="Terminar DJ">■</button>`;document.body.append(mini);
  const perform=async work=>{try{await work();}catch(e){engine.notify(e.message,true);}finally{update();}};
  mini.querySelector('[data-open]').onclick=()=>open();mini.querySelector('[data-stop]').onclick=()=>perform(()=>engine.stop());
  let playerButton=null,playerButtonParent=null,playerButtonFrame=0;
  const ensurePlayerButton=()=>{
    const bar=document.querySelector('[data-testid="now-playing-bar"]');
    const anchor=bar?.querySelector('#SpicyLyrics_PageButton')||bar?.querySelector('[data-testid="control-button-queue"]');
    const parent=anchor?.parentElement;
    if(!parent)return;
    if(playerButton?.isConnected && playerButtonParent===parent)return;
    playerButton?.remove();
    playerButton=document.createElement('button');playerButton.type='button';
    const styleRef=bar.querySelector('[data-testid="control-button-queue"]')||anchor;
    playerButton.className=styleRef.className;
    playerButton.id='PoorDJ_PlaybarButton';playerButton.setAttribute('aria-label','Abrir POOR DJ · Ctrl+D');playerButton.title='POOR DJ · Ctrl+D';
    playerButton.innerHTML=ICON;playerButton.onclick=()=>open();
    parent.insertBefore(playerButton,anchor);playerButtonParent=parent;
  };
  const playerButtonObserver=new MutationObserver(()=>{
    if(playerButtonFrame)return;
    playerButtonFrame=requestAnimationFrame(()=>{playerButtonFrame=0;ensurePlayerButton();});
  });
  playerButtonObserver.observe(document.body,{childList:true,subtree:true});
  const shortcut=e=>{
    if(e.code!=='KeyD'||!e.ctrlKey||e.altKey||e.shiftKey||e.metaKey||e.repeat)return;
    const target=e.target;
    if(target?.isContentEditable||/^(INPUT|TEXTAREA|SELECT)$/.test(target?.tagName||'')||target?.closest?.('[contenteditable="true"],[role="textbox"]'))return;
    e.preventDefault();e.stopPropagation();open();
  };
  document.addEventListener('keydown',shortcut,true);
  ensurePlayerButton();
  const theme=node=>{node.dataset.accent=engine.settings.accent;node.classList.toggle('pd-compact',engine.settings.compact);};
  const text=(key,value)=>{const n=panel?.querySelector(`[data-${key}]`);if(n && n.textContent!==String(value))n.textContent=value;};
  const download=(data,name)=>{const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
  const L={uri:'',data:null,state:'idle',idx:-2,follow:true,pause:0,raf:0,tab:'dj',tint:new Map(),tintUri:'',sleep:0,sleepAt:0,job:0};
  const fmt=ms=>{const s=Math.max(0,Math.floor(ms/1000));return Math.floor(s/60)+':'+String(s%60).padStart(2,'0');};
  const clock=()=>S.Player.getProgress()+(engine.settings.lyricsOffset||0);
  const seek=ms=>{try{if(typeof S.Player.seek==='function')S.Player.seek(ms);else (S.Platform.PlayerAPI?.seekTo||S.Platform.PlayerAPI?.seek)?.call(S.Platform.PlayerAPI,ms);}catch(_){}};
  let panelView;
  const views=[];
  const addView=(root,active)=>{const v={root,active,idx:-2,rendered:'',follow:true,pause:0};views.push(v);return v;};
  const liveViews=()=>{for(let i=views.length-1;i>=0;i--)if(!views[i].root.isConnected)views.splice(i,1);return views;};
  const resetViews=()=>liveViews().forEach(v=>{v.idx=-2;v.follow=true;v.pause=0;});
  function loadLyrics(){
    const track=engine.current;if(!ownLyrics() || !track?.uri || !liveViews().some(v=>v.active())){return;}
    if(L.uri===track.uri && L.state!=='error')return;
    L.uri=track.uri;L.state='loading';L.data=null;views.forEach(v=>{v.rendered='';v.idx=-2;});const job=++L.job;paintLyrics();
    lyrics.get(track,{fallback:engine.settings.lyricsExternal}).then(r=>{if(job!==L.job)return;L.state=r.state;L.data=r.state==='ready'?r:null;L.message=r.message;views.forEach(v=>v.rendered='');paintLyrics();}).catch(e=>{if(job!==L.job)return;L.state='error';L.message=e.message;views.forEach(v=>v.rendered='');paintLyrics();});
  }
  function paintLyrics(){
    const info={idle:'Reproduce una canción para ver su letra.',loading:'Buscando la letra…',none:engine.settings.lyricsExternal?'No encontré letra para esta canción.':'Spotify no tiene letra para esta canción. Puedes activar la búsqueda externa en Ajustes.',error:'No pude cargar la letra. Se reintentará con la siguiente canción.'};
    const d=L.data;
    for(const v of liveViews()){
      const box=v.root.querySelector('[data-lines]'),msg=v.root.querySelector('[data-lyricsmsg]');if(!box)continue;
      msg.hidden=!!d;msg.textContent=d?'':info[L.state]||'';
      const key=d?L.uri+d.source:'';if(v.rendered===key)continue;v.rendered=key;
      box.innerHTML=d?d.lines.map((l,i)=>`<p class="pd-line${isGap(l)?' pd-gap':''}" ${l.t!=null?`data-seek="${l.t}"`:''} data-i="${i}">${isGap(l)?'<span aria-hidden="true">● ● ●</span>':esc(l.text)}</p>`).join(''):'';
      v.root.querySelector('[data-lyricssource]').textContent=d?`${d.synced?'Sincronizada':'Sin sincronizar'} · ${d.provider||d.source}`:'';
      box.parentNode.scrollTop=0;v.idx=-2;
    }
  }
  function tickLyrics(){
    if(!L.data?.synced)return;
    for(const v of liveViews()){
      if(!v.active())continue;const box=v.root.querySelector('[data-lines]');if(!box)continue;
      const i=activeLine(L.data.lines,clock()+250);if(i===v.idx)continue;
      const nodes=box.children;if(v.idx>=0 && nodes[v.idx])nodes[v.idx].classList.remove('pd-now');
      v.idx=i;if(i<0)continue;
      for(let n=Math.max(0,i-8);n<Math.min(nodes.length,i+9);n++)nodes[n].dataset.d=Math.min(3,Math.abs(n-i));
      const node=nodes[i];node.classList.add('pd-now');
      if(v.follow && Date.now()>v.pause){const sc=box.parentNode;sc.scrollTo({top:Math.max(0,node.offsetTop-sc.clientHeight*.38+node.offsetHeight/2),behavior:matchMedia('(prefers-reduced-motion:reduce)').matches?'auto':'smooth'});}
    }
  }
  function wireLyrics(v){
    const root=v.root,sc=root.querySelector('.pd-lyricsscroll'),back=root.querySelector('[data-follow-lyrics]');
    const pause=()=>{v.pause=Date.now()+3500;back.hidden=false;};
    sc.addEventListener('wheel',pause,{passive:true});sc.addEventListener('touchmove',pause,{passive:true});sc.addEventListener('keydown',e=>{if(['ArrowUp','ArrowDown','PageUp','PageDown'].includes(e.key))pause();});
    root.addEventListener('click',e=>{
      const line=e.target.closest('[data-seek]');
      if(line){e.stopPropagation();seek(Math.max(0,Number(line.dataset.seek)-(engine.settings.lyricsOffset||0)));v.follow=true;v.pause=0;return;}
      const b=e.target.closest('button');if(!b || !root.contains(b))return;const d=b.dataset;
      if('followLyrics'in d){v.follow=true;v.pause=0;b.hidden=true;v.idx=-2;tickLyrics();}
      else if(d.offset)Promise.resolve(engine.updateSettings({lyricsOffset:engine.settings.lyricsOffset+Number(d.offset)},false)).then(()=>{resetViews();update();});
      else if('lsize'in d)Promise.resolve(engine.updateSettings({lyricsSize:{s:'m',m:'l',l:'s'}[engine.settings.lyricsSize]},false)).then(update);
      else if('full'in d){try{document.fullscreenElement?document.exitFullscreen():root.requestFullscreen?.();}catch(_){}}
      else return;
      e.stopPropagation();
    });
  }
  const lyricsTools='<div class="pd-lyricstools"><button data-follow-lyrics hidden>Volver a la línea actual</button><span><button data-offset="-250" aria-label="Retrasar letra">−</button><small>Ajuste <b data-offsetlabel>0 s</b></small><button data-offset="250" aria-label="Adelantar letra">+</button></span><button data-lsize aria-label="Cambiar tamaño de letra">Aa</button><button data-full aria-label="Pantalla completa">⛶</button></div>';
  const lyricsBody='<div class="pd-lyricsscroll" tabindex="0" aria-label="Letra de la canción"><p class="pd-note" data-lyricsmsg role="status"></p><div data-lines class="pd-lines"></div></div>';
  function frame(){
    L.raf=0;if(!panel?.isConnected && !pageEl?.isConnected)return;
    try{frameBody();}catch(_){}
    if(S.Player.isPlaying())L.raf=requestAnimationFrame(frame);
  }
  function frameBody(){
    const dur=S.Player.getDuration?.()||engine.current?.duration||0,pos=S.Player.getProgress();
    const bar=panel?.querySelector('[data-progress]');if(bar){bar.style.setProperty('--p',dur?Math.min(1,pos/dur):0);panel.querySelector('[data-pos]').textContent=fmt(pos);panel.querySelector('[data-dur]').textContent=fmt(dur);}
    tickLyrics();
    if(L.sleepAt && Date.now()>=L.sleepAt){L.sleepAt=0;L.sleep=0;if(panel)panel.querySelector('[data-sleep]').value='0';if(engine.active)perform(()=>engine.stop());}
  }
  const startFrame=()=>{if(!L.raf && (panel?.isConnected || pageEl?.isConnected))L.raf=requestAnimationFrame(frame);};
  const tintTargets=()=>[panel,pageEl].filter(n=>n?.isConnected);
  const paintTint=()=>{const v=engine.settings.ambient?L.tint.get(engine.current?.image):'';tintTargets().forEach(n=>v?n.style.setProperty('--pd-tint',v):n.style.removeProperty('--pd-tint'));};
  async function tint(){
    if(!tintTargets().length)return;
    const uri=engine.current?.image;if(!engine.settings.ambient || !uri){paintTint();return;}
    if(L.tint.has(uri)){paintTint();return;}
    if(L.tintUri===uri)return;L.tintUri=uri;
    try{const c=await S.colorExtractor?.(engine.current.uri);L.tint.set(uri,c?.VIBRANT||c?.PROMINENT||c?.DARK_VIBRANT||'');}catch(_){L.tint.set(uri,'');}
    paintTint();
  }
  function setTab(tab){
    L.tab=tab;panel.querySelectorAll('[data-tab]').forEach(b=>{const on=b.dataset.tab===tab;b.classList.toggle('pd-selected',on);b.setAttribute('aria-selected',String(on));b.tabIndex=on?0:-1;});
    panel.querySelectorAll('[data-pane]').forEach(n=>n.hidden=n.dataset.pane!==tab);
    if(tab==='lyrics'){loadLyrics();resetViews();startFrame();queueMicrotask(tickLyrics);}
  }
  // Página de letras a pantalla completa de la ventana (ruta /PoorDJ), con la misma letra que el panel.
  let pageEl,pageView;const ROUTE='/PoorDJ',spicy=()=>!!root.SpicyLyrics,ownLyrics=()=>engine.settings.lyrics && !spicy();
  const mainView=()=>document.querySelector('.Root__main-view')||document.querySelector('#main-view');
  const onRoute=()=>S.Platform.History?.location?.pathname===ROUTE;
  function closePage(){pageEl?.remove();pageEl=null;}
  function updatePage(){
    if(!ownLyrics() || !onRoute()){if(pageEl)closePage();return;}
    if(!pageEl?.isConnected){
      const host=mainView();if(!host)return;
      pageEl=document.createElement('section');pageEl.className='pd pd-page';pageEl.id='PoorDJPage';pageEl.setAttribute('aria-label','Letras');
      pageEl.innerHTML=`<aside class="pd-pagecover"><div class="pd-cover pd-bigcover">${ICON}<img data-pcover alt="Portada actual" hidden></div><h2 data-ptitle></h2><p data-partist></p><div class="pd-transport"><button data-prev aria-label="Anterior">⏮</button><button data-toggleplay class="pd-playbtn" aria-label="Reproducir">▶</button><button data-nextsong aria-label="Siguiente">⏭</button></div><button class="pd-secondary" data-opendj>Abrir panel del DJ</button><button class="pd-secondary" data-closepage>Cerrar letras</button></aside><div class="pd-pagelyrics"><div class="pd-lyricshead"><small></small><small data-lyricssource></small></div>${lyricsBody}${lyricsTools}</div>`;
      host.append(pageEl);pageView=addView(pageEl,()=>true);wireLyrics(pageView);
      pageEl.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;const d=b.dataset;
        if('closepage'in d)S.Platform.History.goBack?.();else if('opendj'in d)open();else if('spicy'in d)S.Platform.History.push('/SpicyLyrics');
        else if('prev'in d)S.Player.back?.();else if('nextsong'in d)S.Player.next?.();else if('toggleplay'in d)setTimeout(()=>{S.Player.togglePlay?.();setTimeout(update,120);},0);});
      L.uri='';
    }
    theme(pageEl);pageEl.dataset.lsize=engine.settings.lyricsSize;pageEl.dataset.lyrics='true';
    const t=engine.current,img=pageEl.querySelector('[data-pcover]'),url=imageURL(t?.image);img.hidden=!url;if(url && img.getAttribute('src')!==url)img.src=url;
    pageEl.querySelector('[data-ptitle]').textContent=t?.name||'Reproduce algo que te guste';pageEl.querySelector('[data-partist]').textContent=t?.artists.map(a=>a.name).join(', ')||'';
    pageEl.querySelector('[data-toggleplay]').textContent=S.Player.isPlaying()?'❚❚':'▶';
    const off=(engine.settings.lyricsOffset>0?'+':'')+(engine.settings.lyricsOffset/1000).toFixed(2).replace(/\.?0+$/,'')+' s';pageEl.querySelector('[data-offsetlabel]').textContent=off;
    loadLyrics();startFrame();
  }
  const navigateLyrics=()=>{if(onRoute())S.Platform.History.goBack?.();else S.Platform.History.push(ROUTE);};
  let lyricsButton=null;const mountedAt=Date.now();
  const ensureButton=()=>{if(lyricsButton || !S.Playbar?.Button || Date.now()-mountedAt<2500 || !ownLyrics())return;lyricsButton=new S.Playbar.Button('Letras · POOR DJ','<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M2 3h12v1.5H2zm0 3.5h8V8H2zM2 10h12v1.5H2zm0 3.5h6V15H2z"/></svg>',navigateLyrics);};
  const buttonTimer=setTimeout(()=>update(),2600);
  // Subtítulo del DJ visible aunque el panel esté cerrado (también sobre otras vistas de letras).
  const toast=document.createElement('aside');toast.className='pd-toastdj';toast.hidden=true;toast.setAttribute('role','status');toast.setAttribute('aria-live','polite');document.body.append(toast);

  const unlisten=S.Platform.History?.listen?.(()=>updatePage());
  function cards(tracks,kind){
    return tracks.map(t=>`<button class="pd-choice" data-${kind}="${esc(t.uri)}" ${engine.choiceBusy?'disabled':''}><span class="pd-choicecover">${imageURL(t.image)?`<img src="${esc(imageURL(t.image))}" alt="" loading="eager">`:ICON}<span class="pd-choiceplay">▶</span></span><b>${esc(t.name)}</b><small>${esc(t.artists.map(a=>a.name).join(', '))}</small><small class="pd-evidence">${esc(evidenceLabel(t.evidence||knownEvidence(t,engine.memory[t.uri]))||t.album||'Resultado de Spotify')}</small></button>`).join('');
  }
  function update(){
    ensurePlayerButton();ensureButton();updatePage();tint();
    const recent=narrator.text && Date.now()-(narrator.textAt||0)<7000,say=(narrator.speaking || recent) && !!narrator.text && !panel?.isConnected;toast.hidden=!say;if(say && !narrator.speaking){clearTimeout(L.toastTimer);L.toastTimer=setTimeout(()=>update(),7100);}if(say){toast.dataset.accent=engine.settings.accent;toast.innerHTML=`<b>DJ POOR</b> ${esc(narrator.text)}`;}theme(mini);mini.hidden=!engine.settings.mini || !engine.active || !!panel?.isConnected;
    if(!panel?.isConnected)return;theme(panel);panel.dataset.lyrics=String(engine.settings.lyrics);panel.dataset.lsize=engine.settings.lyricsSize;panel.dataset.playing=String(engine.active && S.Player.isPlaying());
    text('live',narrator.speaking?'DJ hablando':engine.choiceBusy?'Reproduciendo':engine.active?(engine.busy?'Eligiendo':'DJ activo'):'Tú tienes el control');
    panel.querySelector('[data-live]').classList.toggle('pd-active',engine.active);
    panel.querySelector('.pd-reference').hidden=!engine.active;panel.querySelector('[data-follow]').hidden=engine.active;panel.querySelector('[data-intent]').hidden=!engine.active;
    panel.querySelector('.pd-feedback').hidden=!engine.active;
    panel.querySelector('.pd-queuehead').hidden=!engine.active;
    panel.querySelector('[data-next]').hidden=!engine.active;
    panel.querySelector('[data-session]').hidden=!engine.active && !engine.sessionHeardMs;
    panel.querySelector('[data-savedmix]').hidden=!engine.mixPlaylist;
    text('title',engine.current?.name||'Reproduce algo que te guste');text('artist',engine.current?.artists.map(a=>a.name).join(', ')||'Tu próxima sesión empieza contigo.');
    const img=panel.querySelector('[data-cover]'),url=imageURL(engine.current?.image);img.hidden=!url || !!narrator.speaking;if(url && img.getAttribute('src')!==url)img.src=url;
    text('reference',engine.anchor?`${engine.anchor.name} · ${engine.anchor.artists.map(a=>a.name).join(', ')}`:'Elige una referencia al empezar.');
    const labels=intentLabels(engine.intent),chips=panel.querySelector('[data-intent]');if(chips._key!==JSON.stringify(labels)){chips._key=JSON.stringify(labels);chips.innerHTML=labels.map(label=>`<span class="pd-chip">${esc(label)}</span>`).join('');}
    text('status',engine.status);panel.querySelector('[data-status]').classList.toggle('pd-error',engine.error);
    const toggle=panel.querySelector('[data-toggle]');toggle.classList.toggle('pd-stop',engine.active);toggle.textContent=engine.active?'Terminar DJ':engine.intent.known?'Elegir música conocida':'Empezar DJ';toggle.disabled=!!engine.choiceBusy || engine.busy;toggle.hidden=engine.choosing && !engine.active;
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
    text('voicestatus',!narrator.voice?'Este cliente no ofrece voz en español. Los comentarios siguen por escrito.':narrator.voice.localService?'':'Voz en línea: el texto del comentario se envía a su proveedor.');panel.querySelector('[data-voicestatus]').hidden=!panel.querySelector('[data-voicestatus]').textContent;
    const pick=panel.querySelector('[data-voicepick]'),vlist=narrator.voices(),pickKey=JSON.stringify(vlist.map(v=>v.name));
    if(pick._key!==pickKey){pick._key=pickKey;pick.innerHTML='<option value="">Automática (local)</option><option value="off">Sin voz (solo subtítulos)</option>'+vlist.map(v=>`<option value="${esc(v.name)}">${esc(v.name)} · ${esc(v.lang)}${v.localService?'':' · en línea'}</option>`).join('');}
    if(document.activeElement!==pick)pick.value=!engine.settings.voice?'off':vlist.some(v=>v.name===engine.settings.voiceName)?engine.settings.voiceName:'';
    // El DJ aparece como una pista más mientras habla.
    const talking=!!narrator.speaking;panel.dataset.dj=String(talking);
    if(talking){text('title','DJ POOR');text('artist',narrator.text||'');panel.querySelector('[data-cover]').hidden=true;}
    panel.querySelector('[data-nowlabel]').textContent=talking?'DJ en directo':'Sonando ahora';
    const voice=panel.querySelector('[data-voice]');voice.disabled=!narrator.voice;voice.textContent=narrator.enabled?'Silenciar voz':'Activar voz';voice.setAttribute('aria-pressed',String(narrator.enabled));
    panel.querySelector('[data-recovervolume]').hidden=!recovery();
    panel.querySelectorAll('[data-select]').forEach(input=>{if(document.activeElement!==input)input.value=engine.settings[input.dataset.select];});
    panel.querySelectorAll('[data-setting]').forEach(input=>{input.checked=engine.settings[input.dataset.setting];input.disabled=input.dataset.setting==='takeover' && (engine.active || engine.busy);});
    panel.querySelector('[data-savesession]').disabled=engine.sessionList.length<2 || engine.busy;
    panel.querySelector('[data-tabs]').hidden=!ownLyrics();if(!ownLyrics() && L.tab==='lyrics')setTab('dj');panel.querySelector('[data-openspicy]').hidden=!spicy();panel.querySelectorAll('[data-setting=lyrics],[data-setting=lyricsExternal]').forEach(i=>i.closest('label').hidden=spicy());panel.querySelector('[data-lrclibnote]').hidden=spicy();
    const play=panel.querySelector('[data-toggleplay]');play.textContent=S.Player.isPlaying()?'❚❚':'▶';play.setAttribute('aria-label',S.Player.isPlaying()?'Pausar':'Reproducir');
    text('offsetlabel',(engine.settings.lyricsOffset>0?'+':'')+(engine.settings.lyricsOffset/1000).toFixed(2).replace(/\.?0+$/,'')+' s');
    panel.querySelector('[data-lyricsmini]').textContent=engine.current?.name?`${engine.current.name} · ${engine.current.artists.map(a=>a.name).join(', ')}`:'';
    loadLyrics();startFrame();
  }
  function open(){
    if(panel?.isConnected){update();return;}
    panel=document.createElement('section');panel.className='pd';
    panel.innerHTML=`<header class="pd-header"><div class="pd-brand">${ICON}<h1>POOR DJ <small>${VERSION}</small></h1></div><button class="pd-voice" data-voice></button></header><div class="pd-byline"><span>Tu música. Tu mando.</span><span class="pd-live" data-live></span></div>
      <div class="pd-tabs" role="tablist" data-tabs aria-label="Vista"><button role="tab" data-tab="dj" aria-selected="true" class="pd-selected">DJ</button><button role="tab" data-tab="lyrics" aria-selected="false" tabindex="-1">Letras</button></div>
      <div class="pd-playing"><div class="pd-cover">${ICON}<img data-cover alt="Portada actual" hidden></div><div><small><span data-nowlabel>Sonando ahora</span> <span class="pd-bars" aria-hidden="true"><i></i><i></i><i></i></span></small><h2 data-title></h2><p data-artist></p></div></div>
      <div class="pd-transport"><button data-prev aria-label="Anterior">⏮</button><button data-toggleplay class="pd-playbtn" aria-label="Reproducir">▶</button><button data-nextsong aria-label="Siguiente">⏭</button><button data-openspicy hidden aria-label="Abrir letras en Spicy Lyrics">Letras ↗</button><span data-pos>0:00</span><div class="pd-progress" data-progress role="progressbar" aria-label="Progreso"><i></i></div><span data-dur>0:00</span></div>
      <div data-pane="lyrics" hidden class="pd-lyricspane"><div class="pd-lyricshead"><small data-lyricsmini></small><small data-lyricssource></small></div>${lyricsBody}${lyricsTools}<div class="pd-lyricstools"><button data-openpage>Abrir letras en la ventana</button></div></div>
      <div data-pane="dj">
      <section class="pd-start" aria-label="Empezar"><div class="pd-presets" role="group" aria-label="Selección musical"><button data-known="true">Solo música conocida</button><button data-known="false">Descubrir afines</button></div>
      <button class="pd-primary" data-toggle></button><button class="pd-follow" aria-label="Seguir esta canción" data-follow>Seguir esta canción ↗</button><button class="pd-secondary" data-restore hidden>Restaurar cola guardada</button><p class="pd-status" data-status role="status" aria-live="polite"></p></section>
      <section data-picker class="pd-picker" hidden aria-label="Elige tu primera canción"><h3>Tu música conocida</h3><p data-pickernote></p><div class="pd-cards" data-cards></div><div class="pd-pickeractions"><button data-again>Otra vez</button><button data-resetdeck hidden>Reiniciar selección</button><button data-closepicker>Cancelar</button></div></section>
      <div class="pd-reference"><small>Referencia de la sesión</small><p data-reference></p></div><div class="pd-chips" data-intent aria-label="Instrucciones vigentes"></div>
      <div class="pd-feedback"><button data-feedback="more">Más como esta</button><button data-feedback="less">No encaja</button><details class="pd-feedbackmore"><summary>Más opciones</summary><button data-feedback="artist">Este artista no, por hoy</button><button data-feedback="repeat">Demasiado repetida</button><button data-undo>Deshacer</button></details></div>
      <div class="pd-queuehead"><h3>A continuación</h3><button data-refresh class="pd-other">Otra sugerencia</button></div><div data-next></div><div data-next></div>
      <form data-command class="pd-command"><label for="pd-command">¿Qué quieres escuchar?</label><div><input id="pd-command" name="command" autocomplete="off" maxlength="240" placeholder="Yoko, L A K E N O S H I o sigue esta canción" required><button type="submit">Buscar</button></div></form>
      <div data-matches hidden></div><section data-artistmenu class="pd-artistmenu" hidden aria-label="Mezcla del artista"></section><button data-closesearch class="pd-secondary" hidden>Cerrar resultados</button>
      <section class="pd-narration" data-narration hidden aria-label="Comentarios del DJ"><p data-caption aria-live="polite"></p></section><p class="pd-note" data-session></p><p class="pd-note" data-session></p>
      <p class="pd-note" data-savedmix></p><button class="pd-secondary" data-openmix hidden>Abrir última playlist guardada</button>
      <details class="pd-customize"><summary>Ajustes</summary>
        <div class="pd-options"><label>Voz del DJ<select data-voicepick></select></label><label>El DJ comenta<select data-select="talk"><option value="start">Al empezar y al cambiar</option><option value="few">Cada 5 canciones</option><option value="often">Cada 3 canciones</option></select></label><label>Canciones pendientes<select data-select="queueSize"><option>1</option><option>2</option><option>3</option></select></label><label>Color<select data-select="accent"><option value="spotify">Verde Spotify</option><option value="theme">Mi tema</option><option value="violet">Violeta</option></select></label></div>
        <p class="pd-note" data-voicestatus></p>
        ${[['lyrics', 'Mostrar letras sincronizadas'], ['explicit', 'Permitir contenido explícito'], ['autoLearn', 'Aprender de mi escucha'], ['mini', 'Control flotante']].map(([key,label])=>`<label class="pd-check"><input type="checkbox" data-setting="${key}">${label}</label>`).join('')}
        <details class="pd-details"><summary>Avanzado</summary>
          <label>Continuidad entre canciones<select data-select="flowStrength"><option value="40">Equilibrada</option><option value="65">Suave</option><option value="90">Más continuidad</option></select></label>
          <label>Solapamiento nativo de Spotify<select data-crossfade><option value="0">Sin solapamiento</option><option value="2">2 segundos</option><option value="4" selected>4 segundos</option><option value="6">6 segundos</option></select></label><p data-transitionstatus></p><div class="pd-profile"><button data-applytransition>Aplicar en Spotify</button><button data-restoretransition>Restaurar</button></div><p class="pd-note">El solapamiento también afecta a Spotify fuera del DJ. Con la transición automática, el DJ lo ajusta (0 a 6 s) según lo bien que encajen dos canciones y lo restaura al terminar la sesión. Nunca cambia tu volumen ni adelanta canciones.</p><button data-recovervolume hidden>Recuperar volumen anterior</button>
          <label>Terminar el DJ en<select data-sleep><option value="0">Sin temporizador</option><option value="15">15 minutos</option><option value="30">30 minutos</option><option value="60">1 hora</option><option value="120">2 horas</option></select></label>
          ${[['autoFade', 'Transición automática según cada pareja de canciones'], ['takeover', 'Suspender mi cola manual al iniciar'], ['lyricsExternal', 'Buscar letras fuera de Spotify (LRCLIB)']].map(([key,label])=>`<label class="pd-check"><input type="checkbox" data-setting="${key}">${label}</label>`).join('')}<p class="pd-note" data-lrclibnote>LRCLIB está apagado por defecto: al activarlo se envían título, artista, álbum y duración a lrclib.net solo si Spotify no tiene letra. Las voces «en línea» envían el texto del comentario a su proveedor.</p>
          <form data-tag><label for="pd-tag">Etiquetas de estilo, separadas por coma</label><input id="pd-tag" maxlength="100" placeholder="reggaetón, trap"><button type="submit">Etiquetar playlist actual y canción</button></form>
          <p data-library></p><div class="pd-profile"><button data-librarysync>Actualizar Me gusta y playlists</button><select data-playlists aria-label="Playlist de mi biblioteca"></select><button data-loadplaylist>Leer playlist</button></div>
          <div class="pd-profile"><button data-diagnose>Comprobar compatibilidad</button></div><ul class="pd-diag" data-diagresult></ul>
          <p class="pd-note">Tus datos y la lógica del DJ permanecen en este cliente. POOR DJ ${VERSION}.</p><div class="pd-profile"><button data-export>Exportar perfil</button><button data-import>Importar perfil</button><button data-savesession>Guardar sesión como playlist</button><button data-reset>Borrar aprendizaje</button><button data-cacheclear>Borrar caché acústica</button><input data-file type="file" accept=".json,application/json" hidden></div>
        </details></details></div>
      <footer class="pd-credit">Hecho por <b>KROMBYTE</b> · POOR DJ ${VERSION}</footer>`;
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
      else if(d.tab)setTab(d.tab);
      else if('openspicy'in d){S.PopupModal.hide();S.Platform.History.push('/SpicyLyrics');}
      else if('openpage'in d){S.PopupModal.hide();if(S.Platform.History.location?.pathname!==ROUTE)S.Platform.History.push(ROUTE);}
      else if('spicy'in d){S.PopupModal.hide();S.Platform.History.push('/SpicyLyrics');}
      else if('prev'in d)S.Player.back?.();else if('nextsong'in d)S.Player.next?.();else if('toggleplay'in d){S.Player.togglePlay?.();setTimeout(()=>{update();startFrame();},120);}
      else if('lyricsclear'in d){lyrics.clear();L.uri='';loadLyrics();engine.notify('Listo: se volverán a buscar las letras.');}
      else if(d.example){panel.querySelector('#pd-command').value=d.example;panel.querySelector('#pd-command').focus();}
      else if('voice'in d){narrator.toggle();engine.updateSettings({voice:narrator.enabled},false);}
      else if('settings'in d){S.PopupModal.hide();S.Platform.History.push('/preferences');}
      else if('recovervolume'in d)recoverVolume();
      else if('export'in d)download(engine.exportProfile(),'poor-dj-profile.json');
      else if('savesession'in d)perform(()=>engine.saveSession());
      else if('diagnose'in d)perform(async()=>{const out=panel.querySelector('[data-diagresult]');out.textContent='Comprobando…';const r=await diagnose();out.innerHTML=r.rows.map(x=>`<li class="${x.ok===false?'pd-error':''}">${x.ok===false?'✕':x.ok?'✓':'·'} <b>${esc(x.name)}</b>: ${esc(x.detail)}</li>`).join('')+`<li><b>${r.problems?r.problems+' problema(s)':'Todo responde'}</b></li>`;});
      else if('import'in d)panel.querySelector('[data-file]').click();
      else if('reset'in d && root.confirm('¿Borrar el aprendizaje local de POOR DJ?')){engine.memory={};engine.contexts={};engine.preferences={};engine.undoVote=null;engine.save();engine.refresh();}
      else if('cacheclear'in d){audio.clear();engine.notify('Caché acústica borrada.');}
    };
    panelView=addView(panel.querySelector('[data-pane=lyrics]'),()=>L.tab==='lyrics');wireLyrics(panelView);
    panel.querySelector('[data-tabs]').onkeydown=e=>{if(e.key==='ArrowRight' || e.key==='ArrowLeft'){const t=L.tab==='dj'?'lyrics':'dj';setTab(t);panel.querySelector(`[data-tab="${t}"]`).focus();}};
    panel.querySelector('[data-progress]').onclick=e=>{const r=e.currentTarget.getBoundingClientRect(),d=S.Player.getDuration?.();if(d)seek(Math.round(d*Math.min(1,Math.max(0,(e.clientX-r.left)/r.width))));};
    panel.querySelector('[data-sleep]').onchange=e=>{L.sleep=Number(e.target.value);L.sleepAt=L.sleep?Date.now()+L.sleep*60000:0;engine.notify(L.sleep?`El DJ terminará en ${L.sleep} minutos.`:'Temporizador apagado.');};
    panel.querySelector('[data-command]').onsubmit=event=>{event.preventDefault();perform(()=>engine.command(panel.querySelector('#pd-command').value));};
    panel.querySelector('[data-tag]').onsubmit=event=>{event.preventDefault();perform(()=>engine.tagPlaylist(panel.querySelector('#pd-tag').value.split(',').map(words).filter(Boolean)));};
    panel.querySelector('[data-voicepick]').onchange=e=>{
      const v=e.target.value,on=v!=='off';if(narrator.enabled!==on)narrator.toggle();
      if(on){narrator.prefer(v);engine.updateSettings({voice:true,voiceName:v},false);voiceGate.run('next',{name:engine.current?.name||'tu canción',artists:engine.current?.artists||[],evidence:'tu playlist'},engine.intent,{local:true});}
      else engine.updateSettings({voice:false},false);
      update();};
    panel.querySelectorAll('[data-select]').forEach(input=>input.onchange=()=>perform(()=>engine.updateSettings({[input.dataset.select]:['queueSize','flowStrength'].includes(input.dataset.select)?Number(input.value):input.value},input.dataset.select==='queueSize')));
    panel.querySelectorAll('[data-setting]').forEach(input=>input.onchange=()=>perform(()=>{if(input.dataset.setting==='lyricsExternal')L.uri='';return engine.updateSettings({[input.dataset.setting]:input.checked},['explicit','takeover'].includes(input.dataset.setting));}));
    panel.querySelector('[data-file]').onchange=event=>perform(async()=>{const file=event.target.files[0];if(!file)return;if(file.size>2000000)throw Error('El perfil supera 2 MB');await engine.importProfile(JSON.parse(await file.text()));narrator.enabled=engine.settings.voice;narrator.prefer(engine.settings.voiceName);event.target.value='';});
    S.PopupModal.display({title:'POOR DJ',content:panel,isLarge:true});L.tab='dj';L.uri='';update();startFrame();transitions.refresh().then(update).catch(()=>{});panel.querySelector('#pd-command').focus();
  }
  return {open,update,openLyrics:()=>{if(!onRoute())S.Platform.History.push(ROUTE);},dispose:()=>{clearTimeout(buttonTimer);clearTimeout(L.toastTimer);toast.remove();closePage();unlisten?.();lyricsButton?.deregister?.();playerButtonObserver.disconnect();document.removeEventListener('keydown',shortcut,true);cancelAnimationFrame(playerButtonFrame);playerButton?.remove();cancelAnimationFrame(L.raf);L.raf=0;if(panel?.isConnected)S.PopupModal.hide();panel?.remove();mini.remove();style.remove();}};
}

const ICON='<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2"/><path d="M5 12a7 7 0 0 1 7-7m0 14a7 7 0 0 0 7-7M7 15V9h3"/></svg>';
const esc=x=>String(x||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
const imageURL=uri=>uri?.startsWith('spotify:image:')?`https://i.scdn.co/image/${uri.split(':').pop()}`:uri;
let bootTries=0;
async function boot(){
  const S=root.Spicetify;
  const needs={'Player':S?.Player?.data,'CosmosAsync':S?.CosmosAsync,'Playbar.Button':S?.Playbar?.Button,'PopupModal':S?.PopupModal,'Platform.LocalStorageAPI':S?.Platform?.LocalStorageAPI};
  const missing=Object.keys(needs).filter(k=>!needs[k]);
  if(missing.length){
    if(++bootTries===120)try{S?.showNotification?.('POOR DJ no pudo iniciarse: tu Spicetify no ofrece '+missing.join(', ')+'. Actualiza Spicetify y reinicia Spotify.',true);}catch(_){}
    if(bootTries<=120)setTimeout(boot,500);return;
  }
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
  const lyrics=new LyricsProvider({
    spotify:async(id,track)=>{const img=track.image?imageURL(track.image):'';const base=`https://spclient.wg.spotify.com/color-lyrics/v2/track/${id}`;const q='?format=json&vocalRemoval=false&market=from_token';
      try{return await S.CosmosAsync.get(img?`${base}/image/${encodeURIComponent(img)}${q}`:base+q);}catch(e){if(img && !/404/.test(String(e?.status||e?.message)))return S.CosmosAsync.get(base+q);throw e;}},
    external:async track=>{const c=new AbortController(),timer=setTimeout(()=>c.abort(),5000);try{const p=new URLSearchParams({track_name:track.name,artist_name:track.artists[0]?.name||'',album_name:track.album||'',duration:String(Math.round((track.duration||0)/1000))});const r=await fetch('https://lrclib.net/api/get?'+p,{signal:c.signal});if(r.status===404)return null;if(!r.ok)throw Error('LRCLIB '+r.status);return await r.json();}finally{clearTimeout(timer);}},
    saved:(()=>{try{return storage.getItem('poor-dj-lyrics-misses')||{};}catch(_){return {};}})(),
    persist:data=>{try{storage.setItem('poor-dj-lyrics-misses',data);}catch(_){}}
  });
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
    const name=mode==='session'?`POOR DJ · ${artist.name}`:`POOR DJ · ${artist.name} · ${mode==='only'?'Artista':'Aleatorio'}`;
    const pending=storage.getItem('poor-dj-pending-mix'),key=artist.uri+':'+mode;
    const uri=pending?.key===key?pending.uri:await P.RootlistAPI.createPlaylist(name,{after:'end'},true);
    if(!uri?.startsWith('spotify:playlist:'))throw Error('Spotify no confirmó la creación de la playlist.');
    const planned=mixUris(pending,key,tracks,mode==='session'?100:24);storage.setItem('poor-dj-pending-mix',{key,uri,name,tracks:planned});
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
  narrator.prefer(engine.settings.voiceName);
  engine.onNarrate=event=>{const c=engine.current,seed=event==='next' && c?{...c,evidence:evidenceLabel(knownEvidence(c,engine.memory[c.uri])),plays:engine.memory[c.uri]?.plays||0,minutes:Math.floor(engine.sessionHeardMs/60000),styles:[...(c.styles||[]),...(engine.tags[c.uri]||[])],prevAudio:engine.recent.at(-2)?.audio,hour:new Date().getHours()}:engine.anchor||c;return voiceGate.run(event,seed,engine.intent,{local:localPlayback()});};
  const playGuards=[...new Set([S.Platform.PlayerAPI,S.Player.origin].filter(Boolean))].map(player=>guardPlay(player,()=>{
    if(internalPlay)return null;
    engine.commandGeneration++;engine.choosing=false;engine.commandChoices=[];engine.commandArtists=[];engine.artistMenu=null;voiceGate.cancel();
    return engine.active || engine.managed.length?engine.yieldToUser():null;
  }));
  const recovery=()=>{try{return storage.getItem('poor-dj-volume-recovery');}catch(_){return null;}};
  view=mountUI(S,engine,{diagnose:()=>root.PoorDJ.diagnose(),lyrics,audio,queue,narrator,voiceGate,library,transitions,recovery,recoverVolume:()=>{const r=recovery(),device=S.Platform.ConnectAPI?.getState()?.activeDevice?.id;if(r && localPlayback() && (!r.device || r.device===device) && typeof S.Player.setVolume==='function'){S.Player.setVolume(clamp(r.volume,0,1));storage.setItem('poor-dj-volume-recovery',null);engine.notify('Volumen anterior recuperado.');}else engine.notify('Recupera el volumen en el dispositivo original.',true);}});
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
    autoFade();
  };
  // Spotify exposes no documented, stable queue event; active-only fallback.
  // Transición automática: ajusta el solapamiento nativo según la pareja actual → siguiente y lo restaura al terminar.
  let fadeBusy=false,fadeSeconds=null,fadeWarned=false;
  async function autoFade(){
    if(fadeBusy)return;
    if(!engine.active || !engine.settings.autoFade){if(fadeSeconds!==null){fadeBusy=true;fadeSeconds=null;try{await transitions.restore();}catch(_){}finally{fadeBusy=false;}}return;}
    const seconds=fadePlan(engine.current?.audio,engine.preview[0]?.audio);
    if(seconds===null || seconds===fadeSeconds)return;
    fadeBusy=true;
    try{await transitions.apply(seconds);fadeSeconds=seconds;}
    catch(e){fadeSeconds=seconds;if(!fadeWarned){fadeWarned=true;engine.notify('Transición automática no disponible: '+e.message,true);}}
    finally{fadeBusy=false;}
  }
  engine.onUpdate=()=>{if(engine.active && !reconcile)reconcile=setInterval(reconcileQueue,1000);if(!engine.active && reconcile){clearInterval(reconcile);reconcile=null;}autoFade();view.update();};
  observe();
  const unload=()=>voiceGate.cancel();root.addEventListener('beforeunload',unload);
  const diagnose=async()=>{
    const api={queue:Array.isArray(S.Queue?.nextTracks) && typeof S.addToQueue==='function',play:typeof (S.Platform.PlayerAPI?.play||S.Player.origin?.play)==='function',audio:typeof S.getAudioData==='function',playlists:!!(S.Platform.RootlistAPI?.createPlaylist && S.Platform.PlaylistAPI?.add),voice:!!narrator.voice,lyrics:typeof S.CosmosAsync?.get==='function',spicy:!!root.SpicyLyrics};
    const [a,b]=await Promise.allSettled([query('searchTracks',{searchTerm:'a',offset:0,limit:1,numberOfTopResults:1,includeAudiobooks:false,includePreReleases:false,includeAlbumPreReleases:false}),query('searchArtists',{searchTerm:'a',offset:0,limit:1,numberOfTopResults:1,includeAudiobooks:false})]);
    return compatReport({api,probes:{search:a.status==='fulfilled',artists:b.status==='fulfilled'}});
  };
  root.PoorDJ={engine,diagnose,open:view.open,version:VERSION,audio,narrator,voiceGate,transitions,command:text=>engine.command(text),dispose:()=>{stopped=true;engine.commandGeneration++;engine.active=false;engine.generation++;engine.cancelLookup?.();clearInterval(reconcile);playGuards.forEach(undo=>undo());voiceGate.cancel();narrator.dispose();audio.dispose();requests.dispose();library.dispose();for(const [event,fn]of [['songchange',observe],['onprogress',sample],['onplaypause',paused]])S.Player.removeEventListener?.(event,fn);root.removeEventListener('beforeunload',unload);view.dispose();}};
  root.PoorMansDJ=root.PoorDJ;
}
boot();

})(typeof window!=='undefined'?window:globalThis);
