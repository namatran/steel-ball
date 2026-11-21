# Fit the ball pose in the pasted 0:16 palm frame (frames/p016.png, 2000x1301, ball partly hidden by fingers).
import fit, json, numpy as np
from lib import *
from scipy.spatial.transform import Rotation as Rot
fit.circ['p016']=[1102,905,437]
a=np.asarray(Image.open('half/p016.png').convert('RGB')).astype(float)
m=(a[...,1]-a[...,2]>45)&(a[...,1]>a[...,0]*1.05); m[:110]=False; m[1230:]=False
m=ndi.binary_closing(ndi.binary_opening(m,iterations=2),iterations=6); m=ndi.binary_fill_holes(m)
lab,n=ndi.label(m); sz=ndi.sum(m,lab,range(1,n+1)); m=lab==(np.argmax(sz)+1); m=ndi.binary_erosion(m,iterations=6)
np.save('p016_mask.npy',m)
orig=fit.samples
def samples(i,step,zmin=0.25):
    V,(px,py)=orig(i,step,zmin); k=m[np.clip(py.astype(int),0,m.shape[0]-1),np.clip(px.astype(int),0,m.shape[1]-1)]
    return V[k],(px[k],py[k])
fit.samples=samples
(s,R),top=fit.fit('p016')
print('score %.3f'%s,np.round(R.as_quat(),4),np.round(top,3))
json.dump(dict(p016=dict(q=R.as_quat().tolist(),score=float(s))),open('poses_p016.json','w'))
