# Bake the ball's paint into an object-space cube map, one source frame per piece.
#
# The ball is 8 pieces: six pole-to-pole side panels and two hexagons. Each piece takes ALL its
# paint from the single frame that sees it most head-on (no blending inside a piece, so the
# view-dependent ink lines and black cel patches stay crisp). Piece borders are groove lines,
# so the dark ink hides the seams. The fixed-light shadow the show baked into the frames is
# divided out (shade.json) and stored at half scale; the shader multiplies it back in.
from lib import *
from track import GS
import json,sys,itertools
N=int(sys.argv[1]) if len(sys.argv)>1 else 768
circ=json.load(open('circles_new.json'))
P={k:quat_to_mat(np.array(v)) for k,v in json.load(open('poses_new.json')).items()}
SH=json.load(open('shade.json')); SL=np.array(SH['L'])
# soften the fitted curve: its extremes are poorly constrained
SG=0.45+0.55*np.array(SH['g']); SK=np.linspace(-1,1,len(SG))
FCH=['f%03d'%i for i in range(27,60,2)]
GCH=['g008','g010','g012','g014','g018','g022']
CHAINS=[FCH,GCH,['f012'],['f014']]

def piece(D):
    """0-5 side panels (pole to pole), 6 north hexagon, 7 south hexagon"""
    g,plate,dp,k=groove(D)
    pan=np.mod(k,6).astype(int)
    return np.where(plate>0,np.where(D[...,1]>0,6,7),pan)

# --- choose the symmetric twin of each chain (which physical piece lands in which slot) and
# the source frame of every piece by how head-on it is seen.
rng=np.random.default_rng(0)
pts=rng.normal(size=(40000,3)); pts/=np.linalg.norm(pts,axis=1,keepdims=True); lab=piece(pts)
def quality(k,G):
    z=(pts@(P[k]@G).T)[:,2]
    w=np.clip((z-0.25)/0.75,0,1)
    return np.array([w[lab==s].mean() for s in range(8)])
Q={}
for ch in CHAINS:
    for k in ch:
        for gi,G in enumerate(GS): Q[k,gi]=quality(k,G)
best=None
for tw in itertools.product(range(12),repeat=len(CHAINS)):
    sel=[]; tot=0
    for s in range(8):
        c=max((Q[k,tw[ci]][s],k,tw[ci]) for ci,ch in enumerate(CHAINS) for k in ch)
        sel.append(c); tot+=c[0]
    if best is None or tot>best[0]: best=(tot,sel,tw)
tot,sel,TW=best

print('coverage score %.2f/8'%tot)
for s,(q,k,gi) in enumerate(sel): print('piece',s,'<-',k,'twin',gi,'head-on %.2f'%q)
json.dump([[float(q),k,int(g)] for q,k,g in sel],open('bake_sel.json','w'))

imgs={}
def img(k):
    if k not in imgs: imgs[k]=np.asarray(Image.open(A%k).convert('RGB')).astype(np.float32)
    return imgs[k]
def face_dirs(f):
    g=(np.arange(N)+.5)/N*2-1; s,t=np.meshgrid(g,g); one=np.ones_like(s)
    d=[np.stack([one,-t,-s],-1),np.stack([-one,-t,s],-1),np.stack([s,one,t],-1),
       np.stack([s,-one,-t],-1),np.stack([s,-t,one],-1),np.stack([-s,-t,-one],-1)][f]
    return d/np.linalg.norm(d,axis=-1,keepdims=True)
atlas=np.zeros((N*2,N*3,3),np.uint8); stats=[]
for f in range(6):
    D=face_dirs(f).reshape(-1,3); L=piece(D)
    col=np.zeros((len(D),3),np.float32); ok=np.zeros(len(D),bool)
    for s,(q,k,gi) in enumerate(sel):
        m=L==s
        cx,cy,r=circ[k]; r*=0.985
        V=D[m]@(P[k]@GS[gi]).T; z=V[:,2]
        px=cx+V[:,0]*r; py=cy-V[:,1]*r
        c=np.stack([ndi.map_coordinates(img(k)[...,ch],[py,px],order=1,mode='nearest') for ch in range(3)],1)
        c/=2*np.maximum(np.interp(V@SL,SK,SG),0.12)[:,None]   # shadow out: albedo at half scale
        col[m]=c; ok[m]=z>0.30
    img_=col.reshape(N,N,3); okm=ok.reshape(N,N); Lm=L.reshape(N,N)
    for s in range(8):   # unseen texels: smooth diffusion of the piece's seen colours (no smeared streaks)
        ms=(Lm==s); sn=okm&ms
        if not ms.any() or (sn==ms).all() or not sn.any(): continue
        fill=ms&~okm; sg=N/10
        num=np.stack([ndi.gaussian_filter(img_[...,c]*sn,sg) for c in range(3)],-1); den=ndi.gaussian_filter(sn.astype(float),sg)
        mean=img_[sn].mean(0)
        wgt=np.clip(den[...,None]*20,0,1)
        est=np.where(den[...,None]>1e-6,num/np.maximum(den[...,None],1e-6),mean)*wgt+mean*(1-wgt)
        img_[fill]=est[fill]
    stats.append(okm.mean())
    r_,c_=divmod(f,3); atlas[r_*N:(r_+1)*N,c_*N:(c_+1)*N]=np.clip(img_,0,255).astype(np.uint8)
print('seen fraction per face',np.round(stats,2))
Image.fromarray(atlas).save('../../src/assets/ball-cube.png',optimize=True)
json.dump(dict(L=SL.tolist(),g=SG.tolist()),open('../../src/assets/shade.json','w'))

# Ball orientation (x y z w) that shows each baked frame's view: model->view = R G.
from scipy.spatial.transform import Rotation as Rot
poses={k:[round(float(x),4) for x in Rot.from_matrix(P[k]@GS[TW[[i for i,ch in enumerate(CHAINS) if k in ch][0]]]).as_quat()] for ch in CHAINS for k in ch}
json.dump(poses,open('../../src/assets/frame-poses.json','w'))
