# Collect per-frame fits, then make each pose physically consistent along the f-chain: the
# groove layout has 12 rotational symmetries, so a fit alone cannot say which panel is which.
# Pick the symmetric twin closest to the previous frame's pose (frames are 2/30 s apart).
from lib import *
import json,glob
from scipy.spatial.transform import Rotation as Rot
def group():
    Gs=[]
    for k in range(6):
        Gs.append(Rot.from_euler('y',k*60,degrees=True).as_matrix())
    for k in range(6):
        a=np.radians(k*30); ax=np.array([np.cos(a),0,np.sin(a)])
        Gs.append(2*np.outer(ax,ax)-np.eye(3))   # 180deg about a horizontal axis
    return Gs
GS=group()
if __name__=='__main__':
    fits={}
    for p in glob.glob('fit_*.log'):
        pass
    import re,ast
    for p in [q for q in glob.glob('poses_*.json') if q!='poses_new.json']:
        fits.update(json.load(open(p)))
    CHAINS=[['f%03d'%i for i in range(27,60,2)],['g008','g010','g012','g014','g018','g022'],['f012'],['f014']]
    out={}
    for ch in CHAINS:
        prev=None
        for k in ch:
            R=quat_to_mat(np.array(fits[k]['q']))
            if prev is not None:
                R=R@min(GS,key=lambda G:Rot.from_matrix(prev.T@(R@G)).magnitude())
                print(k,'step %.0f deg'%np.degrees(Rot.from_matrix(prev.T@R).magnitude()))
            out[k]=Rot.from_matrix(R).as_quat().tolist(); prev=R
    json.dump(out,open('poses_new.json','w'))
