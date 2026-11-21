from lib import *
import json,sys
N=int(sys.argv[1]) if len(sys.argv)>1 else 768
circ={int(k):v for k,v in json.load(open('circles.json')).items()}
P={int(k):v for k,v in json.load(open('poses.json')).items()}
SH=json.load(open('shade.json')); SL=np.array(SH['L']); SG=np.array(SH['g'])  # fixed-light shading baked into the stills
SK=np.linspace(-1,1,len(SG))
USE=[1,2,3,5,6,7,8,9]  # 4 duplicates 3
from unpause import unpause
imgs={i:np.asarray(Image.open(A%i).convert('RGB')).astype(np.float32) for i in USE}
for i in (5,6): imgs[i]=unpause(imgs[i])[0].astype(np.float32)   # the player's pause button
# OpenGL cube face conventions: (sc, tc, ma) as functions of direction
def face_dirs(f):
    g=(np.arange(N)+.5)/N*2-1; s,t=np.meshgrid(g,g)   # s: across, t: down rows
    one=np.ones_like(s)
    if f==0: d=np.stack([one,-t,-s],-1)    # +X: sc=-z, tc=-y
    if f==1: d=np.stack([-one,-t,s],-1)    # -X: sc=+z, tc=-y
    if f==2: d=np.stack([s,one,t],-1)      # +Y: sc=x, tc=+z
    if f==3: d=np.stack([s,-one,-t],-1)    # -Y: sc=x, tc=-z
    if f==4: d=np.stack([s,-t,one],-1)     # +Z: sc=x, tc=-y
    if f==5: d=np.stack([-s,-t,-one],-1)   # -Z: sc=-x, tc=-y
    return d/np.linalg.norm(d,axis=-1,keepdims=True)
atlas=np.zeros((N*2,N*3,3),np.uint8); cover=[]
for f in range(6):
    D=face_dirs(f).reshape(-1,3)
    acc=np.zeros((len(D),3)); wsum=np.zeros(len(D)); acc2=np.zeros((len(D),3)); wsum2=np.zeros(len(D)); best=np.zeros(len(D)); 
    for i in USE:
        cx,cy,r=circ[i]; R=quat_to_mat(np.array(P[i]['q']))
        V=D@R.T; z=V[:,2]
        px=cx+V[:,0]*r; py=cy-V[:,1]*r
        w=np.clip(z.astype(np.float64)-0.12,0,None)**28
        dd=np.hypot(px-1000,py-672); icon=(dd<56)&(i==6);  # still 6's button smears the ink under it: ignore that spot
        wi=np.where(icon,w,0.0); w=np.where(icon,0.0,w)
        m=(w>0)|(wi>0)
        c=np.zeros((len(D),3),np.float32)
        for ch in range(3): c[m,ch]=ndi.map_coordinates(imgs[i][...,ch],[py[m],px[m]],order=1)
        c/=2*np.interp(V@SL,SK,SG)[:,None]   # take the shading out: albedo only, stored at half scale
        acc+=c*w[:,None]; wsum+=w; acc2+=c*wi[:,None]; wsum2+=wi; best=np.maximum(best,np.where(icon,0,z))
    ok=wsum>1e-290
    col=np.zeros_like(acc); col[ok]=acc[ok]/wsum[ok,None]
    ok2=(~ok)&(wsum2>1e-290); col[ok2]=acc2[ok2]/wsum2[ok2,None]; ok=ok|ok2
    cover.append((ok.mean(),best.min()))
    img=col.reshape(N,N,3); okm=ok.reshape(N,N)
    if (~okm).any():
        idx=ndi.distance_transform_edt(~okm,return_distances=False,return_indices=True)
        img=img[idx[0],idx[1]]
    r_,c_=divmod(f,3); atlas[r_*N:(r_+1)*N,c_*N:(c_+1)*N]=np.clip(img,0,255).astype(np.uint8)
print('coverage per face (frac, min best z):',[(round(a,3),round(b,2)) for a,b in cover])
Image.fromarray(atlas).save('../../src/assets/ball-cube.png',optimize=True)
