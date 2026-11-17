# Renders the Entity's limbs used around the site (site/assets/ui/limb-*.webp).
#
#   blender -b --factory-startup --python tools/entity/render_limbs.py -- <out_dir> [variant ...]
#
# Each limb is a jointed, chitinous leg modelled procedurally (Skin modifier over
# a spine with swollen segments and thorns), given a black shell with glowing
# cracks, rim-lit from behind and rendered on a transparent background.
# tools/entity/finish_limbs.py then adds the glow and writes the WebP sprites.

import bpy, math, random, sys
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = argv[0] if argv else '//'
ONLY = set(argv[1:])

# name: (joints in the XZ plane, belly radius per segment, seed)
VARIANTS = {
    'a': ([(0.0, 0.0), (2.2, 1.9), (4.3, 2.5), (6.4, 0.4), (7.3, -1.5)], [0.62, 0.46, 0.34, 0.24], 3),
    'b': ([(0.0, 0.0), (1.8, 1.2), (3.9, 2.9), (5.6, 1.3), (6.9, -0.9)], [0.56, 0.44, 0.32, 0.22], 11),
    'c': ([(0.0, 0.0), (2.6, 1.0), (4.6, 2.0), (6.2, 0.2), (6.6, -1.9)], [0.66, 0.45, 0.33, 0.23], 29),
}


def build_limb(joints, belly, seed):
    rnd = random.Random(seed)
    verts, radii, edges = [], [], []

    def add(p, r):
        verts.append(Vector((p[0], 0.0, p[1])))
        radii.append(r)
        return len(verts) - 1

    prev = None
    nseg = len(joints) - 1
    for s in range(nseg):
        a, b = Vector(joints[s]), Vector(joints[s + 1])
        d = b - a
        n = Vector((-d.y, d.x)).normalized()
        bend = (0.10 + rnd.random() * 0.10) * (1 if s % 2 == 0 else -1)
        r_b = belly[s]
        r_joint = r_b * 0.5
        r_next = (belly[s + 1] if s + 1 < nseg else 0.012) * 0.5
        profile = [(0.0, r_joint), (0.08, r_b * 0.92), (0.24, r_b), (0.5, r_b * 0.72), (0.8, max(r_next * 1.3, r_b * 0.5)), (0.94, r_next * 1.1)]
        if s == nseg - 1:  # the last segment tapers to a needle point
            profile = [(0.0, r_joint), (0.12, r_b * 0.9), (0.4, r_b * 0.55), (0.7, r_b * 0.26), (0.9, r_b * 0.09), (1.0, 0.006)]
        for t, r in profile:
            if s > 0 and t == 0.0:
                continue
            p = a + d * t + n * math.sin(math.pi * t) * bend
            i = add(p, r)
            if prev is not None:
                edges.append((prev, i))
            prev = i
        if s < nseg - 1:
            # the joint itself: a pinched knuckle with thorns on the outside of the bend
            j = add(b, r_next)
            edges.append((prev, j))
            prev = j
            d2 = Vector(joints[s + 2]) - b
            out = (-(d.normalized()) + d2.normalized())
            out = -out.normalized() if out.length > 1e-4 else n
            for k in range(2 if s < 2 else 1):
                ang = (rnd.random() - 0.5) * 0.9
                dirv = Vector((out.x * math.cos(ang) - out.y * math.sin(ang), out.x * math.sin(ang) + out.y * math.cos(ang)))
                length = r_b * (1.2 + rnd.random() * 1.3)
                m = add(b + dirv * length * 0.4, r_next * 0.6)
                tip = add(b + dirv * length + n * 0.05, 0.006)
                edges.append((j, m))
                edges.append((m, tip))

    # barbs along the back of the longer segments
    for s in (1, 2):
        a, b = Vector(joints[s]), Vector(joints[s + 1])
        d = b - a
        n = Vector((-d.y, d.x)).normalized()
        base_idx = [i for i, v in enumerate(verts) if (Vector((v.x, v.z)) - a).length < d.length and abs((Vector((v.x, v.z)) - a).dot(n)) < 0.4 and 0.15 < (Vector((v.x, v.z)) - a).dot(d.normalized()) / d.length < 0.8]
        for i in base_idx[:3]:
            if rnd.random() < 0.6:
                p = Vector((verts[i].x, verts[i].z))
                dirv = (n * (1 if rnd.random() < 0.8 else -1) - d.normalized() * 0.5).normalized()
                length = belly[s] * (0.8 + rnd.random() * 0.9)
                tip = add(p + dirv * length, 0.005)
                edges.append((i, tip))

    mesh = bpy.data.meshes.new('limb')
    mesh.from_pydata(verts, edges, [])
    mesh.update()
    obj = bpy.data.objects.new('limb', mesh)
    bpy.context.collection.objects.link(obj)
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)

    skin = obj.modifiers.new('skin', 'SKIN')
    skin.use_smooth_shade = True
    sv = mesh.skin_vertices[0].data
    for i, r in enumerate(radii):
        sv[i].radius = (r, r * 0.6)  # flattened, like a blade
        sv[i].use_root = i == 0
    sub = obj.modifiers.new('sub', 'SUBSURF')
    sub.levels = 3
    sub.render_levels = 3

    # ridged chitin plates + fine roughness
    plates = bpy.data.textures.new('plates', 'VORONOI')
    plates.noise_scale = 0.8
    plates.distance_metric = 'DISTANCE'
    d1 = obj.modifiers.new('plates', 'DISPLACE')
    d1.texture = plates
    d1.strength = 0.16
    d1.mid_level = 0.45
    d1.texture_coords = 'LOCAL'
    grain = bpy.data.textures.new('grain', 'CLOUDS')
    grain.noise_scale = 0.16
    grain.noise_depth = 3
    d2 = obj.modifiers.new('grain', 'DISPLACE')
    d2.texture = grain
    d2.strength = 0.05
    d2.texture_coords = 'LOCAL'
    return obj


def make_material():
    mat = bpy.data.materials.new('chitin')
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    N = nt.nodes.new
    out = N('ShaderNodeOutputMaterial')
    bsdf = N('ShaderNodeBsdfPrincipled')
    coord = N('ShaderNodeTexCoord')

    bsdf.inputs['Base Color'].default_value = (0.035, 0.026, 0.028, 1)
    bsdf.inputs['Roughness'].default_value = 0.27
    bsdf.inputs['Metallic'].default_value = 0.35

    # glowing cracks: thin lines along Voronoi cell borders, only in patches
    vor = N('ShaderNodeTexVoronoi')
    vor.feature = 'DISTANCE_TO_EDGE'
    vor.inputs['Scale'].default_value = 1.9
    warp = N('ShaderNodeTexNoise')
    warp.inputs['Scale'].default_value = 2.2
    warp.inputs['Detail'].default_value = 4
    mixv = N('ShaderNodeMixRGB')
    mixv.blend_type = 'ADD'
    mixv.inputs['Fac'].default_value = 0.35
    nt.links.new(coord.outputs['Object'], warp.inputs['Vector'])
    nt.links.new(coord.outputs['Object'], mixv.inputs['Color1'])
    nt.links.new(warp.outputs['Color'], mixv.inputs['Color2'])
    nt.links.new(mixv.outputs['Color'], vor.inputs['Vector'])
    ramp = N('ShaderNodeValToRGB')
    ramp.color_ramp.elements[0].position = 0.0
    ramp.color_ramp.elements[0].color = (1, 1, 1, 1)
    ramp.color_ramp.elements[1].position = 0.03
    ramp.color_ramp.elements[1].color = (0, 0, 0, 1)
    nt.links.new(vor.outputs['Distance'], ramp.inputs['Fac'])

    patch = N('ShaderNodeTexNoise')
    patch.inputs['Scale'].default_value = 0.75
    patch.inputs['Detail'].default_value = 2
    pr = N('ShaderNodeValToRGB')
    pr.color_ramp.elements[0].position = 0.5
    pr.color_ramp.elements[1].position = 0.68
    nt.links.new(coord.outputs['Object'], patch.inputs['Vector'])
    nt.links.new(patch.outputs['Fac'], pr.inputs['Fac'])
    mask = N('ShaderNodeMath')
    mask.operation = 'MULTIPLY'
    nt.links.new(ramp.outputs['Color'], mask.inputs[0])
    nt.links.new(pr.outputs['Color'], mask.inputs[1])

    heat = N('ShaderNodeValToRGB')  # white-hot core fading to deep red at the edge of each crack
    heat.color_ramp.elements[0].position = 0.0
    heat.color_ramp.elements[0].color = (1.0, 0.07, 0.01, 1)
    heat.color_ramp.elements[1].position = 1.0
    heat.color_ramp.elements[1].color = (1.0, 0.36, 0.06, 1)
    nt.links.new(mask.outputs[0], heat.inputs['Fac'])
    strength = N('ShaderNodeMath')
    strength.operation = 'MULTIPLY'
    strength.inputs[1].default_value = 9.0
    nt.links.new(mask.outputs[0], strength.inputs[0])
    nt.links.new(heat.outputs['Color'], bsdf.inputs['Emission Color'])
    nt.links.new(strength.outputs[0], bsdf.inputs['Emission Strength'])

    # the shell is rougher where it is cracked
    bump = N('ShaderNodeBump')
    bump.inputs['Strength'].default_value = 0.85
    fine = N('ShaderNodeTexNoise')
    fine.inputs['Scale'].default_value = 26
    fine.inputs['Detail'].default_value = 6
    nt.links.new(coord.outputs['Object'], fine.inputs['Vector'])
    nt.links.new(fine.outputs['Fac'], bump.inputs['Height'])
    nt.links.new(bump.outputs['Normal'], bsdf.inputs['Normal'])
    nt.links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])
    return mat


def light(name, kind, loc, rot, color, power, size=4.0):
    data = bpy.data.lights.new(name, kind)
    data.color = color
    data.energy = power
    if kind == 'AREA':
        data.size = size
    ob = bpy.data.objects.new(name, data)
    ob.location = loc
    ob.rotation_euler = rot
    bpy.context.collection.objects.link(ob)
    return ob


def render(name, joints, belly, seed):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    obj = build_limb(joints, belly, seed)
    obj.data.materials.append(make_material())

    xs = [j[0] for j in joints]
    zs = [j[1] for j in joints]
    pad = 1.5
    minx, maxx, minz, maxz = min(xs) - 0.4, max(xs) + pad * 0.5, min(zs) - pad * 0.5, max(zs) + pad
    cx, cz = (minx + maxx) / 2, (minz + maxz) / 2
    width, height = maxx - minx, maxz - minz

    cam = bpy.data.cameras.new('cam')
    cam.type = 'ORTHO'
    cam.ortho_scale = width  # ortho scale spans the larger render dimension (the width)
    cam_ob = bpy.data.objects.new('cam', cam)
    cam_ob.location = (cx, -20, cz)
    cam_ob.rotation_euler = (math.radians(90), 0, 0)
    bpy.context.collection.objects.link(cam_ob)
    scene.camera = cam_ob

    # rim light from behind (blood red / ember), a hard top light for the shell's highlights, faint cold fill
    light('rim1', 'AREA', (cx - 2, 6.5, cz + 5), (math.radians(-55), 0, math.radians(20)), (1.0, 0.13, 0.07), 5200, 7)
    light('rim2', 'AREA', (cx + 4, 5.0, cz - 3), (math.radians(-125), 0, math.radians(-30)), (1.0, 0.30, 0.10), 2600, 6)
    light('top', 'AREA', (cx, -3.5, cz + 7), (math.radians(28), 0, 0), (0.78, 0.86, 1.0), 1500, 4)
    light('fill', 'AREA', (cx - 6, -8, cz - 1), (math.radians(82), 0, math.radians(-35)), (0.55, 0.70, 0.95), 420, 8)

    world = bpy.data.worlds.new('w')
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs[1].default_value = 0.0
    scene.world = world

    scene.render.engine = 'CYCLES'
    scene.cycles.samples = 160
    scene.cycles.use_denoising = True
    scene.cycles.use_adaptive_sampling = True
    scene.render.film_transparent = True
    scene.render.resolution_x = 1800
    scene.render.resolution_y = int(1800 * height / width)
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGBA'
    scene.render.image_settings.color_depth = '8'
    scene.view_settings.view_transform = 'Standard'
    scene.view_settings.look = 'None'
    scene.render.filepath = f'{OUT}/limb-{name}-raw.png'
    bpy.ops.render.render(write_still=True)
    print('rendered', scene.render.filepath, scene.render.resolution_x, scene.render.resolution_y)


for name, (joints, belly, seed) in VARIANTS.items():
    if ONLY and name not in ONLY:
        continue
    render(name, joints, belly, seed)
