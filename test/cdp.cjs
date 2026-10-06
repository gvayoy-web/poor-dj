async function connect(){
 const targets=await (await fetch('http://127.0.0.1:9222/json/list')).json(),target=targets.find(t=>t.type==='page' && /xpui\./.test(t.url));if(!target)throw Error('No Spotify page available');
 const socket=new WebSocket(target.webSocketDebuggerUrl);await new Promise((r,j)=>{socket.addEventListener('open',r,{once:true});socket.addEventListener('error',j,{once:true});});
 let serial=0;const pending=new Map();socket.addEventListener('message',event=>{const data=JSON.parse(event.data);if(data.id && pending.has(data.id)){const entry=pending.get(data.id);clearTimeout(entry.timer);pending.delete(data.id);entry.resolve(data);}});
 socket.addEventListener('close',()=>{for(const entry of pending.values()){clearTimeout(entry.timer);entry.reject(Error('Spotify CDP disconnected'));}pending.clear();});
 const send=async(method,params={})=>{const reply=await new Promise((resolve,reject)=>{const id=++serial,timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP request timed out'));},30000);pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params}));});if(reply.error)throw Error(reply.error.message);return reply.result;};
 return {send,evaluate:async expression=>{const result=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(result?.exceptionDetails)throw Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text);return result?.result?.value;},close:()=>socket.close()};
}
module.exports={connect};
