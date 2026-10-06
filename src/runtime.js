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
