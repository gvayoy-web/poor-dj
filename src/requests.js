function queryDefinition(graphql,name,hash){
  if(graphql?.Definitions?.[name])return graphql.Definitions[name];
  if(hash)return {name,operation:'query',sha256Hash:hash,value:null};
  throw Error('Esta fuente musical no está disponible');
}
class RequestCache{
  constructor({limit=80,ttl=300000,timeout=10000}={}){this.limit=limit;this.ttl=ttl;this.timeout=timeout;this.cache=new Map();this.pending=new Map();this.disposed=false;this.running=0;this.waiting=[];}
  async run(fetcher){
    if(this.disposed)throw Error('Fuente cerrada');
    if(this.running>=2){if(this.waiting.length>=16)throw Error('Demasiadas consultas pendientes');await new Promise((resolve,reject)=>this.waiting.push({resolve,reject}));}
    else this.running++;
    try{if(this.disposed)throw Error('Fuente cerrada');return await fetcher();}
    finally{const next=this.waiting.shift();if(next)next.resolve();else this.running--;}
  }
  get(key,fetcher){
    const cached=this.cache.get(key);
    if(cached && Date.now()-cached.time<this.ttl){this.cache.delete(key);this.cache.set(key,cached);return Promise.resolve(cached.data);}
    if(this.pending.has(key))return this.pending.get(key);
    let timer;
    const request=Promise.resolve().then(()=>this.run(fetcher)).then(data=>{
      if(data?.errors?.length)throw Error('Fuente musical no disponible');
      if(Number(data?.code)>=400)throw Error('Spotify no autorizó la fuente musical');
      if(!this.disposed){this.cache.set(key,{time:Date.now(),data});while(this.cache.size>this.limit)this.cache.delete(this.cache.keys().next().value);}
      return data;
    });
    const visible=Promise.race([request,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Tiempo de espera agotado')),this.timeout);})]).finally(()=>clearTimeout(timer));
    this.pending.set(key,visible);
    request.finally(()=>this.pending.delete(key)).catch(()=>{});
    return visible;
  }
  dispose(){this.disposed=true;this.cache.clear();for(const job of this.waiting.splice(0))job.reject(Error('Fuente cerrada'));}
}
