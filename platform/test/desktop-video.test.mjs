import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {DesktopVideo,secret} from '../desktop-video.mjs';
class FakeDetector {
 constructor(root){this.config={python:path.join(root,'python.exe'),model:path.join(root,'test.onnx'),confidence:.35};this.records=[];}
 info(){return {config:this.config,running:!!this.process,records:[]};}
 start(b){this.last=b;this.process={};}
 async stop(){this.process=null;}
}
test('双机连接保存、密码不回传、重启恢复、断开取消恢复、参数校验',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'linhuo-video-'));
 fs.writeFileSync(path.join(dir,'python.exe'),'');fs.writeFileSync(path.join(dir,'test.onnx'),'');
 const protect=(v,decrypt)=>decrypt?Buffer.from(v,'base64').toString():Buffer.from(v).toString('base64');
 const v=new DesktopVideo(dir,dir,{protect,Detector:FakeDetector});
 try{await v.connect('patrol',{host:'192.168.5.132',password:'test-secret'});
 assert.equal(v.workers.patrol.last.source,'rtsp://192.168.5.132:8554/stream=1');
 assert.equal(v.info().patrol.passwordSaved,true);assert.equal(JSON.stringify(v.info()).includes('test-secret'),false);assert.equal(v.info().patrol.config.cipher,undefined);
 assert.equal(fs.readFileSync(v.file,'utf8').includes('test-secret'),false);
 await v.connect('patrol',{host:'192.168.5.133'});assert.equal(v.workers.patrol.last.password,'test-secret');
 await assert.rejects(v.connect('patrol',{host:'999.1.1.1'}));
 const restored=new DesktopVideo(dir,dir,{protect,Detector:FakeDetector});try{restored.resume('patrol');assert.equal(restored.workers.patrol.last.password,'test-secret');assert.equal(restored.workers.suppression.process,undefined);}finally{restored.close();}
 await v.disconnect('patrol');assert.equal(v.saved.patrol.enabled,false);assert.equal(v.workers.patrol.process,null);
 }finally{v.close();}
});
test('Windows DPAPI密码往返（需真实Windows账户，TEST_WINDOWS_DPAPI=1）', {skip:process.platform!=='win32'||process.env.TEST_WINDOWS_DPAPI!=='1'},()=>{const value='test-only-Random-42';const cipher=secret(value);assert.notEqual(cipher,value);assert.equal(secret(cipher,true),value);});
