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
