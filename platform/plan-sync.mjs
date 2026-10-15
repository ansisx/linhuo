import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {randomBytes,createHash,timingSafeEqual} from 'node:crypto';
import {parsePlan} from './domain.mjs';
const roles=['patrol','suppression'];
function reply(res,status,data){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));}
function match(a,b){const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y);}
export function acceptPlan(state,drone,data,save){
 if(!roles.includes(drone))throw Error('无人机角色无效');
 if(typeof data.name!=='string'||!/^([^\\/\x00-\x1f]{1,95})\.plan$/i.test(data.name))throw Error('文件名必须为 .plan');
 const parsed=parsePlan(data.plan),hash=createHash('sha256').update(JSON.stringify(data.plan)).digest('hex');
 const old=state.plans[drone];
 if(old?.source==='qgc-folder'&&old.sha256===hash&&old.name===data.name)return {ok:true,duplicate:true,revision:old.revision,receivedAt:old.receivedAt};
 const next={...parsed,name:data.name,source:'qgc-folder',sha256:hash,revision:(old?.revision||0)+1,receivedAt:Date.now()};
 state.plans[drone]=next;const audit=state.audit.slice();
 try{save('plan_auto_sync',drone+' '+data.name);}catch(e){if(old)state.plans[drone]=old;else delete state.plans[drone];state.audit=audit;throw e;}
 return {ok:true,revision:next.revision,receivedAt:next.receivedAt,waypoints:next.waypoints.length};
}
export function startPlanSync({state,dir,save,port=8793,host='0.0.0.0'}){
 const tokenFile=path.join(dir,'plan-sync-keys.json');
 let keys;if(fs.existsSync(tokenFile))keys=JSON.parse(fs.readFileSync(tokenFile,'utf8'));else{keys=Object.fromEntries(roles.map(r=>[r,randomBytes(24).toString('hex')]));fs.writeFileSync(tokenFile,JSON.stringify(keys),{mode:0o600,flag:'wx'});}
 for(const r of roles)if(typeof keys[r]!=='string'||keys[r].length<32)throw Error('航线密钥文件无效');
 let status='starting',error='',boundPort=port;
 const server=http.createServer(async(req,res)=>{
  const role=/^\/api\/plan-sync\/(patrol|suppression)$/.exec(req.url||'')?.[1];
  if(req.method!=='POST'||!role){req.resume();return reply(res,404,{error:'仅支持航线同步上传'});}
  if(!match(req.headers.authorization||'','Bearer '+keys[role])){req.resume();return reply(res,401,{error:'航线同步密钥错误'});}
  if(!String(req.headers['content-type']||'').startsWith('application/json')){req.resume();return reply(res,415,{error:'需要JSON请求'});}
  try{const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>1048576){reply(res,413,{error:'航线请求超过1MB'});req.destroy();return;}chunks.push(chunk);}const data=JSON.parse(Buffer.concat(chunks).toString('utf8'));const result=acceptPlan(state,role,data,save);error='';reply(res,200,result);}
  catch(e){error=String(e.message).slice(0,160);if(!res.headersSent)reply(res,400,{error});}
 });
 server.requestTimeout=15000;server.headersTimeout=10000;server.timeout=20000;server.maxConnections=16;
 server.on('error',e=>{status='error';error=e.code==='EADDRINUSE'?'8793端口被占用，请停止另一份平台':e.code||'监听失败';});
 server.listen(port,host,()=>{status='listening';boundPort=server.address().port;});
 return {server,info(){const addresses=[...new Set(Object.entries(os.networkInterfaces()).sort(([a],[b])=>Number(/WLAN|Wi-Fi|Wireless/i.test(b))-Number(/WLAN|Wi-Fi|Wireless/i.test(a))).flatMap(([,a])=>a||[]).filter(a=>a.family==='IPv4'&&!a.internal&&!a.address.startsWith('169.254.')).map(a=>a.address))];return {status,error,port:boundPort,addresses,roles:Object.fromEntries(roles.map(r=>[r,{token:keys[r],path:'/api/plan-sync/'+r,plan:state.plans[r]?{name:state.plans[r].name,source:state.plans[r].source,revision:state.plans[r].revision,receivedAt:state.plans[r].receivedAt,points:state.plans[r].waypoints.length}:null}]))};},close(){server.close();server.closeAllConnections();}};
}
