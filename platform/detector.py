"""Local generic-object test only. JSON config on stdin; NDJSON frames on stdout."""
import os, sys, json, time, threading, base64, ast
os.environ['OPENCV_FFMPEG_CAPTURE_OPTIONS']='rtsp_transport;tcp|stimeout;5000000'
os.environ['OPENCV_LOG_LEVEL']='SILENT'
import cv2
import numpy as np
import onnxruntime as ort
emit_lock=threading.Lock()

def emit(value):
    with emit_lock:print(json.dumps(value,ensure_ascii=True,separators=(',',':')),flush=True)

class Model:
    def __init__(self,path,backend='gpu',device=None):
        from gpu_device import select_nvidia
        selected=select_nvidia() if backend!='cpu' and device is None else None
        if selected:device=selected['index']
        opts=ort.SessionOptions();opts.intra_op_num_threads=4
        opts.enable_mem_pattern=False
        opts.enable_profiling=os.environ.get('DETECT_PROFILE')=='1'
        opts.profile_file_prefix=os.path.join(os.path.dirname(path),'benchmark-profile')
        opts.execution_mode=ort.ExecutionMode.ORT_SEQUENTIAL
        providers=['CPUExecutionProvider'] if backend=='cpu' else [('DmlExecutionProvider',{'device_id':int(device)}),'CPUExecutionProvider']
        if backend!='cpu' and 'DmlExecutionProvider' not in ort.get_available_providers():raise RuntimeError('GPU runtime unavailable')
        self.session=ort.InferenceSession(path,sess_options=opts,providers=providers)
        if backend!='cpu' and 'DmlExecutionProvider' not in self.session.get_providers():raise RuntimeError('GPU initialization failed')
        self.backend='CPU' if backend=='cpu' else 'GPU DirectML '+(selected['name'] if selected else f'adapter {device}')
        inp=self.session.get_inputs()[0]
        if inp.shape!=[1,3,640,640]: raise ValueError('Only supplied fixed 640x640 ONNX model is supported')
        self.input=inp.name
        self.names=ast.literal_eval(self.session.get_modelmeta().custom_metadata_map.get('names','{}'))
    def infer(self,frame,threshold):
        h,w=frame.shape[:2];r=min(640/w,640/h);nw,nh=round(w*r),round(h*r)
        left,top=(640-nw)//2,(640-nh)//2
        canvas=np.full((640,640,3),114,np.uint8);canvas[top:top+nh,left:left+nw]=cv2.resize(frame,(nw,nh))
        tensor=np.ascontiguousarray(canvas[:,:,::-1].transpose(2,0,1)[None],dtype=np.float32)/255
        rows=self.session.run(None,{self.input:tensor})[0]
        if rows.shape!=(1,300,6): raise ValueError('Unexpected model output; require [1,300,6]')
        boxes=[]
        for x1,y1,x2,y2,score,cls in rows[0]:
            if not np.isfinite([x1,y1,x2,y2,score,cls]).all() or score<threshold:continue
            x1,x2=np.clip((np.array([x1,x2])-left)/r,0,w-1);y1,y2=np.clip((np.array([y1,y2])-top)/r,0,h-1)
            if x2<=x1 or y2<=y1:continue
            label=str(self.names.get(int(cls),str(int(cls))))
            boxes.append({'classId':int(cls),'label':label,'confidence':round(float(score),4),'bbox':[round(float(x1/w),5),round(float(y1/h),5),round(float((x2-x1)/w),5),round(float((y2-y1)/h),5)]})
            cv2.rectangle(frame,(int(x1),int(y1)),(int(x2),int(y2)),(60,220,140),2)
            cv2.putText(frame,f'{label} {score:.2f}',(int(x1),max(18,int(y1)-5)),cv2.FONT_HERSHEY_SIMPLEX,.55,(60,220,140),2)
        cv2.putText(frame,'GENERAL TEST - NOT FIRE DETECTION',(12,28),cv2.FONT_HERSHEY_SIMPLEX,.65,(0,220,255),2)
        return boxes

def main():
    cfg=json.loads(sys.stdin.readline());model=None if cfg.get('raw') else Model(cfg['model'],cfg.get('backend','gpu'),cfg.get('device'));emit({'type':'status','message':'电脑已就绪，正在连接遥控器视频'})
    if cfg.get('image'):
        frame=cv2.imread(cfg['image']);boxes=model.infer(frame,float(cfg.get('confidence',.35))) if model else []
        cv2.imwrite(cfg['output'],frame);emit({'type':'test','boxes':boxes});return
    source=cfg['source'];threshold=float(cfg.get('confidence',.35));latest=[None,0,0];lock=threading.Lock()
    def capture():
        while True:
            emit({'type':'status','message':'正在连接视频，每3秒自动重试；尚不代表已连上'})
            cap=cv2.VideoCapture(source,cv2.CAP_FFMPEG,[cv2.CAP_PROP_OPEN_TIMEOUT_MSEC,5000,cv2.CAP_PROP_READ_TIMEOUT_MSEC,5000])
            if cap.isOpened():emit({'type':'status','message':'RTSP opened; waiting for decoded frames'})
            while cap.isOpened():
                ok,frame=cap.read()
                if not ok:break
                with lock:latest[:]=[frame,int(time.time()*1000),latest[2]+1]
            cap.release()
            with lock:latest[0]=None
            emit({'type':'status','message':'视频不可用：检查遥控器IP、桥接APK是否启动、密码及WiFi设备隔离'})
            time.sleep(3)
    threading.Thread(target=capture,daemon=True).start();seen=-1;previous=time.monotonic();fps=0.0
    while True:
        started=time.monotonic()
        with lock:frame,at,seq=latest;frame=None if frame is None else frame.copy()
        if frame is None or seq==seen:time.sleep(.005);continue
        seen=seq;boxes=model.infer(frame,threshold) if model else []
        if frame.shape[1]>960:frame=cv2.resize(frame,(960,round(frame.shape[0]*960/frame.shape[1])))
        ok,jpeg=cv2.imencode('.jpg',frame,[cv2.IMWRITE_JPEG_QUALITY,75])
        now=time.monotonic();instant=1/max(.001,now-previous);previous=now;fps=instant if not fps else .9*fps+.1*instant
        if ok:emit({'type':'frame','backend':model.backend if model else '电脑原画预览','fps':round(fps,1),'capturedAt':at,'inferenceMs':round((now-started)*1000),'boxes':boxes[:100],'jpeg':base64.b64encode(jpeg).decode('ascii')})
        time.sleep(max(0,1/30-(time.monotonic()-started)))

if __name__=='__main__':
    try:main()
    except Exception as e:emit({'type':'error','message':'Detection stopped: '+type(e).__name__+' (check model/runtime)'});sys.exit(1)
