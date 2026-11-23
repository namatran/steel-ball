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
# cells 0-5 north panels, 6/7 hexagons, 8-13 south panels (no mirroring)
ATLAS=(2048,2560); NC=14; CELL=(512,640); PX,PY,PW,EDGEY,MAXY=16,16,480,528,580
HEXC=(256,256); HEXR=240; HPPU=458.4
APO=np.radians(24); BUL=np.radians(78)
circ=json.load(open('circles_new.json'))
P={k:quat_to_mat(np.array(v)) for k,v in json.load(open('poses_new.json')).items()}
P['p016']=quat_to_mat(np.array(json.load(open('poses_p016.json'))['p016']['q']))
SH=json.load(open('shade.json')); SL=np.array(SH['L'])
SG=0.45+0.55*np.array(SH['g']); SK=np.linspace(-1,1,len(SG))
FCH=['f%03d'%i for i in range(27,60,2)]; GCH=['g008','g010','g012','g014','g018','g022']
CHAINS=[FCH,GCH,['f012'],['f014'],['p016']]
# p016: pasted palm frame from 0:16 (frames/p016.png, 2000x1301): large, crisp, NO shadow. Fitted by fit_p016.py.
circ['p016']=[1102/2,905/2,437/2]   # stored half-scale like the others (doubled below)
PM=np.load('p016_mask.npy'); PM=ndi.binary_dilation(PM,iterations=2)  # green-ball mask (no fingers/hat/lips)
POSES_EXTRA=json.load(open('poses_p016.json'))

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
    return np.where(plate>0,np.where(D[...,1]>0,6,7),pan+np.where(D[...,1]<0,8,0))
rng=np.random.default_rng(0)
pts=rng.normal(size=(40000,3)); pts/=np.linalg.norm(pts,axis=1,keepdims=True); lab=piece(pts)
mir=pts*np.array([1,-1,1])
def vis(k,V):
    """1 where the frame sees direction-view V (n,3) at all (front side, inside the green-ball mask for p016)"""
    if k!='p016': return np.ones(len(V))
    cx,cy,r=[v*2 for v in circ[k]]; px=np.clip((cx+V[:,0]*r).astype(int),0,PM.shape[1]-1); py=np.clip((cy-V[:,1]*r).astype(int),0,PM.shape[0]-1)
    return PM[py,px].astype(float)
BIAS={'p016':1.4}   # sharper, shadow-free source
def quality(k,G):
    R=P[k]@G; V=pts@R.T; Vm=mir@R.T
    z=np.maximum(V[:,2]*vis(k,V)+(1-vis(k,V))*-1,Vm[:,2]*vis(k,Vm)+(1-vis(k,Vm))*-1); z0=V[:,2]*vis(k,V)+(1-vis(k,V))*-1
    w=np.clip(((z)-0.25)/0.75,0,1); w0=np.clip((z0-0.25)/0.75,0,1)
    return BIAS.get(k,1)*np.array([w0[lab==s].mean() for s in range(NC)])
Q={}
for ch in CHAINS:
    for k in ch:
        for gi,G in enumerate(GS): Q[k,gi]=quality(k,G)
CB=[[[max((Q[k,gi][sp],k) for k in ch) for sp in range(NC)] for gi in range(12)] for ch in CHAINS]
best=None
for tw in itertools.product(range(12),repeat=len(CHAINS)):
    sel=[];tot=0
    for sp in range(NC):
        c=max((CB[ci][tw[ci]][sp][0],CB[ci][tw[ci]][sp][1],tw[ci]) for ci in range(len(CHAINS))); sel.append(c); tot+=c[0]
    if best is None or tot>best[0]: best=(tot,sel,tw)
tot,sel,TW=best
print('coverage %.2f/%d'%(tot,NC))
for s,(q,k,gi) in enumerate(sel): print('piece',s,'<-',k,'twin',gi,'head-on %.2f'%q)
json.dump([[float(q),k,int(g)] for q,k,g in sel],open('atlas_sel.json','w'))

imgs={}
def img(k):
    if k not in imgs: imgs[k]=np.asarray(Image.open('../../../frames/%s.%s'%(k,'png' if k=='p016' else 'jpg')).convert('RGB')).astype(np.float32)
    return imgs[k]
def sample(k,gi,D):
    """paint (albedo at half scale) and visibility for directions D (...,3); mirror-aware flag handled by caller"""
    cx,cy,r=[v*2 for v in circ[k]]; r*=0.985 if k!='p016' else 0.995
    V=D@(P[k]@GS[gi]).T; z=V[...,2]
    px=cx+V[...,0]*r; py=cy-V[...,1]*r
    c=np.stack([ndi.map_coordinates(img(k)[...,ch],[py,px],order=1,mode='nearest') for ch in range(3)],-1)
    if k=='p016':   # no shadow in this frame: paint is the frame at half scale; hide hand/background pixels
        c/=2; z=np.where(PM[np.clip(py.astype(int),0,PM.shape[0]-1),np.clip(px.astype(int),0,PM.shape[1]-1)],z,-1)
    else: c/=2*np.maximum(np.interp(V@SL,SK,SG),0.12)[...,None]
    return c,z
atlas=np.zeros((ATLAS[1],ATLAS[0],3),np.float32)
PANEL_CELLS=[c for c in range(NC) if c<6 or c>=8]
for cell in range(NC):
    q,k,gi=sel[cell]
    if cell<6: D=panel_dirs(cell)
    elif cell<8: D=hex_dirs(cell==7)
    else: D=panel_dirs(cell-8)*np.array([1,-1,1])   # south half of panel cell-8, painted on its own
    c,z=sample(k,gi,D)
    ok=z>0.30
    if cell in (6,7):
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
# hand/AI-polished cells: polish/out/cellN.png (512x640, shadow-free full-brightness art) replaces the traced cell.
# The atlas holds paint at half scale (the shader doubles it), so store it halved.
import os
POL=set()
for cell in range(NC):
    p='../../polish/out/cell%d.png'%cell
    if os.path.exists(p):
        x0,y0=(cell%4)*CELL[0],(cell//4)*CELL[1]
        out[y0:y0+CELL[1],x0:x0+CELL[0]]=(np.asarray(Image.open(p).convert('RGB').resize((CELL[0],CELL[1]))).astype(np.float32)*0.5).astype(np.uint8); POL.add(cell)
# cel flatten (panels only): mean-shift smooths frame noise, k-means snaps to a few flat colours,
# a median pass rounds the shape edges. argv[3] = colours per panel (0 = off).
CEL=int(sys.argv[3]) if len(sys.argv)>3 else 7
if CEL:
    for cell in PANEL_CELLS:
        if sel[cell][1]=='p016' or cell in POL: continue   # already crisp cel art with no shadow: leave as is
        x0,y0=(cell%4)*CELL[0],(cell//4)*CELL[1]
        t=out[y0:y0+CELL[1],x0:x0+CELL[0]].copy()
        t=cv2.pyrMeanShiftFiltering(t,6,18)
        lab=cv2.cvtColor(t,cv2.COLOR_RGB2LAB).astype(np.float32); reg=lab[PY:PY+MAXY-PY,PX:PX+PW].reshape(-1,3)
        _,_,cen=cv2.kmeans(reg,CEL,None,(cv2.TERM_CRITERIA_EPS|cv2.TERM_CRITERIA_MAX_ITER,30,0.5),3,cv2.KMEANS_PP_CENTERS)
        d=((lab.reshape(-1,1,3)-cen[None])**2).sum(-1); q=cen[d.argmin(1)].reshape(lab.shape)
        q=cv2.cvtColor(np.clip(q,0,255).astype(np.uint8),cv2.COLOR_LAB2RGB)
        q=cv2.medianBlur(q,9)
        out[y0:y0+CELL[1],x0:x0+CELL[0]]=q
# even out panel brightness: each source frame was lit differently (and each cell was divided by its own
# shadow estimate), but without shadow the ball is plain cel shading, so every piece should sit at the same
# overall level. Match each cell's lit-green level (70th percentile of luminance) to the common median.
def lit_level(cell):
    x0,y0=(cell%4)*CELL[0],(cell//4)*CELL[1]; t=out[y0:y0+CELL[1],x0:x0+CELL[0]].astype(np.float32)
    L=t@np.array([0.3,0.59,0.11],np.float32)
    if cell<6 or cell>=8: m=np.zeros(L.shape,bool); m[PY:PY+EDGEY-30,PX+40:PX+PW-40]=True
    else:
        yy,xx=np.mgrid[0:CELL[1],0:CELL[0]]; m=np.hypot(xx-HEXC[0],yy-HEXC[1])<HEXR*0.75
    return np.percentile(L[m],70)
LV=[lit_level(c) for c in range(NC)]; TARGET=float(np.median([LV[c] for c in POL] or LV));   # polished art is already consistent: match the rest to it, print('lit levels',np.round(LV,1),'target %.1f'%TARGET)
for cell in range(NC):
    g=1.0 if cell in POL else np.clip(TARGET/LV[cell],0.6,2.2); x0,y0=(cell%4)*CELL[0],(cell//4)*CELL[1]
    out[y0:y0+CELL[1],x0:x0+CELL[0]]=np.clip(out[y0:y0+CELL[1],x0:x0+CELL[0]].astype(np.float32)*g,0,255).astype(np.uint8)
# equator seam: a panel's north cell k and south cell 8+k meet along their top edge (y=PY). They are painted
# apart now, so blend them toward each other over SEAM px so the paint is continuous across the equator.
SEAM=int(os.environ.get('SEAM','72'))
w=np.clip(1-(np.arange(CELL[1])-PY)/SEAM,0,1)[:,None,None]; w=w*w*(3-2*w)*0.5   # 0.5 at the equator = the average
for k in range(6):
    xn,yn=(k%4)*CELL[0],(k//4)*CELL[1]; xs_,ys_=((k+8)%4)*CELL[0],((k+8)//4)*CELL[1]
    N=out[yn:yn+CELL[1],xn:xn+CELL[0]].astype(np.float32); S=out[ys_:ys_+CELL[1],xs_:xs_+CELL[0]].astype(np.float32)
    out[yn:yn+CELL[1],xn:xn+CELL[0]]=np.clip(N*(1-w)+S*w,0,255).astype(np.uint8)
    out[ys_:ys_+CELL[1],xs_:xs_+CELL[0]]=np.clip(S*(1-w)+N*w,0,255).astype(np.uint8)
# clean grooves: the frames see grooves smeared and at odd angles, so the groove channels, lips and
# ink lines on the panels come from the procedural starter art (starter.png, = `npm run ink`), the
# traced paint stays everywhere else. Hexagon cells keep the traced grooves.
st=np.asarray(Image.open('starter.png').convert('RGB')).astype(np.float32)*0.5   # half scale like the paint
SEGR=np.radians(60); GW=0.05*458.4
sEC=np.pi/2-edge_theta(SEGR/2); slotEnd=EDGEY*(1-np.radians(9)/sEC)
ys,xs=np.mgrid[0:CELL[1],0:CELL[0]].astype(float); lx=xs-PX; ly=ys-PY
dx=np.minimum(lx,PW-lx); dSlot=np.where(ly>slotEnd,np.hypot(dx,ly-slotEnd),dx); dEdge=np.abs(EDGEY-ly)
gd=np.minimum(dSlot,dEdge); gd=np.where((lx<0)|(lx>PW),-1,gd)
A=np.clip((GW*GROOVE_R-gd)/(GW*0.35),0,1)[...,None]
res=out.astype(np.float32)
for cell in PANEL_CELLS:
    x0,y0=(cell%4)*CELL[0],(cell//4)*CELL[1]
    sy0=((cell-8 if cell>=8 else cell)//4)*CELL[1]; sx0=((cell-8 if cell>=8 else cell)%4)*CELL[0]
    res[y0:y0+CELL[1],x0:x0+CELL[0]]=res[y0:y0+CELL[1],x0:x0+CELL[0]]*(1-A)+st[sy0:sy0+CELL[1],sx0:sx0+CELL[0]]*A
out=np.clip(res,0,255).astype(np.uint8)
# rows above the equator line (y<PY) are never sampled on purpose; copy the equator row up so texture
# filtering at the seam only ever blends equal colours.
for cell in PANEL_CELLS:
    x0,y0=(cell%4)*CELL[0],(cell//4)*CELL[1]
    out[y0:y0+PY,x0:x0+CELL[0]]=out[y0+PY:y0+PY+1,x0:x0+CELL[0]]
Image.fromarray(out).save('../../src/assets/ink.png',optimize=True)
json.dump(dict(L=SL.tolist(),g=SG.tolist()),open('../../src/assets/shade.json','w'))
poses={k:[round(float(x),4) for x in Rot.from_matrix(P[k]@GS[TW[[i for i,ch in enumerate(CHAINS) if k in ch][0]]]).as_quat()] for ch in CHAINS for k in ch}
json.dump(poses,open('../../src/assets/frame-poses.json','w'))
