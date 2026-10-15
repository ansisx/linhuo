import http from 'node:http';
import dgram from 'node:dgram';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {timingSafeEqual} from 'node:crypto';
import {Decoder} from './mavlink.mjs';
import {Receiver,validateConnection} from './connections.mjs';
import {DesktopVideo} from './desktop-video.mjs';
import {startPlanSync} from './plan-sync.mjs';
import {ROLES,emptyState,ensure,role,number,text,webUrl,createEvent,reviewEvent,createTask,updateTask,parsePlan} from './domain.mjs';
const root=path.dirname(fileURLToPath(import.meta.url)),port=Number(process.env.PORT||8790),host=process.env.HOST||'127.0.0.1';
const ingestToken=process.env.INGEST_TOKEN||'',viewToken=process.env.VIEW_TOKEN||'';
if(!['127.0.0.1','localhost'].includes(host)&&viewToken.length<24)throw Error('对外监听必须设置至少24位 VIEW_TOKEN，并在正式部署配置 HTTPS');
const dir=process.env.DATA_DIR||path.join(root,'data');fs.mkdirSync(dir,{recursive:true});const file=path.join(dir,'state.json');
let state=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):emptyState();ensure(state.schema===1,'不支持的数据版本');
const videos=new DesktopVideo(root,dir),detection=videos.workers.patrol;
const channels=Object.fromEntries(ROLES.map((r,i)=>{const s=state.settings[r];return [r,new Receiver({enabled:s.enabled!==false,udpPort:Number(process.env[i?'SUPPRESSION_UDP_PORT':'PATROL_UDP_PORT']||s.udpPort||(i?14560:14550)),remoteIp:s.remoteIp||'',rtspUrl:s.rtspUrl||''})];}));
let closing=false;const retries=new Set();
function save(action,details){state.audit.push({at:Date.now(),action,details:text(details,180)});state.audit=state.audit.slice(-1000);const tmp=file+'.tmp';fs.writeFileSync(tmp,JSON.stringify(state,null,2));fs.renameSync(tmp,file);}
function equal(a,b){const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y);}
const planSync=startPlanSync({state,dir,save,port:Number(process.env.PLAN_SYNC_PORT||8793)});
function send(res,status,value){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value));}
function body(req){return new Promise((resolve,reject)=>{let size=0,chunks=[];req.on('data',chunk=>{size+=chunk.length;if(size>1048576){chunks=[];reject(Error('请求超过1MB'));}else chunks.push(chunk);});req.on('end',()=>{try{resolve(JSON.parse(Buffer.concat(chunks).toString()||'{}'));}catch{reject(Error('无效 JSON'));}});req.on('error',reject);});}
function snapshot(){const now=Date.now();return {now,mode:'integration',commandAdapter:'NOT_CONNECTED',channels:Object.fromEntries(ROLES.map(r=>{const c=channels[r],drones=c.decoder.snapshot();const candidates=drones.filter(d=>d.systemId===state.settings[r].systemId);return [r,{port:c.udpPort,status:c.status,receivedAt:c.receivedAt,stats:c.decoder.stats,ambiguous:candidates.length>1,detectedSystems:drones.map(d=>({systemId:d.systemId,source:d.source})),telemetry:candidates.length===1?candidates[0]:null}];})),...state,ingestEnabled:ingestToken.length>=24};}
const files={'/':['index.html','text/html; charset=utf-8'],'/app.js':['app.js','text/javascript'],'/styles.css':['styles.css','text/css'],'/api-guide':['../docs/接口与运行说明.md','text/plain; charset=utf-8']};
files['/cockpit.css']=['cockpit.css','text/css'];
files['/cockpit.js']=['cockpit.js','text/javascript'];
files['/refinements.css']=['refinements.css','text/css'];
files['/connections-ui.js']=['connections-ui.js','text/javascript'];
files['/detection-ui.js']=['detection-ui.js','text/javascript'];
files['/plan-sync-ui.js']=['plan-sync-ui.js','text/javascript'];
const server=http.createServer(async(req,res)=>{try{
  const u=new URL(req.url,'http://localhost');
  if(u.pathname==='/api/health')return send(res,200,{ok:true,appId:'linhuo-desktop-0.4-layout',root,commandAdapter:'NOT_CONNECTED'});
  if(u.pathname==='/api/ingest/fire'&&req.method==='POST'){
    if(ingestToken.length<24||!equal(req.headers.authorization||'','Bearer '+ingestToken))return send(res,401,{error:'未配置有效上报密钥或认证失败'});
    const data=await body(req);ensure(data.eventKey,'机载上报必须提供唯一 eventKey');const event=createEvent(data,'edge');const old=state.events.find(e=>e.source==='edge'&&e.eventKey===event.eventKey);if(old)return send(res,200,{event:old,duplicate:true});ensure(state.events.length<2000,'事件容量已满，请归档后继续');state.events.push(event);save('edge_detection',event.id);return send(res,201,{event});
  }
  if(u.pathname.startsWith('/api/')){
    if(viewToken&&!equal(req.headers['x-view-token']||'',viewToken))return send(res,401,{error:'需要平台访问密钥'});
    if(req.method==='GET'&&u.pathname==='/api/plan-sync/config')return send(res,200,planSync.info());
    if(req.method==='GET'&&u.pathname==='/api/videos')return send(res,200,videos.info());
    if(req.method==='GET'&&u.pathname==='/api/videos/frame'){const w=videos.workers[u.searchParams.get('role')];if(!w?.frame||Date.now()-w.at>5000)return send(res,404,{error:'暂无新视频帧'});res.writeHead(200,{'Content-Type':'image/jpeg','Cache-Control':'no-store'});return res.end(w.frame);}
    if(req.method==='GET'&&u.pathname==='/api/detection')return send(res,200,detection.info());
    if(req.method==='GET'&&(u.pathname==='/api/detection/frame'||u.pathname.startsWith('/api/detection/evidence/'))){const bytes=u.pathname==='/api/detection/frame'?(Date.now()-detection.at<5000?detection.frame:null):(()=>{const item=detection.records.find(x=>x.id===u.pathname.slice('/api/detection/evidence/'.length));return item?Buffer.from(item.jpeg,'base64'):null;})();if(!bytes)return send(res,404,{error:'暂无新画面或证据不存在'});res.writeHead(200,{'Content-Type':'image/jpeg','Cache-Control':'no-store'});return res.end(bytes);}
    if(req.method==='GET'&&u.pathname==='/api/state')return send(res,200,snapshot());
    if(req.method==='GET'&&u.pathname==='/api/connections')return send(res,200,{channels:Object.fromEntries(ROLES.map(r=>{const c=channels[r];return [r,{enabled:c.enabled,udpPort:c.udpPort,remoteIp:c.remoteIp,rtspUrl:c.rtspUrl,status:c.status,filtered:c.filtered}];}))});
    if(req.method==='GET'&&u.pathname.startsWith('/api/task/')){const task=state.tasks.find(t=>t.id===u.pathname.slice(10));ensure(task,'任务不存在');return send(res,200,{...task,notice:'人工交接资料；不是飞控指令；平台没有执行投放'});}
    ensure(req.method==='POST','不支持该方法');
    ensure(req.headers['x-platform-action']==='write','缺少本地操作标记');
    if(req.headers.origin){const origin=new URL(req.headers.origin);ensure(origin.host===req.headers.host,'来源不匹配');}
    const b=await body(req);
    if(u.pathname==='/api/videos/connect'){await videos.connect(b.role,b);return send(res,200,{ok:true});}
    if(u.pathname==='/api/videos/disconnect'){await videos.disconnect(b.role);return send(res,200,{ok:true});}
    if(u.pathname==='/api/detection/start'){detection.start(b);return send(res,200,{ok:true});}
    if(u.pathname==='/api/detection/stop'){detection.stop();return send(res,200,{ok:true});}
    if(u.pathname==='/api/connections'){const r=role(b.drone),config=validateConnection(b);ensure(!ROLES.some(other=>other!==r&&channels[other].udpPort===config.udpPort),'两机请使用不同端口');await channels[r].configure(config,()=>{const previous=state.settings[r],audit=state.audit.slice();state.settings[r]={...previous,...config};try{save('connection_update',r);}catch(e){state.settings[r]=previous;state.audit=audit;throw e;}});return send(res,200,{ok:true});}
    if(u.pathname==='/api/settings'){const r=role(b.drone);const id=number(b.systemId,1,254,'系统编号');ensure(Number.isInteger(id),'系统编号必须为整数');state.settings[r]={...state.settings[r],systemId:id,videoUrl:webUrl(b.videoUrl),videoKind:r==='patrol'?'processed':'raw'};save('settings',r);return send(res,200,{ok:true});}
    if(u.pathname==='/api/events'){ensure(state.events.length<2000,'事件容量已满');const e=createEvent(b);state.events.push(e);save('manual_detection',e.id);return send(res,201,{event:e});}
    if(u.pathname==='/api/events/review'){const e=reviewEvent(state,b.id,b);save('review_'+e.status,e.id);return send(res,200,{event:e});}
    if(u.pathname==='/api/tasks'){ensure(state.tasks.length<2000,'任务容量已满');const task=createTask(state,b);state.tasks.push(task);save('task_draft',task.id);return send(res,201,{task});}
    if(u.pathname==='/api/tasks/update'){const task=updateTask(state,b.id,b);save('task_'+task.status,task.id);return send(res,200,{task});}
    if(u.pathname==='/api/plans'){const r=role(b.drone);const plan=parsePlan(b.plan);state.plans[r]={...plan,name:text(b.name||'任务.plan',100)};save('plan_import',r);return send(res,200,{plan:state.plans[r]});}
    if(u.pathname==='/api/stop'){send(res,200,{stopped:true});setTimeout(shutdown,100);return;}
    return send(res,404,{error:'接口不存在'});
  }
  const item=files[u.pathname];if(!item)return send(res,404,{error:'页面不存在'});
  res.writeHead(200,{'Content-Type':item[1],'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'});fs.createReadStream(path.resolve(root,'public',item[0])).pipe(res);
}catch(e){send(res,400,{error:e.message});}});
async function bind(r){if(closing)return;const c=channels[r];try{await c.configure({enabled:c.enabled,udpPort:c.udpPort,remoteIp:c.remoteIp,rtspUrl:c.rtspUrl});console.log(`${r} UDP ${c.udpPort} ${c.status}`);}catch(e){c.status='busy';console.error(`${r}: ${e.message}；可在网页连接设置中重试或更换端口`);}}
function shutdown(){closing=true;videos.close();planSync.close();for(const t of retries)clearTimeout(t);for(const c of Object.values(channels))try{c.socket?.close();}catch{}server.close();server.closeAllConnections();}
server.on('error',e=>{console.error(e.message);shutdown();process.exitCode=1;});
server.listen(port,host,()=>{console.log(`双机森林消防平台 http://127.0.0.1:${port} | 无飞行/投放指令接口`);ROLES.forEach(bind);});
process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);
