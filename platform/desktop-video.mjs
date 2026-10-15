import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {Detection} from './detection.mjs';

// DPAPI is bound to the current Windows account. Secrets never appear in arguments.
export function secret(value, decrypt=false) {
  const code=decrypt
    ? '$s=ConvertTo-SecureString ([Console]::In.ReadToEnd());$p=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($s);try{[Console]::Out.Write([Runtime.InteropServices.Marshal]::PtrToStringBSTR($p))}finally{[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($p)}'
    : '[Console]::Out.Write((ConvertFrom-SecureString (ConvertTo-SecureString ([Console]::In.ReadToEnd()) -AsPlainText -Force)))';
  const exe=path.join(process.env.SystemRoot||'C:/Windows','System32/WindowsPowerShell/v1.0/powershell.exe');
  const r=spawnSync(exe,['-NoProfile','-NonInteractive','-Command',code],{input:value,encoding:'utf8',windowsHide:true,timeout:10000,env:{...process.env,PSModulePath:path.join(path.dirname(exe),'Modules')}});
  if(r.error||r.status!==0||!r.stdout)throw Error('Windows密码保护失败；请使用原Windows账户或重新填写密码');
  return r.stdout.trim();
}
export class DesktopVideo {
  constructor(root,dir,{protect=secret,Detector=Detection}={}) {
    this.file=path.join(dir,'desktop-video.json');this.protect=protect;this.closed=false;this.busy=new Set();
    this.saved=fs.existsSync(this.file)?JSON.parse(fs.readFileSync(this.file,'utf8')):{};
    this.workers=Object.fromEntries(['patrol','suppression'].map(role=>[role,new Detector(root,dir,role==='suppression')]));
    this.timer=setInterval(()=>{for(const role of Object.keys(this.workers)) {
      const w=this.workers[role];if(this.saved[role]?.enabled&&!w.process&&!this.busy.has(role)&&Date.now()>(w.retryAt||0))this.resume(role);
    }},3000);this.timer.unref();
  }
  persist(){fs.writeFileSync(this.file+'.tmp',JSON.stringify(this.saved,null,2));fs.renameSync(this.file+'.tmp',this.file);}
  info(){return Object.fromEntries(Object.entries(this.workers).map(([role,w])=>{const {cipher,...config}=this.saved[role]||{};return [role,{...w.info(),config:{...w.config,...config},passwordSaved:!!cipher}];}));}
  validate(role,b) {
    if(!this.workers[role])throw Error('未知飞机');
    const host=String(b.host||'').trim();if(!/^(\d{1,3}\.){3}\d{1,3}$/.test(host)||host.split('.').some(n=>Number(n)>255))throw Error('请填写遥控器当前IPv4地址，例如192.168.5.132');
    const port=Number(b.port||8554);if(!Number.isInteger(port)||port<1||port>65535)throw Error('视频端口需为1–65535');
    const streamPath=String(b.streamPath||'/stream=1');if(!streamPath.startsWith('/')||/[\s#@]/.test(streamPath)||streamPath.length>200)throw Error('无效视频路径');
    const old=this.saved[role]||{},defaults=this.workers[role].config;
    const config={host,port,streamPath,source:`rtsp://${host}:${port}${streamPath}`,python:b.python||old.python||defaults.python,model:b.model||old.model||defaults.model,confidence:Number(b.confidence??old.confidence??.35),enabled:true};
    if(!fs.existsSync(config.python)||!/python(?:3(?:\.\d+)?)?(?:\.exe)?$/i.test(path.basename(config.python)))throw Error('未找到Python，请在高级设置中选择现有Python路径');
    if(!fs.existsSync(config.model)||!config.model.endsWith('.onnx'))throw Error('未找到ONNX模型');
    if(!Number.isFinite(config.confidence)||config.confidence<.05||config.confidence>1)throw Error('置信度需为0.05–1');
    config.cipher=b.password?this.protect(String(b.password)):old.cipher;
    if(!config.cipher)throw Error('首次连接请填写遥控器桥接APK内的密码');
    return config;
  }
  async connect(role,b){if(this.busy.has(role))throw Error('正在连接，请稍候');this.busy.add(role);try{
    const config=this.validate(role,b),password=this.protect(config.cipher,true);
    await this.workers[role].stop();if(this.closed)return;
    this.workers[role].start({...config,password});this.saved[role]=config;this.persist();
  }finally{this.busy.delete(role);}}
  resume(role){this.busy.add(role);const w=this.workers[role];w.retryAt=Date.now()+30000;try{w.start({...this.saved[role],password:this.protect(this.saved[role].cipher,true)});}catch(e){w.status=e.message+'；30秒后重试';}finally{this.busy.delete(role);}}
  async disconnect(role){if(!this.workers[role])throw Error('未知飞机');if(this.busy.has(role))throw Error('正在连接，请稍候');if(this.saved[role]){this.saved[role].enabled=false;this.persist();}await this.workers[role].stop();}
  close(){this.closed=true;clearInterval(this.timer);for(const w of Object.values(this.workers))w.stop().catch(()=>{});}
}
