// Ánimo estimado solo con tempo, tono y nivel medidos; nunca con géneros supuestos.
function moodOf(audio){
  if(!audio || !Number.isFinite(audio.bpm) || !Number.isInteger(audio.mode))return null;
  const slow=audio.bpm<100,fast=audio.bpm>=122,loud=Number.isFinite(audio.loudness) && audio.loudness>-6;
  if(audio.mode===0 && slow)return 'melancolica';
  if(slow && (audio.mode===1 || (Number.isFinite(audio.loudness) && audio.loudness<-12)))return 'tranquila';
  if(fast && (loud || audio.bpm>=138))return 'intensa';
  if(audio.mode===1 && fast)return 'animada';
  return null;
}
const MOODS={
  melancolica:{lead:['Un momento más sentimental.','Bajamos un poco la luz.','Toca algo con aire melancólico.'],now:'más melancólico',basis:true},
  tranquila:{lead:['Bajamos las revoluciones.','Un respiro.','Ahora, algo para ir con calma.'],now:'más tranquilo',basis:true},
  animada:{lead:['Subimos el ánimo.','Esta trae buena energía.','Arriba ese ánimo.'],now:'más animado',basis:true},
  intensa:{lead:['Ahora sí, a subir la energía.','Con fuerza.','Prepárate, que esta pega.'],now:'con más intensidad',basis:true}
};
// Líneas por estilo: solo se usan si tú declaraste ese estilo en tus etiquetas.
const GENRE_LINES={reggaeton:['Para el perreo.','Sube el flow.'],trap:['Bajos y rimas.','Para subir el volumen.'],rap:['Rimas con carácter.','Atento a la letra.'],hiphop:['Ritmo y rimas.','Del hip hop que te gusta.'],pop:['Pop para cantar.','Un coro para el recuerdo.'],rock:['Guitarras al frente.','Para dejar el volumen alto.'],electronica:['Para la pista de baile.','Pulso electrónico.'],jazz:['Jazz para escuchar con calma.','Con mucho oficio.'],salsa:['Para mover los pies.','Sabor de salsa.'],bachata:['Una de corazón.','Bachata para sentir.'],alabanzas:['Un momento de alabanza.','Para elevar el ánimo.'],gospel:['Para elevar el ánimo.','Voces con fuerza.'],ambient:['Para dejar volar la mente.','Un paisaje sonoro.'],lofi:['Para concentrarte.','Lo-fi sin prisa.']};
function intro(seed,sequence){
  const n=Math.abs(Math.floor(sequence)),pick=list=>list[n%list.length];
  const title=String(seed?.name||'esta canción').replace(/\s*[(\[][^)\]]*[)\]]/g,'').trim()||'esta canción',artist=seed?.artists?.[0]?.name||'',by=artist?`, de ${artist}`:'';
  const heads=[`Ahora suena ${title}${by}.`,`Esto es ${title}${by}.`,`Sigue ${title}${by}.`,`Llega ${title}${by}.`,`Es el turno de ${title}${by}.`];
  const mood=moodOf(seed?.audio),before=moodOf(seed?.prevAudio),style=(seed?.styles||[]).map(words).find(x=>GENRE_LINES[x]);
  let lead='';
  if(mood && before && mood!==before)lead=`Cambiamos de ambiente: ahora algo ${MOODS[mood].now}.`;
  else if(mood)lead=pick(MOODS[mood].lead);
  else if(Number.isFinite(seed?.hour) && (seed.hour>=22 || seed.hour<5))lead='Para esta hora de la noche.';
  const tail=[];
  if(style)tail.push(pick(GENRE_LINES[style]));
  if(mood && seed.audio)tail.push(`Va a unos ${Math.round(seed.audio.bpm)} bpm y en tono ${seed.audio.mode===1?'mayor':'menor'}.`);
  if(seed?.evidence)tail.push(`Viene de ${seed.evidence.toLowerCase()}.`);
  if(seed?.plays>=3)tail.push(`La has escuchado ${seed.plays} veces.`);
  if(seed?.minutes>=20)tail.push(`Llevas ${seed.minutes} minutos de sesión.`);
  if(!tail.length)tail.push('Encaja con lo que traes.','Va con el ritmo de la sesión.','Conecta bien con la anterior.');
  // Una sola frase de cierre, rotando entre las que de verdad aplican.
  return [lead,heads[n%heads.length],tail[n%tail.length]].filter(Boolean).join(' ');
}
function commentary(event,seed,intent,sequence=0){
  if(event==='next')return intro(seed,sequence);
  const title=songKey(seed?.name||'esta canción'),artist=intent.artist?.name||seed?.artists?.[0]?.name||'tu referencia';
  const direction=intent.styles.length?intent.styles.map(t=>STYLE_NAMES[words(t)]||t).join(' y '):intent.artistMode==='only'?'solo '+artist:intent.artistMode==='mix'?'la música de '+artist:'el sonido de '+artist;
  const intros=event==='start'?[
    `¡Hola! Soy DJ POOR. Hoy empiezo con ${direction}.`,`Tomamos ${title} como referencia.`,`El punto de partida es ${title}.`,`Nos guiamos por ${title}.`,`Arrancamos alrededor de ${title}.`,`La referencia de esta sesión es ${title}.`,`Empezamos desde ${title}.`
  ]:event==='direction'?[
    `La dirección es ${direction}.`,`Nos guiamos por ${direction}.`,`Seguimos con ${direction}.`,`Tu rumbo queda claro: ${direction}.`,`La referencia mantiene ${direction}.`,`Trabajamos con ${direction}.`
  ]:[`Seguimos con ${direction}.`,`Mantenemos ${direction} como guía.`,`El hilo sigue siendo ${direction}.`,`Nos quedamos cerca de ${direction}.`,`La sesión continúa con ${direction}.`,`Conservamos ${direction} como referencia.`];
  const middles=intent.artistMode==='only'?['Dentro de su catálogo.','Sin salir del artista elegido.','También caben sus colaboraciones.','El artista lleva toda la sesión.','Seguimos con sus canciones.','La selección queda centrada en su música.','Tu artista es el límite.']:intent.artistMode==='mix'?['El artista lleva el protagonismo.','Dejamos espacio para música afín.','Sus canciones son la base.','La mayoría será de este artista.','Damos prioridad a su catálogo.','La mezcla gira alrededor de su sonido.','Los otros artistas entran por afinidad.']:intent.known?['Entre tu música conocida.','Desde tus fuentes personales.','Con canciones de tus fuentes permitidas.','Tu biblioteca es la base.','Seguimos con música que ya conoces.','Sin ampliar al catálogo desconocido.','Tus fuentes marcan la selección.']:['Con espacio para descubrir.','Buscamos afinidad con esa referencia.','Las propuestas siguen esta dirección.','Hay espacio para artistas cercanos.','Seguimos las fuentes permitidas.','La afinidad guía las propuestas.','El descubrimiento mantiene esta referencia.'];
  const endings=event==='block'?['Puedes cambiar el rumbo cuando quieras.','Tu elección sigue teniendo prioridad.','Si algo no encaja, puedes indicarlo.','Mantengo tus instrucciones vigentes.','Tú decides hacia dónde seguimos.']:event==='direction'?['Tus instrucciones quedan aplicadas.','Tu elección guía la sesión.','Puedes ajustar el rumbo de nuevo.','Seguimos según lo que pediste.','Tú conservas el control.']:['Tú decides la próxima dirección.','Puedes guiarme cuando quieras.','Tu elección tiene prioridad.','El rumbo lo marcas tú.','Puedes ajustar la sesión a tu gusto.'];
  const n=(Math.abs(Math.floor(sequence))*47)%210;
  return `${intros[n%intros.length]} ${middles[Math.floor(n/6)%middles.length]} ${endings[Math.floor(n/42)%endings.length]}`.split(/\s+/).slice(0,25).join(' ');
}
class Narrator{
  constructor(host,changed=()=>{}){this.host=host;this.changed=changed;this.enabled=true;this.voice=null;this.preferred='';this.text='';this.sequence=Math.floor(Math.random()*10000);this.recent=[];this.disposed=false;this.onVoices=()=>this.detect();host.speechSynthesis?.addEventListener?.('voiceschanged',this.onVoices);this.detect();}
  // Voces en español ordenadas por calidad probable: naturales/neuronales, México y Latinoamérica primero.
  voices(){let all=[];try{all=this.host.speechSynthesis?.getVoices?.()||[];}catch(_){}const score=v=>(/natural|neural/i.test(v.name)?4:0)+(/^es-MX$/i.test(v.lang)?3:/^es-(US|419)$/i.test(v.lang)?2:/^es-ES$/i.test(v.lang)?1:0)+(/sabina|dalia|paloma|livia/i.test(v.name)?1:0);return all.filter(v=>/^es(?:-|$)/i.test(v.lang)).sort((a,b)=>score(b)-score(a));}
  // Automático usa solo voces locales; una voz «en línea» se usa únicamente si la eliges tú.
  detect(force){if((this.voice && !force) || this.disposed)return;const all=this.voices();this.voice=(this.preferred&&all.find(v=>v.name===this.preferred))||all.find(v=>v.localService===true)||null;this.changed();}
  prefer(name){this.preferred=name||'';this.detect(true);}
  canSpeak(local=true){return !this.disposed && this.enabled && !!this.voice && local && !!this.host.SpeechSynthesisUtterance;}
  say(event,seed,intent,local=true){
    if(this.disposed)return Promise.resolve({cancelled:true});this.cancel();for(let tries=0;tries<20;tries++){this.text=commentary(event,seed,intent,this.sequence++);if(!this.recent.includes(this.text))break;}this.textAt=Date.now();this.recent.push(this.text);this.recent=this.recent.slice(-20);this.changed();
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
  dispose(){this.disposed=true;this.cancel();this.host.speechSynthesis?.removeEventListener?.('voiceschanged',this.onVoices);}
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
