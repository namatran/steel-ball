import numpy as np
from PIL import Image
from scipy import ndimage as ndi
A='half/%s.png'
APOT=np.radians(24); BULGE=np.radians(78); SLOTGAP=np.radians(9); GROOVE=0.05
SEG=np.pi/3
def groove(p):
    """angular distance field to nearest groove centre line. p: (...,3) unit"""
    x,y,z=p[...,0],p[...,1],p[...,2]
    theta=np.arccos(np.clip(y,-1,1)); lon=np.arctan2(z,x)
    k=np.floor(lon/SEG+0.5); dp=lon-k*SEG
    cc=APOT-BULGE
    toc=np.sin(theta)*np.sin(cc)*np.cos(dp)+np.abs(y)*np.cos(cc)
    plate=BULGE-np.arccos(np.clip(toc,-1,1))
    dl=np.mod(lon,SEG)-SEG*0.5
    ka=np.sin(cc)*np.cos(SEG*0.5); kb=np.cos(cc)
    ct=np.arctan2(ka,kb)+np.arccos(np.clip(np.cos(BULGE)/np.hypot(ka,kb),-1,1))
    half=np.pi/2-ct-SLOTGAP
    across=np.arcsin(np.clip(np.sin(theta)*np.sin(dl),-1,1))
    along=np.maximum(np.abs(theta-np.pi/2)-half,0)
    slot=np.hypot(across,along)
    return np.minimum(np.abs(plate),slot), plate, dp, k
def quat_to_mat(q):
    x,y,z,w=q/np.linalg.norm(q)
    return np.array([[1-2*(y*y+z*z),2*(x*y-z*w),2*(x*z+y*w)],
                     [2*(x*y+z*w),1-2*(x*x+z*z),2*(y*z-x*w)],
                     [2*(x*z-y*w),2*(y*z+x*w),1-2*(x*x+y*y)]])
def fitcircle(x,y):
    M=np.c_[2*x,2*y,np.ones_like(x)]; b=x*x+y*y
    s=np.linalg.lstsq(M,b,rcond=None)[0]; cx,cy=s[0],s[1]; return cx,cy,np.sqrt(s[2]+cx*cx+cy*cy)
def detect(i,seed=0):
    a=np.asarray(Image.open(A%i).convert('RGB')).astype(float)
    r,g,b=a[...,0],a[...,1],a[...,2]
    m=(g-b>35)&(g>r*1.05)&(g>60); m[:100]=False; m[1010:]=False
    m=ndi.binary_opening(m,iterations=2); m=ndi.binary_fill_holes(m)
    lab,n=ndi.label(m); sz=ndi.sum(m,lab,range(1,n+1)); mm=lab==(np.argmax(sz)+1)
    e=mm&~ndi.binary_erosion(mm,iterations=1); ys,xs=np.nonzero(e); xs=xs.astype(float); ys=ys.astype(float)
    rng=np.random.default_rng(seed); best=None
    for _ in range(4000):
        idx=rng.choice(len(xs),3,replace=False)
        try: cx,cy,rad=fitcircle(xs[idx],ys[idx])
        except Exception: continue
        if not (60<rad<340): continue
        inl=np.abs(np.hypot(xs-cx,ys-cy)-rad)<2.5
        if best is None or inl.sum()>best[0]: best=(inl.sum(),inl)
    inl=best[1]
    for _ in range(3):
        cx,cy,rad=fitcircle(xs[inl],ys[inl]); inl=np.abs(np.hypot(xs-cx,ys-cy)-rad)<3
    return cx,cy,rad,best[0]/len(xs)
