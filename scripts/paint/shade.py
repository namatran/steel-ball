# Estimate the shading baked into the stills: a multiplier g(dot(n, L)) of the view-space
# normal against one fixed light. Overlapping stills see the same paint under different
# normals, so the log-luminance difference between two views is G(n_i) - G(n_j).
from lib import *
from scipy.optimize import nnls
import json
circ=json.load(open('circles_new.json'))
P={k:dict(q=v) for k,v in json.load(open('poses_new.json')).items()}
USE=['f%03d'%i for i in range(35,60,2)]  # consecutive frames: consistent poses
K=9; knots=np.linspace(-1,1,K)
rng=np.random.default_rng(3)
p=rng.normal(size=(500000,3)); p/=np.linalg.norm(p,axis=1,keepdims=True)
lum={}; V={}; ok={}
for i in USE:
    im=np.asarray(Image.open(A%i).convert('RGB')).astype(float)
    L=ndi.gaussian_filter(im@[0.3,0.59,0.11],3)
    cx,cy,r=circ[i]; v=p@quat_to_mat(np.array(P[i]['q'])).T
    px=cx+v[:,0]*r; py=cy-v[:,1]*r
    m=(v[:,2]>0.35)
    m&=groove(p)[0]>0.08   # paint only: no ink lines (hard edges, not shadow)
    l=np.zeros(len(p)); l[m]=ndi.map_coordinates(L,[py[m],px[m]],order=1)
    m&=l>25
    lum[i]=np.log(np.maximum(l,1)); V[i]=v; ok[i]=m
pairs=[(i,j) for a,i in enumerate(USE) for j in USE[a+1:]]
rows=[]
for i,j in pairs:
    idx=np.nonzero(ok[i]&ok[j])[0]
    if len(idx)>20000: idx=rng.choice(idx,20000,replace=False)
    if len(idx): rows.append((i,j,idx))
print('pairs with overlap:',[(i,j,len(x)) for i,j,x in rows])
def basis(t):
    t=np.clip(t,-1,1); f=(t+1)/2*(K-1); k0=np.minimum(f.astype(int),K-2); w=f-k0
    B=np.zeros((len(t),K)); B[np.arange(len(t)),k0]=1-w; B[np.arange(len(t)),k0+1]=w; return B
D=np.zeros((K-2,K))
for k in range(K-2): D[k,k:k+3]=[1,-2,1]
def solve(Ld):
    Bs=[];ys=[]
    for i,j,idx in rows:
        Bs.append(basis(V[i][idx]@Ld)-basis(V[j][idx]@Ld)); ys.append(lum[i][idx]-lum[j][idx])
    X=np.vstack(Bs); y=np.concatenate(ys); w=np.ones(len(y))
    for _ in range(4):
        C=np.tril(np.ones((K,K)))[:,1:]   # G = C d, G[0]=0, d>=0
        A_=np.vstack([(X@C)*w[:,None]**.5, 30*(D@C)*np.sqrt(len(y)/1e5)]); b=np.concatenate([y*w**.5,np.zeros(K-2)])
        d=nnls(A_,b)[0]; G=C@d
        res=y-X@G; s=1.4826*np.median(np.abs(res))+1e-6; w=1/np.maximum(1,np.abs(res)/(1.5*s))
    loss=np.sum(np.minimum(res**2,(3*s)**2))/len(y)
    return loss,G
# coarse search over light directions
dirs=[]
for th in np.radians(np.arange(0,120,20)):
    for ph in np.radians(np.arange(0,360,30)):
        dirs.append([np.sin(th)*np.cos(ph),np.sin(th)*np.sin(ph),np.cos(th)])
best=min(((solve(np.array(d))[0],d) for d in dirs),key=lambda t:t[0])
print('coarse',best)
d0=np.array(best[1]); step=0.25
for it in range(5):
    cand=[d0]+[ (d0+step*e)/np.linalg.norm(d0+step*e) for e in np.vstack([np.eye(3),-np.eye(3)]) ]
    sc=[(solve(c)[0],c) for c in cand]; b=min(sc,key=lambda t:t[0]); d0=b[1]; step*=0.6
loss,G=solve(d0)
g=np.exp(G-G.max()); g=np.maximum(g,0.0); 
print('L',d0.round(3),'loss',loss,'g',g.round(3),'t0 loss',solve(np.array([0,0,1.]))[0])
json.dump(dict(L=d0.tolist(),g=g.tolist()),open('shade.json','w'))
