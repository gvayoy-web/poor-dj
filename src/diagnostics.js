// Informe de compatibilidad: qué partes del cliente responden. Puro: recibe resultados ya medidos.
function compatReport({api={},probes={}}){
  const row=(name,ok,detail)=>({name,ok:ok===null?null:!!ok,detail});
  const probe=(key,label)=>probes[key]===undefined?row(label,null,'Sin comprobar'):row(label,probes[key]===true,probes[key]===true?'Responde':'No responde: Spotify pudo cambiar esta consulta');
  const rows=[
    row('Cola de reproducción',api.queue,api.queue?'Disponible':'No disponible: el DJ no puede gestionar la cola'),
    row('Reproducción directa',api.play,api.play?'Disponible':'No disponible'),
    probe('search','Búsqueda de canciones'),probe('artists','Búsqueda de artistas'),
    row('Datos acústicos',api.audio,api.audio?'Disponible':'No disponibles: se mezcla sin tempo ni tono'),
    row('Playlists privadas',api.playlists,api.playlists?'Disponible':'No disponible: no se podrán guardar mezclas'),
    row('Voz en español',api.voice,api.voice?'Disponible':'No disponible: solo subtítulos'),
    row('Letras de Spotify',api.lyrics,api.spicy?'Spicy Lyrics se encarga de las letras':api.lyrics?'Disponible':'No disponible'),
  ];
  return {rows,problems:rows.filter(r=>r.ok===false).length};
}
