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
