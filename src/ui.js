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
