function commentary(event,seed,intent,sequence=0){
  const title=songKey(seed?.name||'esta canción'),artist=intent.artist?.name||seed?.artists?.[0]?.name||'tu referencia';
  const direction=intent.styles.length?intent.styles.map(t=>STYLE_NAMES[words(t)]||t).join(' y '):intent.artistMode==='only'?'solo '+artist:intent.artistMode==='mix'?'la música de '+artist:'el sonido de '+artist;
  const intros=event==='start'?[
    `Tomamos ${title} como referencia.`,`El punto de partida es ${title}.`,`Nos guiamos por ${title}.`,`Arrancamos alrededor de ${title}.`,`La referencia de esta sesión es ${title}.`,`Empezamos desde ${title}.`
  ]:event==='direction'?[
    `La dirección es ${direction}.`,`Nos guiamos por ${direction}.`,`Seguimos con ${direction}.`,`Tu rumbo queda claro: ${direction}.`,`La referencia mantiene ${direction}.`,`Trabajamos con ${direction}.`
  ]:[`Seguimos con ${direction}.`,`Mantenemos ${direction} como guía.`,`El hilo sigue siendo ${direction}.`,`Nos quedamos cerca de ${direction}.`,`La sesión continúa con ${direction}.`,`Conservamos ${direction} como referencia.`];
  const middles=intent.artistMode==='only'?['Dentro de su catálogo.','Sin salir del artista elegido.','También caben sus colaboraciones.','El artista lleva toda la sesión.','Seguimos con sus canciones.','La selección queda centrada en su música.','Tu artista es el límite.']:intent.artistMode==='mix'?['El artista lleva el protagonismo.','Dejamos espacio para música afín.','Sus canciones son la base.','La mayoría será de este artista.','Damos prioridad a su catálogo.','La mezcla gira alrededor de su sonido.','Los otros artistas entran por afinidad.']:intent.known?['Entre tu música conocida.','Desde tus fuentes personales.','Con canciones de tus fuentes permitidas.','Tu biblioteca es la base.','Seguimos con música que ya conoces.','Sin ampliar al catálogo desconocido.','Tus fuentes marcan la selección.']:['Con espacio para descubrir.','Buscamos afinidad con esa referencia.','Las propuestas siguen esta dirección.','Hay espacio para artistas cercanos.','Seguimos las fuentes permitidas.','La afinidad guía las propuestas.','El descubrimiento mantiene esta referencia.'];
  const endings=event==='block'?['Puedes cambiar el rumbo cuando quieras.','Tu elección sigue teniendo prioridad.','Si algo no encaja, puedes indicarlo.','Mantengo tus instrucciones vigentes.','Tú decides hacia dónde seguimos.']:event==='direction'?['Tus instrucciones quedan aplicadas.','Tu elección guía la sesión.','Puedes ajustar el rumbo de nuevo.','Seguimos según lo que pediste.','Tú conservas el control.']:['Tú decides la próxima dirección.','Puedes guiarme cuando quieras.','Tu elección tiene prioridad.','El rumbo lo marcas tú.','Puedes ajustar la sesión a tu gusto.'];
  const n=(Math.abs(Math.floor(sequence))*47)%210;
  return `${intros[n%intros.length]} ${middles[Math.floor(n/6)%middles.length]} ${endings[Math.floor(n/42)%endings.length]}`.split(/\s+/).slice(0,25).join(' ');
}
class Narrator{
  constructor(host,changed=()=>{}){this.host=host;this.changed=changed;this.enabled=true;this.voice=null;this.text='';this.sequence=Math.floor(Math.random()*10000);this.recent=[];this.disposed=false;this.detect=this.detect.bind(this);host.speechSynthesis?.addEventListener?.('voiceschanged',this.detect);this.detect();}
  detect(){if(this.voice || this.disposed)return;let voices=[];try{voices=this.host.speechSynthesis?.getVoices?.()||[];}catch(_){}const local=voices.filter(v=>v.localService===true && /^es(?:-|$)/i.test(v.lang));this.voice=local.find(v=>/sabina/i.test(v.name) && /^es-MX$/i.test(v.lang))||local.find(v=>/^es-MX$/i.test(v.lang))||local[0]||null;this.changed();}
  canSpeak(local=true){return !this.disposed && this.enabled && !!this.voice && local && !!this.host.SpeechSynthesisUtterance;}
  say(event,seed,intent,local=true){
    if(this.disposed)return Promise.resolve({cancelled:true});this.cancel();for(let tries=0;tries<20;tries++){this.text=commentary(event,seed,intent,this.sequence++);if(!this.recent.includes(this.text))break;}this.recent.push(this.text);this.recent=this.recent.slice(-20);this.changed();
    if(!this.canSpeak(local))return Promise.resolve({spoken:false});
    const utterance=new this.host.SpeechSynthesisUtterance(this.text);utterance.voice=this.voice;utterance.lang=this.voice.lang;utterance.rate=this.rate||.96;utterance.pitch=1.02;utterance.volume=1;
    return new Promise(resolve=>{
      const finish=result=>{if(this.finish!==finish)return;clearTimeout(this.watchdog);this.finish=null;this.speaking=false;this.changed();resolve(result);};
      this.finish=finish;this.speaking=true;this.changed();
      utterance.onend=()=>finish({spoken:true});utterance.onerror=()=>{this.voice=null;finish({spoken:false});};
      this.watchdog=setTimeout(()=>{this.voice=null;finish({spoken:false});try{this.host.speechSynthesis.cancel();}catch(_){}},20000);
      try{this.host.speechSynthesis.speak(utterance);}catch(_){this.voice=null;finish({spoken:false});}
    });
  }
  cancel(){this.finish?.({cancelled:true});try{this.host.speechSynthesis?.cancel?.();}catch(_){} }
  toggle(){this.enabled=!this.enabled;if(!this.enabled){this.finish?.({spoken:false});try{this.host.speechSynthesis?.cancel?.();}catch(_){}}this.changed();return this.enabled;}
  dispose(){this.disposed=true;this.cancel();this.host.speechSynthesis?.removeEventListener?.('voiceschanged',this.detect);}
}
// A narration owns only its own pause. User playback, devices and stop revoke it.
class VoiceGate{
  constructor(narrator,music){this.narrator=narrator;this.music=music;this.lease=null;}
  cancel(){this.lease=null;this.narrator.cancel();}
  playbackChanged(){if(this.lease?.expectedPause && !this.music.playing()){this.lease.expectedPause=false;return;}this.cancel();}
  async run(event,seed,intent,{resume=true,local=true}={}){
    const inherited=this.lease;this.cancel();
    if(!this.narrator.canSpeak(local))return this.narrator.say(event,seed,intent,local);
    if(!this.music.pause || !this.music.resume)return this.narrator.say(event,seed,intent,false);
    const playing=this.music.playing(),uri=this.music.uri(),device=this.music.device();
    const lease={uri,device,wasPlaying:playing || !!(inherited?.wasPlaying && inherited.uri===uri && inherited.device===device),expectedPause:playing};this.lease=lease;
    try{
      if(playing)await this.music.pause();
      if(this.lease!==lease)return {cancelled:true};
      const result=await this.narrator.say(event,seed,intent,local);
      if(this.lease!==lease || result.cancelled || this.music.uri()!==lease.uri || this.music.device()!==lease.device){if(this.lease===lease)this.lease=null;return {cancelled:true};}
      this.lease=null;
      if(resume && lease.wasPlaying && this.music.uri()===lease.uri && this.music.device()===lease.device && !this.music.playing())await this.music.resume();
      return result;
    }catch(_){if(this.lease===lease){this.lease=null;if(lease.wasPlaying && resume && this.music.uri()===lease.uri && this.music.device()===lease.device)await this.music.resume();}return {spoken:false};}
  }
}
