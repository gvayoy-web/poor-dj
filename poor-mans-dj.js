/* POOR DJ 4.0.0 | AGPL-3.0 */
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

const VERSION = '4.0.0';
const clamp = (n, a = 0, b = 100) => Math.min(b, Math.max(a, Number(n) || 0));
const valid = uri => /^spotify:track:[A-Za-z0-9]{22}$/.test(uri || '');
const unwrap = x => x?.contextTrack || x?.track?.data || x?.track || x?.item?.data || x?.item || x;
const artistKey = a => a.uri || String(a.name || '').toLowerCase();

function normalize(input, source = 'contexto') {
  const x = unwrap(input);
  const m = x?.metadata || {};
  if (!valid(x?.uri) || x.is_playable === false || x.isPlayable === false || x.playability?.playable === false) {
    return null;
  }
  const items = x.artists?.items || x.artists || [];
  const artists = Array.isArray(items)
    ? items.map(a => ({ uri: a.uri, name: a.profile?.name || a.name || '' })).filter(a => a.name)
    : [];
  if (!artists.length && m.artist_name) {
    artists.push({ uri: m.artist_uri, name: m.artist_name });
    for (let i = 1; i < 12 && m['artist_name:' + i]; i++) {
      artists.push({ uri: m['artist_uri:' + i], name: m['artist_name:' + i] });
    }
  }
  const album = x.albumOfTrack || x.album || {};
  const albumImage =
    album.coverArt?.sources?.at(-1)?.url ||
    album.coverArt?.sources?.[0]?.url ||
    album.images?.find?.(i => i.label === 'large')?.url ||
    album.images?.[0]?.url ||
    '';
  return {
    uri: valid(m.requested_uri) ? m.requested_uri : x.uri,
    uid: x.uid || input?.uid,
    name: x.name || m.title || '',
    artists,
    image: x.image || albumImage || x.images?.[0]?.url || x.images?.sources?.[0]?.url || m.image_url || '',
    source,
    album: typeof album === 'string' ? album : album.name || m.album_title || '',
    duration:
      x.duration_ms ||
      x.duration?.totalMilliseconds ||
      x.duration?.milliseconds ||
      (typeof x.duration === 'number' ? x.duration : 0) ||
      Number(m.duration) ||
      0,
    styles: Array.isArray(x.styles) ? x.styles.filter(t => typeof t === 'string').slice(0, 5) : [],
    playlist: !!x.playlist,
    evidence: Array.isArray(x.evidence) ? x.evidence.slice(0, 3) : [],
    explicit:
      x.explicit === true ||
      x.isExplicit === true ||
      x.contentRating?.label === 'EXPLICIT' ||
      m.is_explicit === 'true'
  };
}

function collect(data, source) {
  const found = new Map();
  const visited = new WeakSet();
  let nodes = 0;
  function walk(x, depth) {
    if (!x || typeof x !== 'object' || depth > 16 || visited.has(x) || nodes >= 6000 || found.size >= 300) return;
    nodes++;
    visited.add(x);
    const t = normalize(x, source);
    if (t?.name && t.artists.length) {
      const previous = found.get(t.uri);
      found.set(
        t.uri,
        previous
          ? {
              ...t,
              image: t.image || previous.image,
              album: t.album || previous.album,
              duration: t.duration || previous.duration,
              artists: t.artists.length >= previous.artists.length ? t.artists : previous.artists
            }
          : t
      );
    }
    for (const v of Object.values(x)) {
      if (v && typeof v === 'object') walk(v, depth + 1);
    }
  }
  walk(data, 0);
  return [...found.values()];
}

const DEFAULTS = {
  discovery: 35,
  diversity: 25,
  takeover: false,
  queueSize: 3,
  accent: 'spotify',
  compact: false,
  mini: true,
  explicit: true,
  autoLearn: true,
  continuity: 65,
  flowStrength: 65,
  voice: true,
  voiceMode: 'duck',
  duckLevel: 30,
  voiceVolume: 90,
  voiceSpeed: 100,
  onManual: 'follow',
  skipRepeats: true,
  lyrics: true,
  lyricsExternal: false,
  lyricsProvider: 'auto',
  lyricsSize: 'm',
  lyricsOffset: 0,
  ambient: true,
  talk: 'few',
  voiceName: '',
  autoFade: false
};

function settingsOf(value = {}) {
  const s = Object.fromEntries(Object.entries(DEFAULTS).map(([key, def]) => [key, value[key] ?? def]));
  if (!['spotify', 'theme', 'blue', 'violet', 'rose'].includes(s.accent)) s.accent = 'spotify';
  for (const key of ['discovery', 'diversity', 'continuity', 'flowStrength']) s[key] = clamp(s[key]);
  s.queueSize = Math.round(clamp(s.queueSize, 2, 5));
  s.duckLevel = Math.round(clamp(s.duckLevel, 10, 80));
  s.voiceVolume = Math.round(clamp(s.voiceVolume, 0, 100));
  s.voiceSpeed = Math.round(clamp(s.voiceSpeed, 70, 140));
  if (!['follow', 'pause'].includes(s.onManual)) s.onManual = 'follow';
  if (!['duck', 'pause'].includes(s.voiceMode)) s.voiceMode = 'duck';
  if (!['auto', 'builtin'].includes(s.lyricsProvider)) s.lyricsProvider = 'auto';
  if (!['s', 'm', 'l'].includes(s.lyricsSize)) s.lyricsSize = 'm';
  if (!['start', 'few', 'often'].includes(s.talk)) s.talk = 'few';
  s.voiceName = typeof s.voiceName === 'string' ? s.voiceName.slice(0, 120) : '';
  s.lyricsOffset = Math.round(clamp(s.lyricsOffset, -3000, 3000) / 50) * 50;
  for (const key of [
    'takeover',
    'compact',
    'mini',
    'explicit',
    'autoLearn',
    'voice',
    'skipRepeats',
    'lyrics',
    'lyricsExternal',
    'ambient',
    'autoFade'
  ]) {
    if (typeof s[key] !== 'boolean') s[key] = DEFAULTS[key];
  }
  return s;
}

const reference = t => ({ uri: t.uri, uid: t.uid });
const sameEntry = (a, b) => !!a?.uid && !!b?.uid && a.uid === b.uid && a.uri === b.uri;

class Engine {
  constructor(io, saved = {}) {
    saved = migrateProfile(saved);
    this.io = io;
    this.settings = settingsOf(saved.settings);
    this.intent = intentOf(saved.intent);
    this.contexts = saved.contexts;
    this.tags = saved.tags;
    this.taste = saved.taste || { artists: {} };
    this.memory = saved.memory && typeof saved.memory === 'object' ? saved.memory : {};
    this.preferences = saved.preferences && typeof saved.preferences === 'object' ? saved.preferences : {};
    this.suspended = Array.isArray(saved.recovery?.suspended) ? saved.recovery.suspended.filter(t => t?.uri) : [];
    this.managed = Array.isArray(saved.recovery?.managed) ? saved.recovery.managed.filter(t => t?.uri && t?.uid) : [];
    this.captured = !!saved.recovery?.captured;
    this.restoreJournal = saved.recovery?.restoreJournal || null;
    this.mixPlaylist = saved.mixPlaylist;

    this.sessionExcluded = new Set();
    this.artistExcluded = new Set();
    this.sessionPlayed = new Set();
    this.sessionIds = new Set();
    this.deck = new ChoiceDeck();
    this.sessionPlaylist = [];
    this.lastWall = null;
    this.heardCommitted = false;
    this.onNarrate = () => {};
    this.onPrepare = () => {};
    this.onUpdate = () => {};
    this.commandChoices = [];
    this.commandGeneration = 0;

    this.active = false;
    this.busy = false;
    this.flight = null;
    this.poolRefreshFlight = null;
    this.pendingRebuild = false;
    this.refillAfter = false;
    this.generation = 0;
    this.recent = [];
    this.current = null;
    this.anchor = null;
    this.preview = [];
    this.pinned = null;
    this.undoVote = null;
    this.sessionList = [];
    this.sessionHeardMs = 0;
    this.discoveries = 0;
    this.artistSet = new Set();
    this.libraryArtistCounts = new Map();
    this.pool = null;
    this.seeds = [];
    this.followNext = false;
    this.autoSkips = 0;
    this.autoSkipping = false;
    this.knownManual = [];
    this.manualFingerprint = '';
    this.manualFlight = null;
    this.queuePlan = [];
    this.initialManual = [];
    this.yieldFlight = null;
    this.observedMs = 0;
    this.lastPosition = null;
    this.feedbackGiven = false;
    this.lastAttempt = 0;
    this.failures = 0;
    this.played = 0;
    this.nextTalkAt = 0;
    this.lastTalkPlayed = -10;
    this.lastMilestone = 0;
    this.status =
      this.captured || this.managed.length
        ? 'Tienes una sesión anterior pendiente de restaurar.'
        : 'Reproduce una canción y activa el DJ.';
    this.error = false;
    this.commandArtists = [];
    this.artistMenu = null;
  }

  save() {
    const entries = Object.entries(this.memory);
    if (entries.length > 1000) {
      this.memory = Object.fromEntries(
        entries
          .sort(
            (a, b) =>
              Math.max(b[1]?.lastPlayed || 0, b[1]?.dismissedAt || 0, b[1]?.lastSuggested || 0) -
              Math.max(a[1]?.lastPlayed || 0, a[1]?.dismissedAt || 0, a[1]?.lastSuggested || 0)
          )
          .slice(0, 1000)
      );
    }
    while (Object.keys(this.tags).length > 1000) {
      delete this.tags[Object.keys(this.tags)[0]];
    }
    const artistEntries = Object.entries(this.taste?.artists || {});
    if (artistEntries.length > 800) {
      this.taste.artists = Object.fromEntries(
        artistEntries.sort((a, b) => (b[1]?.last || 0) - (a[1]?.last || 0)).slice(0, 800)
      );
    }
    this.io.save({
      schema: 4,
      settings: this.settings,
      intent: this.intent,
      memory: this.memory,
      preferences: this.preferences,
      contexts: this.contexts,
      tags: this.tags,
      taste: this.taste,
      mixPlaylist: this.mixPlaylist,
      recovery: {
        captured: this.captured,
        suspended: this.suspended,
        managed: this.managed,
        restoreJournal: this.restoreJournal
      }
    });
  }

  notify(text, error = false) {
    this.status = text;
    this.error = error;
    this.onUpdate();
  }

  nextTalkSpacing() {
    if (this.settings.talk === 'often') return this.played + 2 + Math.floor(Math.random() * 2);
    if (this.settings.talk === 'few') return this.played + 4 + Math.floor(Math.random() * 3);
    return Infinity;
  }

  poolKey() {
    const i = this.intent;
    return JSON.stringify([
      this.anchor?.uri || '',
      i.known,
      i.artist?.uri || '',
      i.artistMode || '',
      i.styles,
      i.excludedArtists,
      this.settings.discovery,
      this.seeds.map(s => s.uri)
    ]);
  }

  addSeed(track) {
    if (!track || !valid(track.uri)) return;
    this.seeds = [...this.seeds.filter(s => s.uri !== track.uri), reference(track)].slice(-5);
  }

  updateArtistTaste(track, delta, { play = false, skip = false } = {}) {
    if (!track?.artists?.length) return;
    this.taste ||= { artists: {} };
    this.taste.artists ||= {};
    const now = Date.now();
    for (const a of track.artists.slice(0, 3)) {
      const key = artistKey(a);
      if (!key) continue;
      const prev = this.taste.artists[key] || {
        name: a.name || '',
        uri: a.uri || '',
        score: 0,
        plays: 0,
        skips: 0,
        last: now
      };
      this.taste.artists[key] = {
        name: a.name || prev.name,
        uri: a.uri || prev.uri,
        score: clamp((prev.score || 0) + delta, -10, 15),
        plays: (prev.plays || 0) + (play ? 1 : 0),
        skips: (prev.skips || 0) + (skip ? 1 : 0),
        last: now
      };
    }
  }

  userPlay() {
    this.commandGeneration++;
    this.choosing = false;
    this.commandChoices = [];
    this.commandArtists = [];
    this.artistMenu = null;
    if (!this.active && !this.managed.length) return null;
    if (this.active && this.settings.onManual === 'follow') {
      this.followNext = true;
      return null;
    }
    return this.yieldToUser();
  }

  async start(seed = this.current, narrated = false, overlay = false) {
    if (this.active || this.busy) return;
    if (!this.current) {
      this.notify('Primero reproduce una canción de Spotify.', true);
      return;
    }
    if (this.captured || this.managed.length) {
      await this.stop();
      if (this.captured || this.managed.length) return;
    }
    this.active = true;
    this.sessionOverlay = overlay;
    this.anchor = seed;
    this.intent.reference = reference(seed);
    this.sessionExcluded.clear();
    this.artistExcluded.clear();
    this.sessionPlayed = new Set([this.current.uri]);
    this.sessionIds = new Set([songIdentity(this.current)]);
    this.pool = null;
    this.seeds = [];
    this.refillAfter = false;
    this.followNext = false;
    this.autoSkips = 0;
    this.autoSkipping = false;
    this.generation++;
    this.lastAttempt = 0;
    this.failures = 0;
    this.played = 0;
    this.lastTalkPlayed = 0;
    this.lastMilestone = 0;
    this.nextTalkAt = this.nextTalkSpacing();
    this.recent = [this.current];
    this.pinned = null;
    this.sessionList = [];
    this.sessionHeardMs = 0;
    this.discoveries = 0;
    this.artistSet = new Set(this.current.artists.map(artistKey));
    this.manualFingerprint = '';
    this.queuePlan = [];
    this.knownManual = (this.io.queue()?.priority || []).map(reference);
    this.initialManual = this.knownManual.slice();
    this.save();
    this.notify('Preparando tu sesión…');
    if (!narrated) {
      Promise.resolve(this.onNarrate('start')).catch(() => {});
    }
    if (this.active) await this.fill();
  }

  stop() {
    if (this.stopping) return this.stopping;
    this.stopping = this.finishStop().finally(() => {
      this.stopping = null;
    });
    return this.stopping;
  }

  async finishStop() {
    const wasActive = this.active;
    this.io.cancelTransition?.();
    this.pinned = null;
    this.active = false;
    this.pendingRebuild = false;
    this.refillAfter = false;
    this.followNext = false;
    this.generation++;
    this.notify('Devolviendo el control a Spotify…');
    this.cancelLookup?.();
    if (this.flight) await this.flight;
    if (this.manualFlight) await this.manualFlight;
    if (this.yieldFlight) await this.yieldFlight;
    this.busy = true;
    this.onUpdate();
    try {
      const q = this.io.queue();
      if (!q) throw new Error('La cola no está disponible. Intenta restaurarla de nuevo.');
      const ours = q.priority.filter(t => this.managed.some(m => sameEntry(m, t)));
      const originalStillPresent = q.priority.filter(t => this.suspended.some(m => sameEntry(m, t)));
      const cleanup = [...ours, ...originalStillPresent];
      if (cleanup.length) await this.io.remove(cleanup);
      this.managed = [];
      this.preview = [];
      this.save();
      if (this.suspended.length) {
        const pending = this.suspended.slice();
        while (this.suspended.length) {
          if (this.restoreJournal) {
            const live = this.io.queue();
            if (!live) throw Error('No se puede confirmar la restauración');
            const restored = live.priority.filter(
              t => t.uri === this.restoreJournal.uri && !this.restoreJournal.before.includes(t.uid)
            );
            if (restored.length > 1) {
              throw Error('Restauración ambigua: conserva tu cola y reintenta después de revisar sus duplicados');
            }
            if (restored.length === 1) {
              this.suspended.shift();
              this.restoreJournal = null;
              this.save();
              continue;
            }
          }
          this.restoreJournal = {
            uri: this.suspended[0].uri,
            before: (this.io.queue()?.priority || []).map(t => t.uid)
          };
          this.save();
          await this.io.add([this.suspended[0]]);
          this.suspended.shift();
          this.restoreJournal = null;
          this.save();
        }
        this.notify(`Sesión terminada. ${pending.length} canciones de tu cola restauradas.`);
      } else {
        this.notify('Sesión terminada. Spotify continúa con tu playlist.');
      }
      this.captured = false;
      this.sessionExcluded.clear();
      this.artistExcluded.clear();
      this.save();
      if (wasActive && this.played > 0) {
        Promise.resolve(this.onNarrate('end')).catch(() => {});
      }
    } catch (e) {
      this.notify(`No pude restaurar toda la cola: ${e.message}`, true);
      this.save();
    } finally {
      this.busy = false;
      this.onUpdate();
    }
  }

  async saveSession() {
    const tracks = [...new Map(this.sessionList.filter(t => valid(t.uri)).map(t => [t.uri, t])).values()];
    if (tracks.length < 2) {
      this.notify('Aún hay pocas canciones para guardar la sesión.', true);
      return;
    }
    if (!this.io.createMix) {
      this.notify('Este cliente no permite guardar playlists.', true);
      return;
    }
    this.sessionStamp ||= Date.now();
    try {
      this.notify('Guardando la sesión como playlist privada…');
      const label =
        new Date(this.sessionStamp).toLocaleDateString('es', { day: 'numeric', month: 'short' }) +
        ' ' +
        new Date(this.sessionStamp).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
      const saved = await this.io.createMix(
        { uri: 'session:' + this.sessionStamp, name: 'Sesión ' + label },
        'session',
        tracks
      );
      this.mixPlaylist = saved;
      this.sessionStamp = null;
      this.save();
      this.notify('Sesión guardada: ' + saved.name);
    } catch (e) {
      this.notify(e.message || 'No pude guardar la sesión.', true);
    } finally {
      this.onUpdate();
    }
  }

  updateSettings(patch, rebuild = true) {
    const old = this.settings;
    this.settings = settingsOf({ ...old, ...patch });
    if (this.active) this.settings.takeover = old.takeover;
    if (patch.discovery !== undefined) this.intent.known = this.settings.discovery === 0;
    if (patch.diversity !== undefined) this.intent.variety = this.settings.diversity;
    if (patch.talk !== undefined) this.nextTalkAt = this.nextTalkSpacing();
    if (rebuild) this.pool = null;
    this.save();
    if (rebuild) {
      this.generation++;
      this.lastAttempt = 0;
      this.cancelLookup?.();
    }
    this.notify(this.active && rebuild ? 'Actualizando las siguientes canciones…' : 'Preferencias guardadas.');
    if (this.active && rebuild) return this.fill(true);
  }

  feedback(amount) {
    return this.feedbackFor(this.current, amount > 0 ? 'more' : 'less');
  }

  feedbackFor(track, kind) {
    if (!track) return;
    const key = contextKey(this.anchor || this.current, this.intent);
    this.undoVote = {
      uri: track.uri,
      memory: this.memory[track.uri] ? { ...this.memory[track.uri] } : null,
      contexts: JSON.parse(JSON.stringify(this.contexts)),
      taste: JSON.parse(JSON.stringify(this.taste)),
      anchor: this.anchor,
      intent: JSON.parse(JSON.stringify(this.intent)),
      sessionExcluded: [...this.sessionExcluded],
      artistExcluded: [...this.artistExcluded],
      given: this.feedbackGiven
    };
    this.feedbackGiven = true;
    if (kind === 'more') {
      this.anchor = track;
      this.intent.reference = reference(track);
      this.addSeed(track);
      this.pool = null;
      this.adjust(track, 1);
      this.updateArtistTaste(track, 1);
      this.onNarrate('direction');
    } else {
      this.sessionExcluded.add(track.uri);
      const m = (this.memory[track.uri] ||= { plays: 0, vote: 0, heard: 0 });
      m.dismissedAt = Date.now();
      if (kind === 'artist') {
        track.artists.forEach(a => this.artistExcluded.add(artistKey(a)));
        this.updateArtistTaste(track, -2);
      } else {
        this.updateArtistTaste(track, -0.5);
      }
      const c = (this.contexts[key] ||= { votes: {} });
      c.votes[track.uri] = clamp((c.votes[track.uri] || 0) - 1, -5, 5);
      this.save();
    }
    this.notify(
      kind === 'more'
        ? 'La canción actual guía esta sesión.'
        : kind === 'artist'
        ? 'Este artista queda fuera de la sesión.'
        : kind === 'repeat'
        ? 'No volverá a proponerse en esta sesión.'
        : 'Anotado: esta propuesta no encaja.'
    );
    return this.refresh();
  }

  undoFeedback() {
    const u = this.undoVote;
    if (!u) return;
    if (u.memory) this.memory[u.uri] = u.memory;
    else delete this.memory[u.uri];
    this.contexts = u.contexts;
    if (u.taste) this.taste = u.taste;
    this.anchor = u.anchor;
    this.intent = intentOf(u.intent);
    this.sessionExcluded = new Set(u.sessionExcluded);
    this.artistExcluded = new Set(u.artistExcluded);
    this.feedbackGiven = u.given;
    this.undoVote = null;
    this.pool = null;
    this.save();
    this.notify('Corrección deshecha.');
    return this.refresh();
  }

  refresh() {
    this.generation++;
    this.cancelLookup?.();
    this.lastAttempt = 0;
    if (this.active) return this.fill(true);
    return Promise.resolve();
  }

  reserve(t) {
    if (!t || !this.preview.some(x => sameEntry(x, t))) return;
    this.pinned = this.pinned && sameEntry(this.pinned, t) ? null : reference(t);
    this.notify(this.pinned ? 'Canción reservada: se conserva al renovar.' : 'Reserva liberada.');
  }

  adjust(t, amount) {
    const m = (this.memory[t.uri] ||= { plays: 0, vote: 0, heard: 0 });
    m.vote = clamp((m.vote || 0) + amount, -5, 5);
    if (m.vote > 0) {
      m.track = {
        uri: t.uri,
        name: t.name,
        artists: t.artists.slice(0, 10),
        image: t.image || '',
        duration: t.duration || 0,
        explicit: !!t.explicit
      };
    }
    const key = contextKey(this.anchor || this.current, this.intent);
    const context = (this.contexts[key] ||= { votes: {} });
    context.votes[t.uri] = clamp((context.votes[t.uri] || 0) + amount, -5, 5);
    while (Object.keys(this.contexts).length > 40) {
      delete this.contexts[Object.keys(this.contexts)[0]];
    }
    this.save();
  }

  sample(position, playing, wall = Date.now()) {
    if (playing && this.current && this.lastPosition !== null && this.lastWall !== null) {
      const delta = position - this.lastPosition;
      const elapsed = wall - this.lastWall;
      if (delta > 0 && elapsed > 0 && delta <= 6000 && delta <= elapsed + 800) {
        this.observedMs += delta;
        if (this.active) this.sessionHeardMs += delta;
        const threshold = Math.min(60000, this.current.duration > 0 ? this.current.duration * 0.7 : 60000);
        if (!this.heardCommitted && this.observedMs >= threshold) {
          const m = (this.memory[this.current.uri] ||= { plays: 0, vote: 0, heard: 0 });
          m.heard = (m.heard || 0) + 1;
          m.plays = (m.plays || 0) + 1;
          m.lastPlayed = Date.now();
          m.track = { ...this.current, audio: undefined };
          this.heardCommitted = true;
          this.save();
        }
      }
    }
    this.lastPosition = position;
    this.lastWall = wall;
  }

  trackChanged(track, ownSkip = false) {
    if (track?.uri && track.uri === this.current?.uri) {
      if (
        track &&
        ((!this.current.name && track.name) ||
          (!this.current.artists.length && track.artists.length) ||
          (!this.current.image && track.image))
      ) {
        this.current = { ...this.current, ...track, audio: this.current.audio };
        this.recent = this.recent.map(t => (t.uri === track.uri ? this.current : t));
        this.sessionList = this.sessionList.map(t => (t.uri === track.uri ? this.current : t));
        if (this.memory[track.uri]) this.memory[track.uri].track = { ...this.current, audio: undefined };
        if (this.active) {
          track.artists.forEach(a => this.artistSet.add(artistKey(a)));
          this.sessionIds.add(songIdentity(this.current));
        }
        this.onUpdate();
      }
      return;
    }

    const prev = this.current;
    const wasFollow = this.followNext;
    this.followNext = false;
    const wasAutoSkipping = this.autoSkipping;
    this.autoSkipping = false;

    const expected =
      this.expectedNext && (track?.uid ? sameEntry(this.expectedNext, track) : this.expectedNext.uri === track?.uri);
    const wasManaged =
      this.active &&
      track &&
      (expected || this.managed.some(m => (track.uid ? sameEntry(m, track) : m.uri === track.uri)));
    const endedNaturally =
      ownSkip === 'natural' || (prev?.duration > 0 && this.lastPosition !== null && this.lastPosition >= prev.duration - 2500);
    this.expectedNext = null;

    if (prev && this.active && this.settings.autoLearn && !this.feedbackGiven && !wasAutoSkipping && !wasFollow && !ownSkip) {
      const ratio = prev.duration ? this.observedMs / prev.duration : 0;
      if (ratio >= 0.7) {
        this.adjust(prev, 0.2);
        this.updateArtistTaste(prev, 1, { play: true });
        this.addSeed(prev);
      } else if (track && !endedNaturally && this.observedMs >= 1500 && this.observedMs < 30000) {
        this.adjust(prev, -0.5);
        this.updateArtistTaste(prev, -0.5, { skip: true });
      } else if (track && !endedNaturally && this.observedMs >= 30000 && this.observedMs < 60000) {
        this.adjust(prev, -0.15);
      }
    }

    this.current = track;
    this.observedMs = 0;
    this.lastPosition = null;
    this.lastWall = null;
    this.heardCommitted = false;
    this.feedbackGiven = false;
    this.undoVote = null;
    if (this.pinned?.uri === track?.uri) this.pinned = null;

    if (!track || !this.active) {
      this.onUpdate();
      return;
    }

    if (ownSkip === true) this.anchor = track;

    if (wasFollow) {
      this.anchor = track;
      this.intent.reference = reference(track);
      this.seeds = [];
      this.pool = null;
      this.generation++;
      this._recordActiveTrack(track);
      this.managed = this.managed.filter(t => t.uri !== track.uri);
      this.preview = this.preview.filter(t => t.uri !== track.uri);
      this.save();
      Promise.resolve(this.onNarrate('follow')).catch(() => {});
      this.lastTalkPlayed = this.played;
      this.nextTalkAt = this.nextTalkSpacing();
      this.refresh();
      this.onUpdate();
      return;
    }

    const isManualEntry = this.knownManual.some(m => (track.uid ? sameEntry(m, track) : m.uri === track.uri));
    if (
      !wasManaged &&
      !isManualEntry &&
      this.settings.skipRepeats &&
      (this.sessionPlayed.has(track.uri) || this.sessionIds.has(songIdentity(track)) || !this.eligible(track)) &&
      this.autoSkips < 3 &&
      typeof this.io.skip === 'function'
    ) {
      this.autoSkips++;
      this.autoSkipping = true;
      Promise.resolve(this.io.skip()).catch(() => {
        this.autoSkipping = false;
      });
      this.onUpdate();
      return;
    }

    this.autoSkips = 0;
    const prevMem = this.memory[track.uri];
    const isDiscovery = !prevMem;
    const daysSince = prevMem?.lastPlayed ? Math.floor((Date.now() - prevMem.lastPlayed) / 86400000) : 0;
    const isReturn = !isDiscovery && daysSince >= 30 && ((prevMem?.heard || 0) > 0 || (prevMem?.plays || 0) > 0);

    this._recordActiveTrack(track);

    const milestone = Math.floor(this.sessionHeardMs / 1800000);
    if (this.played >= this.nextTalkAt) {
      Promise.resolve(this.onNarrate('next')).catch(() => {});
      this.lastTalkPlayed = this.played;
      this.nextTalkAt = this.nextTalkSpacing();
    } else if (this.settings.talk !== 'start' && this.played - this.lastTalkPlayed >= 2) {
      if (isDiscovery && this.discoveries === 1) {
        Promise.resolve(this.onNarrate('discovery')).catch(() => {});
        this.lastTalkPlayed = this.played;
      } else if (isReturn) {
        Promise.resolve(this.onNarrate('return', { daysSince })).catch(() => {});
        this.lastTalkPlayed = this.played;
      } else if (milestone > this.lastMilestone && milestone > 0) {
        this.lastMilestone = milestone;
        Promise.resolve(this.onNarrate('milestone')).catch(() => {});
        this.lastTalkPlayed = this.played;
      }
    }

    this.managed = this.managed.filter(t => t.uri !== track.uri);
    this.preview = this.preview.filter(t => t.uri !== track.uri);
    this.save();
    this.fill();
    this.onUpdate();
  }

  _recordActiveTrack(track) {
    this.recent.push(track);
    this.recent = this.recent.slice(-50);
    this.sessionPlayed.add(track.uri);
    this.sessionIds.add(songIdentity(track));
    this.played++;
    if (!this.memory[track.uri]) this.discoveries++;
    const m = (this.memory[track.uri] ||= { plays: 0, vote: 0, heard: 0 });
    m.lastStarted = Date.now();
    m.track = {
      uri: track.uri,
      name: track.name,
      artists: track.artists,
      image: track.image || '',
      duration: track.duration || 0,
      explicit: !!track.explicit
    };
    track.artists.forEach(a => this.artistSet.add(artistKey(a)));
    this.sessionList.push({ ...track });
    this.sessionList = this.sessionList.slice(-100);
  }

  score(t, recent) {
    const m = this.memory[t.uri];
    let score =
      ({
        'artista relacionado': 45,
        'artista actual': 75,
        radio: 68,
        contexto: 80,
        'tu colección': 80
      })[t.source] || 0;
    const known = knownEvidence(t, m).length > 0;
    score += known ? (100 - this.settings.discovery) * 0.35 : this.settings.discovery * 0.2;
    const vote = this.contexts[contextKey(this.anchor || this.current, this.intent)]?.votes?.[t.uri] || 0;
    score += clamp(vote, -2, 2) * 6;
    const keys = new Set(t.artists.map(artistKey));
    if (this.intent.artist && hasArtist(t, this.intent.artist)) score += 100;
    recent.slice(-4).forEach(r => {
      if (r.artists.some(a => keys.has(artistKey(a)))) score -= this.settings.diversity * 0.025;
    });

    const primaryKey = t.artists?.[0] ? artistKey(t.artists[0]) : '';
    const artistTaste = primaryKey ? this.taste?.artists?.[primaryKey]?.score || 0 : 0;
    score += clamp(artistTaste, -5, 10) * 4;
    const libCount = primaryKey && this.libraryArtistCounts ? this.libraryArtistCounts.get(primaryKey) || 0 : 0;
    score += Math.min(8, libCount);
    if (Number.isFinite(t.radioRank)) score += Math.max(0, 50 - t.radioRank) * 0.4;

    const ageMs = m?.lastPlayed ? Date.now() - m.lastPlayed : Infinity;
    if (ageMs < 6 * 3600000) score -= 40;
    else if (ageMs < 24 * 3600000) score -= 20;
    else if (ageMs < 72 * 3600000) score -= 8;

    if (!this.intent.known && this.settings.discovery > 0 && this.settings.discovery < 100 && recent.length) {
      const window6 = recent.slice(-6);
      const newShare = window6.filter(r => !this.memory[r.uri]?.heard && !r.familiar).length / window6.length;
      const targetShare = this.settings.discovery / 100;
      const isNewTrack = !known && !m?.heard;
      if (isNewTrack && newShare < targetShare) score += 15;
      else if (!isNewTrack && newShare > targetShare) score += 15;
    }

    const from = recent.at(-1) || this.current;
    const comp = transitionFit(from?.audio, t.audio);
    if (comp.value !== null) score += (comp.value - 0.5) * this.settings.flowStrength * 0.6 * comp.coverage;
    if (comp.tempo !== null && comp.tempo > 0.25) score -= (10 * this.settings.flowStrength) / 65;
    if (comp.loudness !== null && comp.loudness > 8) score -= (6 * this.settings.flowStrength) / 65;
    return score;
  }

  reason(t, from) {
    const evidence = knownEvidence(t, this.memory[t.uri]);
    if (evidence.length) return evidenceLabel(evidence);
    if ((this.memory[t.uri]?.vote || 0) > 0) return 'Por tu voto · Más así';
    const c = compatibility(from?.audio, t.audio);
    if (c.value >= 0.7 && c.coverage >= 0.6) return 'Tempo y tono compatibles';
    if (t.source === 'radio') return 'Radio de Spotify · afín';
    if (t.source === 'artista relacionado') return 'Artista relacionado';
    if (!this.memory[t.uri]) return 'Nueva para ti';
    return 'Afinidad con esta sesión';
  }

  select(candidates, queued, count, { relaxed = false } = {}) {
    const now = Date.now();
    const blockedUris = new Set(
      [
        this.current?.uri,
        ...queued.map(t => t.uri),
        ...this.recent.map(t => t.uri),
        ...this.suspended.map(t => t.uri),
        ...this.sessionPlayed
      ].filter(Boolean)
    );
    const blockedIds = new Set(
      [
        ...[this.current, ...queued, ...this.recent].filter(Boolean).map(songIdentity),
        ...this.sessionIds
      ].filter(id => id && id !== '|')
    );
    const suggestWindow = relaxed ? 3600000 : 6 * 3600000;

    const byId = new Map();
    const recentBase = [...this.recent, ...queued];
    for (const t of candidates.slice(0, 300)) {
      if (!t || t.affinity !== true || !valid(t.uri) || blockedUris.has(t.uri)) continue;
      const id = songIdentity(t);
      if (id && id !== '|' && blockedIds.has(id)) continue;
      if (this.intent.known && !isKnown(t, this.memory[t.uri])) continue;
      if (!this.eligible(t)) continue;
      const m = this.memory[t.uri];
      if (!relaxed && m?.lastPlayed && now - m.lastPlayed < 2 * 3600000) continue;
      if (!relaxed && (m?.vote || 0) <= -1.5) continue;
      if (now - (m?.dismissedAt || m?.lastSuggested || 0) <= suggestWindow) continue;

      const dedupeKey = id && id !== '|' ? id : t.uri;
      const prev = byId.get(dedupeKey);
      if (!prev || this.score(t, recentBase) > this.score(prev, recentBase)) {
        byId.set(dedupeKey, t);
      }
    }

    const pool = [...byId.values()];
    const result = [];
    const recent = [...recentBase];
    const spacing = this.intent.variety >= 60 ? 5 : this.intent.variety <= 10 ? 1 : 3;

    while (pool.length && result.length < count) {
      const ranked = pool
        .map(t => ({ t, score: this.score(t, recent) }))
        .sort((a, b) => b.score - a.score || a.t.uri.localeCompare(b.t.uri));
      const recentPrimaries = new Set(
        recent
          .slice(-spacing)
          .map(r => (r.artists?.[0] ? artistKey(r.artists[0]) : ''))
          .filter(Boolean)
      );
      const chosen =
        artistChoice(ranked, recent, this.intent) ||
        (ranked.find(x => !recentPrimaries.has(x.t.artists?.[0] ? artistKey(x.t.artists[0]) : '')) || ranked[0]).t;
      const from = recent.at(-1) || this.current;
      const enriched = {
        ...chosen,
        reason: this.reason(chosen, from),
        compat: transitionFit(from?.audio, chosen.audio),
        transition: transitionLabel(from?.audio, chosen.audio)
      };
      result.push(enriched);
      recent.push(enriched);
      const chosenId = songIdentity(chosen);
      for (let i = pool.length - 1; i >= 0; i--) {
        if (pool[i].uri === chosen.uri || (chosenId !== '|' && songIdentity(pool[i]) === chosenId)) {
          pool.splice(i, 1);
        }
      }
    }
    return result;
  }

  fill(force = false, snapshot) {
    if (force) this.pendingRebuild = true;
    if (!this.active || !this.current) return this.flight || Promise.resolve();
    if (this.busy || this.manualFlight) {
      this.refillAfter = true;
      return this.flight || Promise.resolve();
    }
    force = this.pendingRebuild;
    const q = snapshot || this.io.queue();
    if (!q) {
      this.notify('Esperando a que Spotify cargue la cola…');
      return Promise.resolve();
    }
    const manualQueued = q.priority.filter(t => !this.managed.some(m => sameEntry(m, t)));
    if (!force && (this.captured || !this.settings.takeover) && manualQueued.length) {
      if (!this.managed.length && this.status !== 'Tus canciones en cola van primero; después sigo con la mezcla.') {
        this.notify('Tus canciones en cola van primero; después sigo con la mezcla.');
      }
      return Promise.resolve();
    }
    if (!force && this.managed.length >= this.settings.queueSize) {
      return Promise.resolve();
    }
    const backoff = this.failures ? Math.min(60000, 5000 * 2 ** (this.failures - 1)) : 0;
    if (!force && backoff && Date.now() - this.lastAttempt < backoff) {
      return Promise.resolve();
    }
    this.pendingRebuild = false;
    this.refillAfter = false;
    this.busy = true;
    this.lastAttempt = Date.now();
    const generation = this.generation;
    let watchdog;
    const timeout = new Promise((_, reject) => {
      watchdog = setTimeout(() => reject(new Error('Tiempo de espera agotado')), 25000);
    });
    this.flight = Promise.race([this.refill(q, force, generation), timeout])
      .catch(error => {
        if (this.active && generation === this.generation) {
          this.failures++;
          this.notify(`Spotify no respondió: ${error.message}. Sigo intentando.`, true);
        }
      })
      .finally(() => {
        clearTimeout(watchdog);
        this.busy = false;
        this.flight = null;
        this.onUpdate();
        if (this.active && (this.refillAfter || this.pendingRebuild)) {
          this.refillAfter = false;
          setTimeout(() => {
            if (this.active) this.fill();
          }, 0);
        }
      });
    return this.flight;
  }

  async refill(initial, force, generation) {
    this.notify('Seleccionando las próximas canciones…');
    const key = this.poolKey();
    let candidates;
    if (!force && this.pool && this.pool.key === key && Date.now() - this.pool.at < 600000) {
      candidates = this.pool.tracks;
    } else {
      let cancel;
      const cancelled = new Promise(resolve => {
        cancel = () => resolve([]);
        this.cancelLookup = cancel;
      });
      try {
        candidates = await Promise.race([
          this.io.candidates(this.anchor || this.current, this.settings, initial.all),
          cancelled
        ]);
      } finally {
        if (this.cancelLookup === cancel) this.cancelLookup = null;
      }
      if (!this.active || generation !== this.generation) return;
      this.pool = { key, at: Date.now(), tracks: candidates || [] };
    }

    let q = this.io.queue();
    if (!q) throw new Error('No se puede leer la cola.');
    const takeover = (this.settings.takeover || this.sessionOverlay) && !this.captured;
    const manualPresent = q.priority.filter(t => !this.managed.some(m => sameEntry(m, t)));
    if (!takeover && manualPresent.length) {
      const ours = q.priority.filter(t => this.managed.some(m => sameEntry(m, t)));
      if (ours.length) await this.io.remove(ours);
      this.managed = [];
      this.preview = [];
      this.knownManual = manualPresent.map(reference);
      this.save();
      this.notify('Tus canciones en cola van primero; después sigo con la mezcla.');
      return;
    }

    const oldManaged = q.priority.filter(t => this.managed.some(m => sameEntry(m, t)));
    const toRemove = takeover
      ? q.priority
      : force
      ? oldManaged.filter(t => !this.pinned || !sameEntry(t, this.pinned))
      : [];
    if (toRemove.some(t => !t.uid)) {
      throw new Error('No puedo identificar las entradas de la cola con seguridad.');
    }
    const kept = q.priority.filter(t => !toRemove.some(r => sameEntry(t, r)));
    const need = Math.max(0, this.settings.queueSize - kept.length);

    let selected = this.select(candidates, [...kept, ...toRemove], need);
    if (selected.length < need && this.io.candidates) {
      const widened = await this.io.candidates(this.anchor || this.current, this.settings, q.all, { widen: true });
      if (!this.active || generation !== this.generation) return;
      if (widened?.length) {
        candidates = widened;
        this.pool = { key, at: Date.now(), tracks: widened };
        selected = this.select(candidates, [...kept, ...toRemove], need, { relaxed: true });
      }
    }

    if (!selected.length) {
      if (force && toRemove.length) {
        await this.io.remove(toRemove);
        this.managed = this.managed.filter(m => !toRemove.some(t => sameEntry(m, t)));
        this.preview = this.preview.filter(m => !toRemove.some(t => sameEntry(t, m)));
        this.save();
      }
      this.failures++;
      this.notify('Me quedé sin canciones afines; Spotify sigue mientras busco más.');
      return;
    }

    if (takeover) {
      this.suspended = toRemove.map(t => ({ ...t }));
      this.captured = true;
      this.save();
    }

    let removed = false;
    try {
      if (toRemove.length) {
        await this.io.remove(toRemove);
        removed = true;
      }
      if (!this.active || generation !== this.generation) {
        if (removed && !takeover) {
          const restored = await this.io.add(toRemove);
          this.managed = [...this.managed.filter(m => !toRemove.some(t => sameEntry(t, m))), ...restored.map(reference)];
          this.save();
        }
        return;
      }
      const inserted = await this.io.add(selected);
      this.managed = [...this.managed.filter(m => !toRemove.some(t => sameEntry(t, m))), ...inserted.map(reference)];
      this.preview = [
        ...this.preview.filter(t => kept.some(k => sameEntry(t, k))),
        ...selected.map((t, i) => ({ ...t, uid: inserted[i]?.uid }))
      ];
      for (const t of selected) {
        const m = (this.memory[t.uri] ||= { plays: 0, vote: 0, heard: 0 });
        m.lastSuggested = Date.now();
      }
      this.save();
      this.failures = 0;
      this.notify('DJ en vivo. Tus elecciones siguen teniendo prioridad.');
      if (this.preview[0]) {
        Promise.resolve(this.onPrepare?.(this.preview[0], this.intent)).catch(() => {});
      }

      const selectedSet = new Set(selected.map(t => t.uri));
      const remaining = candidates.filter(
        t => t && valid(t.uri) && !selectedSet.has(t.uri) && !this.sessionPlayed.has(t.uri) && this.eligible(t)
      ).length;
      if (remaining < Math.max(3, need * 3) && !this.poolRefreshFlight && this.io.candidates) {
        this.poolRefreshFlight = Promise.resolve(
          this.io.candidates(this.anchor || this.current, this.settings, q.all, { widen: true })
        )
          .then(fresh => {
            if (this.active && fresh?.length) {
              this.pool = { key: this.poolKey(), at: Date.now(), tracks: fresh };
            }
          })
          .catch(() => {})
          .finally(() => {
            this.poolRefreshFlight = null;
          });
      }
    } catch (error) {
      if (removed) {
        try {
          const restored = await this.io.add(toRemove);
          if (takeover) {
            this.suspended = [];
            this.captured = false;
          } else {
            this.managed = [...this.managed.filter(m => !toRemove.some(t => sameEntry(t, m))), ...restored.map(reference)];
          }
        } catch (_) {
          // Recovery retains the suspended queue for a later retry.
        }
      }
      this.save();
      throw error;
    }
  }

  sync(snapshot) {
    const q = snapshot || this.io.queue();
    if (!q) return;
    const head = q.priority[0];
    if (head && this.managed.some(m => sameEntry(m, head))) this.expectedNext = reference(head);
    this.managed = this.managed.filter(m => q.priority.some(t => sameEntry(t, m)));
    this.preview = this.preview.filter(m => q.priority.some(t => sameEntry(t, m)));
    if (this.pinned && !q.priority.some(t => sameEntry(t, this.pinned))) this.pinned = null;
  }

  yieldToUser() {
    if (this.yieldFlight) return this.yieldFlight;
    this.active = false;
    this.generation++;
    this.pendingRebuild = false;
    this.refillAfter = false;
    this.followNext = false;
    this.io.cancelTransition?.();
    this.cancelLookup?.();
    this.notify('Tú eliges. DJ pausado; retirando sus sugerencias…');
    this.yieldFlight = Promise.resolve()
      .then(async () => {
        if (this.flight) await this.flight;
        this.busy = true;
        this.onUpdate();
        try {
          const q = this.io.queue();
          if (!q) throw Error('No se puede leer la cola');
          const ours = q.priority.filter(t => this.managed.some(m => sameEntry(m, t)));
          if (ours.length) await this.io.remove(ours);
          this.managed = [];
          this.preview = [];
          this.queuePlan = [];
          if (!this.suspended.length) this.captured = false;
          this.save();
          this.notify(
            this.suspended.length
              ? 'DJ pausado. Tu elección manda. Puedes restaurar la cola guardada.'
              : 'DJ pausado. Tu elección manda; Spotify sigue tu lista.'
          );
        } catch (e) {
          this.notify('No pude retirar todas las sugerencias: ' + e.message + '. Pulsa Restaurar cola.', true);
        } finally {
          this.busy = false;
          this.onUpdate();
        }
      })
      .finally(() => {
        this.yieldFlight = null;
      });
    return this.yieldFlight;
  }

  reconcileManual(snapshot) {
    if (!this.active || this.busy) return this.manualFlight || this.yieldFlight || Promise.resolve();
    const q = snapshot || this.io.queue();
    if (!q) return Promise.resolve();
    const manualEntries = q.priority.filter(t => !this.managed.some(m => sameEntry(m, t)));
    const newManual = manualEntries.filter(t => !this.knownManual.some(k => sameEntry(k, t)));
    this.knownManual = manualEntries.map(reference);

    if (newManual.length && this.managed.length && !this.settings.takeover) {
      const ours = q.priority.filter(t => this.managed.some(m => sameEntry(m, t)));
      if (ours.length) {
        this.manualFlight = Promise.resolve()
          .then(async () => {
            await this.io.remove(ours);
            this.managed = [];
            this.preview = [];
            this.queuePlan = q.priority.filter(t => !ours.some(o => sameEntry(o, t))).map(t => ({ ...t, manual: true }));
            this.save();
            this.notify('Tus canciones en cola van primero; después sigo con la mezcla.');
          })
          .catch(() => {})
          .finally(() => {
            this.manualFlight = null;
            this.onUpdate();
          });
        return this.manualFlight;
      }
    }

    this.queuePlan = q.priority.map(t => ({
      ...this.preview.find(p => sameEntry(p, t)),
      ...t,
      manual: !this.managed.some(m => sameEntry(m, t))
    }));
    return Promise.resolve();
  }

  eligible(t) {
    if (!t || !valid(t.uri) || !t.artists?.length) return false;
    if (this.intent.artistMode === 'only' && this.intent.artist && !hasArtist(t, this.intent.artist)) return false;
    if ((!this.settings.explicit && t.explicit) || this.sessionExcluded.has(t.uri)) return false;
    if (
      t.artists.some(
        a => this.artistExcluded.has(artistKey(a)) || this.intent.excludedArtists.includes(words(a.name))
      )
    ) {
      return false;
    }
    const styles = [...(t.styles || []), ...(this.tags[t.uri] || [])].map(words);
    return !this.intent.styles.length || this.intent.styles.every(tag => styles.includes(words(tag)));
  }

  knownTracks() {
    const q = this.io.queue();
    const playlist = [...this.sessionPlaylist, ...(this.io.known?.() || []), ...(q?.all || []).filter(t => t.playlist)];
    const history = Object.values(this.memory)
      .filter(m => m.track && m.heard > 0)
      .map(m => ({ ...m.track, playlist: false, evidence: [] }));
    const found = new Map();
    const counts = new Map();
    for (const t of [...playlist, ...history]) {
      const evidence = [...new Set([...knownEvidence(t, this.memory[t.uri]), ...(found.get(t.uri)?.evidence || [])])];
      const previous = found.get(t.uri);
      if (isKnown(t, this.memory[t.uri]) && this.eligible(t)) {
        found.set(t.uri, {
          ...t,
          image: t.image || previous?.image || '',
          album: t.album || previous?.album || '',
          playlist: evidence.includes('playlist'),
          evidence,
          familiar: true
        });
      }
    }
    for (const t of found.values()) {
      const k = t.artists?.[0] ? artistKey(t.artists[0]) : '';
      if (k) counts.set(k, (counts.get(k) || 0) + 1);
    }
    this.libraryArtistCounts = counts;
    const keys = new Set((this.anchor || this.current)?.artists.map(artistKey) || []);
    return [...found.values()]
      .sort(
        (a, b) =>
          Number(b.artists.some(x => keys.has(artistKey(x)))) - Number(a.artists.some(x => keys.has(artistKey(x))))
      )
      .slice(0, 300);
  }

  prepareChoices() {
    this.sessionPlaylist = (this.io.queue()?.all || []).filter(t => t.playlist).slice(0, 300);
    const candidates = this.knownTracks();
    candidates.sort((a, b) => this.score(b, []) - this.score(a, []) || a.uri.localeCompare(b.uri));
    this.choosing = true;
    this.deck.set(candidates);
    this.onUpdate();
    this.hydrateChoices();
    this.syncLibrary();
    return this.deck.pair;
  }

  async syncLibrary(force = false, playlist = '') {
    if (!this.io.loadKnown || this.libraryBusy) return;
    this.libraryBusy = true;
    this.onUpdate();
    try {
      await this.io.loadKnown(force, playlist);
      if (this.choosing) {
        const tracks = this.knownTracks();
        const signature = tracks
          .map(t => t.uri)
          .sort()
          .join('|');
        if (signature !== this.deck.signature) this.deck.set(tracks);
        this.hydrateChoices();
      }
      if (this.active) await this.refresh();
    } catch (_) {
      this.notify('La biblioteca no respondió. Puedes seguir con las fuentes ya disponibles.');
    } finally {
      this.libraryBusy = false;
      this.onUpdate();
    }
  }

  nextChoices(reset = false) {
    reset ? this.deck.reset() : this.deck.next();
    this.onUpdate();
    this.hydrateChoices();
    return this.deck.pair;
  }

  async hydrateChoices() {
    if (!this.io.cardDetails) return;
    const pair = this.deck.pair;
    const results = await Promise.allSettled(pair.map(t => (t.image ? Promise.resolve(null) : this.io.cardDetails(t))));
    if (!this.choosing || this.deck.pair !== pair) return;
    let changed = false;
    results.forEach((r, i) => {
      if (r.status === 'fulfilled' && r.value?.image) {
        const t = pair[i];
        t.image = r.value.image;
        t.album = r.value.album || t.album;
        const m = this.memory[t.uri];
        if (m?.track) {
          m.track = { ...m.track, image: t.image, album: t.album };
          changed = true;
        }
      }
    });
    if (changed) this.save();
    this.onUpdate();
  }

  tagPlaylist(styles) {
    const tags = intentOf({ styles }).styles;
    if (!tags.length) return;
    const tracks = [...this.sessionPlaylist, ...(this.io.queue()?.all || []).filter(t => t.playlist)];
    if (this.current) tracks.push(this.current);
    for (const t of tracks) this.tags[t.uri] = tags;
    this.pool = null;
    this.save();
    this.notify('Etiqueta musical guardada para estas canciones.');
    if (this.choosing) this.prepareChoices();
    return this.refresh();
  }

  async playChoice(track, start = false, overlay = false) {
    if (!track || !valid(track.uri)) throw Error('Elige una canción válida');
    if (!this.io.play) throw Error('Spotify no ofrece reproducción directa');
    const generation = ++this.commandGeneration;
    this.choiceBusy = true;
    this.onUpdate();
    try {
      if (this.captured) await this.stop();
      else await this.yieldToUser();
      if (this.captured || this.managed.length) throw Error('Primero hay que restaurar o liberar la cola pendiente');
      if (generation !== this.commandGeneration) return false;
      if (start && this.io.beforeSessionPlay) {
        const allowed = await this.io.beforeSessionPlay(track, this.intent);
        if (allowed === false || generation !== this.commandGeneration) return false;
      }
      await this.io.play(track);
      if (generation !== this.commandGeneration) return false;
      this.trackChanged(track);
      this.anchor = this.current;
      this.intent.reference = reference(track);
      this.choosing = false;
      this.commandChoices = [];
      this.commandArtists = [];
      this.artistMenu = null;
      if (start) await this.start(this.current, !!this.io.beforeSessionPlay, overlay);
      else this.notify('Tu canción está sonando. DJ pausado.');
      return true;
    } finally {
      this.choiceBusy = false;
      this.onUpdate();
    }
  }

  async command(text) {
    this.commandChoices = [];
    this.commandArtists = [];
    this.artistMenu = null;
    this.pendingCommand = null;
    const command = parseCommand(text);
    if (!command.ok) {
      this.notify(command.errors.join(' '), true);
      return command;
    }
    const generation = ++this.commandGeneration;
    if (command.target?.current && !this.current) {
      this.notify('Primero reproduce una canción.', true);
      return { ok: false };
    }
    if (command.action === 'stop' || command.action === 'restore') {
      await this.stop();
      return command;
    }
    let target = command.target?.current ? this.current : null;
    if (command.target && !target) {
      this.notify('Buscando tu canción…');
      const result =
        command.action === 'search' && this.io.search
          ? await this.io.search(command.target)
          : { tracks: (await this.io.resolve?.(command.target)) || [], artists: [] };
      const matches = result.tracks || [];
      this.commandArtists = result.artists || [];
      if (generation !== this.commandGeneration) {
        return { ok: false, errors: ['La orden fue sustituida por otra elección.'] };
      }
      if (!matches.length && !this.commandArtists.length) {
        this.notify('No encontré esa canción o artista.', true);
        return { ok: false, errors: ['Sin coincidencias'] };
      }
      const exact = matches.filter(
        t =>
          songKey(t.name) === songKey(command.target.title) &&
          (!command.target.artist || t.artists.some(a => words(a.name) === words(command.target.artist)))
      );
      if (command.action === 'search' || exact.length !== 1) {
        this.commandChoices = (exact.length ? exact : matches).slice(0, 6);
        this.pendingCommand = command;
        this.notify(
          command.action === 'search'
            ? 'Elige una canción para comenzar una mezcla con esa referencia.'
            : 'Elige la coincidencia correcta. No cambié tu reproducción.'
        );
        return { ...command, choices: this.commandChoices };
      }
      target = exact[0];
    }
    return this.applyCommand(command, target);
  }

  async applyCommand(command, target) {
    const next = intentOf({
      ...this.intent,
      ...command.patch,
      ...(target && ['play', 'search', 'reference'].includes(command.action) ? { artist: null, artistMode: null } : {}),
      excludedArtists: [...this.intent.excludedArtists, ...(command.patch.excludedArtists || [])]
    });
    if (target && target.artists.some(a => next.excludedArtists.includes(words(a.name)))) {
      this.notify('La referencia y el artista excluido se contradicen.', true);
      return { ok: false };
    }
    this.intent = next;
    this.settings.discovery = next.known ? 0 : Math.max(35, this.settings.discovery || 35);
    this.settings.diversity = next.variety;
    this.pool = null;
    if (target && command.action === 'reference') {
      this.anchor = target;
      this.intent.reference = reference(target);
      this.seeds = [];
    }
    this.save();
    if (command.action === 'play') return this.playChoice(target, command.start);
    if (command.action === 'search') return this.playChoice(target, true, true);
    if (command.action === 'reference' && target) {
      if (this.active && !this.captured && this.io.queue()?.priority.some(t => !this.managed.some(m => sameEntry(m, t)))) {
        await this.stop();
      }
      if (!this.active) await this.start(target, false, true);
      else {
        await this.refresh();
        await this.onNarrate('direction');
      }
      return command;
    }
    if (command.start && !this.active) {
      if (this.intent.known && !target) this.prepareChoices();
      else await this.start(target || this.current);
    } else if (this.active) {
      await this.refresh();
      this.onNarrate('direction');
    } else {
      this.notify('Entendido: ' + intentLabels(this.intent).join(' · '));
    }
    return command;
  }

  chooseCommand(track) {
    const command = this.pendingCommand;
    if (!command || !this.commandChoices.some(t => t.uri === track.uri)) return Promise.resolve();
    this.commandChoices = [];
    this.pendingCommand = null;
    return this.applyCommand(command, track);
  }

  chooseArtist(uri, mode) {
    const artist =
      this.commandArtists.find(a => a.uri === uri) ||
      this.commandChoices.flatMap(t => t.artists).find(a => a.uri === uri);
    if (!artist) return Promise.resolve();
    if (!mode) {
      this.artistMenu = artist;
      this.onUpdate();
      return Promise.resolve();
    }
    return this.beginArtist(artist, mode);
  }

  async beginArtist(artist, mode) {
    if (!['mix', 'only'].includes(mode)) return;
    const generation = ++this.commandGeneration;
    this.choiceBusy = true;
    this.notify('Preparando el catálogo de ' + artist.name + '…');
    try {
      const catalog = (await this.io.artistTracks?.(artist)) || this.commandChoices.filter(t => hasArtist(t, artist));
      if (generation !== this.commandGeneration) return;
      const tracks = catalog.filter(t => hasArtist(t, artist) && (this.settings.explicit || !t.explicit));
      if (!tracks.length) {
        this.notify('No encontré canciones reproducibles de ese artista.', true);
        return;
      }
      await this.stop();
      if (generation !== this.commandGeneration || this.captured || this.managed.length) return;
      this.intent = intentOf({
        ...this.intent,
        known: false,
        styles: [],
        artist,
        artistMode: mode,
        excludedArtists: this.intent.excludedArtists.filter(n => n !== words(artist.name))
      });
      this.settings.discovery = 50;
      this.pool = null;
      const choices = tracks.filter(t => t.uri !== this.current?.uri);
      const seed = (choices.length ? choices : tracks)[Math.floor(Math.random() * (choices.length || tracks.length))];
      this.commandArtists = [];
      this.artistMenu = null;
      this.pendingCommand = null;
      const played = await this.playChoice(seed, true, true);
      if (!played || !this.active) return;
      this.choiceBusy = true;
      this.onUpdate();
      const currentGeneration = this.commandGeneration;
      const pool = await this.io.candidates(this.anchor, this.settings, this.io.queue()?.all || []);
      if (currentGeneration !== this.commandGeneration || !this.active) return;
      const plan = [seed, ...this.preview, ...this.select(pool, this.io.queue()?.priority || [], 24)]
        .filter((t, i, a) => a.findIndex(x => x.uri === t.uri) === i)
        .slice(0, 24);
      if (this.io.createMix) {
        this.notify('Guardando la playlist de la mezcla…');
        const saved = await this.io.createMix(artist, mode, plan);
        if (currentGeneration !== this.commandGeneration || !this.active) return;
        this.mixPlaylist = saved;
        this.save();
        this.notify('Mezcla iniciada y playlist guardada: ' + this.mixPlaylist.name);
      }
      this.onUpdate();
    } catch (e) {
      this.notify('No pude completar la mezcla: ' + e.message, true);
    } finally {
      this.choiceBusy = false;
      this.onUpdate();
    }
  }

  exportProfile() {
    return {
      schema: 4,
      version: VERSION,
      settings: this.settings,
      intent: this.intent,
      memory: this.memory,
      preferences: this.preferences,
      contexts: this.contexts,
      tags: this.tags,
      taste: this.taste
    };
  }

  importProfile(data) {
    if (!data || ![1, 2, 3, 4].includes(data.schema) || !data.memory || typeof data.memory !== 'object' || Array.isArray(data.memory)) {
      throw Error('El archivo no es un perfil POOR DJ válido.');
    }
    const profile = migrateProfile(data);
    this.memory = profile.memory;
    this.preferences = profile.preferences;
    this.contexts = profile.contexts;
    this.tags = profile.tags;
    this.taste = profile.taste;
    this.intent = profile.intent;
    this.pool = null;
    this.updateSettings(profile.settings, false);
    this.commandGeneration++;
    return this.refresh();
  }
}

const words = x =>
  String(x || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[“”"']/g, '')
    .replace(/[()[\]!?¡¿.,;:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const STYLE_NAMES = {
  reggaeton: 'reggaetón',
  trap: 'trap',
  rap: 'rap',
  hiphop: 'hip hop',
  pop: 'pop',
  rock: 'rock',
  electronica: 'electrónica',
  jazz: 'jazz',
  salsa: 'salsa',
  bachata: 'bachata',
  alabanzas: 'alabanzas',
  cristiana: 'alabanzas',
  cristiano: 'alabanzas',
  gospel: 'gospel',
  ambient: 'ambient',
  lofi: 'lo-fi'
};

const songKey = text => {
  const key = words(text);
  return /^(?:[a-z0-9]\s+)+[a-z0-9]$/.test(key) ? key.replace(/\s/g, '') : key;
};

function songIdentity(track) {
  const raw = String(track?.name || '');
  const noParens = raw.replace(/\s*[(\[]([^)\]]*)[)\]]/g, (_, inner) =>
    /\bremix\b/i.test(inner) ? ' ' + inner : ' '
  );
  const noSuffix = noParens.replace(
    /\s+-\s+(?:remaster(?:ed)?|live|en\s+vivo|versi[oó]n|radio\s+edit|edit|mono|stereo)\b.*$/i,
    ''
  );
  const title = songKey(noSuffix) || songKey(raw);
  const artist = words(track?.artists?.[0]?.name || '');
  return `${title}|${artist}`;
}

function intentOf(value = {}) {
  return {
    known: value.known !== false,
    styles: Array.isArray(value.styles)
      ? [...new Set(value.styles.filter(t => typeof t === 'string').map(words))].slice(0, 5)
      : [],
    excludedArtists: Array.isArray(value.excludedArtists)
      ? [...new Set(value.excludedArtists.filter(t => typeof t === 'string').map(words))].slice(0, 30)
      : [],
    variety: clamp(value.variety ?? 25),
    reference: value.reference || null,
    artist:
      value.artist && /^spotify:artist:[A-Za-z0-9]{22}$/.test(value.artist.uri || '')
        ? { uri: value.artist.uri, name: String(value.artist.name || '').slice(0, 100) }
        : null,
    artistMode: ['mix', 'only'].includes(value.artistMode) ? value.artistMode : null
  };
}

function parseCommand(raw) {
  let text = words(raw);
  const patch = {};
  const labels = [];
  const errors = [];
  let action = 'configure';
  let target = null;
  let start = false;

  if (!text || text.length > 240) {
    return { ok: false, errors: ['Escribe una instrucción de 1 a 240 caracteres.'] };
  }
  const search = text.match(/^(?:busca|buscar|mezcla con|haz una mezcla de|quiero escuchar|dj con) (.+)$/);
  if (search && !/\b(?:solo conocidas|sin |mas variedad|menos variedad)\b/.test(search[1])) {
    return {
      ok: true,
      action: 'search',
      target: { title: search[1], artist: '' },
      start: true,
      patch: {},
      labels: ['Buscar música'],
      errors: []
    };
  }
  if (/menos comercial|mas comercial|menos viral|menos mainstream/.test(text)) {
    errors.push('No tengo datos para medir lo comercial. Prueba conocidas o excluye un artista.');
  }
  const take = (re, fn) => {
    text = text
      .replace(re, (...args) => {
        fn(...args);
        return ' ';
      })
      .replace(/\s+/g, ' ')
      .trim();
  };
  take(/(?:e |y )?(?:inicia|iniciar|empieza|empezar|activa|activar) (?:el |una |la |mi )?(?:dj|sesion)/g, () => {
    start = true;
  });
  const following = [
    'solo',
    'sin',
    'mas variedad',
    'menos variedad',
    'permite',
    'descubrir',
    'hip hop',
    'lo fi',
    ...Object.keys(STYLE_NAMES)
  ].join('|');
  const split = text.match(new RegExp('^(.*?)(?= y (?:' + following + ')\\b|$)'));
  const targetClause = split?.[0] || text;
  const play = targetClause.match(/^(?:pon|reproduce|toca) (.+?)(?: de (.+))?$/);
  const referenceText = targetClause.match(/^(?:sigue|seguir|mas) (?:como|con) (?!esta\b)(.+?)(?: de (.+))?$/);
  if (play || referenceText) {
    const m = play || referenceText;
    target = { title: m[1].trim(), artist: (m[2] || '').trim() };
    action = play ? 'play' : 'reference';
    text = text.slice(targetClause.length).trim();
  }
  {
    let known = false;
    let discover = false;
    take(/(?:solo )?(?:musica |canciones |rolas )?(?:que conozco|conocidas|conocidos)|menos descubrimiento|mi musica/g, () => {
      known = true;
    });
    take(/(?:permite |permitir )?(?:descubrir|descubrimiento)|mas descubrimiento|musica nueva|canciones nuevas/g, () => {
      discover = true;
    });
    if (known && discover) {
      errors.push('Elige conocidas o descubrir; las dos órdenes se contradicen.');
    }
    if (known || discover) {
      patch.known = known;
      labels.push(known ? 'Solo conocidas' : 'Permitir descubrir');
    }
    take(
      /(?:sigue lo que estoy escuchando|sigue la cancion que estoy escuchando|continua con esta(?: cancion)?|mezcla a partir de esta(?: cancion)?|mas de esta|mas como esta|sigue como esta|(?:sigue|seguir|siguela|siguele)(?: (?:esta|la|esa|lo que suena))?(?: cancion| rola| musica)?|misma vibe|mismo estilo)/g,
      () => {
        action = 'reference';
        target = { current: true };
        start = true;
        labels.push('Seguir esta canción');
      }
    );
    take(
      /(?:sin (?!repetir artistas)|evita |excluye |no pongas )(.+?)(?=\s+y\s+|\s+pero\s+|\s+mas variedad\b|\s+menos variedad\b|$)/g,
      (_, name) => {
        (patch.excludedArtists ||= []).push(name.trim());
        labels.push('Sin ' + name.trim());
      }
    );
    take(/(?:mas variedad|sin repetir artistas|varia artistas)/g, () => {
      patch.variety = 80;
      labels.push('Variar artistas');
    });
    take(/(?:menos variedad|repite artistas)/g, () => {
      if (patch.variety === 80) errors.push('Más y menos variedad se contradicen.');
      patch.variety = 10;
      labels.push('Artistas cercanos');
    });
    take(/otra (?:sugerencia|cancion|rola)|renueva (?:la |las )?(?:cola|sugerencias)/g, () => {
      if (action !== 'configure') errors.push('Separa la orden de renovar.');
      action = 'refresh';
    });
    take(/(?:deten|termina|para|apaga) (?:el |la )?(?:dj|sesion)/g, () => {
      if (action !== 'configure') errors.push('Separa la orden de terminar.');
      action = 'stop';
    });
    take(/(?:restaura|restaurar|devuelve) (?:mi |la )?(?:cola|lista)/g, () => {
      if (action !== 'configure') errors.push('Separa la orden de restaurar.');
      action = 'restore';
    });
    take(/hip hop|lo fi/g, m => {
      (patch.styles ||= []).push(m === 'hip hop' ? 'hip hop' : 'lofi');
    });
    for (const key of Object.keys(STYLE_NAMES)) {
      take(new RegExp('\\b' + key + '\\b', 'g'), () => {
        (patch.styles ||= []).push(STYLE_NAMES[key]);
      });
    }
    text = text
      .replace(/\b(?:y|pero|con|algo|de|musica|canciones|por favor|quiero|ponme|me|el|la|un|una)\b/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (text) {
      if (
        !target &&
        !Object.keys(patch).length &&
        action === 'configure' &&
        !start &&
        !errors.length &&
        !/\b(?:solo|sin|descubr|variedad|termina|deten|restaura|quiero|menos|mas|inicia|dj|sesion)\b/.test(text)
      ) {
        action = 'search';
        target = { title: words(raw), artist: '' };
        start = true;
        text = '';
        labels.push('Buscar música');
      } else {
        errors.push('No entendí: «' + text + '». Corrige esa parte antes de aplicar.');
      }
    }
  }
  if (start && ['stop', 'restore'].includes(action)) {
    errors.push('Iniciar y terminar se contradicen.');
  }
  if (patch.styles) labels.push(...patch.styles.map(x => 'Estilo: ' + x));
  if (!target && !Object.keys(patch).length && action === 'configure' && !start) {
    errors.push('Prueba «solo conocidas», «más como esta» o «pon canción de artista».');
  }
  return { ok: !errors.length, action, target, start, patch, labels, errors };
}

function intentLabels(intent) {
  return [
    intent.known ? 'Solo conocidas' : 'Descubrir afines',
    ...(intent.artist ? [`${intent.artistMode === 'only' ? 'Solo' : 'Protagonista'}: ${intent.artist.name}`] : []),
    ...intent.styles.map(t => 'Estilo: ' + t),
    ...intent.excludedArtists.map(t => 'Sin ' + t),
    ...(intent.variety >= 60 ? ['Variar artistas'] : [])
  ];
}

function knownEvidence(t, m = {}) {
  const evidence = [];
  if (t.playlist || t.evidence?.includes('playlist')) evidence.push('playlist');
  if (t.evidence?.includes('megusta')) evidence.push('megusta');
  if (m.heard > 0 || t.evidence?.includes('escucha')) evidence.push('escucha');
  if (m.vote > 0 || t.evidence?.includes('voto')) evidence.push('voto');
  return [...new Set(evidence)];
}

const evidenceLabel = e =>
  e
    .map(
      x =>
        ({
          playlist: 'Tu playlist',
          megusta: 'Tus Me gusta',
          escucha: 'Escucha registrada',
          voto: 'Voto positivo'
        })[x]
    )
    .filter(Boolean)
    .join(' · ');

const isKnown = (t, m) => knownEvidence(t, m).some(e => ['playlist', 'megusta', 'escucha'].includes(e));

function contextKey(seed, intent) {
  return JSON.stringify([
    intent.styles.slice().sort(),
    (intent.artist ? [intent.artist] : seed?.artists || []).map(artistKey).sort()
  ]);
}

function migrateProfile(data = {}) {
  if (!data || typeof data !== 'object') data = {};
  const schema = Number(data.schema) || 0;
  const now = Date.now();
  const memory = {};

  for (const [uri, m] of Object.entries(data.memory || {}).slice(0, 1000)) {
    if (!valid(uri) || !m || typeof m !== 'object') continue;
    const track = normalize(m.track);
    memory[uri] = {
      plays: clamp(m.plays, 0, 100000),
      heard: schema >= 3 ? clamp(m.heard, 0, 100000) : 0,
      legacyPlays: schema >= 3 ? clamp(m.legacyPlays, 0, 100000) : clamp(m.plays, 0, 100000),
      vote: clamp(m.vote, -5, 5),
      lastPlayed: clamp(m.lastPlayed, 0, now),
      lastStarted: clamp(m.lastStarted, 0, now),
      lastSuggested: clamp(m.lastSuggested, 0, now),
      dismissedAt: clamp(m.dismissedAt, 0, now),
      ...(track ? { track } : {})
    };
  }

  const preferences = {};
  for (const [key, v] of Object.entries(data.preferences || {}).slice(0, 3000)) {
    if (!['__proto__', 'constructor', 'prototype'].includes(key) && key.length < 160) {
      preferences[key] = clamp(v, -3, 3);
    }
  }

  const contexts = {};
  if (schema >= 3) {
    for (const [key, c] of Object.entries(data.contexts || {}).slice(-40)) {
      if (key.length > 1000 || !c || typeof c !== 'object' || ['__proto__', 'constructor', 'prototype'].includes(key)) {
        continue;
      }
      const votes = {};
      for (const [uri, v] of Object.entries(c.votes || {}).slice(0, 300)) {
        if (valid(uri)) votes[uri] = clamp(v, -5, 5);
      }
      contexts[key] = { votes };
    }
  }

  const tags = {};
  for (const [uri, values] of Object.entries(data.tags || {}).slice(0, 1000)) {
    if (valid(uri) && Array.isArray(values)) tags[uri] = intentOf({ styles: values }).styles;
  }

  const artistEntries = [];
  const rawArtists = data.taste?.artists && typeof data.taste.artists === 'object' ? data.taste.artists : {};
  for (const [key, entry] of Object.entries(rawArtists)) {
    if (!key || key.length > 160 || ['__proto__', 'constructor', 'prototype'].includes(key)) continue;
    if (!entry || typeof entry !== 'object') continue;
    artistEntries.push([
      key,
      {
        name: String(entry.name || '').slice(0, 100),
        uri: /^spotify:artist:[A-Za-z0-9]{22}$/.test(entry.uri || '') ? entry.uri : '',
        score: clamp(entry.score, -10, 15),
        plays: clamp(entry.plays, 0, 100000),
        skips: clamp(entry.skips, 0, 100000),
        last: clamp(entry.last, 0, now)
      }
    ]);
  }
  artistEntries.sort((a, b) => (b[1].last || 0) - (a[1].last || 0));
  const taste = { artists: Object.fromEntries(artistEntries.slice(0, 800)) };

  let settings;
  let rawIntent;
  const hasSavedData = Object.keys(data).length > 0;
  if (schema === 4) {
    settings = { ...(data.settings || {}) };
    rawIntent = { ...(data.intent || {}) };
  } else if (hasSavedData && schema <= 3) {
    settings =
      schema === 3
        ? { ...(data.settings || {}) }
        : { ...(data.settings || {}), discovery: 35, diversity: 25, queueSize: 3, takeover: false, voice: true };
    if (settings.discovery === 0 || settings.discovery === undefined) settings.discovery = 35;
    if (settings.queueSize === 1 || settings.queueSize === undefined) settings.queueSize = 3;
    if (settings.voiceName && !String(settings.voiceName).startsWith('neural:')) settings.voiceName = '';
    rawIntent = schema === 3 ? { ...(data.intent || {}) } : {};
    if (settings.discovery !== 0) rawIntent.known = false;
  } else {
    settings = { ...(data.settings || {}) };
    rawIntent = { ...(data.intent || {}) };
    if (rawIntent.known === undefined) {
      rawIntent.known = settings.discovery === 0;
    }
  }

  const mixPlaylist = /^spotify:playlist:[A-Za-z0-9]{22}$/.test(data.mixPlaylist?.uri || '')
    ? {
        uri: data.mixPlaylist.uri,
        name: String(data.mixPlaylist.name || 'Mezcla POOR DJ').slice(0, 200),
        count: clamp(data.mixPlaylist.count, 0, 300)
      }
    : null;

  return {
    schema: 4,
    memory,
    preferences,
    contexts,
    tags,
    taste,
    intent: intentOf(rawIntent),
    settings,
    recovery: data.recovery || {},
    mixPlaylist
  };
}

class ChoiceDeck {
  constructor(random = Math.random) {
    this.random = random;
    this.tracks = [];
    this.offset = 0;
    this.pair = [];
    this.signature = '';
  }
  set(tracks) {
    const unique = [...new Map(tracks.map(t => [t.uri, t])).values()].slice(0, 300);
    const signature = unique
      .map(t => t.uri)
      .sort()
      .join('|');
    if (signature === this.signature && this.tracks.length) return this.next();
    this.signature = signature;
    this.tracks = unique;
    this.shuffle();
    this.offset = 0;
    return this.next();
  }
  shuffle() {
    for (let i = this.tracks.length - 1; i > 0; i--) {
      const j = Math.floor(this.random() * (i + 1));
      [this.tracks[i], this.tracks[j]] = [this.tracks[j], this.tracks[i]];
    }
  }
  next() {
    this.pair = this.tracks.slice(this.offset, this.offset + 2);
    this.offset += this.pair.length;
    return this.pair;
  }
  reset() {
    this.shuffle();
    this.offset = 0;
    return this.next();
  }
  get exhausted() {
    return this.offset >= this.tracks.length;
  }
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
const mixUris=(pending,key,tracks,limit=24)=>[...new Set((pending?.key===key && Array.isArray(pending.tracks)?pending.tracks:tracks.map(t=>t.uri)).filter(valid))].slice(0,limit);
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
function transitionLabel(a,b){
  const f=transitionFit(a,b),parts=[];
  if(f.tempo!==null && f.tempo<=.06)parts.push('mantiene el pulso');
  if(f.key!==null && f.key<=1)parts.push('encaja en tono');
  if(f.loudness!==null && f.loudness<=3)parts.push('suena al mismo nivel');
  return parts.length?'Transición: '+parts.join(', '):'Sin datos para verificar la transición; se prioriza la referencia.';
}
// Segundos de solapamiento recomendados para esta pareja; null si no hay datos suficientes.
function fadePlan(a,b){
  const f=transitionFit(a,b);if(f.value===null || f.coverage<.5)return null;
  if(f.value>=.75 && (f.tempo===null || f.tempo<=.06))return 6;
  if(f.value>=.55)return 4;
  if(f.value>=.35)return 2;
  return 0;
}
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

// Ánimo estimado solo con tempo, tono y nivel medidos; nunca con géneros supuestos.
function moodOf(audio) {
  if (!audio || !Number.isFinite(audio.bpm) || !Number.isInteger(audio.mode)) return null;
  const slow = audio.bpm < 100;
  const fast = audio.bpm >= 122;
  const loud = Number.isFinite(audio.loudness) && audio.loudness > -6;
  if (audio.mode === 0 && slow) return 'melancolica';
  if (slow && (audio.mode === 1 || (Number.isFinite(audio.loudness) && audio.loudness < -12))) return 'tranquila';
  if (fast && (loud || audio.bpm >= 138)) return 'intensa';
  if (audio.mode === 1 && fast) return 'animada';
  return null;
}

const MOODS = {
  melancolica: {
    lead: ['Un momento más sentimental.', 'Bajamos un poco la luz.', 'Toca algo con aire melancólico.'],
    now: 'más melancólico'
  },
  tranquila: {
    lead: ['Bajamos las revoluciones.', 'Un respiro.', 'Ahora, algo para ir con calma.'],
    now: 'más tranquilo'
  },
  animada: {
    lead: ['Subimos el ánimo.', 'Esta trae buena energía.', 'Arriba ese ánimo.'],
    now: 'más animado'
  },
  intensa: {
    lead: ['Ahora sí, a subir la energía.', 'Con fuerza.', 'Prepárate, que esta pega.'],
    now: 'con más intensidad'
  }
};

// Líneas por estilo: solo se usan si tú declaraste ese estilo en tus etiquetas.
const GENRE_LINES = {
  reggaeton: ['Para el perreo.', 'Sube el flow.'],
  trap: ['Bajos y rimas.', 'Para subir el volumen.'],
  rap: ['Rimas con carácter.', 'Atento a la letra.'],
  hiphop: ['Ritmo y rimas.', 'Del hip hop que te gusta.'],
  pop: ['Pop para cantar.', 'Un coro para el recuerdo.'],
  rock: ['Guitarras al frente.', 'Para dejar el volumen alto.'],
  electronica: ['Para la pista de baile.', 'Pulso electrónico.'],
  jazz: ['Jazz para escuchar con calma.', 'Con mucho oficio.'],
  salsa: ['Para mover los pies.', 'Sabor de salsa.'],
  bachata: ['Una de corazón.', 'Bachata para sentir.'],
  alabanzas: ['Un momento de alabanza.', 'Para elevar el ánimo.'],
  gospel: ['Para elevar el ánimo.', 'Voces con fuerza.'],
  ambient: ['Para dejar volar la mente.', 'Un paisaje sonoro.'],
  lofi: ['Para concentrarte.', 'Lo-fi sin prisa.']
};

function cleanTitle(name) {
  return String(name || 'esta canción')
    .replace(/\s*[(\[](?:feat\.?|ft\.?|with)[^)\]]*[)\]]/gi, '')
    .replace(/\s*[(\[][^)\]]*[)\]]/g, '')
    .replace(/\s+-\s+(?:remaster(?:ed)?|live|en\s+vivo|versi[oó]n|radio\s+edit|edit|mono|stereo)\b.*$/i, '')
    .trim() || 'esta canción';
}

function speakable(text) {
  let out = String(text || '');
  out = out.replace(/\s*[(\[](?:feat\.?|ft\.?|with|remaster(?:ed)?|live|en\s+vivo|versi[oó]n)[^)\]]*[)\]]/gi, ' ');
  out = out.replace(/\s+-\s+(?:remaster(?:ed)?|live|en\s+vivo|versi[oó]n|radio\s+edit|edit|mono|stereo)\b[^,.;!?]*/gi, '');
  out = out.replace(/\b(?:feat|ft)\b\.?/gi, 'con');
  out = out.replace(/&/g, ' y ');
  out = out.replace(/(?:^|\s)((?:[A-Za-z0-9]\s+){2,}[A-Za-z0-9])(?=\s|$)/g, (_, seq) => ' ' + seq.replace(/\s+/g, ''));
  out = out.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}♪♫★☆•·]/gu, ' ');
  out = out.replace(/\b[A-ZÁÉÍÓÚÜÑ]{4,}\b/g, w => w[0] + w.slice(1).toLowerCase());
  return out.replace(/\s+/g, ' ').replace(/\s+([,.;:!?])/g, '$1').trim();
}

function greetingForHour(hour) {
  if (!Number.isFinite(hour)) return '¡Qué tal!';
  if (hour >= 5 && hour < 12) return 'Buenos días.';
  if (hour >= 12 && hour < 20) return 'Buenas tardes.';
  return 'Buenas noches.';
}

function pickOpener(openers, sequence, recentOpeners) {
  const n = Math.abs(Math.floor(sequence));
  for (let i = 0; i < openers.length; i++) {
    const candidate = openers[(n + i) % openers.length];
    if (!recentOpeners || !recentOpeners.includes(candidate)) {
      if (Array.isArray(recentOpeners)) {
        recentOpeners.push(candidate);
        if (recentOpeners.length > 10) recentOpeners.shift();
      }
      return candidate;
    }
  }
  return openers[n % openers.length];
}

function commentary(event, seed, intent = intentOf(), sequence = 0, recentOpeners = null) {
  const n = Math.abs(Math.floor(sequence));
  const pick = list => list[n % list.length];
  const title = cleanTitle(seed?.name);
  const artist = seed?.artists?.[0]?.name || intent?.artist?.name || '';
  const by = artist ? `, de ${artist}` : '';
  const mood = moodOf(seed?.audio);
  const before = moodOf(seed?.prevAudio);
  const style = (seed?.styles || []).map(words).find(x => GENRE_LINES[x]);
  const direction = intent?.styles?.length
    ? intent.styles.map(t => STYLE_NAMES[words(t)] || t).join(' y ')
    : intent?.artistMode === 'only'
    ? 'solo ' + (intent.artist?.name || artist || 'este artista')
    : intent?.artistMode === 'mix'
    ? 'la música de ' + (intent.artist?.name || artist || 'este artista')
    : 'el sonido de ' + (artist || title);

  if (event === 'next') {
    const openers = [
      `Ahora suena ${title}${by}.`,
      `Esto es ${title}${by}.`,
      `Sigue ${title}${by}.`,
      `Llega ${title}${by}.`,
      `Es el turno de ${title}${by}.`,
      `Ponemos ${title}${by}.`,
      `Aquí viene ${title}${by}.`,
      `Continuamos con ${title}${by}.`
    ];
    let lead = '';
    if (mood && before && mood !== before) lead = `Cambiamos de ambiente: ahora algo ${MOODS[mood].now}.`;
    else if (mood) lead = pick(MOODS[mood].lead);
    else if (Number.isFinite(seed?.hour) && (seed.hour >= 22 || seed.hour < 5)) lead = 'Para esta hora de la noche.';

    const tail = [];
    if (style) tail.push(pick(GENRE_LINES[style]));
    if (seed?.evidence) tail.push(`Viene de ${seed.evidence.toLowerCase()}.`);
    else if (seed?.source === 'radio') tail.push('Llega desde la radio de tu mezcla.');
    else if (seed?.source === 'artista relacionado') tail.push('De un artista cercano a tu mezcla.');
    if (seed?.plays >= 3) tail.push(`La has escuchado ${seed.plays} veces.`);
    if (seed?.minutes >= 20) tail.push(`Llevas ${seed.minutes} minutos de sesión.`);
    if (seed?.prevArtist && artist && words(seed.prevArtist) !== words(artist)) {
      tail.push(`Cambiamos de ${seed.prevArtist} a ${artist}.`);
    }
    if (!tail.length) {
      tail.push('Encaja bien con lo que traes.', 'Va directo con el pulso de la sesión.', 'Conecta bien con la anterior.');
    }
    const opener = pickOpener(openers, n, recentOpeners);
    return [lead, opener, tail[n % tail.length]].filter(Boolean).join(' ').split(/\s+/).slice(0, 30).join(' ');
  }

  if (event === 'follow') {
    const openers = [
      'Buena elección. Sigo por ahí.',
      'Me gusta ese giro.',
      'Excelente cambio de rumbo.',
      'Tomamos ese camino.',
      'Ajusto la mezcla a lo que pusiste.',
      'Perfecto, seguimos esa línea.',
      'Gran tema para guiar la sesión.',
      'Vamos por esa ruta.'
    ];
    const tails = [
      `Ahora nos guiamos por ${title}${by}.`,
      `Busco música afín a ${title}${by}.`,
      `Preparamos la siguiente cola alrededor de ${artist || title}.`,
      'Dejo tus elecciones al frente.'
    ];
    return `${pickOpener(openers, n, recentOpeners)} ${tails[Math.floor(n / 3) % tails.length]}`
      .split(/\s+/)
      .slice(0, 30)
      .join(' ');
  }

  if (event === 'discovery') {
    const openers = [
      `Esta es nueva para ti: ${title}${by}.`,
      `Algo fresco en tu sesión: ${title}${by}.`,
      `Te presento ${title}${by}.`,
      `Un descubrimiento para ti: ${title}${by}.`,
      `Primera vez por aquí con ${title}${by}.`,
      `Abrimos espacio a algo nuevo: ${title}${by}.`,
      `Para descubrir hoy: ${title}${by}.`,
      `Dale una oportunidad a ${title}${by}.`
    ];
    const tails = [
      'Encaja con la vibra que traes.',
      'Si te convence, dale un voto positivo.',
      'Va en la misma línea de tu referencia.',
      'Dime si quieres más en este estilo.'
    ];
    return `${pickOpener(openers, n, recentOpeners)} ${tails[Math.floor(n / 4) % tails.length]}`
      .split(/\s+/)
      .slice(0, 30)
      .join(' ');
  }

  if (event === 'return') {
    const days = Math.max(30, Number(seed?.daysSince) || 30);
    const openers = [
      `Hace ${days} días que no sonaba ${title}${by}.`,
      `Rescatamos ${title}${by} después de ${days} días.`,
      `Vuelve a sonar ${title}${by}.`,
      `Un reencuentro después de ${days} días: ${title}${by}.`,
      `Tenía ${days} días guardada y vuelve ${title}${by}.`,
      `Regresa a tu cola ${title}${by}.`,
      `Para recordar viejas escuchas: ${title}${by}.`,
      `Traemos de vuelta ${title}${by}.`
    ];
    const tails = [
      seed?.evidence ? `Viene de ${seed.evidence.toLowerCase()}.` : 'Ya formaba parte de tu música.',
      'Directo a la mezcla de hoy.',
      'A ver cómo se siente hoy.'
    ];
    return `${pickOpener(openers, n, recentOpeners)} ${tails[Math.floor(n / 3) % tails.length]}`
      .split(/\s+/)
      .slice(0, 30)
      .join(' ');
  }

  if (event === 'milestone') {
    const mins = Math.max(30, Number(seed?.minutes) || 30);
    const openers = [
      `Llevamos ${mins} minutos de música continua.`,
      `Ya van ${mins} minutos de sesión juntos.`,
      `Media hora más en la cabina: ${mins} minutos ya.`,
      `Seguimos en vivo tras ${mins} minutos de mezcla.`,
      `Qué buen ritmo: ${mins} minutos de sesión.`,
      `${mins} minutos sin soltar el pulso.`,
      `Cruzamos los ${mins} minutos de música.`,
      `Seguimos al aire después de ${mins} minutos.`
    ];
    const tails = [
      seed?.artistsCount ? `Ya pasaron ${seed.artistsCount} artistas por aquí.` : 'La mezcla sigue viva.',
      `Ahora con ${title}${by}.`,
      'Tú sigues al mando.'
    ];
    return `${pickOpener(openers, n, recentOpeners)} ${tails[Math.floor(n / 3) % tails.length]}`
      .split(/\s+/)
      .slice(0, 30)
      .join(' ');
  }

  if (event === 'end') {
    const openers = [
      'Hasta aquí llega la mezcla de hoy.',
      'Cerramos la cabina por ahora.',
      'Gracias por acompañarme en esta sesión.',
      'Dejo la música en tus manos.',
      'Terminamos por hoy en POOR DJ.',
      'Sesión cerrada con buen sabor.',
      'Me despido por ahora.',
      'Apagamos el micro hasta la próxima.'
    ];
    const tails = [
      seed?.minutes >= 5 ? `Fueron ${seed.minutes} minutos de música.` : 'Spotify sigue con tu reproducción.',
      'Cuando quieras, volvemos a mezclar.',
      'Tú mantienes el control.'
    ];
    return `${pickOpener(openers, n, recentOpeners)} ${tails[Math.floor(n / 3) % tails.length]}`
      .split(/\s+/)
      .slice(0, 30)
      .join(' ');
  }

  const greet = greetingForHour(seed?.hour);
  const startOpeners = [
    `${greet} Soy DJ POOR y arrancamos con ${direction}.`,
    `${greet} Arrancamos la mezcla alrededor de ${title}.`,
    `${greet} Tomamos ${title} como punto de partida.`,
    `¡Hola! Soy DJ POOR. Nos guiamos por ${direction}.`,
    `Empezamos la sesión desde ${title}.`,
    `Cabina lista. La referencia de hoy es ${title}.`,
    `Vamos con una sesión guiada por ${direction}.`,
    `Todo listo por aquí: partimos de ${title}.`
  ];
  const dirOpeners = [
    `La dirección ahora es ${direction}.`,
    `Ajustamos el rumbo hacia ${direction}.`,
    `Seguimos con ${direction}.`,
    `Tu rumbo queda claro: ${direction}.`,
    `Cambiamos el enfoque a ${direction}.`,
    `Trabajamos ahora con ${direction}.`,
    `Nueva guía en cabina: ${direction}.`,
    `Recibido: nos movemos con ${direction}.`
  ];
  const blockOpeners = [
    `Seguimos con ${direction}.`,
    `Mantenemos ${direction} como guía.`,
    `El hilo sigue siendo ${direction}.`,
    `Nos quedamos cerca de ${direction}.`,
    `La sesión continúa con ${direction}.`,
    `Conservamos ${direction} como referencia.`,
    `Mantenemos el pulso alrededor de ${direction}.`,
    `Continuamos sobre la línea de ${direction}.`
  ];
  const middles =
    intent?.artistMode === 'only'
      ? ['Dentro de su catálogo.', 'Sin salir del artista elegido.', 'También caben sus colaboraciones.', 'Su música lleva la sesión.']
      : intent?.artistMode === 'mix'
      ? ['El artista lleva el protagonismo.', 'Con música afín entre medias.', 'Sus canciones son la base.', 'Mezclamos su catálogo con afinidad.']
      : intent?.known
      ? ['Solo entre tu música conocida.', 'Desde tus fuentes personales.', 'Tu biblioteca marca el paso.', 'Sin salir de lo que ya conoces.']
      : ['Con espacio para descubrir.', 'Combinando tus favoritas y radio afín.', 'La afinidad guía cada propuesta.', 'Mezcla viva a tu medida.'];
  const endings =
    event === 'direction'
      ? ['Tus instrucciones quedan aplicadas.', 'Puedes ajustar el rumbo cuando quieras.', 'Tú conservas el control.']
      : ['Tú decides la próxima dirección.', 'Tu elección tiene prioridad.', 'El rumbo lo marcas tú.'];

  const openers = event === 'start' ? startOpeners : event === 'direction' ? dirOpeners : blockOpeners;
  const o = pickOpener(openers, n, recentOpeners);
  const m = middles[Math.floor(n / 5) % middles.length];
  const e = endings[Math.floor(n / 20) % endings.length];
  return `${o} ${m} ${e}`.split(/\s+/).slice(0, 30).join(' ');
}

class NeuralVoice {
  constructor(base = 'http://127.0.0.1:47811', { fetch: fetchImpl, Audio: AudioCtor, onStatus } = {}) {
    this.base = String(base || 'http://127.0.0.1:47811').replace(/\/+$/, '');
    this.fetch = fetchImpl || (typeof fetch === 'function' ? fetch.bind(globalThis) : null);
    this.Audio = AudioCtor || (typeof Audio === 'function' ? Audio : null);
    this.onStatus = onStatus || (() => {});
    this.ok = false;
    this.voices = [];
    this.defaultVoice = '';
    this.lastCheck = 0;
    this.checking = null;
    this.audio = null;
    this.loadingAudio = null;
    this.pendingResolve = null;
    this.watchdog = null;
    this.disposed = false;
  }

  async health(force = false) {
    if (this.disposed || !this.fetch) return { ok: false, voices: [], default: '' };
    const ttl = this.ok ? 300000 : 60000;
    if (!force && this.lastCheck && Date.now() - this.lastCheck < ttl) {
      return { ok: this.ok, voices: this.voices, default: this.defaultVoice };
    }
    if (this.checking) return this.checking;
    this.checking = (async () => {
      const prevOk = this.ok;
      const prevSig = JSON.stringify(this.voices);
      const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
      const timer = ctrl ? setTimeout(() => ctrl.abort(), 3000) : null;
      try {
        const res = await this.fetch(`${this.base}/health`, ctrl ? { signal: ctrl.signal } : {});
        if (!res || !res.ok) throw Error('health failed');
        const data = await res.json();
        this.ok = !!data?.ok && Array.isArray(data.voices) && data.voices.length > 0;
        this.voices = this.ok ? data.voices : [];
        this.defaultVoice = this.ok ? String(data.default || this.voices[0]?.id || '') : '';
        this.lastError = '';
      } catch (err) {
        this.ok = false;
        this.voices = [];
        this.defaultVoice = '';
        this.lastError = String(err?.message || err || 'unknown');
      } finally {
        if (timer) clearTimeout(timer);
        this.lastCheck = Date.now();
        this.checking = null;
        if (!this.disposed && (prevOk !== this.ok || prevSig !== JSON.stringify(this.voices))) {
          this.onStatus();
        }
      }
      return { ok: this.ok, voices: this.voices, default: this.defaultVoice };
    })();
    return this.checking;
  }

  url(text, voice = '', speed = 1.0) {
    const clean = String(text || '')
      .replace(/[\x00-\x1f\x7f]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 600);
    const vid = String(voice || this.defaultVoice || '').replace(/^neural:/, '');
    const spd = Math.max(0.7, Math.min(1.4, Number(speed) || 1.0)).toFixed(2);
    return `${this.base}/tts?text=${encodeURIComponent(clean)}&voice=${encodeURIComponent(vid)}&speed=${spd}`;
  }

  async prefetch(text, voice = '', speed = 1.0) {
    if (this.disposed || !this.ok || !this.fetch || !text) return false;
    try {
      const res = await this.fetch(this.url(text, voice, speed));
      return !!res?.ok;
    } catch (_) {
      return false;
    }
  }

  load(text, voice = '', speed = 1.0, timeoutMs = 12000) {
    if (this.disposed || !this.Audio || !text) return Promise.resolve({ ok: false });
    this.cancelLoading();
    const audio = new this.Audio(this.url(text, voice, speed));
    audio.preload = 'auto';
    this.loadingAudio = audio;
    return new Promise(resolve => {
      let settled = false;
      const done = result => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        audio.removeEventListener?.('canplaythrough', onReady);
        audio.removeEventListener?.('error', onErr);
        if (this.loadingAudio === audio) this.loadingAudio = null;
        if (!result.ok) {
          try {
            audio.pause?.();
            audio.src = '';
          } catch (_) {}
        }
        resolve(result);
      };
      const onReady = () => done({ ok: true, audio });
      const onErr = () => done({ ok: false });
      const timer = setTimeout(() => done({ ok: false }), timeoutMs);
      this._cancelLoadHook = () => done({ ok: false, cancelled: true });
      audio.addEventListener?.('canplaythrough', onReady, { once: true });
      audio.addEventListener?.('error', onErr, { once: true });
      try {
        audio.load?.();
      } catch (_) {}
    });
  }

  playLoaded(audio, volume = 0.9) {
    if (this.disposed || !audio) return Promise.resolve({ spoken: false });
    this.cancelPlayback();
    this.audio = audio;
    try {
      audio.volume = Math.max(0, Math.min(1, Number(volume) ?? 0.9));
    } catch (_) {}
    return new Promise(resolve => {
      const finish = result => {
        if (this.pendingResolve !== finish) return;
        clearTimeout(this.watchdog);
        this.watchdog = null;
        this.pendingResolve = null;
        audio.removeEventListener?.('ended', onEnd);
        audio.removeEventListener?.('error', onErr);
        try {
          audio.pause?.();
          audio.src = '';
        } catch (_) {}
        if (this.audio === audio) this.audio = null;
        resolve(result);
      };
      const onEnd = () => finish({ spoken: true });
      const onErr = () => finish({ spoken: false });
      this.pendingResolve = finish;
      this.watchdog = setTimeout(() => finish({ spoken: false }), 30000);
      audio.addEventListener?.('ended', onEnd, { once: true });
      audio.addEventListener?.('error', onErr, { once: true });
      try {
        const p = audio.play?.();
        if (p?.catch) p.catch(() => finish({ spoken: false }));
      } catch (_) {
        finish({ spoken: false });
      }
    });
  }

  async play(text, voice = '', volume = 0.9, speed = 1.0) {
    const loaded = await this.load(text, voice, speed);
    if (!loaded.ok) return { spoken: false, ...(loaded.cancelled ? { cancelled: true } : {}) };
    return this.playLoaded(loaded.audio, volume);
  }

  cancelLoading() {
    this._cancelLoadHook?.();
    this._cancelLoadHook = null;
    if (this.loadingAudio) {
      try {
        this.loadingAudio.pause?.();
        this.loadingAudio.src = '';
      } catch (_) {}
      this.loadingAudio = null;
    }
  }

  cancelPlayback() {
    this.pendingResolve?.({ cancelled: true });
    if (this.audio) {
      try {
        this.audio.pause?.();
        this.audio.src = '';
      } catch (_) {}
      this.audio = null;
    }
  }

  cancel() {
    this.cancelLoading();
    this.cancelPlayback();
  }

  dispose() {
    this.disposed = true;
    this.cancel();
  }
}

class Narrator {
  constructor(host, changed = () => {}, opts = {}) {
    this.host = host;
    this.changed = changed;
    this.enabled = true;
    this.voice = null;
    this.preferred = '';
    this.text = '';
    this.sequence = Math.floor(Math.random() * 10000);
    this.recent = [];
    this.recentOpeners = [];
    this.prepared = null;
    this.speed = 1.0;
    this.volume = 0.9;
    this.disposed = false;
    this.speaking = false;
    this.neural =
      opts.neural ||
      new NeuralVoice(opts.serverUrl, {
        fetch: host.Audio && typeof fetch === 'function' ? fetch.bind(globalThis) : opts.fetch || null,
        Audio: host.Audio || null,
        onStatus: () => {
          this.detect(true);
          this.changed();
        }
      });
    this.onVoices = () => this.detect();
    host.speechSynthesis?.addEventListener?.('voiceschanged', this.onVoices);
    this.detect();
    if (this.neural.Audio) {
      this.neural.health().catch(() => {});
    }
  }

  // Neural local voices first, then Spanish system voices ranked by quality.
  voices() {
    const neuralList = this.neural.ok
      ? this.neural.voices.map(v => ({
          name: 'neural:' + v.id,
          id: v.id,
          label: `${v.label} · neural local`,
          lang: v.lang || 'es',
          localService: true,
          neural: true
        }))
      : [];
    let all = [];
    try {
      all = this.host.speechSynthesis?.getVoices?.() || [];
    } catch (_) {}
    const score = v =>
      (/natural|neural/i.test(v.name) ? 4 : 0) +
      (/^es-MX$/i.test(v.lang) ? 3 : /^es-(US|419)$/i.test(v.lang) ? 2 : /^es-ES$/i.test(v.lang) ? 1 : 0) +
      (/sabina|dalia|paloma|livia/i.test(v.name) ? 1 : 0);
    const sys = all.filter(v => /^es(?:-|$)/i.test(v.lang)).sort((a, b) => score(b) - score(a));
    return [...neuralList, ...sys];
  }

  systemFallbackVoice() {
    let all = [];
    try {
      all = this.host.speechSynthesis?.getVoices?.() || [];
    } catch (_) {}
    const score = v =>
      (/natural|neural/i.test(v.name) ? 4 : 0) +
      (/^es-MX$/i.test(v.lang) ? 3 : /^es-(US|419)$/i.test(v.lang) ? 2 : /^es-ES$/i.test(v.lang) ? 1 : 0) +
      (/sabina|dalia|paloma|livia/i.test(v.name) ? 1 : 0);
    return all
      .filter(v => /^es(?:-|$)/i.test(v.lang) && v.localService === true)
      .sort((a, b) => score(b) - score(a))[0] || null;
  }

  detect(force) {
    if (this.disposed) return;
    if (this.voice && !force) {
      if (!this.voice.neural && this.neural.ok && !this.preferred) {
        // Upgrade automatic choice when neural server comes online.
      } else {
        return;
      }
    }
    const all = this.voices();
    const chosen =
      (this.preferred && all.find(v => v.name === this.preferred)) ||
      (this.neural.ok
        ? all.find(v => v.neural && v.id === this.neural.defaultVoice) || all.find(v => v.neural)
        : null) ||
      all.find(v => !v.neural && v.localService === true) ||
      null;
    this.voice = chosen;
    this.changed();
  }

  prefer(name) {
    this.preferred = name || '';
    this.detect(true);
  }

  canSpeak(local = true) {
    if (this.disposed || !this.enabled || !this.voice || !local) return false;
    if (this.voice.neural) return this.neural.ok;
    return !!this.host.SpeechSynthesisUtterance;
  }

  buildText(event, seed, intent) {
    if (event === 'next' && seed?.uri && this.prepared?.uri === seed.uri && this.prepared?.text) {
      const reused = this.prepared.text;
      this.prepared = null;
      return reused;
    }
    let text = '';
    for (let tries = 0; tries < 20; tries++) {
      text = commentary(event, seed, intent, this.sequence++, this.recentOpeners);
      if (!this.recent.includes(text)) break;
    }
    return text;
  }

  commitCaption(text) {
    this.text = text;
    this.textAt = Date.now();
    this.recent.push(text);
    this.recent = this.recent.slice(-20);
    this.changed();
    return text;
  }

  prepare(event, seed, intent) {
    if (this.disposed || !seed?.uri) return null;
    const text = commentary(event, seed, intent, this.sequence++, this.recentOpeners);
    this.prepared = { uri: seed.uri, event, text };
    if (this.enabled && this.voice?.neural && this.neural.ok) {
      this.neural.prefetch(speakable(text), this.voice.id, this.speed);
    }
    return text;
  }

  say(event, seed, intent, local = true, preloadedAudio = null, prebuiltText = null) {
    if (this.disposed) return Promise.resolve({ cancelled: true });
    if (!prebuiltText) {
      this.cancel();
    }
    const text = prebuiltText || this.buildText(event, seed, intent);
    if (!prebuiltText) this.commitCaption(text);
    if (!this.canSpeak(local)) return Promise.resolve({ spoken: false });

    const spokenText = speakable(text);
    if (this.voice.neural) {
      this.speaking = true;
      this.changed();
      const job = preloadedAudio
        ? this.neural.playLoaded(preloadedAudio, this.volume)
        : this.neural.play(spokenText, this.voice.id, this.volume, this.speed);
      return job.then(res => {
        this.speaking = false;
        this.changed();
        if (res.spoken || res.cancelled || this.disposed) return res;
        this.neural.health(true).catch(() => {});
        const sysVoice = this.systemFallbackVoice();
        if (!sysVoice || !this.host.SpeechSynthesisUtterance) return { spoken: false };
        return this.speakSystem(spokenText, sysVoice);
      });
    }

    return this.speakSystem(spokenText, this.voice);
  }

  speakSystem(spokenText, voice) {
    if (!voice || !this.host.SpeechSynthesisUtterance || !this.host.speechSynthesis) {
      return Promise.resolve({ spoken: false });
    }
    const utterance = new this.host.SpeechSynthesisUtterance(spokenText);
    utterance.voice = voice;
    utterance.lang = voice.lang;
    utterance.rate = this.rate || this.speed || 0.96;
    utterance.pitch = 1.02;
    utterance.volume = Math.max(0, Math.min(1, this.volume ?? 1));
    return new Promise(resolve => {
      const finish = result => {
        if (this.finish !== finish) return;
        clearTimeout(this.watchdog);
        this.finish = null;
        this.speaking = false;
        this.changed();
        resolve(result);
      };
      this.finish = finish;
      this.speaking = true;
      this.changed();
      utterance.onend = () => finish({ spoken: true });
      utterance.onerror = () => {
        if (this.voice === voice) this.voice = null;
        finish({ spoken: false });
      };
      this.watchdog = setTimeout(() => {
        if (this.voice === voice) this.voice = null;
        finish({ spoken: false });
        try {
          this.host.speechSynthesis.cancel();
        } catch (_) {}
      }, 20000);
      try {
        this.host.speechSynthesis.speak(utterance);
      } catch (_) {
        if (this.voice === voice) this.voice = null;
        finish({ spoken: false });
      }
    });
  }

  cancel() {
    this.neural.cancel();
    this.finish?.({ cancelled: true });
    try {
      this.host.speechSynthesis?.cancel?.();
    } catch (_) {}
  }

  toggle() {
    this.enabled = !this.enabled;
    if (!this.enabled) {
      this.neural.cancel();
      this.finish?.({ spoken: false });
      try {
        this.host.speechSynthesis?.cancel?.();
      } catch (_) {}
    }
    this.changed();
    return this.enabled;
  }

  dispose() {
    this.disposed = true;
    this.cancel();
    this.neural.dispose();
    this.host.speechSynthesis?.removeEventListener?.('voiceschanged', this.onVoices);
  }
}

// A narration owns only its own pause or duck lease. User playback, devices and stop revoke it.
class VoiceGate {
  constructor(narrator, music) {
    this.narrator = narrator;
    this.music = music;
    this.lease = null;
  }

  cancel(restore = true) {
    const old = this.lease;
    this.lease = null;
    this.narrator.cancel();
    if (restore && old?.ramped && old?.ducking && this.music.setVolume && this.music.getVolume) {
      try {
        const cur = this.music.getVolume();
        if (Math.abs(cur - old.lastSetVolume) <= 0.08) {
          this.music.setVolume(old.origVolume);
        }
      } catch (_) {}
      this.music.saveRecovery?.(null);
    }
  }

  playbackChanged() {
    if (this.lease?.expectedPause && !this.music.playing()) {
      this.lease.expectedPause = false;
      return;
    }
    if (this.lease?.ducking) return;
    this.cancel();
  }

  async _rampVolume(lease, from, to, ms, steps) {
    const stepMs = Math.max(10, Math.round(ms / steps));
    let expected = from;
    for (let i = 1; i <= steps; i++) {
      await new Promise(r => setTimeout(r, stepMs));
      if (this.lease !== lease) return false;
      const cur = this.music.getVolume();
      if (Math.abs(cur - expected) > 0.08) return false;
      const next = i === steps ? to : from + ((to - from) * i) / steps;
      lease.lastSetVolume = next;
      expected = next;
      this.music.setVolume(next);
    }
    return true;
  }

  async run(event, seed, intent, { resume = true, local = true } = {}) {
    const inherited = this.lease;
    const mode = this.music.mode ? this.music.mode() : 'pause';
    const canDuck = mode === 'duck' && typeof this.music.getVolume === 'function' && typeof this.music.setVolume === 'function';
    const inheritDuck = !!(canDuck && inherited?.ducking && inherited?.ramped);
    this.cancel(!inheritDuck);

    const text = this.narrator.buildText(event, seed, intent);
    this.narrator.commitCaption(text);

    if (!this.narrator.canSpeak(local)) {
      if (inheritDuck) {
        try {
          this.music.setVolume(inherited.origVolume);
        } catch (_) {}
        this.music.saveRecovery?.(null);
      }
      return { spoken: false };
    }

    if (!canDuck && (!this.music.pause || !this.music.resume)) {
      return { spoken: false };
    }

    const playing = this.music.playing();
    const uri = this.music.uri();
    const device = this.music.device();
    const trueOrig = inheritDuck ? inherited.origVolume : canDuck ? this.music.getVolume() : 1;
    const lease = {
      uri,
      device,
      wasPlaying: playing || !!(inherited?.wasPlaying && inherited.uri === uri && inherited.device === device),
      expectedPause: !canDuck && playing,
      ducking: canDuck,
      ramped: inheritDuck,
      origVolume: trueOrig,
      lastSetVolume: canDuck ? this.music.getVolume() : 1
    };
    this.lease = lease;

    let preloadedAudio = null;
    if (this.narrator.voice?.neural) {
      const loaded = await this.narrator.neural.load(speakable(text), this.narrator.voice.id, this.narrator.speed, 12000);
      if (this.lease !== lease) {
        if (loaded.audio) {
          try {
            loaded.audio.pause?.();
            loaded.audio.src = '';
          } catch (_) {}
        }
        return { cancelled: true };
      }
      if (!loaded.ok) {
        this.narrator.neural.health(true).catch(() => {});
        const sys = this.narrator.systemFallbackVoice();
        if (!sys || !this.narrator.host.SpeechSynthesisUtterance) {
          this.lease = null;
          return { spoken: false };
        }
        // Fallback to system voice for this utterance.
        return this._runWithVoice(lease, text, null, { resume, local, canDuck, sysFallback: sys });
      }
      preloadedAudio = loaded.audio;
    }

    return this._runWithVoice(lease, text, preloadedAudio, { resume, local, canDuck });
  }

  async _runWithVoice(lease, text, preloadedAudio, { resume, local, canDuck, sysFallback = null }) {
    try {
      if (canDuck) {
        const orig = lease.origVolume;
        const startVol = this.music.getVolume();
        lease.lastSetVolume = startVol;
        lease.ramped = true;
        const duckPct = clamp(this.music.duckLevel ? this.music.duckLevel() : 30, 10, 80);
        const ducked = Math.max(0.02, orig * (duckPct / 100));
        this.music.saveRecovery?.({ volume: orig, device: lease.device });
        await this._rampVolume(lease, startVol, ducked, 350, 8);
        if (this.lease !== lease) return { cancelled: true };

        const result = sysFallback
          ? await this.narrator.speakSystem(speakable(text), sysFallback)
          : await this.narrator.say('', null, null, local, preloadedAudio, text);

        if (this.lease !== lease || result.cancelled) {
          if (this.lease === lease) this.lease = null;
          return { cancelled: true };
        }
        const cur = this.music.getVolume();
        if (Math.abs(cur - lease.lastSetVolume) <= 0.08) {
          await this._rampVolume(lease, cur, orig, 700, 12);
        }
        this.music.saveRecovery?.(null);
        if (this.lease === lease) this.lease = null;
        return result;
      }

      if (lease.wasPlaying && this.music.playing()) await this.music.pause();
      if (this.lease !== lease) return { cancelled: true };
      const result = sysFallback
        ? await this.narrator.speakSystem(speakable(text), sysFallback)
        : await this.narrator.say('', null, null, local, preloadedAudio, text);
      if (
        this.lease !== lease ||
        result.cancelled ||
        this.music.uri() !== lease.uri ||
        this.music.device() !== lease.device
      ) {
        if (this.lease === lease) this.lease = null;
        return { cancelled: true };
      }
      this.lease = null;
      if (
        resume &&
        lease.wasPlaying &&
        this.music.uri() === lease.uri &&
        this.music.device() === lease.device &&
        !this.music.playing()
      ) {
        await this.music.resume();
      }
      return result;
    } catch (_) {
      if (this.lease === lease) {
        this.lease = null;
        if (canDuck) {
          try {
            const cur = this.music.getVolume();
            if (Math.abs(cur - lease.lastSetVolume) <= 0.03) this.music.setVolume(lease.origVolume);
          } catch (_) {}
          this.music.saveRecovery?.(null);
        } else if (
          lease.wasPlaying &&
          resume &&
          this.music.uri() === lease.uri &&
          this.music.device() === lease.device
        ) {
          await this.music.resume();
        }
      }
      return { spoken: false };
    }
  }
}

// Membership is checked against the seed and its explicitly related artists,
// unless a group is marked trusted (e.g., Spotify radio recommendations).
function affinityPool(seed, related, groups, intent = intentOf(), tags = {}) {
  const seedKeys = new Set((seed?.artists || []).map(artistKey));
  const allowed = new Set([...seedKeys, ...related]);
  const result = new Map();

  for (const { tracks, source, familiar = false, trusted = false } of groups) {
    for (const raw of tracks || []) {
      const t = normalize(raw, source);
      if (!t || !t.name) continue;
      const styles = [...new Set([...(t.styles || []), ...(tags[t.uri] || [])].map(words))];
      const styleMatch = intent.styles.length && intent.styles.every(tag => styles.includes(words(tag)));
      if (!trusted && !t.artists.some(a => allowed.has(artistKey(a))) && !styleMatch) continue;
      const existing = result.get(t.uri);
      const same = t.artists.some(a => seedKeys.has(artistKey(a)));
      const evidence = [...new Set([...(raw.evidence || []), ...(existing?.evidence || []), ...(raw.playlist ? ['playlist'] : [])])];
      const radioRank = Number.isFinite(raw.radioRank) ? raw.radioRank : existing?.radioRank;
      const resolvedSource = familiar
        ? source
        : source === 'radio'
        ? 'radio'
        : same
        ? 'artista actual'
        : 'artista relacionado';
      result.set(t.uri, {
        ...t,
        styles,
        source: existing?.familiar ? existing.source : resolvedSource,
        affinity: true,
        evidence,
        familiar: familiar || !!existing?.familiar,
        ...(Number.isFinite(radioRank) ? { radioRank } : {})
      });
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

// Letras sincronizadas: análisis, búsqueda de la línea activa y proveedor con caché.
// Fuente principal: letras que el propio cliente de Spotify ya ofrece a la sesión.
// LRCLIB solo se consulta si el usuario activa «Buscar letras fuera de Spotify».
const INSTRUMENTAL=/^[\s♪♫•·.\-–—_]*$/;
function parseLrc(text){
  const lines=[];
  for(const raw of String(text||'').split(/\r?\n/)){
    const stamps=[...raw.matchAll(/\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g)];
    if(!stamps.length)continue;
    const words=raw.replace(/\[[^\]]*\]/g,'').trim();
    for(const m of stamps)lines.push({t:(Number(m[1])*60+Number(m[2]))*1000+(m[3]?Math.round(Number('0.'+m[3])*1000):0),text:words});
  }
  return lines.sort((a,b)=>a.t-b.t);
}
function plainLines(text){return String(text||'').split(/\r?\n/).map(s=>s.trim()).filter((s,i,a)=>s || (a[i-1] && a[i+1])).map(text=>({t:null,text}));}
function lyricsFromSpotify(json){
  const l=json?.lyrics;if(!l || !Array.isArray(l.lines))return null;
  const synced=String(l.syncType||'').toUpperCase()!=='UNSYNCED';
  const lines=l.lines.map(x=>({t:synced?Number(x.startTimeMs):null,text:String(x.words??'').trim()})).filter(x=>!synced || Number.isFinite(x.t));
  if(!lines.some(x=>x.text && !INSTRUMENTAL.test(x.text)))return null;
  return {synced,lines:synced?lines.sort((a,b)=>a.t-b.t):lines,source:'Spotify',language:l.language||'',provider:l.providerDisplayName||l.provider||''};
}
function lyricsFromLrclib(json){
  if(!json || json.instrumental)return null;
  const synced=parseLrc(json.syncedLyrics);
  if(synced.some(x=>x.text))return {synced:true,lines:synced,source:'LRCLIB',language:'',provider:'LRCLIB'};
  const plain=plainLines(json.plainLyrics);
  return plain.some(x=>x.text)?{synced:false,lines:plain,source:'LRCLIB',language:'',provider:'LRCLIB'}:null;
}
// Última línea cuyo inicio ya pasó; -1 antes de la primera.
function activeLine(lines,ms){
  let lo=0,hi=lines.length-1,found=-1;
  while(lo<=hi){const mid=(lo+hi)>>1;if(lines[mid].t<=ms){found=mid;lo=mid+1;}else hi=mid-1;}
  return found;
}
const withTimeout=(promise,ms)=>new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(Error('Tiempo de espera agotado')),ms);Promise.resolve(promise).then(v=>{clearTimeout(t);resolve(v);},e=>{clearTimeout(t);reject(e);});});
const isGap=line=>!line?.text || INSTRUMENTAL.test(line.text);
class LyricsProvider{
  constructor({spotify,external,saved={},persist=()=>{},timeout=7000}={}){
    this.timeout=timeout;this.spotify=spotify;this.external=external;this.persist=persist;this.pending=new Map();this.memory=new Map();
    // Solo se guardan resultados negativos para no repetir consultas; el texto no se persiste.
    this.misses=new Map(Object.entries(saved).filter(([,at])=>Date.now()-at<86400000));
  }
  async get(track,{fallback=false}={}){
    if(!track?.uri)return {state:'none'};
    const id=track.uri.split(':').pop(),key=id+(fallback?'+x':'');
    if(this.memory.has(key))return this.memory.get(key);
    if(this.misses.has(key))return {state:'none'};
    if(!this.pending.has(key)){
      const job=this.#load(track,id,fallback).then(result=>{
        this.pending.delete(key);
        if(result.state==='ready'){this.memory.set(key,result);if(this.memory.size>30)this.memory.delete(this.memory.keys().next().value);}
        else if(result.state==='none'){this.misses.set(key,Date.now());this.persist(Object.fromEntries([...this.misses].slice(-200)));}
        return result;
      },error=>{this.pending.delete(key);throw error;});
      this.pending.set(key,job);
    }
    return this.pending.get(key);
  }
  async #load(track,id,fallback){
    let failure;
    if(this.spotify){try{const data=lyricsFromSpotify(await withTimeout(this.spotify(id,track),this.timeout));if(data)return {state:'ready',...data};}catch(e){failure=e;}}
    if(fallback && this.external){try{const data=lyricsFromLrclib(await withTimeout(this.external(track),this.timeout));if(data)return {state:'ready',...data};}catch(e){failure=failure||e;}}
    // 404 de Spotify = no hay letra; cualquier otro fallo se reintenta la próxima vez.
    const status=failure?.status??failure?.code;
    return failure && ![404,'404'].includes(status) && !/404|not found/i.test(failure.message||'')?{state:'error',message:failure.message||'Error'}:{state:'none'};
  }
  clear(){this.memory.clear();this.misses.clear();this.persist({});}
}

// Informe de compatibilidad: qué partes del cliente responden. Puro: recibe resultados ya medidos.
function compatReport({api={},probes={}}){
  const row=(name,ok,detail)=>({name,ok:ok===null?null:!!ok,detail});
  const probe=(key,label)=>probes[key]===undefined?row(label,null,'Sin comprobar'):row(label,probes[key]===true,probes[key]===true?'Responde':'No responde: Spotify pudo cambiar esta consulta');
  const rows=[
    row('Cola de reproducción',api.queue,api.queue?'Disponible':'No disponible: el DJ no puede gestionar la cola'),
    row('Reproducción directa',api.play,api.play?'Disponible':'No disponible'),
    probe('search','Búsqueda de canciones'),probe('artists','Búsqueda de artistas'),
    row('Datos acústicos',api.audio,api.audio?'Disponible':'No disponibles: se mezcla sin tempo ni tono'),
    row('Playlists privadas',api.playlists,api.playlists?'Disponible':'No disponible: no se podrán guardar mezclas'),
    row('Voz en español',api.voice,api.voice?'Disponible':'No disponible: solo subtítulos'),
    row('Letras de Spotify',api.lyrics,api.spicy?'Spicy Lyrics se encarga de las letras':api.lyrics?'Disponible':'No disponible'),
  ];
  return {rows,problems:rows.filter(r=>r.ok===false).length};
}

if (typeof module !== 'undefined' && module.exports) { module.exports = { Engine, normalize, compatibility, settingsOf, AudioLibrary, RequestCache, sameEntry, affinityPool, guardPlay, parseCommand, intentOf, intentLabels, knownEvidence, migrateProfile, ChoiceDeck, Narrator, NeuralVoice, VoiceGate, MusicLibrary, isKnown, collectArtists, hasArtist, mixUris, artistChoice, transitionFit, transitionLabel, NativeTransitions, commentary, speakable, contextKey, words, songKey, songIdentity, queryDefinition, parseLrc, lyricsFromSpotify, lyricsFromLrclib, activeLine, LyricsProvider, isGap, compatReport, moodOf, fadePlan }; return; }
const CSS = "/* POOR DJ 4.0.0 — Full-page glass DJ booth */\n\n.pd-booth,\n.pd-mini,\n.pd-toastdj {\n  --pd-accent: #1ed760;\n  --pd-ink: #050505;\n  --pd-bg: var(--spice-main, #121212);\n  --pd-card: var(--spice-card, #181818);\n  --pd-highlight: var(--spice-highlight, #282828);\n  --pd-text: var(--spice-text, #ffffff);\n  --pd-sub: var(--spice-subtext, #b3b3b3);\n  --pd-tint: #1ed760;\n  --pd-border: rgba(255, 255, 255, 0.08);\n  --pd-glass: color-mix(in srgb, var(--pd-tint) 9%, color-mix(in srgb, var(--pd-card) 82%, transparent));\n  --pd-glass-strong: color-mix(in srgb, var(--pd-tint) 14%, color-mix(in srgb, var(--pd-card) 92%, transparent));\n  color: var(--pd-text);\n  font-family: inherit;\n  box-sizing: border-box;\n}\n\n.pd-booth[data-accent='theme'],\n.pd-mini[data-accent='theme'],\n.pd-toastdj[data-accent='theme'] {\n  --pd-accent: var(--spice-button, #1ed760);\n}\n\n.pd-booth[data-accent='blue'],\n.pd-mini[data-accent='blue'],\n.pd-toastdj[data-accent='blue'] {\n  --pd-accent: #74b9ff;\n}\n\n.pd-booth[data-accent='violet'],\n.pd-mini[data-accent='violet'],\n.pd-toastdj[data-accent='violet'] {\n  --pd-accent: #c4a3ff;\n}\n\n.pd-booth[data-accent='rose'],\n.pd-mini[data-accent='rose'],\n.pd-toastdj[data-accent='rose'] {\n  --pd-accent: #ff9cbd;\n}\n\n.pd-booth *,\n.pd-mini *,\n.pd-toastdj * {\n  box-sizing: border-box;\n}\n\n.pd-booth [hidden],\n.pd-mini[hidden],\n.pd-toastdj[hidden] {\n  display: none !important;\n}\n\n.pd-booth {\n  position: absolute;\n  inset: 0;\n  z-index: 5;\n  overflow-y: auto;\n  overflow-x: hidden;\n  container-type: inline-size;\n  container-name: pd-booth;\n  background: var(--pd-bg);\n  font-size: 14px;\n  line-height: 1.5;\n  scrollbar-width: thin;\n}\n\n.pd-booth button,\n.pd-booth input,\n.pd-booth select {\n  font: inherit;\n}\n\n.pd-booth button {\n  cursor: pointer;\n  color: inherit;\n  transition: background-color 0.18s, border-color 0.18s, color 0.18s, transform 0.15s, opacity 0.18s;\n}\n\n.pd-booth button:disabled {\n  opacity: 0.45;\n  cursor: not-allowed;\n}\n\n.pd-booth button:not(:disabled):active {\n  transform: scale(0.98);\n}\n\n.pd-booth button:focus-visible,\n.pd-booth input:focus-visible,\n.pd-booth select:focus-visible {\n  outline: 2px solid var(--pd-accent);\n  outline-offset: 2px;\n}\n\n/* Ambient cover backdrop */\n.pd-backdrop {\n  position: fixed;\n  inset: 0;\n  pointer-events: none;\n  overflow: hidden;\n  z-index: 0;\n}\n\n.pd-backdrop img {\n  position: absolute;\n  inset: -40px;\n  width: calc(100% + 80px);\n  height: calc(100% + 80px);\n  object-fit: cover;\n  filter: blur(70px) saturate(1.5);\n  opacity: 0.42;\n  transform: scale(1.1);\n  transition: opacity 0.6s ease;\n}\n\n.pd-backdrop::after {\n  content: '';\n  position: absolute;\n  inset: 0;\n  background:\n    radial-gradient(circle at 18% 15%, color-mix(in srgb, var(--pd-tint) 34%, transparent) 0%, transparent 56%),\n    linear-gradient(180deg, color-mix(in srgb, var(--pd-bg) 35%, transparent) 0%, var(--pd-bg) 78%);\n}\n\n.pd-shell {\n  position: relative;\n  z-index: 1;\n  max-width: 1240px;\n  margin: 0 auto;\n  padding: 14px 26px 34px;\n  min-height: 100%;\n  display: flex;\n  flex-direction: column;\n  gap: 16px;\n}\n\n/* Sticky header */\n.pd-header {\n  position: sticky;\n  top: 0;\n  z-index: 10;\n  display: flex;\n  flex-wrap: wrap;\n  align-items: center;\n  justify-content: space-between;\n  gap: 14px;\n  padding: 12px 18px;\n  border-radius: 18px;\n  background: color-mix(in srgb, var(--pd-bg) 72%, transparent);\n  backdrop-filter: blur(22px);\n  border: 1px solid var(--pd-border);\n  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.3);\n}\n\n.pd-brand {\n  display: flex;\n  align-items: center;\n  gap: 12px;\n  min-width: 0;\n}\n\n.pd-brand-mark {\n  width: 36px;\n  height: 36px;\n  border-radius: 11px;\n  display: grid;\n  place-items: center;\n  background: color-mix(in srgb, var(--pd-accent) 18%, var(--pd-card));\n  color: var(--pd-accent);\n  border: 1px solid color-mix(in srgb, var(--pd-accent) 35%, transparent);\n  flex-shrink: 0;\n}\n\n.pd-brand h1 {\n  margin: 0;\n  font-size: 18px;\n  font-weight: 800;\n  letter-spacing: -0.02em;\n  display: flex;\n  align-items: baseline;\n  gap: 8px;\n}\n\n.pd-brand h1 small {\n  font-size: 11px;\n  font-weight: 600;\n  color: var(--pd-sub);\n}\n\n.pd-tagline {\n  display: block;\n  font-size: 11px;\n  color: var(--pd-sub);\n}\n\n.pd-tabs {\n  display: inline-flex;\n  align-items: center;\n  gap: 4px;\n  padding: 4px;\n  border-radius: 999px;\n  background: rgba(255, 255, 255, 0.05);\n  border: 1px solid var(--pd-border);\n}\n\n.pd-tabs button {\n  display: inline-flex;\n  align-items: center;\n  gap: 7px;\n  border: 0;\n  background: none;\n  border-radius: 999px;\n  padding: 7px 16px;\n  font-size: 13px;\n  font-weight: 650;\n  color: var(--pd-sub);\n}\n\n.pd-tabs button:hover {\n  color: var(--pd-text);\n}\n\n.pd-tabs button.pd-selected {\n  background: var(--pd-accent);\n  color: var(--pd-ink);\n}\n\n.pd-header-actions {\n  display: flex;\n  align-items: center;\n  gap: 8px;\n}\n\n.pd-live {\n  display: inline-flex;\n  align-items: center;\n  gap: 8px;\n  padding: 6px 12px;\n  border-radius: 999px;\n  font-size: 12px;\n  font-weight: 600;\n  color: var(--pd-sub);\n  background: rgba(255, 255, 255, 0.05);\n  border: 1px solid var(--pd-border);\n}\n\n.pd-live-dot {\n  width: 8px;\n  height: 8px;\n  border-radius: 50%;\n  background: var(--pd-sub);\n}\n\n.pd-live.pd-active {\n  color: var(--pd-accent);\n  border-color: color-mix(in srgb, var(--pd-accent) 45%, transparent);\n  background: color-mix(in srgb, var(--pd-accent) 14%, transparent);\n}\n\n.pd-live.pd-active .pd-live-dot {\n  background: var(--pd-accent);\n  box-shadow: 0 0 0 0 color-mix(in srgb, var(--pd-accent) 60%, transparent);\n  animation: pd-dot-pulse 1.8s infinite;\n}\n\n.pd-icon-btn {\n  width: 36px;\n  height: 36px;\n  border-radius: 50%;\n  border: 1px solid var(--pd-border);\n  background: rgba(255, 255, 255, 0.05);\n  display: grid;\n  place-items: center;\n  color: var(--pd-text);\n}\n\n.pd-icon-btn:hover {\n  background: rgba(255, 255, 255, 0.12);\n  border-color: rgba(255, 255, 255, 0.22);\n}\n\n.pd-icon-btn[aria-pressed='true'] {\n  color: var(--pd-accent);\n  border-color: color-mix(in srgb, var(--pd-accent) 45%, transparent);\n}\n\n.pd-pill-link {\n  display: inline-flex;\n  align-items: center;\n  gap: 6px;\n  padding: 7px 12px;\n  border-radius: 999px;\n  border: 1px solid var(--pd-border);\n  background: rgba(255, 255, 255, 0.05);\n  font-size: 12px;\n  font-weight: 600;\n}\n\n.pd-pill-link:hover {\n  background: rgba(255, 255, 255, 0.12);\n}\n\n/* Session 2-column layout */\n.pd-session-grid {\n  display: grid;\n  grid-template-columns: minmax(0, 1fr);\n  gap: 24px;\n  align-items: start;\n}\n\n@container pd-booth (min-width: 900px) {\n  .pd-session-grid {\n    grid-template-columns: minmax(320px, 390px) minmax(0, 1fr);\n    gap: 28px;\n  }\n}\n\n.pd-card {\n  background: var(--pd-glass);\n  backdrop-filter: blur(20px);\n  border: 1px solid var(--pd-border);\n  border-radius: 18px;\n  padding: 16px 18px;\n  box-shadow: 0 12px 36px rgba(0, 0, 0, 0.28);\n}\n\n/* Left Column: Deck */\n.pd-deck {\n  display: flex;\n  flex-direction: column;\n  gap: 14px;\n  padding: 20px;\n}\n\n.pd-deck-stage {\n  position: relative;\n  width: 100%;\n  max-width: 340px;\n  margin: 0 auto;\n  padding-right: 44px;\n}\n\n.pd-vinyl {\n  position: absolute;\n  top: 7%;\n  right: 0;\n  width: 86%;\n  aspect-ratio: 1;\n  border-radius: 50%;\n  background:\n    radial-gradient(circle, var(--pd-accent) 0 10%, #1d1d1d 10.5% 17%, #0f0f0f 17.5% 100%),\n    repeating-radial-gradient(circle, rgba(255, 255, 255, 0.1) 0 1.5px, transparent 1.5px 5px);\n  border: 1px solid rgba(255, 255, 255, 0.14);\n  box-shadow: 0 14px 32px rgba(0, 0, 0, 0.65);\n  transition: transform 0.6s cubic-bezier(0.22, 1, 0.36, 1);\n}\n\n.pd-booth[data-playing='true'] .pd-vinyl {\n  animation: pd-spin 7s linear infinite;\n}\n\n.pd-cover-wrap {\n  position: relative;\n  width: 100%;\n  aspect-ratio: 1;\n  border-radius: 16px;\n  overflow: hidden;\n  background: var(--pd-highlight);\n  box-shadow: 0 18px 42px rgba(0, 0, 0, 0.55);\n  display: grid;\n  place-items: center;\n}\n\n.pd-cover-wrap > svg {\n  position: relative;\n  z-index: 0;\n  width: 64px;\n  height: 64px;\n  color: var(--pd-accent);\n  opacity: 0.7;\n}\n\n.pd-cover-wrap img {\n  position: absolute;\n  inset: 0;\n  z-index: 1;\n  width: 100%;\n  height: 100%;\n  object-fit: cover;\n}\n\n/* DJ Mic Overlay */\n.pd-mic-overlay {\n  position: absolute;\n  inset: 0;\n  z-index: 3;\n  display: flex;\n  flex-direction: column;\n  align-items: center;\n  justify-content: center;\n  text-align: center;\n  padding: 20px;\n  gap: 12px;\n  background: radial-gradient(circle, color-mix(in srgb, var(--pd-accent) 26%, rgba(8, 8, 10, 0.88)), rgba(8, 8, 10, 0.94));\n  backdrop-filter: blur(12px);\n  animation: pd-enter 0.25s ease-out;\n}\n\n.pd-rings {\n  position: relative;\n  width: 58px;\n  height: 58px;\n  display: grid;\n  place-items: center;\n  color: var(--pd-accent);\n}\n\n.pd-rings::before,\n.pd-rings::after {\n  content: '';\n  position: absolute;\n  inset: 0;\n  border-radius: 50%;\n  border: 2px solid var(--pd-accent);\n  opacity: 0.5;\n  animation: pd-ring 1.8s ease-out infinite;\n}\n\n.pd-rings::after {\n  animation-delay: 0.9s;\n}\n\n.pd-eq {\n  display: inline-flex;\n  align-items: flex-end;\n  gap: 4px;\n  height: 22px;\n}\n\n.pd-eq i {\n  display: block;\n  width: 4px;\n  height: 8px;\n  border-radius: 4px;\n  background: var(--pd-accent);\n  animation: pd-eq-bar 0.75s ease-in-out infinite alternate;\n}\n\n.pd-eq i:nth-child(2) {\n  animation-delay: -0.25s;\n}\n\n.pd-eq i:nth-child(3) {\n  animation-delay: -0.5s;\n}\n\n.pd-eq i:nth-child(4) {\n  animation-delay: -0.15s;\n}\n\n.pd-mic-label {\n  font-size: 11px;\n  font-weight: 800;\n  letter-spacing: 0.12em;\n  text-transform: uppercase;\n  color: var(--pd-accent);\n}\n\n.pd-mic-caption {\n  margin: 0;\n  font-size: 15px;\n  font-weight: 600;\n  line-height: 1.4;\n  color: #ffffff;\n}\n\n.pd-track-meta {\n  min-width: 0;\n  display: flex;\n  flex-direction: column;\n  gap: 4px;\n}\n\n.pd-track-meta h2 {\n  margin: 0;\n  font-size: 26px;\n  font-weight: 800;\n  letter-spacing: -0.03em;\n  line-height: 1.15;\n  overflow-wrap: anywhere;\n}\n\n.pd-track-artist {\n  margin: 0;\n  font-size: 15px;\n  color: var(--pd-sub);\n  font-weight: 500;\n}\n\n.pd-why-chip {\n  align-self: flex-start;\n  display: inline-flex;\n  align-items: center;\n  gap: 6px;\n  margin-top: 6px;\n  padding: 5px 11px;\n  border-radius: 999px;\n  font-size: 11px;\n  font-weight: 650;\n  color: var(--pd-accent);\n  background: color-mix(in srgb, var(--pd-accent) 14%, transparent);\n  border: 1px solid color-mix(in srgb, var(--pd-accent) 32%, transparent);\n}\n\n/* Transport */\n.pd-transport {\n  display: flex;\n  flex-direction: column;\n  gap: 10px;\n}\n\n.pd-progress-row {\n  display: flex;\n  align-items: center;\n  gap: 10px;\n  font-size: 11px;\n  font-variant-numeric: tabular-nums;\n  color: var(--pd-sub);\n}\n\n.pd-progress {\n  flex: 1;\n  height: 18px;\n  display: flex;\n  align-items: center;\n  cursor: pointer;\n}\n\n.pd-progress::before {\n  content: '';\n  display: block;\n  width: 100%;\n  height: 5px;\n  border-radius: 999px;\n  background: linear-gradient(\n    90deg,\n    var(--pd-accent) calc(var(--p, 0) * 100%),\n    rgba(255, 255, 255, 0.16) 0\n  );\n  transition: height 0.15s;\n}\n\n.pd-progress:hover::before {\n  height: 7px;\n}\n\n.pd-controls {\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  gap: 16px;\n}\n\n.pd-controls button {\n  border: 0;\n  background: rgba(255, 255, 255, 0.06);\n  width: 40px;\n  height: 40px;\n  border-radius: 50%;\n  display: grid;\n  place-items: center;\n}\n\n.pd-controls button:hover {\n  background: rgba(255, 255, 255, 0.14);\n}\n\n.pd-controls .pd-playbtn {\n  width: 52px;\n  height: 52px;\n  background: var(--pd-text);\n  color: var(--pd-bg);\n}\n\n.pd-controls .pd-playbtn:hover {\n  background: var(--pd-text);\n  transform: scale(1.05);\n}\n\n/* Feedback row */\n.pd-feedback {\n  display: grid;\n  grid-template-columns: repeat(2, minmax(0, 1fr));\n  gap: 8px;\n  padding-top: 12px;\n  border-top: 1px solid var(--pd-border);\n}\n\n.pd-feedback button {\n  display: inline-flex;\n  align-items: center;\n  justify-content: center;\n  gap: 6px;\n  padding: 9px 10px;\n  border-radius: 12px;\n  border: 1px solid var(--pd-border);\n  background: rgba(255, 255, 255, 0.04);\n  font-size: 12px;\n  font-weight: 600;\n}\n\n.pd-feedback button:hover:not(:disabled) {\n  background: rgba(255, 255, 255, 0.11);\n  border-color: rgba(255, 255, 255, 0.22);\n}\n\n.pd-feedback button[data-feedback='more']:hover:not(:disabled) {\n  color: var(--pd-accent);\n  border-color: color-mix(in srgb, var(--pd-accent) 45%, transparent);\n}\n\n/* Right column */\n.pd-main-col {\n  display: flex;\n  flex-direction: column;\n  gap: 13px;\n  min-width: 0;\n}\n\n.pd-hero {\n  display: flex;\n  flex-direction: column;\n  gap: 16px;\n}\n\n.pd-hero-head h2 {\n  margin: 0;\n  font-size: 22px;\n  font-weight: 800;\n  letter-spacing: -0.02em;\n}\n\n.pd-hero-head p {\n  margin: 4px 0 0;\n  font-size: 13px;\n  color: var(--pd-sub);\n}\n\n.pd-vibes {\n  display: grid;\n  grid-template-columns: repeat(3, minmax(0, 1fr));\n  gap: 10px;\n}\n\n@container pd-booth (max-width: 560px) {\n  .pd-vibes {\n    grid-template-columns: 1fr;\n  }\n}\n\n.pd-vibe-card {\n  display: flex;\n  flex-direction: column;\n  align-items: flex-start;\n  gap: 6px;\n  padding: 14px;\n  text-align: left;\n  border-radius: 16px;\n  border: 1px solid var(--pd-border);\n  background: rgba(255, 255, 255, 0.04);\n}\n\n.pd-vibe-card:hover {\n  background: rgba(255, 255, 255, 0.09);\n  border-color: rgba(255, 255, 255, 0.2);\n}\n\n.pd-vibe-card.pd-selected {\n  background: color-mix(in srgb, var(--pd-accent) 18%, var(--pd-card));\n  border-color: var(--pd-accent);\n  box-shadow: 0 6px 20px color-mix(in srgb, var(--pd-accent) 18%, transparent);\n}\n\n.pd-vibe-card svg {\n  color: var(--pd-accent);\n}\n\n.pd-vibe-card b {\n  font-size: 14px;\n  font-weight: 750;\n}\n\n.pd-vibe-card small {\n  font-size: 11px;\n  color: var(--pd-sub);\n  line-height: 1.35;\n}\n\n.pd-primary {\n  display: inline-flex;\n  align-items: center;\n  justify-content: center;\n  gap: 8px;\n  width: 100%;\n  border: 0;\n  border-radius: 999px;\n  padding: 14px 20px;\n  font-size: 15px;\n  font-weight: 800;\n  background: var(--pd-accent);\n  color: var(--pd-ink);\n  box-shadow: 0 8px 24px color-mix(in srgb, var(--pd-accent) 28%, transparent);\n}\n\n.pd-primary:hover:not(:disabled) {\n  filter: brightness(1.07);\n}\n\n.pd-primary.pd-stop {\n  background: rgba(255, 92, 92, 0.14);\n  color: #ffb4ad;\n  border: 1px solid rgba(255, 92, 92, 0.38);\n  box-shadow: none;\n}\n\n.pd-primary.pd-stop:hover:not(:disabled) {\n  background: rgba(255, 92, 92, 0.24);\n}\n\n.pd-hero-links {\n  display: flex;\n  flex-wrap: wrap;\n  gap: 10px;\n}\n\n.pd-secondary {\n  display: inline-flex;\n  align-items: center;\n  justify-content: center;\n  gap: 7px;\n  padding: 10px 16px;\n  border-radius: 999px;\n  border: 1px solid var(--pd-border);\n  background: rgba(255, 255, 255, 0.05);\n  font-size: 13px;\n  font-weight: 600;\n}\n\n.pd-secondary:hover:not(:disabled) {\n  background: rgba(255, 255, 255, 0.12);\n  border-color: rgba(255, 255, 255, 0.22);\n}\n\n.pd-hero-links .pd-secondary {\n  flex: 1;\n  min-width: 170px;\n}\n\n/* Status banner */\n.pd-status {\n  margin: 0;\n  padding: 10px 14px;\n  border-radius: 12px;\n  font-size: 12px;\n  color: var(--pd-sub);\n  background: rgba(255, 255, 255, 0.04);\n  border: 1px solid var(--pd-border);\n}\n\n.pd-status.pd-error {\n  color: #ffb4ad;\n  border-color: rgba(255, 100, 100, 0.4);\n  background: rgba(255, 70, 70, 0.12);\n}\n\n/* Picker */\n.pd-picker {\n  display: flex;\n  flex-direction: column;\n  gap: 12px;\n  animation: pd-enter 0.2s ease-out;\n}\n\n.pd-picker h3,\n.pd-section-head h3 {\n  margin: 0;\n  font-size: 16px;\n  font-weight: 750;\n}\n\n.pd-picker > p {\n  margin: 0;\n  font-size: 12px;\n  color: var(--pd-sub);\n}\n\n.pd-cards {\n  display: grid;\n  grid-template-columns: repeat(2, minmax(0, 1fr));\n  gap: 12px;\n}\n\n@container pd-booth (max-width: 480px) {\n  .pd-cards {\n    grid-template-columns: 1fr;\n  }\n}\n\n.pd-choice {\n  display: flex;\n  flex-direction: column;\n  gap: 6px;\n  min-width: 0;\n  text-align: left;\n  border: 1px solid var(--pd-border);\n  border-radius: 16px;\n  padding: 12px;\n  background: rgba(255, 255, 255, 0.04);\n}\n\n.pd-choice:hover:not(:disabled) {\n  background: rgba(255, 255, 255, 0.09);\n  border-color: rgba(255, 255, 255, 0.22);\n}\n\n.pd-choice b {\n  font-size: 13px;\n  font-weight: 700;\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n\n.pd-choice small {\n  font-size: 11px;\n  color: var(--pd-sub);\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n\n.pd-choice .pd-evidence {\n  color: var(--pd-accent);\n  font-weight: 600;\n}\n\n.pd-choicecover {\n  position: relative;\n  display: grid;\n  place-items: center;\n  width: 100%;\n  aspect-ratio: 1;\n  max-height: 140px;\n  border-radius: 10px;\n  overflow: hidden;\n  background: var(--pd-highlight);\n}\n\n.pd-choicecover > img {\n  width: 100%;\n  height: 100%;\n  object-fit: cover;\n}\n\n.pd-choiceplay {\n  position: absolute;\n  bottom: 8px;\n  right: 8px;\n  width: 34px;\n  height: 34px;\n  display: grid;\n  place-items: center;\n  border-radius: 50%;\n  background: var(--pd-accent);\n  color: var(--pd-ink);\n  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.45);\n}\n\n.pd-pickeractions {\n  display: flex;\n  flex-wrap: wrap;\n  gap: 8px;\n}\n\n/* Search & Command */\n.pd-command {\n  display: flex;\n  flex-direction: column;\n  gap: 10px;\n}\n\n.pd-command label {\n  font-size: 13px;\n  font-weight: 700;\n  color: var(--pd-text);\n}\n\n.pd-input-row {\n  display: flex;\n  gap: 8px;\n}\n\n.pd-booth input[type='text'],\n.pd-booth input:not([type]) {\n  flex: 1;\n  min-width: 0;\n  background: rgba(0, 0, 0, 0.32);\n  color: var(--pd-text);\n  border: 1px solid var(--pd-border);\n  border-radius: 12px;\n  padding: 10px 14px;\n  font-size: 13px;\n}\n\n.pd-booth input:focus {\n  border-color: var(--pd-accent);\n  outline: none;\n}\n\n.pd-examples,\n.pd-chips {\n  display: flex;\n  flex-wrap: wrap;\n  gap: 6px;\n}\n\n.pd-examples button {\n  border: 1px solid var(--pd-border);\n  background: rgba(255, 255, 255, 0.04);\n  border-radius: 999px;\n  padding: 5px 11px;\n  font-size: 11px;\n  color: var(--pd-sub);\n}\n\n.pd-examples button:hover {\n  color: var(--pd-text);\n  border-color: rgba(255, 255, 255, 0.25);\n}\n\n.pd-chip {\n  display: inline-flex;\n  align-items: center;\n  padding: 4px 10px;\n  border-radius: 999px;\n  font-size: 11px;\n  font-weight: 600;\n  background: color-mix(in srgb, var(--pd-accent) 14%, rgba(255, 255, 255, 0.06));\n  border: 1px solid color-mix(in srgb, var(--pd-accent) 28%, transparent);\n}\n\n/* Search results & Artist menu */\n.pd-matches {\n  display: flex;\n  flex-direction: column;\n  gap: 10px;\n  max-height: 360px;\n  overflow-y: auto;\n}\n\n.pd-results {\n  display: grid;\n  gap: 6px;\n}\n\n.pd-results .pd-choice {\n  display: grid;\n  grid-template-columns: 46px minmax(0, 1fr);\n  column-gap: 12px;\n  row-gap: 2px;\n  padding: 8px 10px;\n  align-items: center;\n  border-radius: 12px;\n}\n\n.pd-results .pd-choicecover {\n  grid-row: 1 / 4;\n  width: 46px;\n  height: 46px;\n  max-height: 46px;\n  border-radius: 8px;\n}\n\n.pd-results .pd-artist-photo {\n  border-radius: 50%;\n}\n\n.pd-results .pd-choiceplay {\n  display: none;\n}\n\n.pd-artistmenu {\n  display: flex;\n  flex-direction: column;\n  gap: 12px;\n}\n\n.pd-menuhead {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  gap: 12px;\n}\n\n.pd-menuhead h3 {\n  margin: 0;\n  font-size: 18px;\n  font-weight: 800;\n}\n\n.pd-mode {\n  padding: 16px;\n  gap: 8px;\n}\n\n.pd-mode b {\n  font-size: 15px;\n  color: var(--pd-accent);\n}\n\n/* Up Next queue */\n.pd-section-head {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  gap: 12px;\n  margin-bottom: 12px;\n}\n\n.pd-next-list {\n  display: flex;\n  flex-direction: column;\n  gap: 8px;\n}\n\n.pd-next {\n  display: grid;\n  grid-template-columns: 44px minmax(0, 1fr) auto;\n  align-items: center;\n  gap: 12px;\n  padding: 6px 10px;\n  border-radius: 12px;\n  background: rgba(255, 255, 255, 0.03);\n  border: 1px solid transparent;\n  transition: background-color 0.16s, border-color 0.16s;\n}\n\n.pd-next:hover {\n  background: rgba(255, 255, 255, 0.07);\n  border-color: var(--pd-border);\n}\n\n.pd-next-thumb {\n  width: 44px;\n  height: 44px;\n  border-radius: 8px;\n  overflow: hidden;\n  background: var(--pd-highlight);\n  display: grid;\n  place-items: center;\n  color: var(--pd-accent);\n}\n\n.pd-next-thumb img {\n  width: 100%;\n  height: 100%;\n  object-fit: cover;\n}\n\n.pd-next-info {\n  min-width: 0;\n  display: flex;\n  flex-direction: column;\n  gap: 2px;\n}\n\n.pd-next-info b {\n  font-size: 13px;\n  font-weight: 700;\n  white-space: nowrap;\n  overflow: hidden;\n  text-overflow: ellipsis;\n}\n\n.pd-next-info small {\n  font-size: 11px;\n  color: var(--pd-sub);\n  white-space: nowrap;\n  overflow: hidden;\n  text-overflow: ellipsis;\n}\n\n.pd-next-tags {\n  display: flex;\n  flex-wrap: wrap;\n  align-items: center;\n  gap: 6px;\n  margin-top: 2px;\n}\n\n.pd-reason-tag {\n  font-size: 10px;\n  font-weight: 650;\n  color: var(--pd-accent);\n  background: color-mix(in srgb, var(--pd-accent) 12%, transparent);\n  padding: 2px 7px;\n  border-radius: 999px;\n}\n\n.pd-manual-tag {\n  font-size: 10px;\n  font-weight: 700;\n  color: #ffffff;\n  background: rgba(255, 255, 255, 0.16);\n  padding: 2px 8px;\n  border-radius: 999px;\n}\n\n.pd-flow-note {\n  font-size: 10px;\n  color: var(--pd-sub);\n}\n\n.pd-next-actions {\n  display: flex;\n  align-items: center;\n  gap: 4px;\n  opacity: 0.55;\n  transition: opacity 0.16s;\n}\n\n.pd-next:hover .pd-next-actions,\n.pd-next:focus-within .pd-next-actions,\n.pd-next-actions button[aria-pressed='true'] {\n  opacity: 1;\n}\n\n.pd-next-actions button {\n  width: 30px;\n  height: 30px;\n  border-radius: 50%;\n  border: 0;\n  background: transparent;\n  display: grid;\n  place-items: center;\n  color: var(--pd-sub);\n}\n\n.pd-next-actions button:hover {\n  background: rgba(255, 255, 255, 0.12);\n  color: var(--pd-text);\n}\n\n.pd-next-actions button[aria-pressed='true'] {\n  color: var(--pd-accent);\n}\n\n.pd-empty {\n  margin: 0;\n  font-size: 12px;\n  color: var(--pd-sub);\n  padding: 10px 0;\n}\n\n/* Session stats strip */\n.pd-stats {\n  display: grid;\n  grid-template-columns: repeat(4, minmax(0, 1fr));\n  gap: 10px;\n}\n\n@container pd-booth (max-width: 540px) {\n  .pd-stats {\n    grid-template-columns: repeat(2, minmax(0, 1fr));\n  }\n}\n\n.pd-stat {\n  padding: 9px 12px;\n  border-radius: 14px;\n  background: rgba(255, 255, 255, 0.04);\n  border: 1px solid var(--pd-border);\n  display: flex;\n  flex-direction: column;\n  gap: 2px;\n}\n\n.pd-stat b {\n  font-size: 18px;\n  font-weight: 800;\n  font-variant-numeric: tabular-nums;\n}\n\n.pd-stat small {\n  font-size: 11px;\n  color: var(--pd-sub);\n}\n\n.pd-session-actions {\n  display: flex;\n  flex-wrap: wrap;\n  gap: 10px;\n}\n\n.pd-session-actions > button {\n  flex: 1;\n  min-width: 180px;\n}\n\n/* Lyrics tab — Concert Stage */\n.pd-lyricspane {\n  position: relative;\n  overflow: hidden;\n  padding: 0;\n  border-radius: 22px;\n  min-height: clamp(500px, 72vh, 720px);\n  display: flex;\n  flex-direction: column;\n  background: color-mix(in srgb, var(--pd-card) 82%, #05070a);\n}\n\n.pd-lyrics-aura {\n  position: absolute;\n  inset: 0;\n  pointer-events: none;\n  z-index: 0;\n  overflow: hidden;\n}\n\n.pd-lyrics-aura img {\n  position: absolute;\n  inset: -24%;\n  width: 148%;\n  height: 148%;\n  object-fit: cover;\n  filter: blur(88px) saturate(1.9) brightness(0.62);\n  opacity: 0.72;\n  animation: pd-aura-drift 28s ease-in-out infinite alternate;\n  will-change: transform;\n}\n\n.pd-lyrics-aura::after {\n  content: '';\n  position: absolute;\n  inset: 0;\n  background:\n    radial-gradient(circle at 20% 24%, color-mix(in srgb, var(--pd-tint) 38%, transparent) 0%, transparent 58%),\n    radial-gradient(circle at 82% 76%, color-mix(in srgb, var(--pd-accent) 20%, transparent) 0%, transparent 55%),\n    linear-gradient(135deg, rgba(6, 8, 12, 0.42), rgba(6, 8, 12, 0.76));\n}\n\n.pd-lyrics-stage {\n  position: relative;\n  z-index: 1;\n  flex: 1;\n  min-height: 0;\n  display: grid;\n  grid-template-columns: minmax(0, 1fr);\n  grid-template-rows: auto minmax(0, 1fr);\n  gap: 18px;\n  padding: 18px;\n}\n\n@container pd-booth (min-width: 860px) {\n  .pd-lyrics-stage {\n    grid-template-columns: minmax(270px, 340px) minmax(0, 1fr);\n    grid-template-rows: minmax(0, 1fr);\n    gap: 32px;\n    padding: 26px 28px;\n    align-items: center;\n  }\n}\n\n.pd-lyrics-rail {\n  display: flex;\n  flex-direction: column;\n  gap: 16px;\n  min-width: 0;\n  padding: 18px;\n  border-radius: 18px;\n  background: rgba(10, 12, 18, 0.44);\n  backdrop-filter: blur(22px);\n  border: 1px solid rgba(255, 255, 255, 0.1);\n  box-shadow: 0 20px 44px rgba(0, 0, 0, 0.38);\n}\n\n.pd-lyrics-cover {\n  position: relative;\n  width: 100%;\n  max-width: 280px;\n  margin: 0 auto;\n  aspect-ratio: 1;\n  border-radius: 18px;\n  overflow: hidden;\n  background: var(--pd-highlight);\n  display: grid;\n  place-items: center;\n  box-shadow: 0 22px 48px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(255, 255, 255, 0.08);\n  transition: transform 0.6s cubic-bezier(0.22, 1, 0.36, 1);\n}\n\n.pd-booth[data-playing='true'] .pd-lyrics-cover {\n  transform: scale(1.015);\n}\n\n.pd-lyrics-cover > svg {\n  width: 58px;\n  height: 58px;\n  color: var(--pd-accent);\n  opacity: 0.72;\n}\n\n.pd-lyrics-cover img {\n  position: absolute;\n  inset: 0;\n  width: 100%;\n  height: 100%;\n  object-fit: cover;\n}\n\n.pd-lyrics-meta {\n  min-width: 0;\n  display: flex;\n  flex-direction: column;\n  gap: 4px;\n}\n\n.pd-lyrics-meta h2 {\n  margin: 0;\n  font-size: 21px;\n  font-weight: 850;\n  letter-spacing: -0.025em;\n  line-height: 1.18;\n  overflow-wrap: anywhere;\n}\n\n.pd-lyrics-meta .pd-track-artist {\n  font-size: 14px;\n}\n\n.pd-lyrics-badges {\n  display: flex;\n  flex-wrap: wrap;\n  align-items: center;\n  gap: 8px;\n  margin-top: 8px;\n}\n\n.pd-lyrics-badge {\n  display: inline-flex;\n  align-items: center;\n  padding: 4px 10px;\n  border-radius: 999px;\n  font-size: 11px;\n  font-weight: 650;\n  color: var(--pd-sub);\n  background: rgba(255, 255, 255, 0.07);\n  border: 1px solid rgba(255, 255, 255, 0.09);\n}\n\n.pd-lyrics-badge:empty {\n  display: none;\n}\n\n.pd-lyrics-rail-transport {\n  display: flex;\n  flex-direction: column;\n  gap: 10px;\n  padding-top: 8px;\n  border-top: 1px solid rgba(255, 255, 255, 0.08);\n}\n\n.pd-controls-compact {\n  gap: 12px;\n}\n\n.pd-controls-compact button {\n  width: 34px;\n  height: 34px;\n}\n\n.pd-controls-compact .pd-playbtn {\n  width: 44px;\n  height: 44px;\n}\n\n@container pd-booth (max-width: 859px) {\n  .pd-lyrics-rail {\n    display: grid;\n    grid-template-columns: 74px minmax(0, 1fr);\n    grid-template-areas: 'cover meta' 'trans trans';\n    align-items: center;\n    gap: 12px 14px;\n    padding: 14px;\n  }\n  .pd-lyrics-cover {\n    grid-area: cover;\n    max-width: 74px;\n    border-radius: 12px;\n  }\n  .pd-lyrics-cover > svg {\n    width: 30px;\n    height: 30px;\n  }\n  .pd-lyrics-meta {\n    grid-area: meta;\n  }\n  .pd-lyrics-meta h2 {\n    font-size: 17px;\n  }\n  .pd-lyrics-rail-transport {\n    grid-area: trans;\n  }\n}\n\n.pd-lyrics-main {\n  position: relative;\n  min-width: 0;\n  min-height: 0;\n  height: 100%;\n  display: flex;\n  flex-direction: column;\n  gap: 12px;\n}\n\n.pd-lyricsscroll {\n  height: clamp(340px, 60vh, 580px);\n  overflow-y: auto;\n  overflow-x: hidden;\n  overscroll-behavior: contain;\n  scrollbar-width: none;\n  padding: 26% 10px 28%;\n  mask-image: linear-gradient(transparent 0%, #000 13%, #000 84%, transparent 100%);\n  -webkit-mask-image: linear-gradient(transparent 0%, #000 13%, #000 84%, transparent 100%);\n}\n\n.pd-lyricsscroll::-webkit-scrollbar {\n  display: none;\n}\n\n.pd-lyrics-skeleton {\n  display: grid;\n  gap: 18px;\n  padding: 20px 14px;\n}\n\n.pd-lyrics-skeleton span {\n  display: block;\n  height: 28px;\n  border-radius: 10px;\n  background: linear-gradient(90deg, rgba(255, 255, 255, 0.06) 0%, rgba(255, 255, 255, 0.18) 50%, rgba(255, 255, 255, 0.06) 100%);\n  background-size: 200% 100%;\n  animation: pd-shimmer 1.5s linear infinite;\n}\n\n.pd-lyrics-skeleton span:nth-child(1) { width: 74%; }\n.pd-lyrics-skeleton span:nth-child(2) { width: 90%; animation-delay: 0.12s; }\n.pd-lyrics-skeleton span:nth-child(3) { width: 62%; animation-delay: 0.24s; }\n.pd-lyrics-skeleton span:nth-child(4) { width: 82%; animation-delay: 0.36s; }\n\n.pd-lyrics-empty {\n  padding: 36px 14px;\n  font-size: 14px;\n  text-align: left;\n}\n\n.pd-lines {\n  display: grid;\n  gap: 0.48em;\n}\n\n.pd-line {\n  position: relative;\n  margin: 0;\n  padding: 9px 62px 9px 14px;\n  border-radius: 14px;\n  font-size: 29px;\n  line-height: 1.24;\n  font-weight: 800;\n  letter-spacing: -0.025em;\n  color: rgba(255, 255, 255, 0.92);\n  opacity: 0.36;\n  filter: blur(0.65px);\n  transform-origin: left center;\n  transition: opacity 0.38s cubic-bezier(0.22, 1, 0.36, 1), transform 0.38s cubic-bezier(0.22, 1, 0.36, 1), filter 0.38s ease, background-color 0.24s ease;\n  cursor: pointer;\n}\n\n.pd-line[data-time]::after {\n  content: attr(data-time);\n  position: absolute;\n  right: 12px;\n  top: 50%;\n  transform: translateY(-50%) scale(0.92);\n  padding: 3px 8px;\n  border-radius: 999px;\n  font-size: 11px;\n  font-weight: 700;\n  font-variant-numeric: tabular-nums;\n  letter-spacing: 0.02em;\n  color: var(--pd-text);\n  background: rgba(255, 255, 255, 0.12);\n  opacity: 0;\n  transition: opacity 0.18s ease, transform 0.18s ease;\n  pointer-events: none;\n}\n\n.pd-line[data-state='past'] {\n  opacity: 0.34;\n  filter: blur(0.45px);\n}\n\n.pd-line[data-state='next'] {\n  opacity: 0.62;\n  filter: none;\n}\n\n.pd-line[data-state='future'][data-d='2'] {\n  opacity: 0.4;\n  filter: blur(0.65px);\n}\n\n.pd-line[data-state='future'][data-d='3'] {\n  opacity: 0.24;\n  filter: blur(1.25px);\n}\n\n.pd-lyricspane[data-synced='false'] .pd-line {\n  opacity: 0.9;\n  filter: none;\n}\n\n.pd-line:hover {\n  opacity: 0.95 !important;\n  filter: none !important;\n  background: rgba(255, 255, 255, 0.065);\n  transform: translateX(4px);\n}\n\n.pd-line[data-time]:hover::after {\n  opacity: 1;\n  transform: translateY(-50%) scale(1);\n}\n\n.pd-line.pd-now {\n  opacity: 1 !important;\n  filter: none !important;\n  transform: scale(1.03);\n  background: rgba(255, 255, 255, 0.055);\n  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.09), 0 10px 28px rgba(0, 0, 0, 0.22);\n}\n\n.pd-line.pd-now .pd-ltext {\n  background-image: linear-gradient(\n    90deg,\n    #ffffff 0%,\n    color-mix(in srgb, var(--pd-accent) 26%, #ffffff) calc(var(--lp, 0) * 100%),\n    rgba(255, 255, 255, 0.46) calc(var(--lp, 0) * 100% + 14%),\n    rgba(255, 255, 255, 0.46) 100%\n  );\n  -webkit-background-clip: text;\n  background-clip: text;\n  color: transparent;\n  filter: drop-shadow(0 0 22px color-mix(in srgb, var(--pd-accent) 42%, transparent));\n}\n\n.pd-line.pd-gap {\n  padding-top: 12px;\n  padding-bottom: 12px;\n}\n\n.pd-gap-dots {\n  display: inline-flex;\n  align-items: center;\n  gap: 8px;\n}\n\n.pd-gap-dots i {\n  display: block;\n  width: 9px;\n  height: 9px;\n  border-radius: 50%;\n  background: rgba(255, 255, 255, 0.48);\n  transition: transform 0.25s ease, background-color 0.25s ease;\n}\n\n.pd-line.pd-now .pd-gap-dots i {\n  background: var(--pd-accent);\n  box-shadow: 0 0 12px color-mix(in srgb, var(--pd-accent) 60%, transparent);\n  animation: pd-gap-bounce 1.2s ease-in-out infinite;\n}\n\n.pd-line.pd-now .pd-gap-dots i:nth-child(2) {\n  animation-delay: 0.2s;\n}\n\n.pd-line.pd-now .pd-gap-dots i:nth-child(3) {\n  animation-delay: 0.4s;\n}\n\n.pd-booth[data-lsize='s'] .pd-line {\n  font-size: 22px;\n}\n\n.pd-booth[data-lsize='l'] .pd-line {\n  font-size: 37px;\n}\n\n@container pd-booth (max-width: 560px) {\n  .pd-line {\n    font-size: 23px;\n    padding-right: 48px;\n  }\n  .pd-booth[data-lsize='l'] .pd-line {\n    font-size: 29px;\n  }\n}\n\n.pd-lyricstools {\n  display: flex;\n  align-items: center;\n  flex-wrap: wrap;\n  gap: 8px;\n  padding: 8px 12px;\n  border-radius: 999px;\n  background: rgba(10, 12, 18, 0.54);\n  backdrop-filter: blur(18px);\n  border: 1px solid rgba(255, 255, 255, 0.1);\n}\n\n.pd-lyricstools > span {\n  display: inline-flex;\n  align-items: center;\n  gap: 8px;\n  margin-left: auto;\n  font-size: 12px;\n  color: var(--pd-sub);\n}\n\n.pd-lyricstools button {\n  display: inline-flex;\n  align-items: center;\n  gap: 6px;\n  border: 1px solid rgba(255, 255, 255, 0.1);\n  background: rgba(255, 255, 255, 0.06);\n  border-radius: 999px;\n  padding: 6px 12px;\n  font-size: 12px;\n  font-weight: 600;\n}\n\n.pd-lyricstools button:hover {\n  background: rgba(255, 255, 255, 0.15);\n}\n\n.pd-booth:fullscreen {\n  padding: 0;\n  background: #07090d;\n}\n\n.pd-booth:fullscreen .pd-shell {\n  max-width: none;\n  height: 100vh;\n  padding: 18px 28px;\n}\n\n.pd-booth:fullscreen[data-tab='lyrics'] .pd-header,\n.pd-booth:fullscreen[data-tab='lyrics'] .pd-credit {\n  display: none;\n}\n\n.pd-booth:fullscreen[data-tab='lyrics'] .pd-lyricspane {\n  flex: 1;\n  min-height: 0;\n  border-radius: 24px;\n}\n\n.pd-booth:fullscreen[data-tab='lyrics'] .pd-lyrics-stage {\n  grid-template-columns: minmax(300px, 380px) minmax(0, 1fr);\n  gap: 44px;\n  padding: 36px 44px;\n}\n\n.pd-booth:fullscreen[data-tab='lyrics'] .pd-lyrics-cover {\n  max-width: 340px;\n}\n\n.pd-booth:fullscreen[data-tab='lyrics'] .pd-lyricsscroll {\n  height: calc(100vh - 168px);\n}\n\n.pd-booth:fullscreen[data-tab='lyrics'] .pd-line {\n  font-size: 36px;\n}\n\n.pd-booth:fullscreen[data-tab='lyrics'][data-lsize='s'] .pd-line {\n  font-size: 26px;\n}\n\n.pd-booth:fullscreen[data-tab='lyrics'][data-lsize='l'] .pd-line {\n  font-size: 46px;\n}\n\n/* Settings tab */\n.pd-settings-grid {\n  display: grid;\n  grid-template-columns: repeat(2, minmax(0, 1fr));\n  gap: 18px;\n  align-items: start;\n}\n\n@container pd-booth (max-width: 820px) {\n  .pd-settings-grid {\n    grid-template-columns: 1fr;\n  }\n}\n\n.pd-setting-card {\n  display: flex;\n  flex-direction: column;\n  gap: 14px;\n}\n\n.pd-setting-card h3 {\n  margin: 0;\n  font-size: 16px;\n  font-weight: 800;\n  display: flex;\n  align-items: center;\n  gap: 8px;\n}\n\n.pd-setting-card h3 svg {\n  color: var(--pd-accent);\n}\n\n.pd-field {\n  display: flex;\n  flex-direction: column;\n  gap: 6px;\n  font-size: 12px;\n  font-weight: 600;\n}\n\n.pd-field-head {\n  display: flex;\n  justify-content: space-between;\n  align-items: center;\n}\n\n.pd-field-head span:last-child {\n  color: var(--pd-accent);\n  font-variant-numeric: tabular-nums;\n}\n\n.pd-booth select {\n  width: 100%;\n  background: rgba(0, 0, 0, 0.35);\n  color: var(--pd-text);\n  border: 1px solid var(--pd-border);\n  border-radius: 10px;\n  padding: 9px 12px;\n  font-size: 13px;\n}\n\n.pd-booth input[type='range'] {\n  width: 100%;\n  accent-color: var(--pd-accent);\n  cursor: pointer;\n}\n\n.pd-check {\n  display: flex;\n  align-items: center;\n  gap: 10px;\n  font-size: 13px;\n  cursor: pointer;\n}\n\n.pd-check input {\n  width: 16px;\n  height: 16px;\n  accent-color: var(--pd-accent);\n  cursor: pointer;\n}\n\n.pd-btn-row {\n  display: flex;\n  flex-wrap: wrap;\n  gap: 8px;\n}\n\n.pd-note {\n  margin: 0;\n  font-size: 11px;\n  color: var(--pd-sub);\n  line-height: 1.5;\n}\n\n.pd-server-pill {\n  display: inline-flex;\n  align-items: center;\n  gap: 8px;\n  padding: 7px 12px;\n  border-radius: 10px;\n  font-size: 12px;\n  font-weight: 600;\n  background: rgba(255, 255, 255, 0.04);\n  border: 1px solid var(--pd-border);\n}\n\n.pd-server-pill.pd-ok {\n  color: var(--pd-accent);\n  border-color: color-mix(in srgb, var(--pd-accent) 40%, transparent);\n  background: color-mix(in srgb, var(--pd-accent) 12%, transparent);\n}\n\n.pd-diag {\n  list-style: none;\n  padding: 0;\n  margin: 0;\n  display: grid;\n  gap: 5px;\n  font-size: 12px;\n}\n\n.pd-diag:empty {\n  display: none;\n}\n\n.pd-diag .pd-error {\n  color: #ffb4ad;\n}\n\n.pd-credit {\n  text-align: center;\n  font-size: 11px;\n  color: var(--pd-sub);\n  padding-top: 8px;\n}\n\n.pd-credit b {\n  color: var(--pd-text);\n  letter-spacing: 0.06em;\n}\n\n/* Floating mini pill */\n.pd-mini {\n  position: fixed;\n  bottom: 98px;\n  right: 22px;\n  z-index: 1000;\n  display: flex;\n  align-items: center;\n  gap: 8px;\n  padding: 6px 8px 6px 6px;\n  border-radius: 999px;\n  background: color-mix(in srgb, var(--pd-card) 88%, transparent);\n  backdrop-filter: blur(18px);\n  border: 1px solid var(--pd-border);\n  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.45);\n}\n\n.pd-mini button {\n  display: inline-flex;\n  align-items: center;\n  gap: 8px;\n  border: 0;\n  background: none;\n  color: var(--pd-text);\n  font: inherit;\n  font-size: 12px;\n  font-weight: 650;\n  cursor: pointer;\n  border-radius: 999px;\n  padding: 4px 8px;\n}\n\n.pd-mini button:hover {\n  background: rgba(255, 255, 255, 0.1);\n}\n\n.pd-mini-cover {\n  width: 28px;\n  height: 28px;\n  border-radius: 50%;\n  overflow: hidden;\n  background: var(--pd-highlight);\n  display: grid;\n  place-items: center;\n  color: var(--pd-accent);\n  flex-shrink: 0;\n}\n\n.pd-mini-cover img {\n  width: 100%;\n  height: 100%;\n  object-fit: cover;\n}\n\n/* Off-page DJ Toast */\n.pd-toastdj {\n  position: fixed;\n  left: 50%;\n  bottom: 108px;\n  transform: translateX(-50%);\n  max-width: min(560px, 92vw);\n  z-index: 100000;\n  pointer-events: none;\n  display: flex;\n  align-items: center;\n  gap: 12px;\n  padding: 12px 18px;\n  border-radius: 18px;\n  background: color-mix(in srgb, var(--pd-card) 88%, transparent);\n  backdrop-filter: blur(22px);\n  border: 1px solid color-mix(in srgb, var(--pd-accent) 45%, var(--pd-border));\n  box-shadow: 0 14px 38px rgba(0, 0, 0, 0.55);\n  animation: pd-enter 0.22s ease-out;\n}\n\n.pd-toast-ring {\n  width: 34px;\n  height: 34px;\n  border-radius: 50%;\n  background: color-mix(in srgb, var(--pd-accent) 20%, transparent);\n  border: 1px solid var(--pd-accent);\n  display: grid;\n  place-items: center;\n  color: var(--pd-accent);\n  flex-shrink: 0;\n}\n\n.pd-toastdj-body {\n  display: flex;\n  flex-direction: column;\n  gap: 2px;\n  font-size: 13px;\n  line-height: 1.35;\n}\n\n.pd-toastdj-body b {\n  font-size: 11px;\n  letter-spacing: 0.08em;\n  text-transform: uppercase;\n  color: var(--pd-accent);\n}\n\n@container pd-booth (max-width: 600px) {\n  .pd-shell {\n    padding: 14px 14px 36px;\n  }\n  .pd-header {\n    padding: 10px 12px;\n  }\n  .pd-deck {\n    padding: 18px;\n  }\n  .pd-track-meta h2 {\n    font-size: 22px;\n  }\n}\n\n@keyframes pd-spin {\n  to {\n    transform: rotate(360deg);\n  }\n}\n\n@keyframes pd-ring {\n  from {\n    transform: scale(0.7);\n    opacity: 0.85;\n  }\n  to {\n    transform: scale(1.6);\n    opacity: 0;\n  }\n}\n\n@keyframes pd-eq-bar {\n  from {\n    height: 5px;\n  }\n  to {\n    height: 22px;\n  }\n}\n\n@keyframes pd-dot-pulse {\n  0% {\n    box-shadow: 0 0 0 0 color-mix(in srgb, var(--pd-accent) 60%, transparent);\n  }\n  70% {\n    box-shadow: 0 0 0 7px transparent;\n  }\n  100% {\n    box-shadow: 0 0 0 0 transparent;\n  }\n}\n\n@keyframes pd-enter {\n  from {\n    opacity: 0;\n    transform: translateY(8px);\n  }\n  to {\n    opacity: 1;\n    transform: translateY(0);\n  }\n}\n\n@keyframes pd-aura-drift {\n  0% {\n    transform: scale(1.06) translate3d(-2%, -2%, 0) rotate(0deg);\n  }\n  100% {\n    transform: scale(1.16) translate3d(2%, 2%, 0) rotate(5deg);\n  }\n}\n\n@keyframes pd-gap-bounce {\n  0%,\n  100% {\n    transform: translateY(0) scale(0.9);\n    opacity: 0.65;\n  }\n  50% {\n    transform: translateY(-4px) scale(1.15);\n    opacity: 1;\n  }\n}\n\n@keyframes pd-shimmer {\n  0% {\n    background-position: 200% 0;\n  }\n  100% {\n    background-position: -200% 0;\n  }\n}\n\n@media (prefers-reduced-motion: reduce) {\n  .pd-booth *,\n  .pd-mini *,\n  .pd-toastdj * {\n    animation: none !important;\n    transition: none !important;\n  }\n}\n";
function mountUI(S, engine, { audio, queue, narrator, voiceGate, library, transitions, recovery, recoverVolume, lyrics, diagnose }) {
  const style = document.createElement('style');
  style.id = 'poor-dj-style';
  style.textContent = CSS;
  document.head.append(style);

  const svg = (paths, size = 18) =>
    `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

  const ICONS = {
    disc: svg('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2"/><path d="M5 12a7 7 0 0 1 7-7m0 14a7 7 0 0 0 7-7"/>', 20),
    play: svg('<polygon points="6 4 20 12 6 20 6 4" fill="currentColor" stroke="none"/>', 20),
    pause: svg('<rect x="6" y="4" width="4" height="16" rx="1" fill="currentColor" stroke="none"/><rect x="14" y="4" width="4" height="16" rx="1" fill="currentColor" stroke="none"/>', 20),
    prev: svg('<polygon points="19 20 9 12 19 4 19 20" fill="currentColor" stroke="none"/><line x1="5" y1="19" x2="5" y2="5"/>', 18),
    next: svg('<polygon points="5 4 15 12 5 20 5 4" fill="currentColor" stroke="none"/><line x1="19" y1="5" x2="19" y2="19"/>', 18),
    heart: svg('<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>', 15),
    thumbsDown: svg('<path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zM17 2h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17"/>', 15),
    userX: svg('<path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="18" y1="8" x2="23" y2="13"/><line x1="23" y1="8" x2="18" y2="13"/>', 15),
    undo: svg('<path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/>', 15),
    refresh: svg('<polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>', 15),
    pin: svg('<path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/>', 15),
    x: svg('<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>', 17),
    mic: svg('<path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/>', 17),
    micOff: svg('<line x1="1" y1="1" x2="23" y2="23"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"/><path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/>', 17),
    settings: svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>', 16),
    search: svg('<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>', 16),
    sparkles: svg('<path d="M12 3l1.8 4.2L18 9l-4.2 1.8L12 15l-1.8-4.2L6 9l4.2-1.8z"/><path d="M19 16l.9 2.1L22 19l-2.1.9L19 22l-.9-2.1L16 19l2.1-.9z"/>', 17),
    library: svg('<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>', 17),
    compass: svg('<circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/>', 17),
    lyrics: svg('<path d="M4 6h16M4 12h10M4 18h14"/>', 16),
    stop: svg('<rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" stroke="none"/>', 14),
    save: svg('<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/>', 15),
    arrowLeft: svg('<line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>', 15),
    external: svg('<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>', 14),
    maximize: svg('<polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/>', 15),
    sliders: svg('<line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/>', 16),
    radio: svg('<circle cx="12" cy="12" r="2"/><path d="M16.24 7.76a6 6 0 0 1 0 8.49m-8.48-.01a6 6 0 0 1 0-8.49m11.31-2.82a10 10 0 0 1 0 14.14m-14.14 0a10 10 0 0 1 0-14.14"/>', 16)
  };

  const ROUTE = '/PoorDJ';
  let lastNonDjPath = '/';
  const curInitPath = S.Platform.History?.location?.pathname;
  if (curInitPath && curInitPath !== ROUTE) lastNonDjPath = curInitPath;
  const detectExternalLyrics = () => {
    if (root.SpicyLyrics || document.querySelector('#SpicyLyrics_PageButton')) {
      return { id: 'spicy', name: 'Spicy Lyrics', open: () => S.Platform.History.push('/SpicyLyrics') };
    }
    if (root.LyricsPlus || document.querySelector('a[href="/lyrics-plus"], [data-uri="spotify:app:lyrics-plus"]')) {
      return { id: 'lyrics-plus', name: 'Lyrics Plus', open: () => S.Platform.History.push('/lyrics-plus') };
    }
    if (root.BeautifulLyrics || document.querySelector('.BeautifulLyrics, #BeautifulLyrics, [class*="BeautifulLyrics"]')) {
      return { id: 'beautiful-lyrics', name: 'Beautiful Lyrics', open: () => S.Platform.History.push('/lyrics') };
    }
    return null;
  };
  const useExternalLyrics = () => !!detectExternalLyrics() && engine.settings.lyricsProvider !== 'builtin';
  const ownLyrics = () => engine.settings.lyrics && !useExternalLyrics();
  const mainView = () => document.querySelector('#main-view') || document.querySelector('.Root__main-view');
  const onRoute = () => S.Platform.History?.location?.pathname === ROUTE;

  const mini = document.createElement('aside');
  mini.className = 'pd-mini';
  mini.hidden = true;
  mini.setAttribute('aria-label', 'Sesión POOR DJ');
  mini.innerHTML = `<button data-open><span class="pd-mini-cover">${ICONS.disc}<img data-minicover alt="" hidden></span><span data-minitext>POOR DJ</span></button><button data-stop aria-label="Terminar DJ">${ICONS.stop}</button>`;
  document.body.append(mini);

  const toast = document.createElement('aside');
  toast.className = 'pd-toastdj';
  toast.hidden = true;
  toast.setAttribute('role', 'status');
  toast.setAttribute('aria-live', 'polite');
  document.body.append(toast);

  const perform = async work => {
    try {
      await work();
    } catch (e) {
      engine.notify(e.message, true);
    } finally {
      update();
    }
  };

  const closeBooth = () => {
    if (document.fullscreenElement && (!pageEl || document.fullscreenElement === pageEl)) {
      try {
        document.exitFullscreen?.().catch?.(() => {});
      } catch (_) {}
    }
    if (onRoute()) {
      const idx = S.Platform.History?.index;
      if ((typeof idx !== 'number' || idx > 0) && typeof S.Platform.History?.goBack === 'function') {
        try {
          S.Platform.History.goBack();
        } catch (_) {}
      }
      if (onRoute() && typeof S.Platform.History?.push === 'function') {
        try {
          S.Platform.History.push(lastNonDjPath && lastNonDjPath !== ROUTE ? lastNonDjPath : '/');
        } catch (_) {}
      }
      if (onRoute()) closePage();
    }
    update();
  };
  const toggleBooth = () => {
    if (onRoute()) closeBooth();
    else S.Platform.History.push(ROUTE);
  };

  mini.querySelector('[data-open]').onclick = () => open();
  mini.querySelector('[data-stop]').onclick = () => perform(() => engine.stop());

  let playerButton = null;
  let playerButtonParent = null;
  let playerButtonFrame = 0;
  let fallbackButton = null;

  const ensurePlayerButton = () => {
    const bar = document.querySelector('[data-testid="now-playing-bar"]');
    const anchor = bar?.querySelector('#SpicyLyrics_PageButton') || bar?.querySelector('[data-testid="control-button-queue"]');
    const parent = anchor?.parentElement;
    if (!parent) return;
    if (fallbackButton) {
      fallbackButton.deregister?.();
      fallbackButton = null;
    }
    if (playerButton?.isConnected && playerButtonParent === parent) return;
    playerButton?.remove();
    playerButton = document.createElement('button');
    playerButton.type = 'button';
    const styleRef = bar.querySelector('[data-testid="control-button-queue"]') || anchor;
    playerButton.className = styleRef.className;
    playerButton.id = 'PoorDJ_PlaybarButton';
    playerButton.setAttribute('aria-label', 'Abrir POOR DJ · Ctrl+D');
    playerButton.title = 'POOR DJ · Ctrl+D';
    playerButton.innerHTML = ICON;
    playerButton.onclick = () => toggleBooth();
    parent.insertBefore(playerButton, anchor);
    playerButtonParent = parent;
  };

  const playerButtonObserver = new MutationObserver(() => {
    if (playerButtonFrame) return;
    playerButtonFrame = requestAnimationFrame(() => {
      playerButtonFrame = 0;
      ensurePlayerButton();
    });
  });
  playerButtonObserver.observe(document.body, { childList: true, subtree: true });

  const fallbackTimer = setTimeout(() => {
    if (!playerButton?.isConnected && S.Playbar?.Button && !fallbackButton) {
      fallbackButton = new S.Playbar.Button('POOR DJ', ICON, () => toggleBooth());
    }
  }, 6000);

  const shortcut = e => {
    if (e.key === 'Escape' && onRoute()) {
      e.preventDefault();
      e.stopPropagation();
      if (document.fullscreenElement) {
        try {
          document.exitFullscreen?.().catch?.(() => {});
        } catch (_) {}
      } else {
        closeBooth();
      }
      return;
    }
    if (e.code !== 'KeyD' || !e.ctrlKey || e.altKey || e.shiftKey || e.metaKey || e.repeat) return;
    const target = e.target;
    if (
      target?.isContentEditable ||
      /^(INPUT|TEXTAREA|SELECT)$/.test(target?.tagName || '') ||
      target?.closest?.('[contenteditable="true"],[role="textbox"]')
    ) {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    toggleBooth();
  };
  document.addEventListener('keydown', shortcut, true);
  ensurePlayerButton();

  const theme = node => {
    node.dataset.accent = engine.settings.accent;
  };
  const setText = (key, value) => {
    const n = pageEl?.querySelector(`[data-${key}]`);
    if (n && n.textContent !== String(value)) n.textContent = value;
  };
  const download = (data, name) => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const L = {
    uri: '',
    data: null,
    state: 'idle',
    idx: -2,
    follow: true,
    pause: 0,
    raf: 0,
    tab: 'dj',
    tint: new Map(),
    tintUri: '',
    sleep: 0,
    sleepAt: 0,
    job: 0
  };

  const fmt = ms => {
    const s = Math.max(0, Math.floor(ms / 1000));
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  };
  const clock = () => S.Player.getProgress() + (engine.settings.lyricsOffset || 0);
  const seek = ms => {
    try {
      if (typeof S.Player.seek === 'function') S.Player.seek(ms);
      else (S.Platform.PlayerAPI?.seekTo || S.Platform.PlayerAPI?.seek)?.call(S.Platform.PlayerAPI, ms);
    } catch (_) {}
  };

  let pageEl = null;
  let lyricsView = null;
  const views = [];
  const addView = (rootNode, active) => {
    const v = { root: rootNode, active, idx: -2, rendered: '', follow: true, pause: 0 };
    views.push(v);
    return v;
  };
  const liveViews = () => {
    for (let i = views.length - 1; i >= 0; i--) {
      if (!views[i].root.isConnected) views.splice(i, 1);
    }
    return views;
  };
  const resetViews = () =>
    liveViews().forEach(v => {
      v.idx = -2;
      v.follow = true;
      v.pause = 0;
    });

  function loadLyrics() {
    const track = engine.current;
    if (!ownLyrics() || !track?.uri || !liveViews().some(v => v.active())) return;
    if (L.uri === track.uri && L.state !== 'error') return;
    L.uri = track.uri;
    L.state = 'loading';
    L.data = null;
    views.forEach(v => {
      v.rendered = '';
      v.idx = -2;
    });
    const job = ++L.job;
    paintLyrics();
    lyrics
      .get(track, { fallback: engine.settings.lyricsExternal })
      .then(r => {
        if (job !== L.job) return;
        L.state = r.state;
        L.data = r.state === 'ready' ? r : null;
        L.message = r.message;
        views.forEach(v => {
          v.rendered = '';
        });
        paintLyrics();
      })
      .catch(e => {
        if (job !== L.job) return;
        L.state = 'error';
        L.message = e.message;
        views.forEach(v => {
          v.rendered = '';
        });
        paintLyrics();
      });
  }

  function paintLyrics() {
    const info = {
      idle: 'Reproduce una canción para ver su letra.',
      loading: 'Buscando la letra…',
      none: engine.settings.lyricsExternal
        ? 'No encontré letra para esta canción.'
        : 'Spotify no tiene letra para esta canción. Puedes activar la búsqueda externa en Ajustes.',
      error: 'No pude cargar la letra. Se reintentará con la siguiente canción.'
    };
    const d = L.data;
    for (const v of liveViews()) {
      const box = v.root.querySelector('[data-lines]');
      const msg = v.root.querySelector('[data-lyricsmsg]');
      const skel = v.root.querySelector('[data-lyricsskeleton]');
      if (!box) continue;
      v.root.dataset.synced = d ? String(!!d.synced) : '';
      v.root.dataset.state = L.state;
      if (skel) skel.hidden = L.state !== 'loading' || !!d;
      msg.hidden = !!d || L.state === 'loading';
      msg.textContent = d || L.state === 'loading' ? '' : info[L.state] || '';
      const key = d ? L.uri + d.source : '';
      if (v.rendered === key) continue;
      v.rendered = key;
      box.innerHTML = d
        ? d.lines
            .map(
              (l, i) =>
                `<p class="pd-line${isGap(l) ? ' pd-gap' : ''}"${l.t != null ? ` data-seek="${l.t}" data-time="${fmt(l.t)}"` : ''} data-i="${i}">${
                  isGap(l)
                    ? '<span class="pd-gap-dots" aria-hidden="true"><i></i><i></i><i></i></span>'
                    : `<span class="pd-ltext">${esc(l.text)}</span>`
                }</p>`
            )
            .join('')
        : '';
      v.root.querySelector('[data-lyricssource]').textContent = d
        ? `${d.synced ? 'Sincronizada' : 'Sin sincronizar'} · ${d.provider || d.source}`
        : '';
      box.parentNode.scrollTop = 0;
      v.idx = -2;
    }
  }

  function tickLyrics() {
    if (!L.data?.synced) return;
    const nowMs = clock() + 220;
    const lines = L.data.lines;
    const i = activeLine(lines, nowMs);
    for (const v of liveViews()) {
      if (!v.active()) continue;
      const box = v.root.querySelector('[data-lines]');
      if (!box) continue;
      const backBtn = v.root.querySelector('[data-follow-lyrics]');
      const canFollow = v.follow && Date.now() > v.pause;
      if (backBtn) backBtn.hidden = canFollow;
      const nodes = box.children;
      if (i !== v.idx) {
        v.idx = i;
        for (let n = 0; n < nodes.length; n++) {
          const elLine = nodes[n];
          elLine.classList.toggle('pd-now', i >= 0 && n === i);
          if (i < 0 || n !== i) elLine.style.removeProperty('--lp');
          if (i < 0) {
            elLine.dataset.state = 'future';
            elLine.dataset.d = '2';
            continue;
          }
          elLine.dataset.d = Math.min(3, Math.abs(n - i));
          if (n < i) elLine.dataset.state = 'past';
          else if (n === i) elLine.dataset.state = 'now';
          else if (n === i + 1) elLine.dataset.state = 'next';
          else elLine.dataset.state = 'future';
        }
        if (i >= 0 && nodes[i]) {
          const node = nodes[i];
          if (canFollow) {
            const sc = box.parentNode;
            sc.scrollTo({
              top: Math.max(0, node.offsetTop - sc.clientHeight * 0.36 + node.offsetHeight / 2),
              behavior: matchMedia('(prefers-reduced-motion:reduce)').matches ? 'auto' : 'smooth'
            });
          }
        }
      }
      if (i >= 0 && nodes[i]) {
        const curT = lines[i].t ?? 0;
        const rawNext = lines[i + 1]?.t;
        const durFallback = S.Player.getDuration?.() || engine.current?.duration || curT + 4000;
        const span = Math.max(400, (rawNext != null ? rawNext : durFallback) - curT);
        const lp = Math.max(0, Math.min(1, (nowMs - curT) / span));
        nodes[i].style.setProperty('--lp', lp.toFixed(3));
      }
    }
  }

  function wireLyrics(v) {
    const rNode = v.root;
    const sc = rNode.querySelector('.pd-lyricsscroll');
    const back = rNode.querySelector('[data-follow-lyrics]');
    const pause = () => {
      v.pause = Date.now() + 3500;
      if (back) back.hidden = false;
    };
    sc.addEventListener('wheel', pause, { passive: true });
    sc.addEventListener('touchmove', pause, { passive: true });
    sc.addEventListener('keydown', e => {
      if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown'].includes(e.key)) pause();
    });
    rNode.addEventListener('click', e => {
      const line = e.target.closest('[data-seek]');
      if (line) {
        e.stopPropagation();
        seek(Math.max(0, Number(line.dataset.seek) - (engine.settings.lyricsOffset || 0)));
        v.follow = true;
        v.pause = 0;
        v.idx = -2;
        if (back) back.hidden = true;
        tickLyrics();
        frameBody();
        if (!S.Player.isPlaying()) setTimeout(() => { tickLyrics(); frameBody(); }, 120);
        return;
      }
      const b = e.target.closest('button');
      if (!b || !rNode.contains(b)) return;
      const d = b.dataset;
      if ('followLyrics' in d) {
        v.follow = true;
        v.pause = 0;
        b.hidden = true;
        v.idx = -2;
        tickLyrics();
      } else if (d.offset) {
        Promise.resolve(engine.updateSettings({ lyricsOffset: engine.settings.lyricsOffset + Number(d.offset) }, false)).then(
          () => {
            resetViews();
            update();
          }
        );
      } else if ('lsize' in d) {
        Promise.resolve(engine.updateSettings({ lyricsSize: { s: 'm', m: 'l', l: 's' }[engine.settings.lyricsSize] }, false)).then(
          update
        );
      } else if ('full' in d) {
        try {
          document.fullscreenElement ? document.exitFullscreen?.().catch?.(() => {}) : pageEl?.requestFullscreen?.();
        } catch (_) {}
      } else if ('exitfull' in d) {
        try {
          document.fullscreenElement && document.exitFullscreen?.().catch?.(() => {});
        } catch (_) {}
      } else {
        return;
      }
      e.stopPropagation();
    });
  }

  function frame() {
    L.raf = 0;
    if (!pageEl?.isConnected) return;
    try {
      frameBody();
    } catch (_) {}
    if (S.Player.isPlaying()) L.raf = requestAnimationFrame(frame);
  }

  function frameBody() {
    if (!pageEl) return;
    const dur = S.Player.getDuration?.() || engine.current?.duration || 0;
    const pos = S.Player.getProgress();
    const ratio = dur ? Math.min(1, pos / dur) : 0;
    const posText = fmt(pos);
    const durText = fmt(dur);
    pageEl.querySelectorAll('[data-progress]').forEach(bar => bar.style.setProperty('--p', ratio));
    pageEl.querySelectorAll('[data-pos]').forEach(el => {
      if (el.textContent !== posText) el.textContent = posText;
    });
    pageEl.querySelectorAll('[data-dur]').forEach(el => {
      if (el.textContent !== durText) el.textContent = durText;
    });
    tickLyrics();
    if (L.sleepAt && Date.now() >= L.sleepAt) {
      L.sleepAt = 0;
      L.sleep = 0;
      pageEl.querySelector('[data-sleep]').value = '0';
      if (engine.active) perform(() => engine.stop());
    }
  }

  const startFrame = () => {
    if (!L.raf && pageEl?.isConnected) L.raf = requestAnimationFrame(frame);
  };

  const paintTint = () => {
    const v = engine.settings.ambient ? L.tint.get(engine.current?.image) : '';
    if (pageEl?.isConnected) {
      if (v) pageEl.style.setProperty('--pd-tint', v);
      else pageEl.style.removeProperty('--pd-tint');
    }
  };

  async function tint() {
    if (!pageEl?.isConnected) return;
    const uri = engine.current?.image;
    if (!engine.settings.ambient || !uri) {
      paintTint();
      return;
    }
    if (L.tint.has(uri)) {
      paintTint();
      return;
    }
    if (L.tintUri === uri) return;
    L.tintUri = uri;
    try {
      const c = await S.colorExtractor?.(engine.current.uri);
      L.tint.set(uri, c?.VIBRANT || c?.PROMINENT || c?.DARK_VIBRANT || '');
    } catch (_) {
      L.tint.set(uri, '');
    }
    paintTint();
  }

  function setTab(tab) {
    L.tab = tab;
    if (!pageEl) return;
    pageEl.dataset.tab = tab;
    pageEl.querySelectorAll('[data-tab]').forEach(b => {
      const on = b.dataset.tab === tab;
      b.classList.toggle('pd-selected', on);
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
    });
    pageEl.querySelectorAll('[data-pane]').forEach(n => {
      n.hidden = n.dataset.pane !== tab;
    });
    if (tab === 'lyrics') {
      loadLyrics();
      resetViews();
      startFrame();
      queueMicrotask(tickLyrics);
    } else if (tab === 'settings') {
      narrator.neural.health().catch(() => {});
      transitions.refresh().then(update).catch(() => {});
    }
  }

  function cards(tracks, kind) {
    return tracks
      .map(
        t =>
          `<button class="pd-choice" data-${kind}="${esc(t.uri)}" ${engine.choiceBusy ? 'disabled' : ''}>
            <span class="pd-choicecover">${imageURL(t.image) ? `<img src="${esc(imageURL(t.image))}" alt="" loading="eager">` : ICONS.disc}<span class="pd-choiceplay">${ICONS.play}</span></span>
            <b>${esc(t.name)}</b>
            <small>${esc(t.artists.map(a => a.name).join(', '))}</small>
            <small class="pd-evidence">${esc(evidenceLabel(t.evidence || knownEvidence(t, engine.memory[t.uri])) || t.album || 'Resultado de Spotify')}</small>
          </button>`
      )
      .join('');
  }

  function currentReasonLabel() {
    const c = engine.current;
    if (!c) return 'Reproduce una canción en Spotify';
    const ev = knownEvidence(c, engine.memory[c.uri]);
    if (ev.length) return evidenceLabel(ev);
    const activeMatch = engine.sessionList.find(t => t.uri === c.uri);
    if (activeMatch?.reason) return activeMatch.reason;
    if (engine.active && engine.anchor?.uri === c.uri) return 'Referencia actual de la sesión';
    if (!engine.memory[c.uri]) return 'Nueva para ti';
    return 'Sonando en Spotify';
  }

  function buildBoothDOM() {
    const el = document.createElement('section');
    el.className = 'pd-booth';
    el.id = 'PoorDJPage';
    el.setAttribute('aria-label', 'Cabina de POOR DJ');

    el.innerHTML = `
      <div class="pd-backdrop"><img data-bgcover alt="" hidden></div>
      <div class="pd-shell">
        <header class="pd-header">
          <div class="pd-brand">
            <span class="pd-brand-mark">${ICONS.disc}</span>
            <div>
              <h1>POOR DJ <small>${VERSION}</small></h1>
              <span class="pd-tagline">Tu música. Tu mando.</span>
            </div>
          </div>
          <div class="pd-tabs" role="tablist" data-tabs aria-label="Vista">
            <button role="tab" data-tab="dj" aria-selected="true" class="pd-selected">${ICONS.radio}<span>Sesión</span></button>
            <button role="tab" data-tab="lyrics" aria-selected="false" tabindex="-1">${ICONS.lyrics}<span>Letras</span></button>
            <button role="tab" data-tab="settings" aria-selected="false" tabindex="-1">${ICONS.settings}<span>Ajustes</span></button>
          </div>
          <div class="pd-header-actions">
            <button class="pd-pill-link" data-openspicy hidden>${ICONS.external}<span>Letras ↗</span></button>
            <span class="pd-live" data-live><i class="pd-live-dot"></i><span data-livetext>Tú tienes el control</span></span>
            <button class="pd-icon-btn" data-voice aria-label="Voz del DJ">${ICONS.mic}</button>
            <button class="pd-icon-btn" data-closepage aria-label="Cerrar cabina">${ICONS.x}</button>
          </div>
        </header>

        <div data-pane="dj" class="pd-session-grid">
          <section class="pd-card pd-deck" aria-label="Reproductor del DJ">
            <div class="pd-deck-stage">
              <div class="pd-vinyl" aria-hidden="true"></div>
              <div class="pd-cover-wrap">
                ${ICONS.disc}
                <img data-cover alt="Portada actual" hidden>
                <div class="pd-mic-overlay" data-micoverlay hidden>
                  <div class="pd-rings"><span class="pd-eq" aria-hidden="true"><i></i><i></i><i></i><i></i></span></div>
                  <span class="pd-mic-label">DJ POOR al micro</span>
                  <p class="pd-mic-caption" data-miccaption></p>
                </div>
              </div>
            </div>
            <div class="pd-track-meta">
              <h2 data-title></h2>
              <p class="pd-track-artist" data-artist></p>
              <span class="pd-why-chip" data-why></span>
            </div>
            <div class="pd-transport">
              <div class="pd-progress-row">
                <span data-pos>0:00</span>
                <div class="pd-progress" data-progress role="progressbar" aria-label="Progreso"></div>
                <span data-dur>0:00</span>
              </div>
              <div class="pd-controls">
                <button data-prev aria-label="Anterior">${ICONS.prev}</button>
                <button data-toggleplay class="pd-playbtn" aria-label="Reproducir">${ICONS.play}</button>
                <button data-nextsong aria-label="Siguiente">${ICONS.next}</button>
              </div>
            </div>
            <div class="pd-feedback" data-feedbackrow>
              <button data-feedback="more">${ICONS.heart}<span>Me encanta</span></button>
              <button data-feedback="less">${ICONS.thumbsDown}<span>No es para mí</span></button>
              <button data-feedback="artist">${ICONS.userX}<span>Sin este artista hoy</span></button>
              <button data-undo>${ICONS.undo}<span>Deshacer</span></button>
            </div>
          </section>

          <div class="pd-main-col">
            <section class="pd-card pd-hero" data-idleview aria-label="Empieza tu sesión">
              <div class="pd-hero-head">
                <h2>Empieza tu sesión</h2>
                <p>Elige el estilo de mezcla y el DJ cuida el pulso sin interrumpir tus saltos.</p>
              </div>
              <div class="pd-vibes" role="group" aria-label="Modo de mezcla">
                <button class="pd-vibe-card" data-vibe="0">
                  ${ICONS.library}
                  <b>Mis favoritas</b>
                  <small>Solo playlists, Me gusta y escuchas que ya conoces.</small>
                </button>
                <button class="pd-vibe-card" data-vibe="35">
                  ${ICONS.sparkles}
                  <b>Mezcla</b>
                  <small>Equilibrio entre tus canciones conocidas y radio afín.</small>
                </button>
                <button class="pd-vibe-card" data-vibe="75">
                  ${ICONS.compass}
                  <b>Descubrir</b>
                  <small>Explora radio de Spotify y artistas relacionados.</small>
                </button>
              </div>
              <button class="pd-primary" data-toggle></button>
              <div class="pd-hero-links">
                <button class="pd-secondary" data-openpicker>${ICONS.disc}<span>Elegir canción de inicio</span></button>
                <button class="pd-secondary" data-follow>${ICONS.radio}<span>Seguir esta canción</span></button>
              </div>
              <button class="pd-secondary" data-restore hidden>Restaurar cola guardada</button>
            </section>

            <section class="pd-card pd-picker" data-picker hidden aria-label="Elige tu canción de inicio">
              <h3>Tu música conocida</h3>
              <p data-pickernote></p>
              <div class="pd-cards" data-cards></div>
              <div class="pd-pickeractions">
                <button class="pd-secondary" data-again>Otra vez</button>
                <button class="pd-secondary" data-resetdeck hidden>Reiniciar selección</button>
                <button class="pd-secondary" data-closepicker>Cancelar</button>
              </div>
            </section>

            <section class="pd-card" data-upnextcard hidden aria-label="A continuación">
              <div class="pd-section-head">
                <h3>A continuación</h3>
                <button class="pd-secondary" data-refresh>${ICONS.refresh}<span>Otra selección</span></button>
              </div>
              <div class="pd-next-list" data-next></div>
            </section>

            <section class="pd-stats" data-statsrow hidden aria-label="Estadísticas de sesión">
              <div class="pd-stat"><b data-statmin>0</b><small>Minutos</small></div>
              <div class="pd-stat"><b data-stattracks>0</b><small>Canciones</small></div>
              <div class="pd-stat"><b data-statartists>0</b><small>Artistas</small></div>
              <div class="pd-stat"><b data-statnew>0</b><small>Descubrimientos</small></div>
            </section>

            <section class="pd-card pd-command">
              <form data-command>
                <label for="pd-command" data-cmdlabel>¿Qué quieres escuchar?</label>
                <div class="pd-input-row">
                  <input id="pd-command" name="command" autocomplete="off" maxlength="240" placeholder="Yoko, L A K E N O S H I o sigue esta canción" required>
                  <button class="pd-secondary" type="submit">${ICONS.search}<span>Buscar</span></button>
                </div>
              </form>
              <div class="pd-examples" data-examples></div>
              <div class="pd-chips" data-intent aria-label="Instrucciones vigentes"></div>
            </section>

            <div class="pd-card pd-matches" data-matches hidden></div>
            <section class="pd-card pd-artistmenu" data-artistmenu hidden aria-label="Mezcla del artista"></section>
            <button class="pd-secondary" data-closesearch hidden>Cerrar resultados</button>

            <p class="pd-status" data-status role="status" aria-live="polite"></p>

            <div class="pd-session-actions" data-activeactions hidden>
              <button class="pd-secondary" data-savesession>${ICONS.save}<span>Guardar sesión como playlist</span></button>
              <button class="pd-primary pd-stop" data-stopbtn>${ICONS.stop}<span>Terminar DJ</span></button>
            </div>

            <div class="pd-card" data-mixcard hidden>
              <p class="pd-note" data-savedmix></p>
              <button class="pd-secondary" data-openmix>${ICONS.external}<span>Abrir última playlist guardada</span></button>
            </div>
          </div>
        </div>

        <div data-pane="lyrics" hidden class="pd-card pd-lyricspane">
          <div class="pd-lyrics-aura" aria-hidden="true"><img data-lyricsaura alt="" hidden></div>
          <div class="pd-lyrics-stage">
            <aside class="pd-lyrics-rail" aria-label="Ahora suena">
              <div class="pd-lyrics-cover">
                ${ICONS.disc}
                <img data-lyricscover alt="Portada actual" hidden>
              </div>
              <div class="pd-lyrics-meta">
                <h2 data-lyricstitle></h2>
                <p class="pd-track-artist" data-lyricsartist></p>
                <div class="pd-lyrics-badges">
                  <span class="pd-lyrics-badge" data-lyricssource></span>
                  <button class="pd-pill-link" data-openextlyrics hidden></button>
                </div>
              </div>
              <div class="pd-lyrics-rail-transport">
                <div class="pd-progress-row">
                  <span data-pos>0:00</span>
                  <div class="pd-progress" data-progress role="progressbar" aria-label="Progreso"></div>
                  <span data-dur>0:00</span>
                </div>
                <div class="pd-controls pd-controls-compact">
                  <button data-prev aria-label="Anterior">${ICONS.prev}</button>
                  <button data-toggleplay class="pd-playbtn" aria-label="Reproducir">${ICONS.play}</button>
                  <button data-nextsong aria-label="Siguiente">${ICONS.next}</button>
                </div>
              </div>
            </aside>

            <div class="pd-lyrics-main">
              <div class="pd-lyricsscroll" tabindex="0" aria-label="Letra de la canción">
                <div class="pd-lyrics-skeleton" data-lyricsskeleton hidden aria-hidden="true"><span></span><span></span><span></span><span></span></div>
                <p class="pd-note pd-lyrics-empty" data-lyricsmsg role="status"></p>
                <div data-lines class="pd-lines"></div>
              </div>
              <div class="pd-lyricstools">
                <button data-follow-lyrics hidden>Volver a la línea actual</button>
                <span>
                  <button data-offset="-250" aria-label="Retrasar letra">−</button>
                  <small>Ajuste <b data-offsetlabel>0 s</b></small>
                  <button data-offset="250" aria-label="Adelantar letra">+</button>
                </span>
                <button data-lsize aria-label="Cambiar tamaño de letra">Aa</button>
                <button data-full aria-label="Pantalla completa">${ICONS.maximize}</button>
                <button data-exitfull hidden aria-label="Salir de pantalla completa">${ICONS.x}</button>
              </div>
            </div>
          </div>
        </div>

        <div data-pane="settings" hidden class="pd-settings-grid">
          <section class="pd-card pd-setting-card">
            <h3>${ICONS.mic}<span>Voz del DJ</span></h3>
            <div class="pd-server-pill" data-serverpill>Comprobando voz neuronal local…</div>
            <p class="pd-note" data-serverhint hidden>Para voces locales naturales en español, ejecuta <code>voice\\install.ps1 -Autostart</code> y reinicia o lanza <code>voice\\start.ps1</code>.</p>
            <label class="pd-field">Voz preferida<select data-voicepick></select></label>
            <p class="pd-note" data-voicestatus></p>
            <label class="pd-field">Modo al hablar
              <select data-select="voiceMode">
                <option value="duck">Hablar sobre la música (baja el volumen)</option>
                <option value="pause">Pausar la música mientras habla</option>
              </select>
            </label>
            <label class="pd-field">
              <span class="pd-field-head"><span>Volumen de la música al hablar</span><span data-ducklabel>30%</span></span>
              <input type="range" min="10" max="80" step="5" data-range="duckLevel">
            </label>
            <label class="pd-field">
              <span class="pd-field-head"><span>Volumen de la voz</span><span data-vvollabel>90%</span></span>
              <input type="range" min="0" max="100" step="5" data-range="voiceVolume">
            </label>
            <label class="pd-field">
              <span class="pd-field-head"><span>Velocidad de la voz</span><span data-vspdlabel>1.00x</span></span>
              <input type="range" min="70" max="140" step="5" data-range="voiceSpeed">
            </label>
            <label class="pd-field">Frecuencia de comentarios
              <select data-select="talk">
                <option value="start">Al empezar y al cambiar rumbo</option>
                <option value="few">Cada 4–6 canciones</option>
                <option value="often">Cada 2–3 canciones</option>
              </select>
            </label>
            <div class="pd-btn-row">
              <button class="pd-secondary" data-testvoice>${ICONS.mic}<span>Probar voz</span></button>
              <button class="pd-secondary" data-recheckvoice>${ICONS.refresh}<span>Reintentar servidor</span></button>
            </div>
          </section>

          <section class="pd-card pd-setting-card">
            <h3>${ICONS.disc}<span>Música y comportamiento</span></h3>
            <label class="pd-field">Modo predeterminado
              <select data-select="discovery">
                <option value="0">Mis favoritas (solo conocidas)</option>
                <option value="35">Mezcla (equilibrada)</option>
                <option value="75">Descubrir afines</option>
              </select>
            </label>
            <label class="pd-field">Canciones preparadas en cola
              <select data-select="queueSize">
                <option value="2">2 canciones</option>
                <option value="3">3 canciones</option>
                <option value="4">4 canciones</option>
                <option value="5">5 canciones</option>
              </select>
            </label>
            <label class="pd-field">Cuando elijo manualmente una canción
              <select data-select="onManual">
                <option value="follow">Seguir esa dirección (mantener DJ)</option>
                <option value="pause">Pausar el DJ</option>
              </select>
            </label>
            ${[
              ['explicit', 'Permitir contenido explícito'],
              ['skipRepeats', 'Evitar repeticiones en la sesión'],
              ['autoLearn', 'Aprender de mi escucha y saltos'],
              ['takeover', 'Suspender mi cola manual al iniciar']
            ]
              .map(([k, lbl]) => `<label class="pd-check"><input type="checkbox" data-setting="${k}"><span>${lbl}</span></label>`)
              .join('')}
          </section>

          <section class="pd-card pd-setting-card">
            <h3>${ICONS.sliders}<span>Transiciones y tiempo</span></h3>
            <label class="pd-field">Continuidad entre canciones
              <select data-select="flowStrength">
                <option value="40">Equilibrada</option>
                <option value="65">Suave</option>
                <option value="90">Más continuidad</option>
              </select>
            </label>
            <label class="pd-field">Solapamiento nativo de Spotify
              <select data-crossfade>
                <option value="0">Sin solapamiento</option>
                <option value="2">2 segundos</option>
                <option value="4" selected>4 segundos</option>
                <option value="6">6 segundos</option>
              </select>
            </label>
            <p class="pd-note" data-transitionstatus></p>
            <div class="pd-btn-row">
              <button class="pd-secondary" data-applytransition>Aplicar en Spotify</button>
              <button class="pd-secondary" data-restoretransition>Restaurar</button>
              <button class="pd-secondary" data-recovervolume hidden>Recuperar volumen anterior</button>
            </div>
            <label class="pd-check"><input type="checkbox" data-setting="autoFade"><span>Transición automática según cada pareja de canciones</span></label>
            <label class="pd-field">Terminar el DJ en
              <select data-sleep>
                <option value="0">Sin temporizador</option>
                <option value="15">15 minutos</option>
                <option value="30">30 minutos</option>
                <option value="60">1 hora</option>
                <option value="120">2 horas</option>
              </select>
            </label>
          </section>

          <section class="pd-card pd-setting-card">
            <h3>${ICONS.sparkles}<span>Apariencia y letras</span></h3>
            <label class="pd-field">Color de acento
              <select data-select="accent">
                <option value="spotify">Verde Spotify</option>
                <option value="theme">Mi tema</option>
                <option value="blue">Azul</option>
                <option value="violet">Violeta</option>
                <option value="rose">Rosa</option>
              </select>
            </label>
            <label class="pd-field" data-lyricsproviderwrap hidden>Proveedor de letras
              <select data-select="lyricsProvider"></select>
            </label>
            ${[
              ['mini', 'Control flotante al salir de la cabina'],
              ['ambient', 'Ambiente con color de portada'],
              ['lyrics', 'Mostrar pestaña de letras sincronizadas'],
              ['lyricsExternal', 'Buscar letras fuera de Spotify (LRCLIB)']
            ]
              .map(([k, lbl]) => `<label class="pd-check"><input type="checkbox" data-setting="${k}"><span>${lbl}</span></label>`)
              .join('')}
            <p class="pd-note" data-lrclibnote>LRCLIB está apagado por defecto: al activarlo se envían título, artista, álbum y duración a lrclib.net solo si Spotify no tiene letra.</p>
          </section>

          <section class="pd-card pd-setting-card" style="grid-column: 1 / -1">
            <h3>${ICONS.library}<span>Biblioteca y datos locales</span></h3>
            <p class="pd-note" data-library></p>
            <div class="pd-btn-row">
              <button class="pd-secondary" data-librarysync>Actualizar Me gusta y playlists</button>
              <select data-playlists aria-label="Playlist de mi biblioteca" style="max-width:280px"></select>
              <button class="pd-secondary" data-loadplaylist>Leer playlist</button>
            </div>
            <form data-tag class="pd-input-row">
              <input id="pd-tag" maxlength="100" placeholder="Etiquetas para esta canción y playlist (ej. reggaetón, trap)">
              <button class="pd-secondary" type="submit">Etiquetar</button>
            </form>
            <div class="pd-btn-row">
              <button class="pd-secondary" data-diagnose>Comprobar compatibilidad</button>
              <button class="pd-secondary" data-export>Exportar perfil</button>
              <button class="pd-secondary" data-import>Importar perfil</button>
              <button class="pd-secondary" data-reset>Borrar aprendizaje</button>
              <button class="pd-secondary" data-cacheclear>Borrar caché acústica</button>
              <input data-file type="file" accept=".json,application/json" hidden>
            </div>
            <ul class="pd-diag" data-diagresult></ul>
          </section>
        </div>

        <footer class="pd-credit">Hecho por <b>KROMBYTE</b> · POOR DJ ${VERSION}</footer>
      </div>
    `;

    el.onclick = event => {
      const button = event.target.closest('button');
      if (!button || !el.contains(button)) return;
      const d = button.dataset;
      if (d.choice) {
        perform(() => engine.playChoice(engine.deck.pair.find(t => t.uri === d.choice), true));
      } else if (d.match) {
        perform(() => engine.chooseCommand(engine.commandChoices.find(t => t.uri === d.match)));
      } else if (d.mixartist) {
        perform(async () => {
          await engine.chooseArtist(d.mixartist);
          queueMicrotask(() => pageEl?.querySelector('[data-artistmode]')?.focus({ preventScroll: true }));
        });
      } else if (d.artistmode) {
        perform(() => engine.chooseArtist(d.artisturi, d.artistmode));
      } else if ('closeartist' in d) {
        const uri = engine.artistMenu?.uri;
        engine.artistMenu = null;
        update();
        pageEl?.querySelectorAll('[data-mixartist]').forEach(n => {
          if (n.dataset.mixartist === uri) n.focus({ preventScroll: true });
        });
      } else if ('closesearch' in d) {
        engine.commandGeneration++;
        engine.commandChoices = [];
        engine.commandArtists = [];
        engine.artistMenu = null;
        engine.pendingCommand = null;
        update();
      } else if ('openmix' in d && engine.mixPlaylist) {
        S.Platform.History.push('/playlist/' + engine.mixPlaylist.uri.split(':').pop());
      } else if ('applytransition' in d) {
        perform(async () => {
          await transitions.apply(Number(pageEl.querySelector('[data-crossfade]').value));
          engine.notify('Transición nativa aplicada en Spotify.');
        });
      } else if ('restoretransition' in d) {
        perform(async () => {
          await transitions.restore();
          engine.notify('Ajuste de transición anterior restaurado.');
        });
      } else if ('follow' in d) {
        perform(() => engine.command('sigue esta canción'));
      } else if ('openpicker' in d) {
        engine.prepareChoices();
      } else if (d.vibe !== undefined) {
        perform(() => engine.updateSettings({ discovery: Number(d.vibe) }));
      } else if ('librarysync' in d) {
        perform(() => engine.syncLibrary(true));
      } else if ('loadplaylist' in d) {
        const uri = pageEl.querySelector('[data-playlists]').value;
        if (uri) perform(() => engine.syncLibrary(true, uri));
      } else if ('again' in d) {
        engine.nextChoices();
      } else if ('resetdeck' in d) {
        engine.nextChoices(true);
      } else if ('closepicker' in d) {
        engine.choosing = false;
        update();
      } else if ('toggle' in d) {
        perform(() => (engine.active ? engine.stop() : engine.current ? engine.start() : engine.prepareChoices()));
      } else if ('stopbtn' in d || 'restore' in d) {
        perform(() => engine.stop());
      } else if ('refresh' in d) {
        perform(() => engine.refresh());
      } else if (d.feedback) {
        perform(() => engine.feedbackFor(engine.current, d.feedback));
      } else if ('undo' in d) {
        perform(() => engine.undoFeedback());
      } else if (d.reject) {
        perform(() => engine.feedbackFor(engine.preview.find(t => t.uid === d.reject), 'less'));
      } else if (d.pin) {
        engine.reserve(engine.preview.find(t => t.uid === d.pin));
        update();
      } else if (d.tab) {
        setTab(d.tab);
      } else if ('closepage' in d) {
        closeBooth();
      } else if ('openspicy' in d || 'openextlyrics' in d) {
        detectExternalLyrics()?.open();
      } else if ('prev' in d) {
        S.Player.back?.();
      } else if ('nextsong' in d) {
        S.Player.next?.();
      } else if ('toggleplay' in d) {
        S.Player.togglePlay?.();
        setTimeout(() => {
          update();
          startFrame();
        }, 120);
      } else if (d.example) {
        const inp = pageEl.querySelector('#pd-command');
        inp.value = d.example;
        inp.focus();
      } else if ('voice' in d) {
        narrator.toggle();
        engine.updateSettings({ voice: narrator.enabled }, false);
      } else if ('testvoice' in d) {
        narrator.volume = (engine.settings.voiceVolume ?? 90) / 100;
        narrator.speed = (engine.settings.voiceSpeed ?? 100) / 100;
        if (!narrator.enabled) narrator.toggle();
        voiceGate.run(
          'next',
          { name: engine.current?.name || 'tu canción', artists: engine.current?.artists || [], evidence: 'tu playlist' },
          engine.intent,
          { local: true }
        );
      } else if ('recheckvoice' in d) {
        narrator.neural.health(true).then(() => update()).catch(() => {});
      } else if ('recovervolume' in d) {
        recoverVolume();
      } else if ('export' in d) {
        download(engine.exportProfile(), 'poor-dj-profile.json');
      } else if ('savesession' in d) {
        perform(() => engine.saveSession());
      } else if ('diagnose' in d) {
        perform(async () => {
          const out = pageEl.querySelector('[data-diagresult]');
          out.textContent = 'Comprobando…';
          const r = await diagnose();
          out.innerHTML =
            r.rows
              .map(
                x =>
                  `<li class="${x.ok === false ? 'pd-error' : ''}">${x.ok === false ? '✕' : x.ok ? '✓' : '·'} <b>${esc(x.name)}</b>: ${esc(x.detail)}</li>`
              )
              .join('') + `<li><b>${r.problems ? r.problems + ' problema(s)' : 'Todo responde'}</b></li>`;
        });
      } else if ('import' in d) {
        pageEl.querySelector('[data-file]').click();
      } else if ('reset' in d && root.confirm('¿Borrar el aprendizaje local de POOR DJ?')) {
        engine.memory = {};
        engine.contexts = {};
        engine.preferences = {};
        engine.taste = { artists: {} };
        engine.undoVote = null;
        engine.pool = null;
        engine.save();
        engine.refresh();
      } else if ('cacheclear' in d) {
        audio.clear();
        engine.notify('Caché acústica borrada.');
      }
    };

    lyricsView = addView(el.querySelector('[data-pane="lyrics"]'), () => L.tab === 'lyrics');
    wireLyrics(lyricsView);

    el.querySelector('[data-tabs]').onkeydown = e => {
      const order = ownLyrics() ? ['dj', 'lyrics', 'settings'] : ['dj', 'settings'];
      const cur = order.indexOf(L.tab);
      if (e.key === 'ArrowRight') {
        const nextTab = order[(cur + 1) % order.length];
        setTab(nextTab);
        el.querySelector(`[data-tab="${nextTab}"]`).focus();
      } else if (e.key === 'ArrowLeft') {
        const nextTab = order[(cur - 1 + order.length) % order.length];
        setTab(nextTab);
        el.querySelector(`[data-tab="${nextTab}"]`).focus();
      }
    };

    el.querySelectorAll('[data-progress]').forEach(bar => {
      bar.onclick = e => {
        const r = e.currentTarget.getBoundingClientRect();
        const d = S.Player.getDuration?.();
        if (d) {
          seek(Math.round(d * Math.min(1, Math.max(0, (e.clientX - r.left) / r.width))));
          frameBody();
        }
      };
    });

    el.querySelector('[data-sleep]').onchange = e => {
      L.sleep = Number(e.target.value);
      L.sleepAt = L.sleep ? Date.now() + L.sleep * 60000 : 0;
      engine.notify(L.sleep ? `El DJ terminará en ${L.sleep} minutos.` : 'Temporizador apagado.');
    };

    el.querySelector('[data-command]').onsubmit = event => {
      event.preventDefault();
      perform(() => engine.command(el.querySelector('#pd-command').value));
    };

    el.querySelector('[data-tag]').onsubmit = event => {
      event.preventDefault();
      perform(() =>
        engine.tagPlaylist(
          el
            .querySelector('#pd-tag')
            .value.split(',')
            .map(words)
            .filter(Boolean)
        )
      );
    };

    el.querySelector('[data-voicepick]').onchange = e => {
      const v = e.target.value;
      const on = v !== 'off';
      if (narrator.enabled !== on) narrator.toggle();
      if (on) {
        narrator.prefer(v);
        narrator.volume = (engine.settings.voiceVolume ?? 90) / 100;
        narrator.speed = (engine.settings.voiceSpeed ?? 100) / 100;
        engine.updateSettings({ voice: true, voiceName: v }, false);
        voiceGate.run(
          'next',
          { name: engine.current?.name || 'tu canción', artists: engine.current?.artists || [], evidence: 'tu playlist' },
          engine.intent,
          { local: true }
        );
      } else {
        engine.updateSettings({ voice: false }, false);
      }
      update();
    };

    el.querySelectorAll('[data-select]').forEach(input => {
      input.onchange = () => {
        const key = input.dataset.select;
        const val = ['queueSize', 'flowStrength', 'discovery'].includes(key) ? Number(input.value) : input.value;
        perform(() => engine.updateSettings({ [key]: val }, ['queueSize', 'discovery'].includes(key)));
      };
    });

    el.querySelectorAll('[data-range]').forEach(input => {
      input.oninput = () => {
        const key = input.dataset.range;
        const val = Number(input.value);
        engine.updateSettings({ [key]: val }, false);
        narrator.volume = (engine.settings.voiceVolume ?? 90) / 100;
        narrator.speed = (engine.settings.voiceSpeed ?? 100) / 100;
        update();
      };
    });

    el.querySelectorAll('[data-setting]').forEach(input => {
      input.onchange = () =>
        perform(() => {
          if (input.dataset.setting === 'lyricsExternal') L.uri = '';
          return engine.updateSettings(
            { [input.dataset.setting]: input.checked },
            ['explicit', 'takeover'].includes(input.dataset.setting)
          );
        });
    });

    el.querySelector('[data-file]').onchange = event =>
      perform(async () => {
        const file = event.target.files[0];
        if (!file) return;
        if (file.size > 2000000) throw Error('El perfil supera 2 MB');
        await engine.importProfile(JSON.parse(await file.text()));
        narrator.enabled = engine.settings.voice;
        narrator.prefer(engine.settings.voiceName);
        event.target.value = '';
      });

    return el;
  }

  function closePage() {
    if (document.fullscreenElement && (!pageEl || document.fullscreenElement === pageEl)) {
      try {
        document.exitFullscreen?.().catch?.(() => {});
      } catch (_) {}
    }
    cancelAnimationFrame(L.raf);
    L.raf = 0;
    pageEl?.remove();
    pageEl = null;
    lyricsView = null;
  }

  function update() {
    ensurePlayerButton();
    if (playerButton) playerButton.classList.toggle('main-genericButton-buttonActive', onRoute() || engine.active);
    if (fallbackButton) fallbackButton.active = onRoute() || engine.active;

    const recentCaption = narrator.text && Date.now() - (narrator.textAt || 0) < 7000;
    const onBooth = onRoute();
    const showToast = (narrator.speaking || recentCaption) && !!narrator.text && !onBooth;
    toast.hidden = !showToast;
    if (showToast && !narrator.speaking) {
      clearTimeout(L.toastTimer);
      L.toastTimer = setTimeout(() => update(), 7100);
    }
    if (showToast) {
      theme(toast);
      toast.innerHTML = `<span class="pd-toast-ring"><span class="pd-eq" aria-hidden="true"><i></i><i></i><i></i></span></span><div class="pd-toastdj-body"><b>DJ POOR</b><span>${esc(narrator.text)}</span></div>`;
    }

    theme(mini);
    mini.hidden = !engine.settings.mini || !engine.active || onBooth;
    if (!mini.hidden) {
      const mUrl = imageURL(engine.current?.image);
      const mImg = mini.querySelector('[data-minicover]');
      mImg.hidden = !mUrl;
      if (mUrl && mImg.getAttribute('src') !== mUrl) mImg.src = mUrl;
      mini.querySelector('[data-minitext]').textContent = narrator.speaking
        ? 'DJ al micro'
        : engine.current?.name || 'DJ activo';
    }

    if (!onBooth) {
      if (pageEl) closePage();
      return;
    }

    if (!pageEl?.isConnected) {
      const host = mainView();
      if (!host) return;
      document.getElementById('PoorDJPage')?.remove();
      pageEl = buildBoothDOM();
      host.append(pageEl);
      L.uri = '';
      setTab(L.tab);
      narrator.neural.health().catch(() => {});
      transitions.refresh().then(update).catch(() => {});
    } else if (pageEl.dataset.tab !== L.tab) {
      setTab(L.tab);
    }

    theme(pageEl);
    pageEl.dataset.lyrics = String(engine.settings.lyrics);
    pageEl.dataset.lsize = engine.settings.lyricsSize;
    pageEl.dataset.playing = String(S.Player.isPlaying());
    pageEl.dataset.full = String(document.fullscreenElement === pageEl);
    const exitFullBtn = pageEl.querySelector('[data-exitfull]');
    if (exitFullBtn) exitFullBtn.hidden = document.fullscreenElement !== pageEl;
    tint();

    const talking = !!narrator.speaking;
    pageEl.dataset.dj = String(talking);

    setText(
      'livetext',
      talking
        ? 'DJ al micro'
        : engine.choiceBusy
        ? 'Reproduciendo'
        : engine.active
        ? engine.busy
          ? 'Eligiendo…'
          : 'En vivo'
        : 'Tú tienes el control'
    );
    pageEl.querySelector('[data-live]').classList.toggle('pd-active', engine.active || talking);

    const coverUrl = imageURL(engine.current?.image);
    for (const sel of ['[data-cover]', '[data-bgcover]', '[data-lyricscover]', '[data-lyricsaura]']) {
      const img = pageEl.querySelector(sel);
      if (!img) continue;
      img.hidden = !coverUrl;
      if (coverUrl && img.getAttribute('src') !== coverUrl) img.src = coverUrl;
    }

    const micOverlay = pageEl.querySelector('[data-micoverlay]');
    micOverlay.hidden = !talking;
    if (talking) setText('miccaption', narrator.text || '');

    const curTitle = engine.current?.name || 'Reproduce algo que te guste';
    const curArtist = engine.current?.artists.map(a => a.name).join(', ') || 'Tu próxima sesión empieza contigo.';
    setText('title', curTitle);
    setText('artist', curArtist);
    setText('lyricstitle', curTitle);
    setText('lyricsartist', curArtist);
    setText('why', currentReasonLabel());

    const isPlaying = S.Player.isPlaying();
    pageEl.querySelectorAll('[data-toggleplay]').forEach(playBtn => {
      playBtn.innerHTML = isPlaying ? ICONS.pause : ICONS.play;
      playBtn.setAttribute('aria-label', isPlaying ? 'Pausar' : 'Reproducir');
    });

    pageEl.querySelector('[data-feedbackrow]').hidden = !engine.active;
    pageEl.querySelector('[data-undo]').disabled = !engine.undoVote;
    pageEl.querySelectorAll('[data-feedback]').forEach(b => {
      b.disabled = !engine.current || !!engine.choiceBusy;
    });

    pageEl.querySelector('[data-idleview]').hidden = engine.active;
    pageEl.querySelector('[data-upnextcard]').hidden = !engine.active;
    pageEl.querySelector('[data-statsrow]').hidden = !engine.active && !engine.sessionHeardMs;
    pageEl.querySelector('[data-activeactions]').hidden = !engine.active;

    // Vibe cards selection
    const activeVibe = engine.intent.known ? '0' : engine.settings.discovery >= 60 ? '75' : '35';
    pageEl.querySelectorAll('[data-vibe]').forEach(b => {
      const on = b.dataset.vibe === activeVibe;
      b.classList.toggle('pd-selected', on);
      b.setAttribute('aria-pressed', String(on));
    });

    const toggle = pageEl.querySelector('[data-toggle]');
    toggle.textContent = engine.current ? 'Iniciar DJ' : 'Elegir canción para empezar';
    toggle.disabled = !!engine.choiceBusy || engine.busy;

    const restoreBtn = pageEl.querySelector('[data-restore]');
    restoreBtn.hidden = !(engine.captured || (engine.managed.length && !engine.active));
    restoreBtn.disabled = engine.busy || !!engine.choiceBusy;

    // Known song picker
    const chooser = pageEl.querySelector('[data-picker]');
    chooser.hidden = !engine.choosing;
    const cardKey = JSON.stringify([engine.deck.pair.map(t => [t.uri, t.name, t.image, t.evidence]), engine.choiceBusy]);
    if (chooser._key !== cardKey) {
      chooser._key = cardKey;
      pageEl.querySelector('[data-cards]').innerHTML = cards(engine.deck.pair, 'choice');
    }
    setText(
      'pickernote',
      engine.deck.pair.length
        ? `${engine.deck.tracks.length} canciones conocidas · ${Math.max(0, engine.deck.tracks.length - engine.deck.offset)} por explorar. Elige una para guiar la sesión.`
        : engine.deck.tracks.length
        ? 'Ya viste todas las opciones. Reinicia la selección para revisarlas.'
        : 'No hay canciones conocidas disponibles. Lee una playlist o actualiza tus Me gusta en Ajustes.'
    );
    pageEl.querySelector('[data-again]').disabled = engine.deck.exhausted || !!engine.choiceBusy;
    pageEl.querySelector('[data-resetdeck]').hidden = !engine.deck.exhausted || !engine.deck.tracks.length;

    // Up next list
    pageEl.querySelector('[data-refresh]').disabled = !engine.active || engine.busy;
    const ordered = engine.active
      ? (queue()?.priority || []).slice(0, 8).map(t => ({
          ...t,
          ...engine.preview.find(p => sameEntry(p, t)),
          manual: !engine.managed.some(m => sameEntry(m, t))
        }))
      : [];
    const nextKey = JSON.stringify(
      ordered.map(t => [t.uri, t.uid, t.reason, t.manual, t.image, engine.pinned && sameEntry(t, engine.pinned)])
    );
    const list = pageEl.querySelector('[data-next]');
    if (list._key !== nextKey) {
      list._key = nextKey;
      list.innerHTML =
        ordered
          .map(
            t =>
              `<div class="pd-next">
                <span class="pd-next-thumb">${imageURL(t.image) ? `<img src="${esc(imageURL(t.image))}" alt="">` : ICONS.disc}</span>
                <div class="pd-next-info">
                  <b>${esc(t.name)}</b>
                  <small>${esc(t.artists.map(a => a.name).join(', '))}</small>
                  <div class="pd-next-tags">
                    <span class="${t.manual ? 'pd-manual-tag' : 'pd-reason-tag'}">${esc(
                      t.manual ? 'Tu elección' : t.reason || engine.reason(t, engine.current)
                    )}</span>
                    ${t.manual ? '' : `<span class="pd-flow-note">${esc(t.transition || transitionLabel(engine.current?.audio, t.audio))}</span>`}
                  </div>
                </div>
                ${
                  t.manual
                    ? ''
                    : `<div class="pd-next-actions">
                        <button data-pin="${esc(t.uid)}" aria-label="Reservar ${esc(t.name)}" aria-pressed="${!!(engine.pinned && sameEntry(engine.pinned, t))}">${ICONS.pin}</button>
                        <button data-reject="${esc(t.uid)}" aria-label="No encaja: ${esc(t.name)}">${ICONS.x}</button>
                      </div>`
                }
              </div>`
          )
          .join('') || '<p class="pd-empty">Preparando sugerencias para la cola…</p>';
    }

    // Session stats
    setText('statmin', Math.floor(engine.sessionHeardMs / 60000));
    setText('stattracks', engine.played);
    setText('statartists', engine.artistSet.size);
    setText('statnew', engine.discoveries);

    // Command box & examples
    setText('cmdlabel', engine.active ? 'Dirige al DJ' : '¿Qué quieres escuchar?');
    const artist0 = engine.current?.artists?.[0]?.name || '';
    const examples = [
      'más variedad',
      'solo conocidas',
      'descubrir',
      'sigue esta canción',
      ...(artist0 ? ['sin ' + artist0] : [])
    ];
    const exBox = pageEl.querySelector('[data-examples]');
    const exKey = JSON.stringify([engine.active, examples]);
    if (exBox._key !== exKey) {
      exBox._key = exKey;
      exBox.innerHTML = engine.active
        ? examples.map(ex => `<button type="button" data-example="${esc(ex)}">${esc(ex)}</button>`).join('')
        : '';
    }

    const labels = intentLabels(engine.intent);
    const chips = pageEl.querySelector('[data-intent]');
    chips.hidden = !engine.active;
    if (chips._key !== JSON.stringify(labels)) {
      chips._key = JSON.stringify(labels);
      chips.innerHTML = labels.map(label => `<span class="pd-chip">${esc(label)}</span>`).join('');
    }

    // Search results & artist menu
    const matchBox = pageEl.querySelector('[data-matches]');
    const menu = pageEl.querySelector('[data-artistmenu]');
    const hasResults = !!(engine.commandChoices.length || engine.commandArtists.length || engine.artistMenu);
    matchBox.hidden = !hasResults || !!engine.artistMenu;
    menu.hidden = !engine.artistMenu;
    pageEl.querySelector('[data-closesearch]').hidden = !hasResults;
    pageEl.querySelector('[data-closesearch]').disabled = !!engine.choiceBusy;
    const matchKey = JSON.stringify([engine.commandChoices.map(t => [t.uri, t.name, t.image]), engine.commandArtists]);
    if (matchBox._key !== matchKey) {
      matchBox._key = matchKey;
      const artists = engine.commandArtists.length
        ? engine.commandArtists
        : [
            ...new Map(
              engine.commandChoices
                .flatMap(t => t.artists)
                .filter(a => words(a.name).includes(words(engine.pendingCommand?.target?.title)))
                .map(a => [a.uri, a])
            ).values()
          ];
      matchBox.innerHTML =
        '<small class="pd-note">Resultados de Spotify</small><div class="pd-results">' +
        artists
          .map(
            a =>
              `<button class="pd-choice pd-result" data-mixartist="${esc(a.uri)}">
                <span class="pd-choicecover pd-artist-photo">${imageURL(a.image) ? `<img src="${esc(imageURL(a.image))}" alt="" loading="eager">` : ICONS.disc}</span>
                <b>${esc(a.name)}</b>
                <small>Artista · elegir mezcla</small>
              </button>`
          )
          .join('') +
        cards(engine.commandChoices, 'match') +
        '</div>';
    }
    if (engine.artistMenu && menu._key !== engine.artistMenu.uri) {
      const a = engine.artistMenu;
      menu._key = a.uri;
      menu.innerHTML = `
        <div class="pd-menuhead">
          <h3>${esc(a.name)}</h3>
          <button class="pd-secondary" data-closeartist aria-label="Volver a resultados">${ICONS.arrowLeft}<span>Volver</span></button>
        </div>
        <p class="pd-note">Elige el rumbo. Guardamos una playlist privada y devolvemos tu cola al terminar.</p>
        <div class="pd-cards">
          <button class="pd-choice pd-mode" data-artistmode="mix" data-artisturi="${esc(a.uri)}" aria-label="Aleatorio">
            <b>Aleatorio ↗</b>
            <small>Mucho de este artista, con canciones afines entre medias.</small>
          </button>
          <button class="pd-choice pd-mode" data-artistmode="only" data-artisturi="${esc(a.uri)}" aria-label="Artista">
            <b>Solo artista ↻</b>
            <small>Su catálogo y colaboraciones. Toda la mezcla gira alrededor de él.</small>
          </button>
        </div>`;
    }
    pageEl.querySelectorAll('[data-mixartist],[data-match],[data-artistmode]').forEach(n => {
      n.disabled = !!engine.choiceBusy;
    });

    setText('status', engine.status);
    pageEl.querySelector('[data-status]').classList.toggle('pd-error', engine.error);

    pageEl.querySelector('[data-savesession]').disabled = engine.sessionList.length < 2 || engine.busy;
    pageEl.querySelector('[data-stopbtn]').disabled = !!engine.choiceBusy || engine.busy;
    pageEl.querySelector('[data-mixcard]').hidden = !engine.mixPlaylist;
    setText('savedmix', engine.mixPlaylist ? `${engine.mixPlaylist.name} · ${engine.mixPlaylist.count} canciones` : '');

    // Voice & settings tab
    const voiceBtn = pageEl.querySelector('[data-voice]');
    voiceBtn.disabled = !narrator.voice;
    voiceBtn.innerHTML = narrator.enabled ? ICONS.mic : ICONS.micOff;
    voiceBtn.setAttribute('aria-pressed', String(narrator.enabled));
    voiceBtn.setAttribute('aria-label', narrator.enabled ? 'Silenciar voz' : 'Activar voz');

    const serverPill = pageEl.querySelector('[data-serverpill]');
    serverPill.classList.toggle('pd-ok', !!narrator.neural.ok);
    serverPill.textContent = narrator.neural.ok
      ? `Voz neuronal local: conectada ✓ (${narrator.neural.voices.length} voces)`
      : 'Voz neuronal local: no detectada (usando respaldo del sistema)';
    pageEl.querySelector('[data-serverhint]').hidden = !!narrator.neural.ok;

    setText(
      'voicestatus',
      !narrator.voice
        ? 'No hay voz en español disponible. Los comentarios siguen por escrito.'
        : narrator.voice.neural
        ? `Usando voz neuronal local (${narrator.voice.label}).`
        : narrator.voice.localService
        ? `Usando voz local del sistema (${narrator.voice.name}).`
        : 'Voz en línea: el texto del comentario se envía a su proveedor.'
    );
    pageEl.querySelector('[data-voicestatus]').hidden = !pageEl.querySelector('[data-voicestatus]').textContent;

    const pick = pageEl.querySelector('[data-voicepick]');
    const vlist = narrator.voices();
    const pickKey = JSON.stringify(vlist.map(v => [v.name, v.label || v.name]));
    if (pick._key !== pickKey) {
      pick._key = pickKey;
      pick.innerHTML =
        '<option value="">Automática (mejor local)</option><option value="off">Sin voz (solo subtítulos)</option>' +
        vlist
          .map(
            v =>
              `<option value="${esc(v.name)}">${esc(v.label || `${v.name} · ${v.lang}`)}${
                v.localService ? '' : ' · en línea'
              }</option>`
          )
          .join('');
    }
    if (document.activeElement !== pick) {
      pick.value = !engine.settings.voice
        ? 'off'
        : vlist.some(v => v.name === engine.settings.voiceName)
        ? engine.settings.voiceName
        : '';
    }

    setText('ducklabel', engine.settings.duckLevel + '%');
    setText('vvollabel', engine.settings.voiceVolume + '%');
    setText('vspdlabel', (engine.settings.voiceSpeed / 100).toFixed(2) + 'x');
    pageEl.querySelectorAll('[data-range]').forEach(input => {
      if (document.activeElement !== input) input.value = engine.settings[input.dataset.range];
    });

    pageEl.querySelectorAll('[data-select]').forEach(input => {
      if (document.activeElement !== input) input.value = String(engine.settings[input.dataset.select]);
    });
    pageEl.querySelectorAll('[data-setting]').forEach(input => {
      input.checked = !!engine.settings[input.dataset.setting];
      input.disabled = input.dataset.setting === 'takeover' && (engine.active || engine.busy);
    });

    setText('library', engine.libraryBusy ? 'Leyendo tu biblioteca…' : library.status);
    pageEl.querySelector('[data-librarysync]').disabled = !!engine.libraryBusy;
    const playlists = pageEl.querySelector('[data-playlists]');
    const playlistKey = JSON.stringify(library.playlists);
    if (playlists._key !== playlistKey) {
      const selected = playlists.value;
      playlists._key = playlistKey;
      playlists.innerHTML =
        '<option value="">Elige una playlist de tu biblioteca</option>' +
        library.playlists.map(p => `<option value="${esc(p.uri)}">${esc(p.name)}</option>`).join('');
      playlists.value = selected;
    }
    pageEl.querySelector('[data-loadplaylist]').disabled = !!engine.libraryBusy;

    const native = transitions.state();
    setText(
      'transitionstatus',
      native.enabled
        ? `Crossfade de Spotify: ${native.seconds} s. Se priorizan tempo, tono y nivel cuando hay datos.`
        : 'Crossfade de Spotify apagado. Se prioriza continuidad musical cuando hay datos.'
    );
    pageEl.querySelector('[data-applytransition]').disabled = !native.available;
    pageEl.querySelector('[data-restoretransition]').disabled = !native.available;
    pageEl.querySelector('[data-recovervolume]').hidden = !recovery();

    // Tabs visibility and external lyrics provider choice
    const extLyrics = detectExternalLyrics();
    const extActive = useExternalLyrics();
    const lpWrap = pageEl.querySelector('[data-lyricsproviderwrap]');
    const lpSelect = pageEl.querySelector('[data-select="lyricsProvider"]');
    lpWrap.hidden = !extLyrics;
    if (extLyrics && lpSelect._key !== extLyrics.id) {
      lpSelect._key = extLyrics.id;
      lpSelect.innerHTML = `<option value="auto">Usar ${esc(extLyrics.name)} (recomendado)</option><option value="builtin">Usar letras integradas de POOR DJ</option>`;
    }
    if (extLyrics && document.activeElement !== lpSelect) {
      lpSelect.value = engine.settings.lyricsProvider;
    }

    const lyricsTabBtn = pageEl.querySelector('[data-tab="lyrics"]');
    lyricsTabBtn.hidden = !ownLyrics();
    if (!ownLyrics() && L.tab === 'lyrics') setTab('dj');

    const openExtBtn = pageEl.querySelector('[data-openspicy]');
    openExtBtn.hidden = !extActive;
    if (extActive && extLyrics && openExtBtn._key !== extLyrics.id) {
      openExtBtn._key = extLyrics.id;
      openExtBtn.innerHTML = `${ICONS.external}<span>${esc(extLyrics.name)} ↗</span>`;
    }

    const headExtBtn = pageEl.querySelector('[data-openextlyrics]');
    headExtBtn.hidden = !(extLyrics && !extActive);
    if (extLyrics && !extActive && headExtBtn._key !== extLyrics.id) {
      headExtBtn._key = extLyrics.id;
      headExtBtn.innerHTML = `${ICONS.external}<span>Abrir en ${esc(extLyrics.name)} ↗</span>`;
    }

    pageEl.querySelectorAll('[data-setting=lyrics],[data-setting=lyricsExternal]').forEach(i => {
      i.closest('label').hidden = extActive;
    });
    pageEl.querySelector('[data-lrclibnote]').hidden = extActive;

    setText(
      'offsetlabel',
      (engine.settings.lyricsOffset > 0 ? '+' : '') +
        (engine.settings.lyricsOffset / 1000).toFixed(2).replace(/\.?0+$/, '') +
        ' s'
    );

    loadLyrics();
    startFrame();
  }

  const onFullscreen = () => {
    if (!pageEl) return;
    const isFull = document.fullscreenElement === pageEl;
    pageEl.dataset.full = String(isFull);
    const exitBtn = pageEl.querySelector('[data-exitfull]');
    if (exitBtn) exitBtn.hidden = !isFull;
    if (L.tab === 'lyrics') {
      resetViews();
      requestAnimationFrame(tickLyrics);
    }
  };
  document.addEventListener('fullscreenchange', onFullscreen);

  const unlisten = S.Platform.History?.listen?.(loc => {
    const p = loc?.pathname ?? S.Platform.History?.location?.pathname;
    if (p && p !== ROUTE) lastNonDjPath = p;
    update();
  });

  function open() {
    if (!onRoute()) {
      S.Platform.History.push(ROUTE);
    }
    update();
  }

  return {
    open,
    update,
    openLyrics: () => {
      L.tab = 'lyrics';
      if (!onRoute()) S.Platform.History.push(ROUTE);
      else update();
    },
    dispose: () => {
      clearTimeout(fallbackTimer);
      clearTimeout(L.toastTimer);
      toast.remove();
      closePage();
      unlisten?.();
      fallbackButton?.deregister?.();
      playerButtonObserver.disconnect();
      document.removeEventListener('fullscreenchange', onFullscreen);
      document.removeEventListener('keydown', shortcut, true);
      cancelAnimationFrame(playerButtonFrame);
      playerButton?.remove();
      cancelAnimationFrame(L.raf);
      L.raf = 0;
      mini.remove();
      style.remove();
    }
  };
}

const ICON =
  '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2"/><path d="M5 12a7 7 0 0 1 7-7m0 14a7 7 0 0 0 7-7M7 15V9h3"/></svg>';
const esc = x =>
  String(x || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const imageURL = uri => (uri?.startsWith('spotify:image:') ? `https://i.scdn.co/image/${uri.split(':').pop()}` : uri);

let bootTries = 0;
async function boot() {
  const S = root.Spicetify;
  const needs = {
    Player: S?.Player?.data,
    CosmosAsync: S?.CosmosAsync,
    'Platform.LocalStorageAPI': S?.Platform?.LocalStorageAPI
  };
  const missing = Object.keys(needs).filter(k => !needs[k]);
  if (missing.length) {
    if (++bootTries === 120) {
      try {
        S?.showNotification?.(
          'POOR DJ no pudo iniciarse: tu Spicetify no ofrece ' +
            missing.join(', ') +
            '. Actualiza Spicetify y reinicia Spotify.',
          true
        );
      } catch (_) {}
    }
    if (bootTries <= 120) setTimeout(boot, 500);
    return;
  }
  if (root.PoorDJ?.version === VERSION) return;
  if (root.PoorMansDJ) {
    S.showNotification?.('POOR DJ: elimina la instalación duplicada y reinicia Spotify.', true);
    return;
  }

  const storage = S.Platform.LocalStorageAPI;
  const requests = new RequestCache();
  const library = new MusicLibrary(S.Platform, requests);
  let audioSaved = {};
  try {
    audioSaved = storage.getItem('poor-dj-audio-v2') || {};
  } catch (_) {}
  const audio = new AudioLibrary(
    S.getAudioData ? uri => S.getAudioData(uri) : null,
    audioSaved,
    data => storage.setItem('poor-dj-audio-v2', data)
  );

  const hashes = {
    queryArtistOverview: '9f8134ef565e78621f1e1793555bd6633c5ac144ae0f89604ed3ae3f80b3c8e6',
    searchTracks: 'b02683192a98dde7966b5e6655a79eeb62713eab703eda9902c932818dd52751',
    searchArtists: '7bf95d754fdbe32c8b161fbbe54d1ae50974900df4dce4c8f1afcbcad153224d',
    queryArtistDiscographyAll: '5e07d323febb57b4a56a42abbf781490e58764aa45feb6e3dc0591564fc56599',
    getAlbum: '6a74b456cd1735c9193d9e8ec8cc5184cad7ce13572210315229db3975964361'
  };

  function query(name, variables) {
    return requests.get(name + JSON.stringify(variables), () => {
      if (typeof S.GraphQL?.Request !== 'function') throw Error('Spotify aún no ofrece consultas musicales');
      return S.GraphQL.Request(queryDefinition(S.GraphQL, name, hashes[name]), variables);
    });
  }

  function queue() {
    const q = S.Queue;
    if (!Array.isArray(q?.nextTracks)) return null;
    const result = { all: [], priority: [] };
    for (const t of q.nextTracks) {
      const track = normalize(t) || {
        uri: unwrap(t)?.uri,
        uid: unwrap(t)?.uid || t.uid,
        name: unwrap(t)?.metadata?.title || '',
        artists: [],
        source: 'contexto'
      };
      if (track.uri) {
        track.playlist = t.provider === 'context' && /^spotify:playlist:/.test(S.Player.data?.context?.uri || '');
        result.all.push(track);
        if (t.provider === 'queue') result.priority.push(track);
      }
    }
    return result;
  }

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  async function add(tracks) {
    if (!S.Player.origin?._queue?.addToQueue) throw new Error('El control de cola no está disponible');
    const before = queue();
    if (!before) throw new Error('Cola no disponible');
    let failure;
    try {
      await S.addToQueue(tracks.map(t => ({ uri: t.uri })));
    } catch (e) {
      failure = e;
    }
    let inserted = [];
    for (let i = 0; i < 40; i++) {
      const q = queue();
      inserted = (q?.priority || []).filter(t => t.uid && !before.priority.some(b => sameEntry(t, b)));
      const remaining = inserted.slice();
      const ordered = tracks.map(t => {
        const n = remaining.findIndex(x => x.uri === t.uri);
        return n >= 0 ? remaining.splice(n, 1)[0] : null;
      });
      if (ordered.every(Boolean)) return ordered;
      await sleep(150);
    }
    const partial = inserted.filter(t => tracks.some(x => x.uri === t.uri));
    if (partial.length) await remove(partial);
    throw failure || new Error('Spotify no confirmó la inserción completa');
  }

  async function remove(tracks) {
    if (tracks.some(t => !t.uid)) throw new Error('Entrada de cola sin identificador');
    let failure;
    try {
      await S.removeFromQueue(tracks.map(reference));
    } catch (e) {
      failure = e;
    }
    for (let i = 0; i < 40; i++) {
      const q = queue();
      if (q && tracks.every(t => !q.priority.some(x => sameEntry(t, x)))) return;
      await sleep(150);
    }
    throw failure || new Error('Spotify no confirmó la retirada');
  }

  const radioCache = new Map();
  async function radio(uri) {
    if (!valid(uri)) return { tracks: [], relatedArtists: [] };
    const cached = radioCache.get(uri);
    if (cached && Date.now() - cached.at < 1800000) return cached.data;

    let tracks = [];
    let relatedArtists = [];
    try {
      const mix = await S.CosmosAsync.get(
        `https://spclient.wg.spotify.com/inspiredby-mix/v2/seed_to_playlist/${encodeURIComponent(uri)}?response-format=json`
      );
      const plUri = mix?.mediaItems?.[0]?.uri;
      if (plUri && S.Platform?.PlaylistAPI?.getContents) {
        const contents = await S.Platform.PlaylistAPI.getContents(plUri, { offset: 0, limit: 100 });
        const items = contents?.items || [];
        tracks = items
          .map((item, idx) => {
            const norm = normalize(item, 'radio');
            return norm && norm.uri !== uri ? { ...norm, radioRank: idx } : null;
          })
          .filter(Boolean);
      }
    } catch (_) {}

    if (!tracks.length) {
      try {
        const apollo = await S.CosmosAsync.get(
          `https://spclient.wg.spotify.com/radio-apollo/v3/stations/${encodeURIComponent(uri)}?count=50&autoplay=true`
        );
        tracks = (apollo?.tracks || [])
          .map((item, idx) => {
            const norm = normalize(item, 'radio');
            return norm && norm.uri !== uri ? { ...norm, radioRank: idx } : null;
          })
          .filter(Boolean);
        relatedArtists = (apollo?.related_artists || []).map(a => a?.uri).filter(Boolean);
      } catch (_) {}
    }

    const data = { tracks, relatedArtists };
    if (tracks.length) {
      radioCache.set(uri, { at: Date.now(), data });
      while (radioCache.size > 40) radioCache.delete(radioCache.keys().next().value);
    }
    return data;
  }

  async function candidates(seed, settings, all, { widen = false } = {}) {
    if (engine.intent.artist) seed = { ...seed, artists: [engine.intent.artist] };
    await library.load(S.Player.data?.context?.uri || '');
    if (!engine.active) return [];

    const local = engine.knownTracks();
    const groups = [{ tracks: local, source: 'tu colección', familiar: true, trusted: widen }];
    if (engine.intent.artist) {
      groups.push({ tracks: await artistTracks(engine.intent.artist), source: 'artista actual' });
    }

    const activeSeeds = [seed, ...engine.seeds.slice(-2)].filter(
      (s, idx, arr) => s?.uri && arr.findIndex(x => x.uri === s.uri) === idx
    );
    const radioResponses = await Promise.allSettled(
      (engine.intent.artistMode === 'only' ? [] : activeSeeds.slice(0, !engine.intent.known || widen ? 2 : 1)).map(s =>
        radio(s.uri)
      )
    );
    const radioTracks = [];
    const radioArtists = new Set();
    const radioRankByUri = new Map();
    for (const res of radioResponses) {
      if (res.status !== 'fulfilled' || !res.value) continue;
      for (const aUri of res.value.relatedArtists || []) radioArtists.add(aUri);
      for (const rt of res.value.tracks || []) {
        radioTracks.push(rt);
        if (!radioRankByUri.has(rt.uri)) radioRankByUri.set(rt.uri, rt.radioRank);
        for (const a of rt.artists || []) {
          const k = artistKey(a);
          if (k) radioArtists.add(k);
        }
      }
    }
    for (const t of local) {
      if (radioRankByUri.has(t.uri)) t.radioRank = radioRankByUri.get(t.uri);
    }

    let overview;
    const artist = seed.artists?.find(a => a.uri?.startsWith('spotify:artist:'));
    if (artist) {
      try {
        overview = await query('queryArtistOverview', { uri: artist.uri, locale: '', preReleaseV2: false });
        if (!engine.intent.known) groups.push({ tracks: collect(overview, 'artista actual'), source: 'artista actual' });
      } catch (_) {}
    }

    const related = new Map();
    const seen = new WeakSet();
    function find(x, inRelated = false) {
      if (!x || typeof x !== 'object' || seen.has(x)) return;
      seen.add(x);
      if (inRelated && x.uri?.startsWith('spotify:artist:') && x.uri !== artist?.uri) related.set(x.uri, x);
      for (const [k, v] of Object.entries(x)) {
        if (v && typeof v === 'object') find(v, inRelated || /related|similar/i.test(k));
      }
    }
    find(overview);
    const allowedArtists = [...new Set([...related.keys(), ...radioArtists])];

    if (!engine.intent.known) {
      if (radioTracks.length && engine.intent.artistMode !== 'only') {
        groups.push({ tracks: radioTracks, source: 'radio', trusted: true });
      }
      const chosen = engine.intent.artistMode !== 'only' ? [...related.keys()].slice(0, 2) : [];
      const responses = await Promise.allSettled(
        chosen.map(uri => query('queryArtistOverview', { uri, locale: '', preReleaseV2: false }))
      );
      responses.forEach(r => {
        if (r.status === 'fulfilled') groups.push({ tracks: collect(r.value, 'artista relacionado'), source: 'artista relacionado' });
      });
      const name = seed.artists?.[0]?.name || '';
      if (name) {
        try {
          groups.push({
            tracks: collect(
              await query('searchTracks', {
                searchTerm: name,
                offset: 0,
                limit: 40,
                numberOfTopResults: 5,
                includeAudiobooks: false,
                includePreReleases: false,
                includeAlbumPreReleases: false
              }),
              'artista actual'
            ),
            source: 'artista actual'
          });
        } catch (_) {}
      }
    }

    const unique = affinityPool(seed, allowedArtists, groups, engine.intent, engine.tags).slice(0, 300);
    if (!engine.active) return [];

    const current = engine.current;
    if (current && typeof S.getAudioData === 'function') {
      const data = await audio.get(current.uri);
      if (engine.active && engine.current === current) current.audio = data;
    }
    unique.sort((a, b) => engine.score(b, engine.recent) - engine.score(a, engine.recent));
    const excluded = new Set([
      engine.current?.uri,
      ...(queue()?.priority || []).map(t => t.uri),
      ...engine.recent.map(t => t.uri),
      ...engine.suspended.map(t => t.uri),
      ...engine.sessionPlayed
    ]);
    let analyzed = unique.filter(
      t =>
        !excluded.has(t.uri) &&
        (settings.explicit || !t.explicit) &&
        (engine.memory[t.uri]?.vote || 0) > -1.5 &&
        Date.now() - (engine.memory[t.uri]?.lastPlayed || 0) > 7200000
    );
    if (engine.intent.artistMode === 'mix') {
      analyzed = [
        ...analyzed.filter(t => hasArtist(t, engine.intent.artist)).slice(0, 6),
        ...analyzed.filter(t => !hasArtist(t, engine.intent.artist)).slice(0, 2)
      ];
    }
    if (typeof S.getAudioData === 'function') {
      await audio.enrich(analyzed, 8);
    }
    return unique;
  }

  let saved = {};
  try {
    saved = storage.getItem('poor-dj-v3') || storage.getItem('poor-dj-v2') || storage.getItem('poor-mans-dj-v1') || {};
    if (!storage.getItem('poor-dj-v3')) storage.setItem('poor-dj-before-v3', saved);
  } catch (_) {}

  const lyrics = new LyricsProvider({
    spotify: async (id, track) => {
      const img = track.image ? imageURL(track.image) : '';
      const base = `https://spclient.wg.spotify.com/color-lyrics/v2/track/${id}`;
      const q = '?format=json&vocalRemoval=false&market=from_token';
      try {
        return await S.CosmosAsync.get(img ? `${base}/image/${encodeURIComponent(img)}${q}` : base + q);
      } catch (e) {
        if (img && !/404/.test(String(e?.status || e?.message))) return S.CosmosAsync.get(base + q);
        throw e;
      }
    },
    external: async track => {
      const c = new AbortController();
      const timer = setTimeout(() => c.abort(), 5000);
      try {
        const p = new URLSearchParams({
          track_name: track.name,
          artist_name: track.artists[0]?.name || '',
          album_name: track.album || '',
          duration: String(Math.round((track.duration || 0) / 1000))
        });
        const r = await fetch('https://lrclib.net/api/get?' + p, { signal: c.signal });
        if (r.status === 404) return null;
        if (!r.ok) throw Error('LRCLIB ' + r.status);
        return await r.json();
      } finally {
        clearTimeout(timer);
      }
    },
    saved: (() => {
      try {
        return storage.getItem('poor-dj-lyrics-misses') || {};
      } catch (_) {
        return {};
      }
    })(),
    persist: data => {
      try {
        storage.setItem('poor-dj-lyrics-misses', data);
      } catch (_) {}
    }
  });

  let view;
  let narrator;
  let voiceGate;
  let internalPlay = false;
  let stopped = false;
  let reconcile = null;
  let progressUI = 0;

  const api = () => (typeof S.Platform.PlayerAPI?.play === 'function' ? S.Platform.PlayerAPI : S.Player.origin);

  async function play(track) {
    if (typeof api()?.play !== 'function') throw Error('Reproducción directa no disponible');
    const manual = (queue()?.priority || []).filter(t => !engine.managed.some(m => sameEntry(m, t)));
    let request;
    internalPlay = true;
    try {
      request = api().play({ uri: track.uri }, {}, {});
    } finally {
      internalPlay = false;
    }
    await request;
    for (let i = 0; i < 40; i++) {
      if (normalize(S.Player.data?.item)?.uri === track.uri) {
        const remaining = queue()?.priority || [];
        const used = new Set();
        const missing = manual.filter(t => {
          const index = remaining.findIndex((r, idx) => !used.has(idx) && r.uri === t.uri);
          if (index < 0) return true;
          used.add(index);
          return false;
        });
        if (missing.length) await add(missing);
        return;
      }
      await sleep(150);
    }
    throw Error('Spotify no confirmó la canción elegida');
  }

  async function resolve(target) {
    const data = await query('searchTracks', {
      searchTerm: [songKey(target.title), target.artist].filter(Boolean).join(' '),
      offset: 0,
      limit: 20,
      numberOfTopResults: 5,
      includeAudiobooks: false,
      includePreReleases: false,
      includeAlbumPreReleases: false
    });
    return collect(data, 'búsqueda')
      .filter(t => !target.artist || t.artists.some(a => words(a.name).includes(words(target.artist))))
      .slice(0, 6)
      .map(t => ({ ...t, evidence: library.tracks.get(t.uri)?.evidence || t.evidence }));
  }

  async function search(target) {
    const results = await Promise.allSettled([
      resolve(target),
      query('searchArtists', {
        searchTerm: target.title,
        offset: 0,
        limit: 6,
        numberOfTopResults: 5,
        includeAudiobooks: false
      })
    ]);
    return {
      tracks: results[0].status === 'fulfilled' ? results[0].value : [],
      artists: results[1].status === 'fulfilled' ? collectArtists(results[1].value) : []
    };
  }

  async function artistTracks(artist) {
    const overview = await query('queryArtistOverview', { uri: artist.uri, locale: '', preReleaseV2: false });
    const tracks = collect(overview, 'artista actual');
    try {
      const disc = await query('queryArtistDiscographyAll', { uri: artist.uri, offset: 0, limit: 12 });
      const albums = new Set();
      const seen = new WeakSet();
      let nodes = 0;
      const walk = (x, d = 0) => {
        if (!x || typeof x !== 'object' || d > 15 || seen.has(x) || nodes++ > 2000) return;
        seen.add(x);
        if (x.uri?.startsWith('spotify:album:')) albums.add(x.uri);
        for (const v of Object.values(x)) if (v && typeof v === 'object') walk(v, d + 1);
      };
      walk(disc);
      const choices = [...albums].filter((_, i) => i % 3 === 0).slice(0, 4);
      for (let i = 0; i < choices.length; i += 2) {
        const data = await Promise.allSettled(
          choices.slice(i, i + 2).map(uri => query('getAlbum', { uri, offset: 0, limit: 50, locale: '' }))
        );
        for (const r of data) {
          if (r.status === 'fulfilled') {
            const album = r.value.data?.albumUnion;
            tracks.push(
              ...collect(r.value, 'artista actual').map(t => ({
                ...t,
                image: t.image || album?.coverArt?.sources?.[0]?.url || '',
                album: t.album || album?.name || ''
              }))
            );
          }
        }
      }
    } catch (_) {}
    return [...new Map(tracks.filter(t => hasArtist(t, artist)).map(t => [t.uri, t])).values()].slice(0, 300);
  }

  async function createMix(artist, mode, tracks) {
    const P = S.Platform;
    if (!P.RootlistAPI?.createPlaylist || !P.PlaylistAPI?.add || !P.RootlistAPI?.setPublishedState) {
      throw Error('Este cliente no permite guardar una playlist privada.');
    }
    const name =
      mode === 'session'
        ? `POOR DJ · ${artist.name}`
        : `POOR DJ · ${artist.name} · ${mode === 'only' ? 'Artista' : 'Aleatorio'}`;
    const pending = storage.getItem('poor-dj-pending-mix');
    const key = artist.uri + ':' + mode;
    const uri = pending?.key === key ? pending.uri : await P.RootlistAPI.createPlaylist(name, { after: 'end' }, true);
    if (!uri?.startsWith('spotify:playlist:')) throw Error('Spotify no confirmó la creación de la playlist.');
    const planned = mixUris(pending, key, tracks, mode === 'session' ? 100 : 24);
    storage.setItem('poor-dj-pending-mix', { key, uri, name, tracks: planned });
    await P.RootlistAPI.setPublishedState(uri, false);
    const existing = await P.PlaylistAPI.getContents(uri, { offset: 0, limit: 100 });
    const present = new Set((existing.items || []).map(t => t.uri));
    const missing = planned.filter(u => !present.has(u));
    if (missing.length) await P.PlaylistAPI.add(uri, missing, { after: 'end' });
    const verify = await P.PlaylistAPI.getContents(uri, { offset: 0, limit: 100 });
    if (!planned.every(u => verify.items?.some(t => t.uri === u))) {
      throw Error('Spotify no confirmó todas las canciones de la mezcla.');
    }
    storage.setItem('poor-dj-pending-mix', null);
    return { uri, name, count: verify.items.length };
  }

  const cardDetails = async track => {
    if (!track.name || !track.artists.length) return null;
    const matches = await resolve({ title: track.name, artist: track.artists[0].name });
    const same = matches.find(t => t.uri === track.uri);
    if (same) return same;
    const exact = matches.filter(
      t =>
        songKey(t.name) === songKey(track.name) &&
        t.artists.some(a => words(a.name) === words(track.artists[0].name)) &&
        (!track.album || words(t.album) === words(track.album))
    );
    return exact.length === 1 ? exact[0] : null;
  };

  const localPlayback = () => {
    try {
      return (
        S.Platform.ConnectAPI?.getState()?.activeDevice?.isLocal === true ||
        S.Player.data?.isLocal === true ||
        S.Player.data?.device?.is_local === true
      );
    } catch (_) {
      return false;
    }
  };

  const engine = new Engine(
    {
      queue,
      candidates,
      add,
      remove,
      play,
      skip: () => S.Player.next?.(),
      resolve,
      search,
      artistTracks,
      createMix,
      cardDetails,
      known: () => library.snapshot(),
      loadKnown: (force, playlist) => library.load(S.Player.data?.context?.uri || '', force, playlist),
      beforeSessionPlay: async (track, intent) =>
        !(await voiceGate.run('start', track, intent, { resume: false, local: localPlayback() })).cancelled,
      cancelTransition: () => voiceGate?.cancel(),
      save: data => {
        try {
          storage.setItem('poor-dj-v3', data);
        } catch (_) {
          S.showNotification?.('No pude guardar tu perfil local de POOR DJ.', true);
        }
      }
    },
    saved
  );

  // Recover leftover ducked volume on boot if playback is local.
  try {
    const volRec = storage.getItem('poor-dj-volume-recovery');
    if (volRec && localPlayback() && typeof S.Player.setVolume === 'function') {
      S.Player.setVolume(clamp(volRec.volume, 0, 1));
      storage.setItem('poor-dj-volume-recovery', null);
    }
  } catch (_) {}

  const transitions = new NativeTransitions(S.Platform, storage, localPlayback);
  narrator = new Narrator(root, () => view?.update());
  narrator.enabled = engine.settings.voice;
  narrator.volume = (engine.settings.voiceVolume ?? 90) / 100;
  narrator.speed = (engine.settings.voiceSpeed ?? 100) / 100;
  narrator.prefer(engine.settings.voiceName);

  const pauseMusic =
    typeof S.Platform.PlayerAPI?.pause === 'function'
      ? () => S.Platform.PlayerAPI.pause()
      : typeof S.Player.pause === 'function'
      ? () => S.Player.pause()
      : null;
  const resumeMusic =
    typeof S.Platform.PlayerAPI?.resume === 'function'
      ? () => S.Platform.PlayerAPI.resume()
      : typeof S.Player.play === 'function'
      ? () => S.Player.play()
      : null;

  voiceGate = new VoiceGate(narrator, {
    playing: () => S.Player.isPlaying(),
    uri: () => normalize(S.Player.data?.item)?.uri,
    device: () => S.Platform.ConnectAPI?.getState()?.activeDevice?.id,
    mode: () => engine.settings.voiceMode,
    duckLevel: () => engine.settings.duckLevel,
    getVolume: typeof S.Player.getVolume === 'function' ? () => S.Player.getVolume() : null,
    setVolume: typeof S.Player.setVolume === 'function' ? v => S.Player.setVolume(v) : null,
    saveRecovery: r => {
      try {
        storage.setItem('poor-dj-volume-recovery', r);
      } catch (_) {}
    },
    pause: pauseMusic
      ? async () => {
          await pauseMusic();
          for (let i = 0; i < 20 && S.Player.isPlaying(); i++) await sleep(50);
          if (S.Player.isPlaying()) throw Error('No se confirmó la pausa');
        }
      : null,
    resume: resumeMusic
  });

  const buildNarrationSeed = (track, extra = {}) => {
    if (!track) return engine.anchor || engine.current;
    const prev = engine.recent.at(-2);
    return {
      ...track,
      evidence: evidenceLabel(knownEvidence(track, engine.memory[track.uri])),
      plays: engine.memory[track.uri]?.plays || 0,
      minutes: Math.floor(engine.sessionHeardMs / 60000),
      artistsCount: engine.artistSet.size,
      styles: [...(track.styles || []), ...(engine.tags[track.uri] || [])],
      prevAudio: prev?.audio,
      prevArtist: prev?.artists?.[0]?.name || '',
      hour: new Date().getHours(),
      ...extra
    };
  };

  engine.onPrepare = (track, intent) => {
    if (!track) return;
    narrator.prepare('next', buildNarrationSeed(track), intent);
  };

  engine.onNarrate = (event, extra = {}) => {
    narrator.volume = (engine.settings.voiceVolume ?? 90) / 100;
    narrator.speed = (engine.settings.voiceSpeed ?? 100) / 100;
    const c = engine.current;
    const seed =
      ['next', 'discovery', 'return', 'milestone', 'follow'].includes(event) && c
        ? buildNarrationSeed(c, extra)
        : buildNarrationSeed(engine.anchor || c, extra);
    return voiceGate.run(event, seed, engine.intent, { local: localPlayback() });
  };

  const playGuards = [...new Set([S.Platform.PlayerAPI, S.Player.origin].filter(Boolean))].map(player =>
    guardPlay(player, () => {
      if (internalPlay) return null;
      voiceGate.cancel();
      return engine.userPlay();
    })
  );

  const recovery = () => {
    try {
      return storage.getItem('poor-dj-volume-recovery');
    } catch (_) {
      return null;
    }
  };

  view = mountUI(S, engine, {
    diagnose: () => root.PoorDJ.diagnose(),
    lyrics,
    audio,
    queue,
    narrator,
    voiceGate,
    library,
    transitions,
    recovery,
    recoverVolume: () => {
      const r = recovery();
      const dev = S.Platform.ConnectAPI?.getState()?.activeDevice?.id;
      if (r && localPlayback() && (!r.device || r.device === dev) && typeof S.Player.setVolume === 'function') {
        S.Player.setVolume(clamp(r.volume, 0, 1));
        storage.setItem('poor-dj-volume-recovery', null);
        engine.notify('Volumen anterior recuperado.');
      } else {
        engine.notify('Recupera el volumen en el dispositivo original.', true);
      }
    }
  });

  engine.save();

  const sample = () => {
    if (stopped || engine.interrupted) return;
    try {
      if (!engine.current?.name || !engine.current?.artists.length || !engine.current?.image) observe();
      engine.sample(S.Player.getProgress(), S.Player.isPlaying());
      if (Date.now() - progressUI > 5000) {
        progressUI = Date.now();
        view.update();
      }
    } catch (_) {}
  };

  const observe = () => {
    if (stopped) return;
    const track = normalize(S.Player.data?.item);
    if (!track) {
      engine.interrupted = true;
      engine.lastPosition = null;
      engine.lastWall = null;
      voiceGate.cancel();
      if (engine.active) engine.notify('Spotify está reproduciendo contenido fuera del DJ. Esperaré a la música.');
      return;
    }
    const natural = engine.interrupted;
    engine.interrupted = false;
    engine.trackChanged(track, natural ? 'natural' : false);
  };

  const paused = () => {
    voiceGate.playbackChanged();
    engine.lastPosition = null;
    engine.lastWall = null;
    view.update();
  };

  S.Player.addEventListener('songchange', observe);
  S.Player.addEventListener('onprogress', sample);
  S.Player.addEventListener('onplaypause', paused);

  let device = S.Platform.ConnectAPI?.getState()?.activeDevice?.id;
  const reconcileQueue = () => {
    if (stopped) return;
    const nextDevice = S.Platform.ConnectAPI?.getState()?.activeDevice?.id;
    if (nextDevice !== device) {
      device = nextDevice;
      voiceGate.cancel();
      engine.commandGeneration++;
    }
    if (engine.active && !engine.busy && !engine.interrupted) {
      const q = queue();
      if (q) {
        engine.sync(q);
        engine.reconcileManual(q);
        engine.fill(false, q);
      }
    }
    autoFade();
  };

  let fadeBusy = false;
  let fadeSeconds = null;
  let fadeWarned = false;
  async function autoFade() {
    if (fadeBusy) return;
    if (!engine.active || !engine.settings.autoFade) {
      if (fadeSeconds !== null) {
        fadeBusy = true;
        fadeSeconds = null;
        try {
          await transitions.restore();
        } catch (_) {
        } finally {
          fadeBusy = false;
        }
      }
      return;
    }
    const seconds = fadePlan(engine.current?.audio, engine.preview[0]?.audio);
    if (seconds === null || seconds === fadeSeconds) return;
    fadeBusy = true;
    try {
      await transitions.apply(seconds);
      fadeSeconds = seconds;
    } catch (e) {
      fadeSeconds = seconds;
      if (!fadeWarned) {
        fadeWarned = true;
        engine.notify('Transición automática no disponible: ' + e.message, true);
      }
    } finally {
      fadeBusy = false;
    }
  }

  engine.onUpdate = () => {
    if (engine.active && !reconcile) reconcile = setInterval(reconcileQueue, 1000);
    if (!engine.active && reconcile) {
      clearInterval(reconcile);
      reconcile = null;
    }
    autoFade();
    view.update();
  };

  observe();
  const unload = () => voiceGate.cancel();
  root.addEventListener('beforeunload', unload);

  const diagnose = async () => {
    const apiOk = {
      queue: Array.isArray(S.Queue?.nextTracks) && typeof S.addToQueue === 'function',
      play: typeof (S.Platform.PlayerAPI?.play || S.Player.origin?.play) === 'function',
      audio: typeof S.getAudioData === 'function',
      playlists: !!(S.Platform.RootlistAPI?.createPlaylist && S.Platform.PlaylistAPI?.add),
      voice: !!narrator.voice,
      lyrics: typeof S.CosmosAsync?.get === 'function',
      spicy:
        !!(
          root.SpicyLyrics ||
          document.querySelector('#SpicyLyrics_PageButton') ||
          root.LyricsPlus ||
          document.querySelector('a[href="/lyrics-plus"], [data-uri="spotify:app:lyrics-plus"]') ||
          root.BeautifulLyrics ||
          document.querySelector('.BeautifulLyrics, #BeautifulLyrics, [class*="BeautifulLyrics"]')
        ) && engine.settings.lyricsProvider !== 'builtin'
    };
    const [a, b] = await Promise.allSettled([
      query('searchTracks', {
        searchTerm: 'a',
        offset: 0,
        limit: 1,
        numberOfTopResults: 1,
        includeAudiobooks: false,
        includePreReleases: false,
        includeAlbumPreReleases: false
      }),
      query('searchArtists', {
        searchTerm: 'a',
        offset: 0,
        limit: 1,
        numberOfTopResults: 1,
        includeAudiobooks: false
      })
    ]);
    return compatReport({ api: apiOk, probes: { search: a.status === 'fulfilled', artists: b.status === 'fulfilled' } });
  };

  root.PoorDJ = {
    engine,
    diagnose,
    open: view.open,
    version: VERSION,
    audio,
    narrator,
    voiceGate,
    transitions,
    command: text => engine.command(text),
    dispose: () => {
      stopped = true;
      engine.commandGeneration++;
      engine.active = false;
      engine.generation++;
      engine.cancelLookup?.();
      clearInterval(reconcile);
      playGuards.forEach(undo => undo());
      voiceGate.cancel();
      narrator.dispose();
      audio.dispose();
      requests.dispose();
      library.dispose();
      for (const [event, fn] of [
        ['songchange', observe],
        ['onprogress', sample],
        ['onplaypause', paused]
      ]) {
        S.Player.removeEventListener?.(event, fn);
      }
      root.removeEventListener('beforeunload', unload);
      view.dispose();
    }
  };
  root.PoorMansDJ = root.PoorDJ;
}
boot();

})(typeof window !== 'undefined' ? window : globalThis);