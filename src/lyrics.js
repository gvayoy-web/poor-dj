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
