import bpy, bmesh, math, time, sys, os, traceback
from mathutils import Vector, Matrix
C=bpy.context; M=bpy.data.materials; O=bpy.data.objects
T='/Users/danabay/sealed-verdict/apps/web/public/textures/'
OUT='/Users/danabay/sealed-verdict/apps/web/public/models'
SAVE='/Users/danabay/sealed-verdict/assets/blender/sealed-verdict-v2.blend'
T0=time.time()
def log(*a): print('[%6.1fs]'%(time.time()-T0), *a, flush=True)
def upd(): C.view_layer.update()
def apply_mods(o, names):
    for ob in C.selected_objects: ob.select_set(False)
    C.view_layer.objects.active=o; o.select_set(True)
    for n in names: bpy.ops.object.modifier_apply(modifier=n)
    o.select_set(False)
def shade(o):
    for ob in C.selected_objects: ob.select_set(False)
    C.view_layer.objects.active=o; o.select_set(True); bpy.ops.object.shade_smooth(); o.select_set(False)
def bsdf(m): return next(n for n in m.node_tree.nodes if n.type=='BSDF_PRINCIPLED')
def solid(name,color,rough=0.6,metal=0.0,sheen=0.0):
    m=M.get(name) or M.new(name); m.use_nodes=True; b=bsdf(m)
    b.inputs['Base Color'].default_value=(*color,1); b.inputs['Roughness'].default_value=rough; b.inputs['Metallic'].default_value=metal
    b.inputs['Sheen Weight'].default_value=sheen; b.inputs['Sheen Roughness'].default_value=0.35
    return m
def fabric(name, folder, color, rough=0.85, sheen=0.5, nstr=0.8, scale=10.0):
    m=M.get(name)
    if m: M.remove(m)
    m=M.new(name); m.use_nodes=True; nt=m.node_tree; b=bsdf(m)
    b.inputs['Base Color'].default_value=(*color,1); b.inputs['Roughness'].default_value=rough
    b.inputs['Sheen Weight'].default_value=sheen; b.inputs['Sheen Roughness'].default_value=0.35
    tc=nt.nodes.new('ShaderNodeTexCoord'); mp=nt.nodes.new('ShaderNodeMapping'); mp.inputs['Scale'].default_value=(scale,scale,1.0)
    tx=nt.nodes.new('ShaderNodeTexImage'); tx.image=bpy.data.images.load(T+folder+'/normal.jpg', check_existing=True); tx.image.colorspace_settings.name='Non-Color'
    nm=nt.nodes.new('ShaderNodeNormalMap'); nm.inputs['Strength'].default_value=nstr
    nt.links.new(tc.outputs['UV'],mp.inputs['Vector']); nt.links.new(mp.outputs['Vector'],tx.inputs['Vector'])
    nt.links.new(tx.outputs['Color'],nm.inputs['Color']); nt.links.new(nm.outputs['Normal'],b.inputs['Normal'])
    return m
TWEED=fabric('F_Tweed','tweed',(0.42,0.32,0.19),0.88,0.4,0.9,9)
COATW=fabric('F_CoatWool','wool',(0.40,0.30,0.17),0.86,0.45,0.8,9)
ROBE=fabric('F_RobeBlack','wool',(0.025,0.022,0.03),0.8,0.6,0.7,10)
GOWNR=fabric('F_GownCrimson','wool',(0.32,0.03,0.045),0.72,0.7,0.7,10)
SUIT=fabric('F_Suit','wool',(0.03,0.03,0.035),0.8,0.4,0.7,10)
SHIRT=fabric('F_Shirt','satin',(0.86,0.85,0.82),0.6,0.2,0.5,12)
BLOUSE=fabric('F_Blouse','satin',(0.88,0.82,0.72),0.55,0.25,0.5,12)
KNIT=fabric('F_Knit','knit',(0.10,0.13,0.24),0.92,0.7,1.0,7)
TROU=fabric('F_Trouser','wool',(0.07,0.065,0.07),0.85,0.4,0.7,10)
SKIRTW=fabric('F_Skirt','tweed',(0.12,0.11,0.12),0.85,0.4,0.8,10)
TIE=fabric('F_Tie','satin',(0.32,0.04,0.05),0.45,0.3,0.5,14)
TIGHTS=solid('M_Tights',(0.035,0.03,0.035),0.45,0.0,0.3)
LEATHER=solid('M_Shoe',(0.035,0.025,0.022),0.32)
WHITE=solid('M_Bands',(0.93,0.92,0.9),0.6)
BRASS=M.get('Brass') or solid('Brass',(0.85,0.64,0.28),0.32,1.0)
BUTTON=solid('M_Button',(0.09,0.06,0.04),0.35)
DARKB=solid('M_Belt',(0.05,0.035,0.025),0.45)
LIPS=solid('M_Lips',(0.42,0.2,0.18),0.45)
HAIR={'grey':solid('M_HairGrey',(0.42,0.40,0.38),0.55,0,0.4),'black':solid('M_HairBlack',(0.02,0.018,0.016),0.3,0,0.4),'auburn':solid('M_HairAuburn',(0.24,0.08,0.035),0.42,0,0.5),'brow_dark':solid('M_BrowDark',(0.03,0.025,0.02),0.6),'brow_auburn':solid('M_BrowAuburn',(0.17,0.06,0.03),0.6),'brow_grey':solid('M_BrowGrey',(0.3,0.29,0.28),0.6)}
SPEC={'J2_skeptic':dict(src='GEO-body_male_realistic',neck=1.46,wrist=0.79),
      'J2_expert':dict(src='GEO-body_female_realistic',neck=1.42,wrist=0.75),
      'J2_advocate':dict(src='GEO-body_male_realistic',neck=1.46,wrist=0.79),
      'J2_statistician':dict(src='GEO-body_female_realistic',neck=1.42,wrist=0.75)}
GARMENT={'Upper','Skirt','Legs','Shoes','Neck','Lapel','Belt','Buckle','Cuff','Jabot','Trim','Collar','Robe','SleeveU','SleeveL','Elbow','CollarRing','Coat','CoatLower','Shirt','Tie','Trousers','Tights','Blouse','Cardigan','GownUpper','GownLower','RobeUpper','RobeLower','Bands','PocketSquare','PencilSkirt','Jacket','Button','Scalp','BrowStrip','Lips','Epaulette','Hair','Brow','Moustache'}
def is_hand(co,sp): return abs(co.x)>0.33 and co.z<sp['wrist']+0.02
def is_arm(co): return abs(co.x)>0.215 and 0.5<co.z<1.42
def body_of(root): return next(c for c in root.children if c.name.startswith('Body'))
def clear(root):
    names=[c.name for c in root.children_recursive if c.name.split('.')[0] in GARMENT]
    for n in names:
        if n in O: O.remove(O[n], do_unlink=True)
def region_copy(root, body, name, keep):
    g=body.copy(); g.data=body.data.copy(); C.collection.objects.link(g); g.name=name
    for mod in list(g.modifiers): g.modifiers.remove(mod)
    bm=bmesh.new(); bm.from_mesh(g.data); bm.verts.ensure_lookup_table()
    lay=bm.verts.layers.int.new('orig')
    for v in bm.verts: v[lay]=v.index
    keepv=[keep(v.index) for v in bm.verts]
    kill=[f for f in bm.faces if not all(keepv[v.index] for v in f.verts)]
    bmesh.ops.delete(bm, geom=kill, context='FACES')
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
    bm.to_mesh(g.data); bm.free(); g.data.materials.clear()
    return g
def fit(g, body, smooth_iter, lift, offset):
    sm=g.modifiers.new('Sm','SMOOTH'); sm.factor=1.0; sm.iterations=smooth_iter
    dp=g.modifiers.new('Lift','DISPLACE'); dp.strength=lift; dp.mid_level=0.0; dp.direction='NORMAL'
    sw=g.modifiers.new('Fit','SHRINKWRAP'); sw.target=body; sw.wrap_method='NEAREST_SURFACEPOINT'; sw.wrap_mode='OUTSIDE'; sw.offset=offset
    apply_mods(g,['Sm','Lift','Fit'])
def push(g, src, fn):
    me=g.data; orig=[a.value for a in me.attributes['orig'].data]; S=src.data.vertices
    nrm=[v.normal.copy() for v in me.vertices]
    for i,v in enumerate(me.vertices):
        a=fn(S[orig[i]].co)
        if a: v.co=v.co+nrm[i]*a
    me.update()
def extrude_loop(g, src, pick, out=0.0, up=0.0, fwd=0.0):
    bm=bmesh.new(); bm.from_mesh(g.data); lay=bm.verts.layers.int.get('orig'); S=src.data.vertices
    edges=[e for e in bm.edges if e.is_boundary and all(pick(S[v[lay]].co) for v in e.verts)]
    n=len(edges)
    if n:
        res=bmesh.ops.extrude_edge_only(bm, edges=edges)
        nv=[x for x in res['geom'] if isinstance(x,bmesh.types.BMVert)]
        cen=sum((v.co for v in nv),Vector())/len(nv)
        for v in nv:
            d=v.co-cen; d.z=0
            if d.length>1e-6: d.normalize()
            v.co+= d*out + Vector((0,-fwd,up))
    bm.to_mesh(g.data); bm.free(); return n
def thicken(g, mat_, t=0.008, subd=0, root=None):
    g.data.materials.clear(); g.data.materials.append(mat_)
    so=g.modifiers.new('Th','SOLIDIFY'); so.thickness=t; so.offset=1.0; so.use_rim=True
    names=['Th']
    if subd: sb=g.modifiers.new('Sd','SUBSURF'); sb.levels=subd; names.append('Sd')
    apply_mods(g,names); shade(g)
def loft(root, body, src, name, z_top, z_bot, mat_, rings=28, seg=72, offset=0.02, flare=0.0, folds=0.0, nfold=11, hem_wave=0.012, seed=0.0, thick=0.008, gap=0, top_offset=None, ramp=0.2):
    Mw=body.matrix_world; S=src.data.vertices; P=body.data.vertices
    pts=[Mw@P[i].co for i in range(len(P)) if not is_arm(S[i].co)]
    X=root.matrix_world.translation.x
    angs=[2*math.pi*j/seg for j in range(seg)]
    zs=[z_top+(z_bot-z_top)*k/(rings-1) for k in range(rings)]
    profs=[]
    for z in zs:
        zz=max(z,0.16); w=0.025
        band=[p for p in pts if abs(p.z-zz)<w]
        while len(band)<12 and w<0.3: w*=2; band=[p for p in pts if abs(p.z-zz)<w]
        if len(band)>400: band=band[::max(1,len(band)//400)]
        cx=sum(p.x for p in band)/len(band); cy=sum(p.y for p in band)/len(band)
        h=[max((p.x-cx)*math.cos(a)+(p.y-cy)*math.sin(a) for p in band) for a in angs]
        profs.append([cx,cy,h])
    for _ in range(3):
        new=[]
        for k in range(len(profs)):
            a=profs[max(0,k-1)]; b=profs[k]; c=profs[min(len(profs)-1,k+1)]
            new.append([(a[0]+2*b[0]+c[0])/4,(a[1]+2*b[1]+c[1])/4,[(a[2][j]+2*b[2][j]+c[2][j])/4 for j in range(seg)]])
        profs=new
    for pr in profs:
        h=pr[2]
        for _ in range(3): h=[(h[j-1]+2*h[j]+h[(j+1)%seg])/4 for j in range(seg)]
        pr[2]=h
    bm=bmesh.new(); uvl=bm.loops.layers.uv.new('UVMap'); RV=[]
    for k,(z,(cx,cy,h)) in enumerate(zip(zs,profs)):
        t=k/(rings-1); ring=[]
        for j,a in enumerate(angs):
            fold=folds*(t**1.5)*(0.65*math.sin(nfold*a+seed+1.3*t)+0.35*math.sin(2*nfold*a+2.1+seed))
            if top_offset is None: off=offset
            else:
                u=min(1.0,t/ramp); off=top_offset+(offset-top_offset)*(u*u*(3-2*u))
            r=h[j]+off+flare*(t**1.4)+fold
            zz=z+hem_wave*math.sin(5*a+seed)*(t**6)
            ring.append(bm.verts.new((cx+r*math.cos(a)-X, cy+r*math.sin(a), zz)))
        RV.append(ring)
    front=int(seg*0.75)  # angle 270deg = -y = front
    span=(z_top-z_bot)
    for k in range(rings-1):
        for j in range(seg):
            if gap and min((j-front)%seg,(front-j)%seg)<gap: continue
            q=[(k,j),(k+1,j),(k+1,j+1),(k,j+1)]
            f=bm.faces.new([RV[kk][jj%seg] for kk,jj in q])
            for li,(kk,jj) in zip(f.loops,q): li[uvl].uv=(jj/seg*6.0, kk/(rings-1)*span*6.0)
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
    me=bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    o=bpy.data.objects.new(name,me); C.collection.objects.link(o); o.location=(X,0,0); upd()
    o.parent=root; o.matrix_parent_inverse=root.matrix_world.inverted()
    o.data.materials.append(mat_)
    so=o.modifiers.new('Th','SOLIDIFY'); so.thickness=thick; so.offset=1.0
    sb=o.modifiers.new('Sd','SUBSURF'); sb.levels=1
    apply_mods(o,['Th','Sd']); shade(o)
    cx,cy,h=profs[0]
    return o,(cx,cy,h[front]+offset,max(h[0],h[seg//2])+offset)
def place(root,o):
    upd(); o.parent=root; o.matrix_parent_inverse=root.matrix_world.inverted()
def box(root, loc, size, mat_, name, rot=(0,0,0)):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot); o=C.active_object; o.name=name; o.scale=size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    bv=o.modifiers.new('B','BEVEL'); bv.width=min(size)*0.3; bv.segments=2; o.data.materials.append(mat_); apply_mods(o,['B']); shade(o); place(root,o); return o
def button(root, loc, r, mat_):
    bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=0.006, vertices=16, location=loc, rotation=(math.radians(90),0,0)); o=C.active_object; o.name='Button'
    o.data.materials.append(mat_); shade(o); place(root,o); return o
def ellipse_ring(root, c, rx, ry, z, r, mat_, name):
    bpy.ops.mesh.primitive_torus_add(major_radius=1.0, minor_radius=r, location=(c[0],c[1],z), major_segments=64, minor_segments=10); o=C.active_object; o.name=name
    o.scale=(rx,ry,1.0); bpy.ops.object.transform_apply(location=False, rotation=False, scale=True); o.data.materials.append(mat_); shade(o); place(root,o); return o
def surf_front(obj, x, z, tol=0.02):
    Mw=obj.matrix_world; best=None
    for v in obj.data.vertices:
        p=Mw@v.co
        if abs(p.x-x)<tol and abs(p.z-z)<tol and (best is None or p.y<best): best=p.y
    return best
def neck_pick(sp): return lambda co: co.z>sp['neck']-0.06
def wrist_pick(sp): return lambda co: abs(co.x)>0.3 and co.z<sp['wrist']+0.09
def vcut(co, z0, k): return co.y<-0.02 and co.z>z0 and abs(co.x)<(co.z-z0)*k
def legs_shell(root, body, src, name, zmax, mat_, lift, t):
    S=src.data.vertices
    g=region_copy(root, body, name, lambda i: 0.075<S[i].co.z<zmax and not is_arm(S[i].co))
    fit(g, body, 4, lift, lift*0.6); thicken(g, mat_, t); return g
def shoes_shell(root, body, src):
    S=src.data.vertices
    g=region_copy(root, body, 'Shoes', lambda i: S[i].co.z<0.085)
    fit(g, body, 3, 0.007, 0.005); thicken(g, LEATHER, 0.004); return g
def head_frame(src):
    S=src.data.vertices
    nose=min((v.co.copy() for v in S if v.co.z>1.4), key=lambda c:c.y)
    top=max(v.co.z for v in S)
    return nose, top
def gauss_move(body, src, center, r, delta):
    me=body.data; S=src.data.vertices
    for i,v in enumerate(me.vertices):
        d=(S[i].co-center).length
        if d<r: v.co=v.co+delta*(1-(d/r)**2)**2
    me.update()
def scalp(root, body, src, mat_, thick, front_drop=0.0, nape=None):
    S=src.data.vertices; nose,top=head_frame(src)
    eye_z=nose.z+0.04; hair_front=eye_z+0.078-front_drop; nape_z=nape if nape is not None else nose.z-0.05
    def keep(i):
        co=S[i].co
        if co.z<nape_z-0.02: return False
        t=min(1.0,max(0.0,(co.y-(nose.y+0.06))/0.12))
        line=hair_front*(1-t)+nape_z*t
        if abs(co.x)>0.062 and co.z<eye_z+0.025 and co.y<nose.y+0.13: return False
        return co.z>line
    g=region_copy(root, body, 'Scalp', keep)
    tex=bpy.data.textures.get('hairtex') or bpy.data.textures.new('hairtex','CLOUDS'); tex.noise_scale=0.012
    sw=g.modifiers.new('Fit','SHRINKWRAP'); sw.target=body; sw.wrap_method='NEAREST_SURFACEPOINT'; sw.wrap_mode='OUTSIDE_SURFACE'; sw.offset=0.003
    so=g.modifiers.new('Th','SOLIDIFY'); so.thickness=thick; so.offset=1.0
    sb=g.modifiers.new('Sd','SUBSURF'); sb.levels=1
    dp=g.modifiers.new('Tx','DISPLACE'); dp.texture=tex; dp.strength=0.004; dp.direction='NORMAL'
    sm=g.modifiers.new('Sm','SMOOTH'); sm.factor=0.5; sm.iterations=3
    g.data.materials.clear(); g.data.materials.append(mat_)
    apply_mods(g,['Fit','Th','Sd','Tx','Sm']); shade(g); return g
def brows(root, body, src, mat_):
    S=src.data.vertices; nose,top=head_frame(src); eye_z=nose.z+0.04; brow_z=eye_z+0.028
    def keep(i):
        co=S[i].co
        return co.y<nose.y+0.05 and abs(co.z-brow_z)<0.0075 and 0.012<abs(co.x)<0.058
    g=region_copy(root, body, 'BrowStrip', keep)
    sw=g.modifiers.new('Fit','SHRINKWRAP'); sw.target=body; sw.wrap_method='NEAREST_SURFACEPOINT'; sw.wrap_mode='OUTSIDE_SURFACE'; sw.offset=0.0015
    so=g.modifiers.new('Th','SOLIDIFY'); so.thickness=0.0035; so.offset=1.0
    g.data.materials.clear(); g.data.materials.append(mat_)
    apply_mods(g,['Fit','Th']); shade(g); return g
def lips(root, body, src):
    S=src.data.vertices; nose,top=head_frame(src); mz=nose.z-0.038
    def keep(i):
        co=S[i].co
        return co.y<nose.y+0.03 and abs(co.x)<0.024*(1-((co.z-mz)/0.012)**2 if abs(co.z-mz)<0.012 else 0)
    g=region_copy(root, body, 'Lips', keep)
    sw=g.modifiers.new('Fit','SHRINKWRAP'); sw.target=body; sw.wrap_method='NEAREST_SURFACEPOINT'; sw.wrap_mode='OUTSIDE_SURFACE'; sw.offset=0.0006
    g.data.materials.clear(); g.data.materials.append(LIPS)
    apply_mods(g,['Fit']); shade(g); return g
def skin(body, color):
    m=body.data.materials[0] if body.data.materials else None
    if not m: return
    b=bsdf(m); b.inputs['Base Color'].default_value=(*color,1); b.inputs['Roughness'].default_value=0.5
    if 'IOR' in b.inputs: b.inputs['IOR'].default_value=1.4
    b.inputs['Sheen Weight'].default_value=0.15; b.inputs['Sheen Roughness'].default_value=0.4
done=[]
def build(name, fn):
    try:
        log('BEGIN', name); fn(); done.append(name); log('END', name)
    except Exception:
        log('FAILED', name); traceback.print_exc(); sys.stdout.flush()
# ===================== 1 INSPECTOR =====================
def inspector():
    root=O['J2_skeptic']; body=body_of(root); sp=SPEC[root.name]; src=O[sp['src']]; S=src.data.vertices; X=root.location.x; clear(root)
    nose,top=head_frame(src); eye_z=nose.z+0.04
    gauss_move(body, src, Vector((0.034,nose.y+0.03,eye_z+0.028)), 0.03, Vector((0,0,0.004)))
    skin(body,(0.66,0.46,0.34))
    sh=region_copy(root, body, 'Shirt', lambda i: 1.02<S[i].co.z<sp['neck'] and not is_arm(S[i].co)); fit(sh, body, 5, 0.004, 0.004); extrude_loop(sh, src, neck_pick(sp), out=0.004, up=0.03); thicken(sh, SHIRT, 0.004); log(' shirt')
    cu=region_copy(root, body, 'Coat', lambda i: (0.9<S[i].co.z<sp['neck']-0.01 or (is_arm(S[i].co) and S[i].co.z>0.6)) and not is_hand(S[i].co,sp) and not vcut(S[i].co,1.10,0.5))
    fit(cu, body, 10, 0.016, 0.014); log(' coat fit')
    a=extrude_loop(cu, src, lambda co: co.y<-0.02 and co.z>1.09 and abs(co.x)<0.2 and co.z<sp['neck']-0.05, out=0.05, fwd=0.012)
    b=extrude_loop(cu, src, lambda co: co.z>sp['neck']-0.08 and not (co.y<-0.05 and abs(co.x)<0.1), out=0.03, up=0.05)
    c=extrude_loop(cu, src, wrist_pick(sp), out=0.014); log(' coat extrude lapel/collar/cuff edges', a, b, c)
    thicken(cu, TWEED, 0.01); log(' coat thick')
    cl,ring=loft(root, body, src, 'CoatLower', 1.03, 0.44, COATW, offset=0.042, flare=0.10, folds=0.014, nfold=9, seed=0.7); log(' coat lower')
    ellipse_ring(root,(ring[0],ring[1]),ring[3]+0.008,ring[2]+0.008,1.0,0.018,DARKB,'Belt')
    box(root,(ring[0],ring[1]-ring[2]-0.02,1.0),(0.065,0.014,0.05),BRASS,'Buckle')
    for z,src_obj in ((1.13,cu),(1.07,cu),(0.92,cl),(0.84,cl)):
        for sx in (-1,1):
            y=surf_front(src_obj, X+sx*0.065, z)
            if y is not None: button(root,(X+sx*0.065,y-0.004,z),0.011,BUTTON)
    yf=surf_front(sh, X, 1.30) or -0.15
    box(root,(X,yf-0.006,1.22),(0.045,0.01,0.25),TIE,'Tie')
    for sx in (-1,1):
        ys=surf_front(cu, X+sx*0.17, 1.42, 0.03)
        if ys is not None: box(root,(X+sx*0.17,ys+0.07,1.445),(0.06,0.13,0.012),TWEED,'Epaulette')
    legs_shell(root, body, src, 'Trousers', 0.98, TROU, 0.012, 0.005); shoes_shell(root, body, src)
    scalp(root, body, src, HAIR['grey'], 0.009); brows(root, body, src, HAIR['brow_grey']); lips(root, body, src)
    mz=nose.z-0.022; box(root,(X,nose.y-0.006,mz),(0.06,0.012,0.01),HAIR['grey'],'Moustache')
# ===================== 2 JUDGE =====================
def judge():
    root=O['J2_expert']; body=body_of(root); sp=SPEC[root.name]; src=O[sp['src']]; S=src.data.vertices; X=root.location.x; clear(root)
    skin(body,(0.40,0.25,0.18))
    ru=region_copy(root, body, 'RobeUpper', lambda i: (1.0<S[i].co.z<sp['neck'] or (is_arm(S[i].co) and S[i].co.z>0.6)) and not is_hand(S[i].co,sp))
    fit(ru, body, 12, 0.022, 0.018); log(' robe fit')
    push(ru, src, lambda co: min(0.035,0.008+max(0.0,1.05-co.z)*0.1) if (is_arm(co) and co.z<1.1) else 0.0)
    extrude_loop(ru, src, neck_pick(sp), out=0.012, up=0.03); extrude_loop(ru, src, wrist_pick(sp), out=0.02)
    thicken(ru, ROBE, 0.012); log(' robe upper')
    loft(root, body, src, 'RobeLower', 1.37, 0.07, ROBE, rings=32, offset=0.04, flare=0.22, folds=0.03, nfold=13, seed=1.9, top_offset=0.012, ramp=0.12); log(' robe lower')
    yf=surf_front(ru, X, 1.36*body.scale.z, 0.03) or -0.16
    box(root,(X,yf-0.012,1.37*body.scale.z),(0.12,0.016,0.05),WHITE,'Bands')
    for sx in (-1,1): box(root,(X+sx*0.022,yf-0.016,1.27*body.scale.z),(0.038,0.012,0.15),WHITE,'Bands',rot=(math.radians(-8),0,0))
    shoes_shell(root, body, src); brows(root, body, src, HAIR['brow_dark']); lips(root, body, src)
# ===================== 3 ADVOCATE =====================
def advocate():
    root=O['J2_advocate']; body=body_of(root); sp=SPEC[root.name]; src=O[sp['src']]; S=src.data.vertices; X=root.location.x; clear(root)
    nose,top=head_frame(src); eye_z=nose.z+0.04
    for sx in (-1,1): gauss_move(body, src, Vector((sx*0.016,nose.y+0.03,eye_z+0.024)), 0.018, Vector((0,0,-0.004)))
    gauss_move(body, src, Vector((0.022,nose.y+0.03,nose.z-0.04)), 0.014, Vector((0,0,0.003)))
    skin(body,(0.86,0.70,0.60))
    sh=region_copy(root, body, 'Shirt', lambda i: 1.0<S[i].co.z<sp['neck'] and not is_arm(S[i].co)); fit(sh, body, 5, 0.004, 0.004); extrude_loop(sh, src, neck_pick(sp), out=0.004, up=0.035); thicken(sh, SHIRT, 0.004); log(' shirt')
    jk=region_copy(root, body, 'Jacket', lambda i: 0.86<S[i].co.z<sp['neck']-0.02 and not is_arm(S[i].co) and not vcut(S[i].co,1.04,0.34))
    fit(jk, body, 8, 0.012, 0.01); extrude_loop(jk, src, lambda co: co.y<-0.02 and co.z>1.03 and abs(co.x)<0.18 and co.z<sp['neck']-0.05, out=0.035, fwd=0.008); thicken(jk, SUIT, 0.008); log(' jacket')
    gu=region_copy(root, body, 'GownUpper', lambda i: (0.95<S[i].co.z<sp['neck']-0.01 or (is_arm(S[i].co) and S[i].co.z>0.6)) and not is_hand(S[i].co,sp) and not (S[i].co.y<0 and abs(S[i].co.x)<0.10))
    fit(gu, body, 10, 0.024, 0.02)
    push(gu, src, lambda co: min(0.04,0.008+max(0.0,1.08-co.z)*0.1) if (is_arm(co) and co.z<1.12) else 0.0)
    extrude_loop(gu, src, lambda co: co.y<-0.02 and abs(co.x)<0.13 and 0.96<co.z<sp['neck']-0.04, out=0.03, fwd=0.006)
    extrude_loop(gu, src, lambda co: co.z>sp['neck']-0.08 and co.y>-0.06, out=0.035, up=0.06)
    extrude_loop(gu, src, wrist_pick(sp), out=0.02)
    thicken(gu, GOWNR, 0.01); log(' gown upper')
    loft(root, body, src, 'GownLower', 1.12, 0.06, GOWNR, offset=0.034, flare=0.12, folds=0.02, nfold=10, seed=3.1, gap=7, top_offset=0.018); log(' gown lower')
    yf=surf_front(sh, X, 1.38, 0.03) or -0.16
    for sx in (-1,1): box(root,(X+sx*0.016,yf-0.006,1.37),(0.028,0.008,0.10),WHITE,'Bands',rot=(math.radians(-6),0,0))
    legs_shell(root, body, src, 'Trousers', 0.9, SUIT, 0.012, 0.005); shoes_shell(root, body, src)
    scalp(root, body, src, HAIR['black'], 0.007); brows(root, body, src, HAIR['brow_dark']); lips(root, body, src)
# ===================== 4 ANALYST =====================
def analyst():
    root=O['J2_statistician']; body=body_of(root); sp=SPEC[root.name]; src=O[sp['src']]; S=src.data.vertices; X=root.location.x; clear(root)
    nose,top=head_frame(src); eye_z=nose.z+0.04
    for sx in (-1,1): gauss_move(body, src, Vector((sx*0.034,nose.y+0.03,eye_z+0.028)), 0.03, Vector((0,0,0.003)))
    skin(body,(0.90,0.72,0.62))
    bl=region_copy(root, body, 'Blouse', lambda i: 1.0<S[i].co.z<sp['neck'] and not is_arm(S[i].co)); fit(bl, body, 5, 0.004, 0.004); extrude_loop(bl, src, neck_pick(sp), out=0.01, up=0.022); thicken(bl, BLOUSE, 0.004); log(' blouse')
    cg=region_copy(root, body, 'Cardigan', lambda i: (0.93<S[i].co.z<sp['neck']-0.03 or (is_arm(S[i].co) and S[i].co.z>0.6)) and not is_hand(S[i].co,sp) and not vcut(S[i].co,1.02,0.45))
    fit(cg, body, 8, 0.012, 0.011); extrude_loop(cg, src, wrist_pick(sp), out=0.01); extrude_loop(cg, src, lambda co: co.y<-0.02 and co.z>1.01 and abs(co.x)<0.2, out=0.012, fwd=0.006)
    thicken(cg, KNIT, 0.008); log(' cardigan')
    for z in (0.99,0.95):
        y=surf_front(cg, X, z, 0.025)
        if y is not None: button(root,(X,y-0.004,z),0.008,BRASS)
    loft(root, body, src, 'PencilSkirt', 1.0, 0.52, SKIRTW, offset=0.016, flare=-0.015, folds=0.0, hem_wave=0.0); log(' skirt')
    legs_shell(root, body, src, 'Tights', 0.95, TIGHTS, 0.003, 0.002); shoes_shell(root, body, src)
    scalp(root, body, src, HAIR['auburn'], 0.018, front_drop=0.006); brows(root, body, src, HAIR['brow_auburn']); lips(root, body, src)
log('start; objects', len(O))
for n,fn in (('inspector',inspector),('judge',judge),('advocate',advocate),('analyst',analyst)): build(n,fn)
upd(); bpy.ops.wm.save_as_mainfile(filepath=SAVE); log('saved', SAVE)
for name in ['J2_skeptic','J2_expert','J2_advocate','J2_statistician']:
    try:
        root=O[name]; X=root.location.x; root.location=(0,0,0); upd()
        for ob in C.selected_objects: ob.select_set(False)
        for c in root.children_recursive: c.select_set(True)
        root.select_set(True); C.view_layer.objects.active=root
        f=os.path.join(OUT,'juror_'+name[3:]+'.glb')
        bpy.ops.export_scene.gltf(filepath=f, export_format='GLB', use_selection=True, export_apply=True, export_yup=True, export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=6, export_image_format='JPEG')
        root.location=(X,0,0); upd(); log('exported', os.path.basename(f), os.path.getsize(f)//1024, 'KB')
    except Exception:
        log('EXPORT FAILED', name); traceback.print_exc()
log('DONE built=', done)
