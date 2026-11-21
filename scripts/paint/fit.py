from lib import *
import json,sys
from scipy.spatial.transform import Rotation as Rot
circ=json.load(open('circles_new.json'))
def inkmap(i):
    a=np.asarray(Image.open(A%i).convert('L')).astype(float)/255
    ink=np.clip(ndi.gaussian_filter(a,7)-a,0,None)   # dark thin lines
    return ink
def samples(i,step,zmin=0.25):
    cx,cy,r=circ[i]; r*=0.985
    g=np.arange(-1,1.0001,step/r); X,Y=np.meshgrid(g,g)
    m=X*X+Y*Y<1-zmin**2
    x,y=X[m],-Y[m]; z=np.sqrt(1-x*x-y*y)
    return np.c_[x,y,z], (cx+X[m]*r, cy+Y[m]*r)
def scorefn(i,blur,step):
    ink=ndi.gaussian_filter(inkmap(i),blur); ink/=ink.max()
    V,(px,py)=samples(i,step)
    I=ndi.map_coordinates(ink,[py,px],order=1)
    I=I-I.mean()
    def f(R):   # R: model->view; p=R^T v
        P=V@R   # rows: (R^T v)
        g=groove(P)[0]
        w=np.exp(-((g-0.04)/0.02)**2)   # wall ring
        w=w-w.mean()
        return (w*I).sum()/np.sqrt((w*w).sum()*(I*I).sum()+1e-9)
    return f
def fit(i,n=30000):
    f=scorefn(i,6,10)
    Rs=Rot.random(n,random_state=1).as_matrix()
    sc=np.array([f(R) for R in Rs])
    top=np.argsort(-sc)[:25]
    best=[]
    f2=scorefn(i,3,4)
    for t in top:
        R0=Rot.from_matrix(Rs[t]); bs=f2(R0.as_matrix()); br=R0; s=0.06
        for it in range(250):
            d=Rot.from_rotvec(np.random.default_rng(it+t).normal(size=3)*s)
            c=d*br; v=f2(c.as_matrix())
            if v>bs: bs,br=v,c
            if it%60==59: s*=0.5
        best.append((bs,br))
    best.sort(key=lambda t:-t[0])
    return best[0],[b[0] for b in best[:5]]
if __name__=='__main__':
    out={}
    for i in sys.argv[1:]:
        (s,R),top=fit(i)
        q=R.as_quat()  # x y z w
        print(i,'score %.3f'%s,'quat',np.round(q,4),'top5',np.round(top,3),flush=True)
        out[i]=dict(q=q.tolist(),score=float(s))
    json.dump(out,open('poses_%s.json'%'_'.join(sys.argv[1:]),'w'))
