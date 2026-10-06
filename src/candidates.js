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
