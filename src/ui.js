function mountUI(S,engine,{audio,queue,narrator,voiceGate,library,transitions,recovery,recoverVolume}){
  const style=document.createElement('style');style.id='poor-dj-style';style.textContent=CSS;document.head.append(style);
  let panel;const mini=document.createElement('aside');mini.className='pd-mini';mini.hidden=true;mini.setAttribute('aria-label','Sesión POOR DJ');
  mini.innerHTML=`<button data-open>${ICON}<span>POOR DJ</span></button><button data-stop aria-label="Terminar DJ">■</button>`;document.body.append(mini);
  const perform=async work=>{try{await work();}catch(e){engine.notify(e.message,true);}finally{update();}};
  mini.querySelector('[data-open]').onclick=()=>open();mini.querySelector('[data-stop]').onclick=()=>perform(()=>engine.stop());
  const playbar=new S.Playbar.Button('POOR DJ',ICON,()=>open());
  const theme=node=>{node.dataset.accent=engine.settings.accent;node.classList.toggle('pd-compact',engine.settings.compact);};
  const text=(key,value)=>{const n=panel?.querySelector(`[data-${key}]`);if(n && n.textContent!==String(value))n.textContent=value;};
  const download=(data,name)=>{const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
  function cards(tracks,kind){
    return tracks.map(t=>`<button class="pd-choice" data-${kind}="${esc(t.uri)}" ${engine.choiceBusy?'disabled':''}><span class="pd-choicecover">${imageURL(t.image)?`<img src="${esc(imageURL(t.image))}" alt="" loading="eager">`:ICON}<span class="pd-choiceplay">▶</span></span><b>${esc(t.name)}</b><small>${esc(t.artists.map(a=>a.name).join(', '))}</small><small class="pd-evidence">${esc(evidenceLabel(t.evidence||knownEvidence(t,engine.memory[t.uri]))||t.album||'Resultado de Spotify')}</small></button>`).join('');
  }
  function update(){
    playbar.active=engine.active;theme(mini);mini.hidden=!engine.settings.mini || !engine.active;
    if(!panel?.isConnected)return;theme(panel);panel.dataset.playing=String(engine.active && S.Player.isPlaying());
    text('live',narrator.speaking?'DJ hablando':engine.choiceBusy?'Reproduciendo':engine.active?(engine.busy?'Eligiendo':'DJ activo'):'Tú tienes el control');
    panel.querySelector('[data-live]').classList.toggle('pd-active',engine.active);
    panel.querySelector('.pd-reference').hidden=!engine.active;
    panel.querySelector('.pd-feedback').hidden=!engine.active;
    panel.querySelector('.pd-queuehead').hidden=!engine.active;
    panel.querySelector('[data-next]').hidden=!engine.active;
    panel.querySelector('[data-session]').hidden=!engine.active && !engine.sessionHeardMs;
    panel.querySelector('[data-savedmix]').hidden=!engine.mixPlaylist;
    text('title',engine.current?.name||'Reproduce algo que te guste');text('artist',engine.current?.artists.map(a=>a.name).join(', ')||'Tu próxima sesión empieza contigo.');
    const img=panel.querySelector('[data-cover]'),url=imageURL(engine.current?.image);img.hidden=!url;if(url && img.getAttribute('src')!==url)img.src=url;
    text('reference',engine.anchor?`${engine.anchor.name} · ${engine.anchor.artists.map(a=>a.name).join(', ')}`:'Elige una referencia al empezar.');
    const labels=intentLabels(engine.intent),chips=panel.querySelector('[data-intent]');if(chips._key!==JSON.stringify(labels)){chips._key=JSON.stringify(labels);chips.innerHTML=labels.map(label=>`<span class="pd-chip">${esc(label)}</span>`).join('');}
    text('status',engine.status);panel.querySelector('[data-status]').classList.toggle('pd-error',engine.error);
    const toggle=panel.querySelector('[data-toggle]');toggle.textContent=engine.active?'Terminar DJ':engine.intent.known?'Elegir música conocida':'Empezar DJ';toggle.disabled=!!engine.choiceBusy || engine.busy;toggle.hidden=engine.choosing && !engine.active;
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
    text('voicestatus',narrator.voice?`Voz local: ${narrator.voice.name}`:'Este cliente no ofrece voz local en español. Los comentarios siguen por escrito.');
    const voice=panel.querySelector('[data-voice]');voice.disabled=!narrator.voice;voice.textContent=narrator.enabled?'Silenciar voz':'Activar voz';voice.setAttribute('aria-pressed',String(narrator.enabled));
    panel.querySelector('[data-recovervolume]').hidden=!recovery();
    panel.querySelectorAll('[data-select]').forEach(input=>{if(document.activeElement!==input)input.value=engine.settings[input.dataset.select];});
    panel.querySelectorAll('[data-setting]').forEach(input=>{input.checked=engine.settings[input.dataset.setting];input.disabled=input.dataset.setting==='takeover' && (engine.active || engine.busy);});
    panel.querySelector('[data-sessionexport]').disabled=!engine.sessionList.length;
  }
  function open(){
    if(panel?.isConnected){update();return;}
    panel=document.createElement('section');panel.className='pd';
    panel.innerHTML=`<header class="pd-header"><div class="pd-brand">${ICON}<h1>POOR DJ <small>${VERSION}</small></h1></div><button class="pd-voice" data-voice></button></header><div class="pd-byline"><span>Tu música. Tu mando.</span><span class="pd-live" data-live></span></div>
      <div class="pd-playing"><div class="pd-cover">${ICON}<img data-cover alt="Portada actual" hidden></div><div><small>Sonando ahora <span class="pd-bars" aria-hidden="true"><i></i><i></i><i></i></span></small><h2 data-title></h2><p data-artist></p></div></div>
      <div class="pd-reference"><small>Referencia de la sesión</small><p data-reference></p></div><div class="pd-chips" data-intent aria-label="Instrucciones vigentes"></div>
      <form data-command class="pd-command"><label for="pd-command">¿Qué quieres escuchar?</label><div><input id="pd-command" name="command" autocomplete="off" maxlength="240" placeholder="Yoko, L A K E N O S H I o sigue esta canción" required><button type="submit">Buscar / aplicar</button></div></form>
      <p class="pd-note">Busca una canción o artista, o escribe una dirección para la mezcla. Tú eliges cuándo empezar.</p>
      <button class="pd-follow" aria-label="Seguir esta canción" data-follow>Seguir esta canción ↗</button>
      <div data-matches hidden></div><section data-artistmenu class="pd-artistmenu" hidden aria-label="Mezcla del artista"></section><button data-closesearch class="pd-secondary" hidden>Cerrar resultados</button>
      <div class="pd-presets" role="group" aria-label="Selección musical"><button data-known="true">Solo música conocida</button><button data-known="false">Descubrir afines</button></div>
      <section data-picker class="pd-picker" hidden aria-label="Elige tu primera canción"><h3>Tu música conocida</h3><p data-pickernote></p><div class="pd-cards" data-cards></div><div class="pd-pickeractions"><button data-again>Otra vez</button><button data-resetdeck hidden>Reiniciar selección</button><button data-closepicker>Cancelar</button></div></section>
      <div class="pd-feedback"><button data-feedback="more">Más como esta</button><button data-feedback="less">No encaja</button><details class="pd-feedbackmore"><summary>Más opciones</summary><button data-feedback="artist">Este artista no, por hoy</button><button data-feedback="repeat">Demasiado repetida</button><button data-undo>Deshacer</button></details></div>
      <div class="pd-queuehead"><h3>A continuación</h3><button data-refresh class="pd-other">Otra sugerencia</button></div><div data-next></div>
      <button class="pd-primary" data-toggle></button><button class="pd-secondary" data-restore hidden>Restaurar cola guardada</button><p class="pd-status" data-status role="status" aria-live="polite"></p>
      <section class="pd-narration" data-narration hidden aria-label="Comentarios del DJ"><p data-caption aria-live="polite"></p></section><p class="pd-note" data-session></p>
      <p class="pd-note" data-savedmix></p><button class="pd-secondary" data-openmix hidden>Abrir última playlist guardada</button>
      <details class="pd-customize"><summary>Personalizar y ajustes</summary><p class="pd-note" data-voicestatus></p><details class="pd-details"><summary>Transiciones</summary><label>Continuidad musical<select data-select="flowStrength"><option value="40">Equilibrada</option><option value="65">Suave</option><option value="90">Más continuidad</option></select></label><p data-transitionstatus></p><label>Solapamiento nativo<select data-crossfade><option value="2">Breve · 2 segundos</option><option value="4" selected>Suave · 4 segundos</option><option value="6">Continua · 6 segundos</option><option value="0">Sin solapamiento</option></select></label><button data-applytransition>Aplicar en Spotify</button><button data-restoretransition>Restaurar ajuste anterior</button><p>Este ajuste también afecta a Spotify fuera del DJ. Automix puede decidir las transiciones en playlists compatibles. POOR DJ no baja el volumen ni salta el final de las canciones.</p></details>
      <details class="pd-details"><summary>Ajustes</summary><div class="pd-options"><label>Acento<select data-select="accent"><option value="spotify">Verde Spotify</option><option value="theme">Mi tema</option><option value="blue">Azul</option><option value="violet">Violeta</option><option value="rose">Rosa</option></select></label><label>Canciones pendientes<select data-select="queueSize"><option>1</option><option>2</option><option>3</option></select></label></div>${[['mini','Control compacto'],['compact','Panel compacto'],['explicit','Permitir contenido explícito'],['autoLearn','Aprender de mi escucha'],['takeover','Suspender mi cola manual al iniciar (opcional)']].map(([key,label])=>`<label class="pd-check"><input type="checkbox" data-setting="${key}">${label}</label>`).join('')}<p>Spotify controla las transiciones nativas. El DJ no cambia tu volumen ni adelanta canciones.</p><button data-settings>Abrir configuración de Spotify</button><button data-recovervolume hidden>Recuperar volumen anterior</button></details>
      <details class="pd-details"><summary>Etiquetas musicales</summary><p>Las etiquetas son tuyas. Para filtrar por género, etiqueta las canciones de tu playlist actual; no deducimos género por tempo ni tus creencias por lo que escuchas.</p><form data-tag><label for="pd-tag">Estilos, separados por coma</label><input id="pd-tag" maxlength="100" placeholder="reggaetón, trap"><button type="submit">Etiquetar playlist actual y canción</button></form></details>
      <details class="pd-details"><summary>Mi biblioteca y fuentes</summary><p data-library></p><button data-librarysync>Actualizar Me gusta y playlists</button><select data-playlists aria-label="Playlist de mi biblioteca"></select><button data-loadplaylist>Leer esta playlist</button><p>Solo usamos Me gusta, playlists y escuchas registradas como música conocida. Leemos una parte limitada; puedes elegir una playlist para consultar hasta 300 canciones. Spotify no ofrece aquí tus estadísticas completas.</p></details><details class="pd-details"><summary>Mis datos</summary><p>Playlist, escucha registrada y voto son fuentes diferentes de familiaridad. No consultamos todo tu historial de Spotify. Tus datos y la lógica del DJ permanecen en este cliente.</p><div class="pd-profile"><button data-export>Exportar perfil</button><button data-import>Importar perfil</button><button data-sessionexport>Guardar sesión</button><button data-reset>Borrar aprendizaje</button><button data-cacheclear>Borrar caché acústica</button><input data-file type="file" accept=".json,application/json" hidden></div><p>POOR DJ ${VERSION} · sin servidor propio, IA ni claves adicionales.</p></details>
      <details class="pd-details"><summary>Cómo funciona</summary><p>Elige una canción conocida o inicia desde lo que suena. Escribe instrucciones combinables y revisa las etiquetas. Una elección manual pausa el DJ y retira sus sugerencias. Terminar devuelve la cola suspendida; las playlists nunca se editan.</p><p>Prueba «solo conocidas y más variedad», «reggaetón y más variedad», «pon SIN UN PLAN (TEGOCALDERON) de Isma» o «termina el DJ». Una orden incompleta no se aplica a medias.</p></details></details>`;
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
      else if(d.example){panel.querySelector('#pd-command').value=d.example;panel.querySelector('#pd-command').focus();}
      else if('voice'in d){narrator.toggle();engine.updateSettings({voice:narrator.enabled},false);}
      else if('settings'in d){S.PopupModal.hide();S.Platform.History.push('/preferences');}
      else if('recovervolume'in d)recoverVolume();
      else if('export'in d)download(engine.exportProfile(),'poor-dj-profile.json');
      else if('sessionexport'in d)download({schema:1,version:VERSION,heardMs:engine.sessionHeardMs,tracks:engine.sessionList.map(t=>({uri:t.uri,name:t.name,artists:t.artists}))},'poor-dj-session.json');
      else if('import'in d)panel.querySelector('[data-file]').click();
      else if('reset'in d && root.confirm('¿Borrar el aprendizaje local de POOR DJ?')){engine.memory={};engine.contexts={};engine.preferences={};engine.undoVote=null;engine.save();engine.refresh();}
      else if('cacheclear'in d){audio.clear();engine.notify('Caché acústica borrada.');}
    };
    panel.querySelector('[data-command]').onsubmit=event=>{event.preventDefault();perform(()=>engine.command(panel.querySelector('#pd-command').value));};
    panel.querySelector('[data-tag]').onsubmit=event=>{event.preventDefault();perform(()=>engine.tagPlaylist(panel.querySelector('#pd-tag').value.split(',').map(words).filter(Boolean)));};
    panel.querySelectorAll('[data-select]').forEach(input=>input.onchange=()=>perform(()=>engine.updateSettings({[input.dataset.select]:['queueSize','flowStrength'].includes(input.dataset.select)?Number(input.value):input.value},input.dataset.select==='queueSize')));
    panel.querySelectorAll('[data-setting]').forEach(input=>input.onchange=()=>perform(()=>engine.updateSettings({[input.dataset.setting]:input.checked},['explicit','takeover'].includes(input.dataset.setting))));
    panel.querySelector('[data-file]').onchange=event=>perform(async()=>{const file=event.target.files[0];if(!file)return;if(file.size>2000000)throw Error('El perfil supera 2 MB');await engine.importProfile(JSON.parse(await file.text()));narrator.enabled=engine.settings.voice;event.target.value='';});
    S.PopupModal.display({title:'POOR DJ',content:panel,isLarge:true});update();transitions.refresh().then(update).catch(()=>{});panel.querySelector('#pd-command').focus();
  }
  return {open,update,dispose:()=>{if(panel?.isConnected)S.PopupModal.hide();panel?.remove();mini.remove();style.remove();playbar.deregister?.();}};
}
