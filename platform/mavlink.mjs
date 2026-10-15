const definitions = {0:[50,9],1:[124,31],24:[24,30],30:[39,28],33:[104,28],74:[20,20],147:[154,36]};
export function crc(bytes,extra){let c=65535;for(const x of [...bytes,extra]){let t=x^(c&255);t^=(t<<4)&255;c=((c>>8)^(t<<8)^(t<<3)^(t>>4))&65535;}return c;}
export class Decoder {
  vehicles=new Map(); stats={packets:0,valid:0,bad:0,unsupported:0};
  feed(data,source){this.stats.packets++;let at=0;
    while(at<data.length){const v2=data[at]===253;if(!v2&&data[at]!==254){at++;continue;}const h=v2?10:6;if(at+h>data.length)break;const n=data[at+1], signed=v2&&(data[at+2]&1),size=h+n+2+(signed?13:0);if(at+size>data.length){this.stats.bad++;break;}
      const f=data.subarray(at,at+size);at+=size;const id=v2?f.readUIntLE(7,3):f[5],sys=f[v2?5:3],comp=f[v2?6:4],def=definitions[id];
      if(v2&&(f[2]&~1)){this.stats.bad++;continue;}if(!def){this.stats.unsupported++;continue;}
      if((!v2&&n<def[1])||crc(f.subarray(1,h+n),def[0])!==f.readUInt16LE(h+n)){this.stats.bad++;continue;}
      this.stats.valid++;const p=Buffer.alloc(Math.max(n,def[1]));f.copy(p,0,h,h+n);
      // Only autopilot component telemetry; exclude forwarded GCS heartbeats.
      if(comp!==1||sys===0||(id===0&&(p[4]===6||p[5]===8)))continue;
      const key=source+':'+sys,s=this.vehicles.get(key)||{droneId:'UAV-'+sys,source,systemId:sys,fields:{}};const now=Date.now();s.t=now;
      const set=(k,v)=>{s[k]=Number.isFinite(v)||typeof v==='string'?v:null;s.fields[k]=now;};
      const position=(lat,lng,alt)=>{if(Math.abs(lat)<=90&&Math.abs(lng)<=180&&!(lat===0&&lng===0)){set('lat',lat);set('lng',lng);set('alt',alt);s.positionAt=now;}else{set('lat',null);set('lng',null);}};
      if(id===0){set('mode','模式编号 '+p.readUInt32LE(0));set('armed',(p[6]&128)?'已解锁':'未解锁');}
      if(id===1){const v=p.readUInt16LE(14),b=p.readInt8(30);set('voltage',v===65535?null:v/1000);set('battery',b>=0&&b<=100?b:null);}
      if(id===24){set('fixType',p[28]);set('sats',p[29]===255?null:p[29]);if(p[28]>=3)position(p.readInt32LE(8)/1e7,p.readInt32LE(12)/1e7,p.readInt32LE(16)/1000);else{set('lat',null);set('lng',null);}}
      if(id===33){position(p.readInt32LE(4)/1e7,p.readInt32LE(8)/1e7,p.readInt32LE(12)/1000);set('relativeAlt',p.readInt32LE(16)/1000);set('speed',Math.hypot(p.readInt16LE(20),p.readInt16LE(22))/100);set('heading',p.readUInt16LE(26)===65535?null:p.readUInt16LE(26)/100);}
      if(id===30){set('roll',p.readFloatLE(4)*180/Math.PI);set('pitch',p.readFloatLE(8)*180/Math.PI);}
      if(id===74){set('speed',p.readFloatLE(4));set('heading',p.readInt16LE(16));}
      if(id===147&&p[32]===0){const b=p.readInt8(35);set('battery',b>=0&&b<=100?b:null);let total=0,found=false;for(let i=10;i<30;i+=2){const v=p.readUInt16LE(i);if(v!==65535){total+=v;found=true;}}set('voltage',found?total/1000:null);}
      this.vehicles.set(key,s);
    }
  }
  snapshot(){const now=Date.now();return [...this.vehicles.values()].map(s=>{const out={...s};for(const [k,t] of Object.entries(s.fields))if(now-t>10000)out[k]=null;delete out.fields;return out;});}
}
