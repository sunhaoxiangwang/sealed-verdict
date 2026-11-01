import bpy, os, math
from mathutils import Vector
C=bpy.context; S=C.scene; O=bpy.data.objects
def ob(name, data): 
    o=O.get(name) or bpy.data.objects.new(name, data)
    if o.name not in C.collection.objects: C.collection.objects.link(o)
    return o
cam=ob('LineupCam2', bpy.data.cameras.new('LineupCam2')); cam.data.lens=35
cam.location=(44.5,-12.5,1.3); cam.rotation_euler=(Vector((44.5,0,0.95))-cam.location).to_track_quat('-Z','Y').to_euler(); S.camera=cam
def area(name, loc, energy, color, size):
    l=ob(name, bpy.data.lights.new(name,'AREA')); l.data.energy=energy; l.data.color=color; l.data.size=size; l.location=loc
    l.rotation_euler=(Vector((44.5,0,1.1))-Vector(loc)).to_track_quat('-Z','Y').to_euler()
area('LKey',(40.5,-5.5,4.2),2600,(1.0,0.8,0.62),4); area('LRim',(49,4.5,3.8),1800,(0.62,0.72,1.0),3); area('LFill',(49,-6,1.8),700,(1.0,0.9,0.85),5)
if 'LBack' not in O:
    bpy.ops.mesh.primitive_plane_add(size=1, location=(44.5,3.2,5)); b=C.active_object; b.name='LBack'; b.scale=(40,1,14); b.rotation_euler=(math.radians(90),0,0)
    m=bpy.data.materials.new('LBackM'); m.use_nodes=True; n=next(x for x in m.node_tree.nodes if x.type=='BSDF_PRINCIPLED'); n.inputs['Base Color'].default_value=(0.012,0.011,0.014,1); n.inputs['Roughness'].default_value=0.9; b.data.materials.append(m)
    bpy.ops.mesh.primitive_plane_add(size=1, location=(44.5,-3,0)); f=C.active_object; f.name='LFloor'; f.scale=(30,14,1); f.data.materials.append(m)
for name in ('LineupBackdrop','LineupFloor'):
    if name in O: O[name].hide_render=True
w=S.world or bpy.data.worlds.new('W'); S.world=w; w.use_nodes=True
bg=next((n for n in w.node_tree.nodes if n.type=='BACKGROUND'),None)
if bg: bg.inputs[0].default_value=(0.01,0.01,0.012,1); bg.inputs[1].default_value=0.3
try: S.render.engine='BLENDER_EEVEE'
except TypeError: S.render.engine='BLENDER_WORKBENCH'
S.render.resolution_x=2400; S.render.resolution_y=1000; S.render.resolution_percentage=100; S.render.film_transparent=False
out=os.path.expanduser('~/Desktop/sealed-verdict-shots/7-jurors-lineup.png'); S.render.filepath=out; S.render.image_settings.file_format='PNG'
bpy.ops.render.render(write_still=True); print('RENDERED', S.render.engine, os.path.getsize(out)//1024, 'KB', flush=True)
