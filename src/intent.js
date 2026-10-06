const words=x=>String(x||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[“”"']/g,'').replace(/[()[\]!?¡¿.,;:]/g,' ').replace(/\s+/g,' ').trim();
const STYLE_NAMES={reggaeton:'reggaetón',trap:'trap',rap:'rap',hiphop:'hip hop',pop:'pop',rock:'rock',electronica:'electrónica',jazz:'jazz',salsa:'salsa',bachata:'bachata',alabanzas:'alabanzas',cristiana:'alabanzas',cristiano:'alabanzas',gospel:'gospel',ambient:'ambient',lofi:'lo-fi'};
const songKey=text=>{const key=words(text);return /^(?:[a-z0-9]\s+)+[a-z0-9]$/.test(key)?key.replace(/\s/g,''):key;};
function intentOf(value={}){return {known:value.known!==false,styles:Array.isArray(value.styles)?[...new Set(value.styles.filter(t=>typeof t==='string').map(words))].slice(0,5):[],excludedArtists:Array.isArray(value.excludedArtists)?[...new Set(value.excludedArtists.filter(t=>typeof t==='string').map(words))].slice(0,30):[],variety:clamp(value.variety??25),reference:value.reference||null,artist:value.artist && /^spotify:artist:[A-Za-z0-9]{22}$/.test(value.artist.uri||'')?{uri:value.artist.uri,name:String(value.artist.name||'').slice(0,100)}:null,artistMode:['mix','only'].includes(value.artistMode)?value.artistMode:null};}
function parseCommand(raw){
  let text=words(raw);const patch={},labels=[],errors=[];let action='configure',target=null,start=false;
  if(!text || text.length>240)return {ok:false,errors:['Escribe una instrucción de 1 a 240 caracteres.']};
  const search=text.match(/^(?:busca|buscar|mezcla con|haz una mezcla de|quiero escuchar|dj con) (.+)$/);
  if(search && !/\b(?:solo conocidas|sin |mas variedad|menos variedad)\b/.test(search[1]))return {ok:true,action:'search',target:{title:search[1],artist:''},start:true,patch:{},labels:['Buscar música'],errors:[]};
  if(/menos comercial|mas comercial|menos viral|menos mainstream/.test(text))errors.push('No tengo datos para medir lo comercial. Prueba conocidas o excluye un artista.');
  const take=(re,fn)=>{text=text.replace(re,(...args)=>{fn(...args);return ' ';}).replace(/\s+/g,' ').trim();};
  take(/(?:e |y )?(?:inicia|iniciar|empieza|empezar|activa|activar) (?:el |una |la |mi )?(?:dj|sesion)/g,()=>{start=true;});
  const following=['solo','sin','mas variedad','menos variedad','permite','descubrir','hip hop','lo fi',...Object.keys(STYLE_NAMES)].join('|');
  const split=text.match(new RegExp('^(.*?)(?= y (?:'+following+')\\b|$)'));
  const targetClause=split?.[0]||text;
  const play=targetClause.match(/^(?:pon|reproduce|toca) (.+?)(?: de (.+))?$/);
  const referenceText=targetClause.match(/^(?:sigue|seguir|mas) (?:como|con) (?!esta\b)(.+?)(?: de (.+))?$/);
  if(play || referenceText){const m=play||referenceText;target={title:m[1].trim(),artist:(m[2]||'').trim()};action=play?'play':'reference';text=text.slice(targetClause.length).trim();}
  {
    let known=false,discover=false;
    take(/(?:solo )?(?:musica |canciones |rolas )?(?:que conozco|conocidas|conocidos)|menos descubrimiento|mi musica/g,()=>{known=true;});
    take(/(?:permite |permitir )?(?:descubrir|descubrimiento)|mas descubrimiento|musica nueva|canciones nuevas/g,()=>{discover=true;});
    if(known && discover)errors.push('Elige conocidas o descubrir; las dos órdenes se contradicen.');
    if(known || discover){patch.known=known;labels.push(known?'Solo conocidas':'Permitir descubrir');}
    take(/(?:sigue lo que estoy escuchando|sigue la cancion que estoy escuchando|continua con esta(?: cancion)?|mezcla a partir de esta(?: cancion)?|mas de esta|mas como esta|sigue como esta|(?:sigue|seguir|siguela|siguele)(?: (?:esta|la|esa|lo que suena))?(?: cancion| rola| musica)?|misma vibe|mismo estilo)/g,()=>{action='reference';target={current:true};start=true;labels.push('Seguir esta canción');});
    take(/(?:sin (?!repetir artistas)|evita |excluye |no pongas )(.+?)(?=\s+y\s+|\s+pero\s+|\s+mas variedad\b|\s+menos variedad\b|$)/g,(_,name)=>{(patch.excludedArtists ||= []).push(name.trim());labels.push('Sin '+name.trim());});
    take(/(?:mas variedad|sin repetir artistas|varia artistas)/g,()=>{patch.variety=80;labels.push('Variar artistas');});
    take(/(?:menos variedad|repite artistas)/g,()=>{if(patch.variety===80)errors.push('Más y menos variedad se contradicen.');patch.variety=10;labels.push('Artistas cercanos');});
    take(/otra (?:sugerencia|cancion|rola)|renueva (?:la |las )?(?:cola|sugerencias)/g,()=>{if(action!=='configure')errors.push('Separa la orden de renovar.');action='refresh';});
    take(/(?:deten|termina|para|apaga) (?:el |la )?(?:dj|sesion)/g,()=>{if(action!=='configure')errors.push('Separa la orden de terminar.');action='stop';});
    take(/(?:restaura|restaurar|devuelve) (?:mi |la )?(?:cola|lista)/g,()=>{if(action!=='configure')errors.push('Separa la orden de restaurar.');action='restore';});
    take(/hip hop|lo fi/g,m=>{(patch.styles ||= []).push(m==='hip hop'?'hip hop':'lofi');});
    for(const key of Object.keys(STYLE_NAMES))take(new RegExp('\\b'+key+'\\b','g'),()=>{(patch.styles ||= []).push(STYLE_NAMES[key]);});
    text=text.replace(/\b(?:y|pero|con|algo|de|musica|canciones|por favor|quiero|ponme|me|el|la|un|una)\b/g,' ').replace(/\s+/g,' ').trim();
    if(text){
      if(!target && !Object.keys(patch).length && action==='configure' && !start && !errors.length && !/\b(?:solo|sin|descubr|variedad|termina|deten|restaura|quiero|menos|mas|inicia|dj|sesion)\b/.test(text)){
        action='search';target={title:words(raw),artist:''};start=true;text='';labels.push('Buscar música');
      }else errors.push('No entendí: «'+text+'». Corrige esa parte antes de aplicar.');
    }
  }
  if(start && ['stop','restore'].includes(action))errors.push('Iniciar y terminar se contradicen.');
  if(patch.styles)labels.push(...patch.styles.map(x=>'Estilo: '+x));
  if(!target && !Object.keys(patch).length && action==='configure' && !start)errors.push('Prueba «solo conocidas», «más como esta» o «pon canción de artista».');
  return {ok:!errors.length,action,target,start,patch,labels,errors};
}
function intentLabels(intent){return [intent.known?'Solo conocidas':'Descubrir afines',...(intent.artist?[`${intent.artistMode==='only'?'Solo':'Protagonista'}: ${intent.artist.name}`]:[]),...intent.styles.map(t=>'Estilo: '+t),...intent.excludedArtists.map(t=>'Sin '+t),...(intent.variety>=60?['Variar artistas']:[])];}
