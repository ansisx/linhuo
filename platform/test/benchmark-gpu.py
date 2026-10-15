import sys,time,json,subprocess
import os
os.environ['DETECT_PROFILE']='1'
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from detector import Model,cv2,np
root=Path(__file__).resolve().parents[1]
frame=cv2.imread(sys.argv[1]);assert frame is not None
backend=sys.argv[2];device=int(sys.argv[3]) if len(sys.argv)>3 else None
model=Model(str(root/'models/yolo26n.onnx'),backend,device)
for _ in range(10):model.infer(frame.copy(),.35)
times=[]
for _ in range(60):
    start=time.perf_counter();f=frame.copy();boxes=model.infer(f,.35)
    f=cv2.resize(f,(960,round(f.shape[0]*960/f.shape[1])))
    cv2.imencode('.jpg',f,[cv2.IMWRITE_JPEG_QUALITY,75])
    times.append((time.perf_counter()-start)*1000)
assert 'bus' in {b['label'] for b in boxes}
print(json.dumps({'backend':model.backend,'providers':model.session.get_providers(),'frames':len(times),'meanMs':round(float(np.mean(times)),2),'p95Ms':round(float(np.percentile(times,95)),2),'processingFps':round(1000/float(np.mean(times)),1),'labels':sorted({b['label'] for b in boxes})}))
profile=json.loads(Path(model.session.end_profiling()).read_text())
print('Executed providers:',sorted({e.get('args',{}).get('provider','') for e in profile if e.get('args',{}).get('provider')}))
subprocess.run(['nvidia-smi','--query-gpu=name,memory.used,utilization.gpu','--format=csv'])
