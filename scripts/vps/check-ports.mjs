import net from 'node:net';
const host=process.argv[2]||process.env.VPS_HOST;
if(!host)throw new Error('Usage: node scripts/vps/check-ports.mjs <your-vps-host>');
const ports=[22,80,443,3001,5433,6380,9000,9001,8080,2019,2375,2376];
const results=await Promise.all(ports.map(port=>new Promise(resolve=>{
  const socket=net.connect({host,port});
  let done=false;
  const finish=state=>{if(done)return;done=true;socket.destroy();resolve({port,state});};
  socket.setTimeout(2500,()=>finish('not reachable'));
  socket.on('connect',()=>finish('open'));
  socket.on('error',()=>finish('not reachable'));
})));
console.log(JSON.stringify(results));
if(results.some(x=>[22,80,443].includes(x.port)?x.state!=='open':x.state==='open'))process.exitCode=1;
