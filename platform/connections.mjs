import dgram from 'node:dgram';
import {isIPv4} from 'node:net';
import {Decoder} from './mavlink.mjs';
export function validateConnection(b){
  if(typeof b.enabled!=='boolean')throw Error('请选择是否启用接收');
  if(!Number.isInteger(b.udpPort)||b.udpPort<1024||b.udpPort>65535)throw Error('UDP端口必须为1024–65535之间的整数');
  const remoteIp=String(b.remoteIp||'').trim();if(remoteIp&&!isIPv4(remoteIp))throw Error('遥控器地址必须为IPv4，或留空接收任意来源');
  const rtspUrl=String(b.rtspUrl||'').trim();if(rtspUrl){const u=new URL(rtspUrl);if(!['rtsp:','rtsps:'].includes(u.protocol)||u.username||u.password)throw Error('源地址需为不带账号密码的RTSP地址');}
  return {enabled:b.enabled,udpPort:b.udpPort,remoteIp,rtspUrl};
}
export class Receiver {
  constructor(config){Object.assign(this,config);this.decoder=new Decoder();this.status='starting';this.socket=null;this.receivedAt=0;this.filtered=0;this.changing=false;}
  async configure(config,persist=()=>{}){
    if(this.changing)throw Error('此通道正在切换，请稍后重试');this.changing=true;
    let next=null;const old=this.socket;
    try{
      const rebind=config.enabled&&(!old||config.udpPort!==this.udpPort||this.status!=='listening');
      if(rebind){next=dgram.createSocket('udp4');await new Promise((resolve,reject)=>{const fail=e=>reject(Error(e.code==='EADDRINUSE'?'端口被其他程序占用，原配置未改变':e.message));next.once('error',fail);next.bind(config.udpPort,'0.0.0.0',()=>{next.removeListener('error',fail);resolve();});});}
      // Persist only after the replacement socket is bound; failed saves preserve old listener.
      persist();Object.assign(this,config);
      if(!config.enabled||rebind){this.socket=next;if(old)try{old.close();}catch{}}
      if(next){const bound=next;bound.on('error',e=>{if(this.socket===bound){this.status=e.code||'error';this.socket=null;}try{bound.close();}catch{}});bound.on('message',(data,peer)=>{if(this.socket!==bound)return;if(this.remoteIp&&peer.address!==this.remoteIp){this.filtered++;return;}this.receivedAt=Date.now();this.decoder.feed(data,peer.address);});}
      this.decoder=new Decoder();this.receivedAt=0;this.filtered=0;this.status=config.enabled?'listening':'disabled';
    }catch(e){if(next)try{next.close();}catch{}throw e;}finally{this.changing=false;}
  }
  close(){try{this.socket?.close();}catch{}this.socket=null;this.status='disabled';}
}
