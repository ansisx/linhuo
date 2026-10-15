import test from 'node:test';
import assert from 'node:assert/strict';
import dgram from 'node:dgram';
import {Receiver,validateConnection} from '../connections.mjs';
const bind=()=>new Promise((resolve,reject)=>{const s=dgram.createSocket('udp4');s.once('error',reject);s.bind(0,'0.0.0.0',()=>resolve(s));});
const close=s=>new Promise(resolve=>s.close(resolve));
test('接口配置验证：端口、IPv4、视频源协议',()=>{for(const port of [0,1023,65536,1.2,'14550'])assert.throws(()=>validateConnection({enabled:true,udpPort:port}));assert.throws(()=>validateConnection({enabled:true,udpPort:14550,remoteIp:'bad'}));assert.throws(()=>validateConnection({enabled:true,udpPort:14550,rtspUrl:'http://example.com'}));assert.deepEqual(validateConnection({enabled:false,udpPort:14550,remoteIp:'10.248.240.25'}),{enabled:false,udpPort:14550,remoteIp:'10.248.240.25',rtspUrl:''});});
test('动态换端口、冲突回滚、持久化失败回滚、来源过滤、停用释放',async()=>{
 const occupied=await bind(),reserve=await bind(),port=reserve.address().port;await close(reserve);const r=new Receiver({enabled:true,udpPort:port,remoteIp:'',rtspUrl:''});const c={enabled:true,udpPort:port,remoteIp:'',rtspUrl:''};const sender=dgram.createSocket('udp4');
 try{await r.configure(c);assert.equal(r.status,'listening');await assert.rejects(r.configure({...c,udpPort:occupied.address().port}),/占用/);assert.equal(r.udpPort,port);assert.equal(r.status,'listening');const available=await bind(),nextPort=available.address().port;await close(available);await assert.rejects(r.configure({...c,udpPort:nextPort},()=>{throw Error('disk full');}),/disk full/);assert.equal(r.udpPort,port);
 await r.configure({...c,udpPort:nextPort,remoteIp:'192.0.2.1'});await new Promise((resolve,reject)=>sender.send(Buffer.from([1,2]),nextPort,'127.0.0.1',e=>e?reject(e):resolve()));await new Promise(resolve=>setTimeout(resolve,40));assert.equal(r.filtered,1);assert.equal(r.decoder.stats.packets,0);await r.configure({...c,udpPort:nextPort,enabled:false});assert.equal(r.socket,null);const check=dgram.createSocket('udp4');await new Promise((resolve,reject)=>{check.once('error',reject);check.bind(nextPort,resolve);});await close(check);
 }finally{r.close();sender.close();await close(occupied);}
});
