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
