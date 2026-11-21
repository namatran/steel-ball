# Remove the video player's pause button (translucent dark disc + two light bars, fixed on
# screen at the video's centre) from a still, so it doesn't end up in the baked paint.
import numpy as np, cv2
CX,CY,R=1001.0,672.0,47.0
def unpause(a):
    a=a.astype(np.uint8).copy(); H,W=a.shape[:2]
    Y,X=np.mgrid[:H,:W]
    bars=np.zeros((H,W),np.uint8)
    bars[642:703,974:999]=255; bars[642:703,1002:1026]=255   # the two bars
    a=cv2.inpaint(a,bars,4,cv2.INPAINT_TELEA)
    # the disc darkens everything under it: estimate that gain from just inside vs outside its rim
    ratios=[]
    for t in np.linspace(0,2*np.pi,180,endpoint=False):
        def at(r):
            x=int(round(CX+r*np.cos(t))); y=int(round(CY+r*np.sin(t))); return a[y,x].astype(float).mean()
        i=np.mean([at(R-5),at(R-7)]); o=np.mean([at(R+4),at(R+6)])
        if i>30 and o>30: ratios.append(o/i)
    gain=float(np.median(ratios))
    d=np.hypot(X-CX,Y-CY)
    wgt=np.clip((R+2-d)/3,0,1)[...,None]   # 1 inside, soft edge
    out=a.astype(float)*(1+(gain-1)*wgt)
    return np.clip(out,0,255), gain
