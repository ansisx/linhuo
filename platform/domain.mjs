import {randomUUID} from 'node:crypto';
export const ROLES=['patrol','suppression'];
export const roleName={patrol:'巡检机',suppression:'灭火机'};
export function ensure(ok,message){if(!ok)throw new Error(message);}
export function role(value){ensure(ROLES.includes(value),'无人机角色必须为 patrol 或 suppression');return value;}
export function number(value,min,max,name){ensure(typeof value==='number'&&Number.isFinite(value)&&value>=min&&value<=max,name+'不合法');return value;}
export function text(value,max=500){return String(value??'').trim().slice(0,max);}
export function coordinates(lat,lng){return {lat:number(lat,-90,90,'纬度'),lng:number(lng,-180,180,'经度')};}
export function webUrl(value){if(!value)return '';const u=new URL(value);ensure(['http:','https:'].includes(u.protocol)&&!u.username&&!u.password,'只接受不带账号密码的 HTTP/HTTPS 播放页面地址');return u.href;}
export function emptyState(){return {schema:1,events:[],tasks:[],audit:[],plans:{},settings:{patrol:{systemId:1,videoUrl:'',videoKind:'processed'},suppression:{systemId:1,videoUrl:'',videoKind:'raw'}}};}
export function createEvent(body,source='manual'){
  const drone=role(body.drone||'patrol');ensure(drone==='patrol','火源事件必须来源于巡检机');
  const e={id:randomUUID(),eventKey:text(body.eventKey,100),drone,source,label:text(body.label||'疑似火源',80),confidence:body.confidence==null?null:number(body.confidence,0,1,'置信度'),detectedAt:body.detectedAt==null?Date.now():number(body.detectedAt,0,Date.now()+60000,'检测时间'),receivedAt:Date.now(),status:'candidate',note:text(body.note),position:null,positionVerified:false};
  if(body.position!=null){ensure(body.position.crs==='WGS84','火点坐标必须明确标注 WGS84');e.position={...coordinates(body.position.lat,body.position.lng),crs:'WGS84',method:text(body.position.method||'未说明',80),uncertaintyM:number(body.position.uncertaintyM,0,100000,'定位误差半径')};}
  if(body.bbox!=null){ensure(Array.isArray(body.bbox)&&body.bbox.length===4,'bbox 必须是归一化 [x,y,w,h]');e.bbox=body.bbox.map(v=>number(v,0,1,'bbox'));ensure(e.bbox[2]>0&&e.bbox[3]>0&&e.bbox[0]+e.bbox[2]<=1.00001&&e.bbox[1]+e.bbox[3]<=1.00001,'bbox 超出画面');}
  return e;
}
export function reviewEvent(state,id,body){const e=state.events.find(x=>x.id===id);ensure(e,'火点不存在');ensure(e.status==='candidate','该火点已经处理');const action=body.action;ensure(['confirm','dismiss'].includes(action),'无效审核动作');const note=text(body.note);ensure(note,'请填写审核依据');
  if(action==='confirm'){const p=body.position?createEvent({position:body.position}).position:e.position;ensure(p,'无地面坐标，不能确认可用火点；请先核验坐标');ensure(body.positionVerified===true,'必须人工核验地面坐标');e.position=p;e.positionVerified=true;}
  e.status=action==='confirm'?'confirmed':'dismissed';e.reviewNote=note;e.reviewedAt=Date.now();return e;
}
export function createTask(state,body){const e=state.events.find(x=>x.id===body.eventId);ensure(e&&e.status==='confirmed'&&e.positionVerified,'仅可对已确认且坐标已核验的火点创建任务');ensure(!state.tasks.some(t=>t.eventId===e.id&&!['verified','cancelled'].includes(t.status)),'该火点已有未结束任务');return {id:randomUUID(),eventId:e.id,drone:'suppression',status:'draft',createdAt:Date.now(),target:{...e.position},note:text(body.note),transport:'NOT_CONNECTED',slots:[null,null,null,null],history:[{at:Date.now(),status:'draft',note:'平台任务草稿，尚未下发飞机'}]};}
const transitions={draft:['handed_over','cancelled'],handed_over:['operator_reported','cancelled'],operator_reported:['verified','cancelled']};
export function updateTask(state,id,body){const t=state.tasks.find(x=>x.id===id);ensure(t,'任务不存在');ensure(transitions[t.status]?.includes(body.status),'不允许的任务状态转换');const note=text(body.note);ensure(note,'请填写人工操作记录或复核依据');
  if(body.status==='operator_reported'){ensure(Array.isArray(body.slots)&&body.slots.length>0,'请选择操作员报告的舵机通道');for(const slot of body.slots){number(slot,1,4,'舵机通道');ensure(Number.isInteger(slot),'舵机通道必须为整数');}for(const slot of body.slots)t.slots[slot-1]='operator_reported';}
  t.status=body.status;t.history.push({at:Date.now(),status:t.status,note});return t;
}
export function parsePlan(plan){ensure(plan&&plan.fileType==='Plan'&&plan.mission&&Array.isArray(plan.mission.items),'请选择 QGC .plan 文件');ensure(plan.mission.items.length<=1000,'最多支持1000个任务项');let waypoints=[];let actions=0;let warning=[];
  for(const [index,item]of plan.mission.items.entries()){
    ensure(item.type==='SimpleItem','此版本只支持普通航点，不支持测绘等 ComplexItem');
    if(![16,21,22,82,84,85].includes(item.command)){actions++;warning.push('任务项 '+(index+1)+' 命令 '+item.command+' 未绘为坐标点');continue;}
    ensure([0,3,5,6,10,11].includes(item.frame),'不支持局部坐标系航点');ensure(Array.isArray(item.params)&&item.params.length===7,'航点参数必须有7项');
    const lat=item.params[4],lng=item.params[5];coordinates(lat,lng);ensure(!(lat===0&&lng===0),'零坐标可能表示当前位置，不能当作固定航点绘制');
    waypoints.push({index:index+1,command:item.command,frame:item.frame,...coordinates(lat,lng),alt:number(item.params[6],-10000,100000,'航点高度'),altitudeReference:[3,6].includes(item.frame)?'相对 Home':[10,11].includes(item.frame)?'相对地形':'海拔'});
  }
  ensure(waypoints.length,'未找到可展示的普通坐标航点');return {waypoints,actions,warnings:warning,importedAt:Date.now(),displayOnly:true};
}
