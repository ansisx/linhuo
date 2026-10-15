import sys,json
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from detector import Model,cv2
root=Path(__file__).resolve().parents[1]
model=Model(str(root/'models/yolo26n.onnx'))
frame=cv2.imread(sys.argv[1])
assert frame is not None
boxes=model.infer(frame,.35)
labels={b['label'] for b in boxes}
assert 'person' in labels and 'bus' in labels,labels
assert 'fire' not in labels and 'smoke' not in labels
cv2.imwrite(str(root/'通用检测样例.jpg'),frame)
print(json.dumps({'passed':True,'classes':sorted(labels),'boxes':len(boxes),'backend':model.backend},ensure_ascii=False))
