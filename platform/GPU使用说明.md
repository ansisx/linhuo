# GPU 检测版

本版独立于桌面的旧版本；不会自动替换旧版或迁移 data。先在旧平台点击“停止接收”或关闭原服务，再运行本目录的“启动平台.cmd”，访问 http://127.0.0.1:8790。页面标题应出现“GPU通用识别”。

Python 保持 D:/anaconda/python.exe。模型路径必须指向本文件夹 models/yolo26n.onnx。填写当前遥控器视频桥地址和 APK 密码。依赖是 Windows x64 / Python 3.12 的 ONNX Runtime DirectML 1.23.0，随 runtime 打包，不修改全局 Python。其他电脑需另行安装兼容的 OpenCV、NumPy 等依赖。

自动通过 DXGI 枚举选择 NVIDIA 显卡，GPU 初始化失败会停止，不会悄悄改为 CPU。少量算子仍可能在 CPU 执行。解码、画框和 JPEG 编码也仍在 CPU。采用 DirectML，不是 CUDA/TensorRT。

## 本机样例基准（2026-10-13）

RTX 3050 Ti Laptop GPU 4GB，YOLO26n ONNX，640×640模型输入；bus.jpg，预热10次、连续60次，含预处理、识别、画框与960宽JPEG编码。不含RTSP接收解码、进程传输及浏览器显示。

| 后端 | 平均耗时 | 基准处理能力 |
|---|---:|---:|
| CPU（4线程） | 48.06 ms | 20.8 FPS |
| NVIDIA GPU DirectML | 16.61 ms | 60.2 FPS |

GPU 第95百分位耗时17.79 ms；Profiler确认DmlExecutionProvider执行，nvidia-smi观察到143 MiB显存和36%利用率（瞬时值）。不代表所有场景的稳定帧率。

实时检测输出最多30 FPS，网页取帧目标30 FPS，仍是JPEG预览，不含音频。状态中的FPS是检测输出速度，不是浏览器实际呈现速度。源视频帧率、Wi-Fi、RTSP解码、图像复杂度、浏览器、功耗和温度都会影响结果，尚未实测当前遥控器视频。不承诺60 FPS实时视频。

通用检测结果仍独立于火点记录，不生成火情坐标或飞行/投放指令。每10秒最多保存一条目标记录，最多100条。

原版 data 文件夹为原记录与配置。需要保留历史时，在两个服务都停止后，将原 data 复制到新版同名目录；不要覆盖正在运行的服务数据。
