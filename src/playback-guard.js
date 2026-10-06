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
