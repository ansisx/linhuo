"""Choose the NVIDIA DXGI adapter explicitly on dual-GPU Windows laptops."""
import ctypes as c
import uuid
class Desc(c.Structure):
    _fields_=[('name',c.c_wchar*128),('vendor',c.c_uint),('device',c.c_uint),('subsystem',c.c_uint),('revision',c.c_uint),('vram',c.c_size_t),('system',c.c_size_t),('shared',c.c_size_t),('luid',c.c_byte*8),('flags',c.c_uint)]
def adapters():
    factory=c.c_void_p();guid=(c.c_byte*16).from_buffer_copy(uuid.UUID('770aae78-f26f-4dba-a829-253c83d1b387').bytes_le)
    create=c.WinDLL('dxgi').CreateDXGIFactory1
    create.argtypes=[c.c_void_p,c.POINTER(c.c_void_p)];create.restype=c.c_long
    if create(c.byref(guid),c.byref(factory))<0:raise RuntimeError('DXGI factory unavailable')
    def method(obj,index,restype,*args):
        table=c.cast(obj,c.POINTER(c.POINTER(c.c_void_p))).contents
        return c.WINFUNCTYPE(restype,c.c_void_p,*args)(table[index])
    found=[]
    try:
        for index in range(16):
            adapter=c.c_void_p()
            if method(factory,12,c.c_long,c.c_uint,c.POINTER(c.c_void_p))(factory,index,c.byref(adapter))<0:break
            try:
                desc=Desc()
                if method(adapter,10,c.c_long,c.POINTER(Desc))(adapter,c.byref(desc))>=0:found.append({'index':index,'name':desc.name,'vendor':desc.vendor})
            finally:method(adapter,2,c.c_ulong)(adapter)
    finally:method(factory,2,c.c_ulong)(factory)
    return found
def select_nvidia():
    for item in adapters():
        if item['vendor']==0x10de:return item
    raise RuntimeError('NVIDIA adapter not found; GPU mode will not silently use CPU')
if __name__=='__main__':print(adapters())
