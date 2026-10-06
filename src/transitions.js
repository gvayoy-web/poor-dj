function transitionFit(a,b){
  const base=compatibility(a,b);let sum=base.value===null?0:base.value*base.coverage,weight=base.coverage;
  const loudness=Number.isFinite(a?.loudness)&&Number.isFinite(b?.loudness)?Math.abs(a.loudness-b.loudness):null;
  if(loudness!==null){sum+=.2*(1-Math.min(loudness/8,1));weight+=.2;}
  return {value:weight?sum/weight:null,coverage:Math.min(weight,1),tempo:base.tempo,key:base.key,loudness};
}
function transitionLabel(a,b){const f=transitionFit(a,b),parts=[];if(f.tempo!==null && f.tempo<=.06)parts.push('tempo cercano');if(f.key!==null && f.key<=1)parts.push('tono compatible');if(f.loudness!==null && f.loudness<=3)parts.push('nivel parecido');return parts.length?'Continuidad: '+parts.join(' · '):'Sin continuidad acústica verificada; se prioriza la referencia.';}
class NativeTransitions{
  constructor(platform,storage,local){this.platform=platform;this.storage=storage;this.local=local;}
  state(){const s=this.platform.SettingsAPI?.playback;return {enabled:s?.audioCrossfade?.value===true,seconds:Math.round((s?.audioCrossfadeMs?.value||0)/1000),gapless:s?.gapless?.value===true,available:this.local() && typeof s?.audioCrossfade?.setValue==='function' && typeof s?.audioCrossfadeMs?.setValue==='function'};}
  async refresh(){const s=this.platform.SettingsAPI?.playback;await Promise.all(['audioCrossfade','audioCrossfadeMs'].map(k=>s?.[k]?.getValue?.()));return this.state();}
  async apply(seconds){
    await this.refresh();
    if(!this.state().available)throw Error('Las transiciones se ajustan en el dispositivo local compatible.');
    const s=this.platform.SettingsAPI.playback,previous={enabled:s.audioCrossfade.value===true,ms:s.audioCrossfadeMs.value||0};
    if(!this.storage.getItem('poor-dj-transition-recovery'))this.storage.setItem('poor-dj-transition-recovery',previous);
    try{await s.audioCrossfadeMs.setValue(clamp(seconds,0,12)*1000);await s.audioCrossfade.setValue(seconds>0);await this.refresh();if(s.audioCrossfade.value!==(seconds>0)||s.audioCrossfadeMs.value!==clamp(seconds,0,12)*1000)throw Error('Spotify no confirmó el nuevo ajuste de transición.');}
    catch(e){await s.audioCrossfadeMs.setValue(previous.ms);await s.audioCrossfade.setValue(previous.enabled);await this.refresh();throw e;}
    return seconds;
  }
  async restore(){const r=this.storage.getItem('poor-dj-transition-recovery');if(!r)return;if(!this.state().available)throw Error('Vuelve al dispositivo local para restaurar.');const s=this.platform.SettingsAPI.playback;await s.audioCrossfadeMs.setValue(r.ms);await s.audioCrossfade.setValue(r.enabled);await this.refresh();if(s.audioCrossfade.value!==r.enabled || s.audioCrossfadeMs.value!==r.ms)throw Error('Spotify no confirmó la restauración.');this.storage.setItem('poor-dj-transition-recovery',null);}
}
