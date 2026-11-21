# Trace the frames' paint into the hand-paintable ink atlas (src/assets/ink.png, layout in
# src/inkAtlas.js), one source frame per piece, shadow divided out, then flattened a little.
#
# Panels: the atlas cell is shared by a panel's north and south halves (mirrored at the equator),
# so each texel is sampled from whichever half the source frame sees better.
# Hexagons: flat projection around the pole, one cell each.
from lib import *
from track import GS
import json,sys,itertools,cv2
from scipy.spatial.transform import Rotation as Rot
ATLAS=(2048,1280); CELL=(512,640); PX,PY,PW,EDGEY,MAXY=16,16,480,528,580
HEXC=(256,256); HEXR=240; HPPU=458.4
APO=np.radians(24); BUL=np.radians(78)
circ=json.load(open('circles_new.json'))
P={k:quat_to_mat(np.array(v)) for k,v in json.load(open('poses_new.json')).items()}
SH=json.load(open('shade.json')); SL=np.array(SH['L'])
SG=0.45+0.55*np.array(SH['g']); SK=np.linspace(-1,1,len(SG))
FCH=['f%03d'%i for i in range(27,60,2)]; GCH=['g008','g010','g012','g014','g018','g022']
CHAINS=[FCH,GCH,['f012'],['f014']]

def edge_theta(dp):
    cc=APO-BUL; a=np.sin(cc)*np.cos(dp); b=np.cos(cc)
    return np.arctan2(a,b)+np.arccos(np.clip(np.cos(BUL)/np.hypot(a,b),-1,1))
def panel_dirs(k,H=CELL[1],W=CELL[0]):
    ys,xs=np.mgrid[0:H,0:W].astype(float)
    dp=((np.clip(xs,PX,PX+PW)-PX)/PW-0.5)*SEG
    v=(np.clip(ys,PY,MAXY)-PY)/EDGEY
    s=v*(np.pi/2-edge_theta(dp)); th=np.pi/2-s; lon=k*SEG+dp
    return np.stack([np.sin(th)*np.cos(lon),np.cos(th),np.sin(th)*np.sin(lon)],-1)
def hex_dirs(south):
    ys,xs=np.mgrid[0:CELL[1],0:CELL[0]].astype(float)
    qx=np.clip(xs-HEXC[0],-HEXR,HEXR)/HPPU; qy=np.clip(ys-HEXC[1],-HEXR,HEXR)/HPPU
    r2=np.minimum(qx*qx+qy*qy,0.98); y=np.sqrt(1-r2)
    # shader: q=(p.x,p.z)*k, south flips q.y; invert (k=1 at default size)
    return np.stack([qx,-y if south else y,-qy if south else qy],-1) if True else None

def piece(D):
    g,plate,dp,k=groove(D); pan=np.mod(k,6).astype(int)
    return np.where(plate>0,np.where(D[...,1]>0,6,7),pan)
rng=np.random.default_rng(0)
pts=rng.normal(size=(40000,3)); pts/=np.linalg.norm(pts,axis=1,keepdims=True); lab=piece(pts)
mir=pts*np.array([1,-1,1])
def quality(k,G):
    R=P[k]@G; z=np.maximum((pts@R.T)[:,2],(mir@R.T)[:,2]); z0=(pts@R.T)[:,2]
    w=np.clip(((z)-0.25)/0.75,0,1); w0=np.clip((z0-0.25)/0.75,0,1)
    return np.array([(w if s<6 else w0)[lab==s].mean() for s in range(8)])
Q={}
for ch in CHAINS:
    for k in ch:
        for gi,G in enumerate(GS): Q[k,gi]=quality(k,G)
best=None
for tw in itertools.product(range(12),repeat=len(CHAINS)):
    sel=[];tot=0
    for s in range(8):
        c=max((Q[k,tw[ci]][s],k,tw[ci]) for ci,ch in enumerate(CHAINS) for k in ch); sel.append(c); tot+=c[0]
    if best is None or tot>best[0]: best=(tot,sel,tw)
tot,sel,TW=best
print('coverage %.2f/8'%tot)
for s,(q,k,gi) in enumerate(sel): print('piece',s,'<-',k,'twin',gi,'head-on %.2f'%q)
json.dump([[float(q),k,int(g)] for q,k,g in sel],open('atlas_sel.json','w'))

imgs={}
def img(k):
    if k not in imgs: imgs[k]=np.asarray(Image.open('../../../frames/%s.jpg'%k).convert('RGB')).astype(np.float32)
    return imgs[k]
def sample(k,gi,D):
    """paint (albedo at half scale) and visibility for directions D (...,3); mirror-aware flag handled by caller"""
    cx,cy,r=[v*2 for v in circ[k]]; r*=0.985
    V=D@(P[k]@GS[gi]).T; z=V[...,2]
    px=cx+V[...,0]*r; py=cy-V[...,1]*r
    c=np.stack([ndi.map_coordinates(img(k)[...,ch],[py,px],order=1,mode='nearest') for ch in range(3)],-1)
    c/=2*np.maximum(np.interp(V@SL,SK,SG),0.12)[...,None]
    return c,z
atlas=np.zeros((ATLAS[1],ATLAS[0],3),np.float32)
for cell in range(8):
    q,k,gi=sel[cell]
    D=panel_dirs(cell) if cell<6 else hex_dirs(cell==7)
    c,z=sample(k,gi,D)
    if cell<6:
        c2,z2=sample(k,gi,D*np.array([1,-1,1]))
        use2=z2>z; c=np.where(use2[...,None],c2,c); z=np.maximum(z,z2)
    ok=z>0.30
    if cell>=6:
        ys,xs=np.mgrid[0:CELL[1],0:CELL[0]]; ok&=np.hypot(xs-HEXC[0],ys-HEXC[1])<HEXR
    sg=40; sn=ok
    num=np.stack([ndi.gaussian_filter(c[...,i]*sn,sg) for i in range(3)],-1); den=ndi.gaussian_filter(sn.astype(float),sg)
    mean=c[sn].mean(0) if sn.any() else np.array([120,160,40.])
    wgt=np.clip(den[...,None]*20,0,1)
    est=np.where(den[...,None]>1e-6,num/np.maximum(den[...,None],1e-6),mean)*wgt+mean*(1-wgt)
    c=np.where(ok[...,None],c,est)
    # feather the seen/unseen border a few pixels so the diffused fill doesn't leave a cliff
    a=ndi.gaussian_filter(ok.astype(float),3)[...,None]; c=c*a+est*(1-a)*(a<1)+c*(a>=1)*0
    c=np.where(ok[...,None],c,est)
    x0,y0=(cell%4)*CELL[0],(cell//4)*CELL[1]
    atlas[y0:y0+CELL[1],x0:x0+CELL[0]]=c
    print('cell',cell,'seen %.2f'%ok.mean())
out=np.clip(atlas,0,255).astype(np.uint8)
GROOVE_R=float(sys.argv[2]) if len(sys.argv)>2 else 1.9
FLAT=int(sys.argv[1]) if len(sys.argv)>1 else 0
if FLAT:   # flatten: edge-preserving smoothing keeps the ink and cel edges, evens out frame noise
    for _ in range(FLAT): out=cv2.bilateralFilter(out,7,28,5)
# clean grooves: the frames see grooves smeared and at odd angles, so the groove channels, lips and
# ink lines on the panels come from the procedural starter art (starter.png, = `npm run ink`), the
# traced paint stays everywhere else. Hexagon cells keep the traced grooves.
st=np.asarray(Image.open('starter.png').convert('RGB')).astype(np.float32)
SEGR=np.radians(60); GW=0.05*458.4
sEC=np.pi/2-edge_theta(SEGR/2); slotEnd=EDGEY*(1-np.radians(9)/sEC)
ys,xs=np.mgrid[0:CELL[1],0:CELL[0]].astype(float); lx=xs-PX; ly=ys-PY
dx=np.minimum(lx,PW-lx); dSlot=np.where(ly>slotEnd,np.hypot(dx,ly-slotEnd),dx); dEdge=np.abs(EDGEY-ly)
gd=np.minimum(dSlot,dEdge); gd=np.where((lx<0)|(lx>PW),-1,gd)
A=np.clip((GW*GROOVE_R-gd)/(GW*0.35),0,1)[...,None]
res=out.astype(np.float32)
for cell in range(6):
    x0,y0=(cell%4)*CELL[0],(cell//4)*CELL[1]
    res[y0:y0+CELL[1],x0:x0+CELL[0]]=res[y0:y0+CELL[1],x0:x0+CELL[0]]*(1-A)+st[y0:y0+CELL[1],x0:x0+CELL[0]]*A
out=np.clip(res,0,255).astype(np.uint8)
Image.fromarray(out).save('../../src/assets/ink.png',optimize=True)
json.dump(dict(L=SL.tolist(),g=SG.tolist()),open('../../src/assets/shade.json','w'))
poses={k:[round(float(x),4) for x in Rot.from_matrix(P[k]@GS[TW[[i for i,ch in enumerate(CHAINS) if k in ch][0]]]).as_quat()] for ch in CHAINS for k in ch}
json.dump(poses,open('../../src/assets/frame-poses.json','w'))
