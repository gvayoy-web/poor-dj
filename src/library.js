class MusicLibrary{
  constructor(platform,requests){this.platform=platform;this.requests=requests;this.tracks=new Map();this.playlists=[];this.loadedPlaylists=new Set();this.flight=null;this.updatedAt=0;this.status='Me gusta y playlists todavía sin consultar.';this.disposed=false;}
  read(key,fetcher){return this.requests.get('library:'+key,fetcher);}
  add(data,evidence){
    for(const track of collect(data,'tu colección')){
      const old=this.tracks.get(track.uri),proof=[...new Set([...(old?.evidence||[]),evidence])];
      this.tracks.set(track.uri,{...track,image:track.image||old?.image||'',evidence:proof,playlist:proof.includes('playlist')});
    }
    while(this.tracks.size>1000)this.tracks.delete(this.tracks.keys().next().value);
  }
  snapshot(){return [...this.tracks.values()];}
  async load(context='',force=false,chosen=''){
    if(this.disposed)return [];
    if(this.flight)return this.flight;
    if(!force && !chosen && Date.now()-this.updatedAt<300000)return this.snapshot();
    this.status='Consultando tus Me gusta y playlists…';
    this.flight=this.fetch(context,force,chosen).finally(()=>{this.flight=null;});return this.flight;
  }
  async fetch(context,force,chosen){
    const P=this.platform,stamp=force?Date.now():'';let failures=0;
    const results=await Promise.allSettled([
      P.LibraryAPI?.getTracks?this.read('liked:'+stamp,()=>P.LibraryAPI.getTracks({offset:0,limit:160})):Promise.reject(Error('Me gusta no disponible')),
      P.RootlistAPI?.getContents?this.read('root:'+stamp,()=>P.RootlistAPI.getContents()):Promise.reject(Error('Playlists no disponibles'))
    ]);
    if(this.disposed)return [];
    if(results[0].status==='fulfilled')this.add(results[0].value,'megusta');else failures++;
    if(results[1].status==='fulfilled'){
      const found=new Map(),seen=new WeakSet();let nodes=0;
      const walk=(x,d=0)=>{if(!x || typeof x!=='object' || d>12 || seen.has(x) || nodes++>3000)return;seen.add(x);if(/^spotify:playlist:/.test(x.uri||''))found.set(x.uri,{uri:x.uri,name:x.name||'Playlist'});for(const v of Object.values(x))if(v && typeof v==='object')walk(v,d+1);};
      walk(results[1].value);this.playlists=[...found.values()].slice(0,100);
    }else failures++;
    const selected=chosen?[chosen]:[...new Set([context,...this.playlists.map(p=>p.uri)].filter(uri=>/^spotify:playlist:/.test(uri)))].slice(0,7);
    for(let i=0;i<selected.length && !this.disposed;i+=2){
      const batch=await Promise.allSettled(selected.slice(i,i+2).map(async uri=>{
        if(!P.PlaylistAPI?.getContents)throw Error('Playlist no disponible');
        for(let offset=0;offset<(chosen?300:50);offset+=100){
          const limit=chosen?100:50,data=await this.read(uri+':'+offset+':'+limit+':'+stamp,()=>P.PlaylistAPI.getContents(uri,{offset,limit}));
          if(this.disposed)return;this.add(data,'playlist');
          if((data.items?.length||0)<limit)break;
        }
        this.loadedPlaylists.add(uri);
      }));failures+=batch.filter(r=>r.status==='rejected').length;
    }
    this.updatedAt=Date.now();const liked=this.snapshot().filter(t=>t.evidence.includes('megusta')).length;
    this.status=`${liked} Me gusta cargados · ${this.loadedPlaylists.size}/${this.playlists.length} playlists consultadas · ${this.tracks.size} canciones en estas fuentes.${failures?' Algunas fuentes no respondieron.':''}`;
    return this.snapshot();
  }
  dispose(){this.disposed=true;this.tracks.clear();}
}
