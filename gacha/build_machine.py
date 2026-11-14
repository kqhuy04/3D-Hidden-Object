"""Model the capsule machine in Blender and export it as GLB.

A rose cabinet with a pill-shaped chamber — glass on the front, left and right
faces, solid back — holding a small heap of capsules on a shelf. Below: a
recessed control panel with a round coin plate that has a real slot cut through
it, and a small mint push button.

The body under the shelf is solid. A hole in the shelf drops into a square
shaft, which meets a tunnel that runs forward out of an arch cut in the front
face — one hollow pipe from the pile to the exit. The hole is covered by a
hatch hinged on its rear edge, so the machine can hold the pile back until it
opens.

Flat shading, no gradients.

Run inside Blender:
    exec(open(r"<path>/gacha/build_machine.py").read())
"""

import math
import os

import bpy

HERE = r"C:\Users\HuongKT\Photo Hunt\gacha"
ASSETS = os.path.join(HERE, "assets")
GLB_OUT = os.path.join(ASSETS, "gacha-machine.glb")
RENDER_OUT = os.path.join(ASSETS, "machine-preview.png")


# --- colour helpers -------------------------------------------------------

def _srgb_to_linear(c):
    c = c / 255.0
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def rgba(hex_color, alpha=1.0):
    h = hex_color.lstrip("#")
    r, g, b = (int(h[i:i + 2], 16) for i in (0, 2, 4))
    return (_srgb_to_linear(r), _srgb_to_linear(g), _srgb_to_linear(b), alpha)


def material(name, hex_color, rough=0.85, metallic=0.0, alpha=1.0):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = rgba(hex_color)
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metallic
    if "Specular IOR Level" in bsdf.inputs:
        bsdf.inputs["Specular IOR Level"].default_value = 0.25
    if alpha < 1.0:
        bsdf.inputs["Alpha"].default_value = alpha
        for attr, value in (("blend_method", "BLEND"), ("surface_render_method", "BLENDED")):
            try:
                setattr(mat, attr, value)
            except (AttributeError, TypeError):
                pass
    mat.diffuse_color = rgba(hex_color)
    return mat


def activate(obj):
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    return obj


def parent_keep(child, parent):
    """Parent without moving the child — the game animates these as one unit."""
    bpy.context.view_layer.update()
    child.parent = parent
    child.matrix_parent_inverse = parent.matrix_world.inverted()
    return child


def boolean_cut(target, cutter, use_self=False):
    """Subtract `cutter` from `target` and destroy the cutter."""
    mod = target.modifiers.new("Cut", "BOOLEAN")
    mod.operation = "DIFFERENCE"
    mod.object = cutter
    mod.solver = "EXACT"
    mod.use_self = use_self
    activate(target)
    bpy.ops.object.modifier_apply(modifier=mod.name)
    bpy.data.objects.remove(cutter, do_unlink=True)
    return target


def join_objects(objects, name):
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.object.join()
    joined = bpy.context.object
    joined.name = name
    return joined


# --- primitive helpers ----------------------------------------------------

def rounded_box(name, size, loc, mat=None, bevel=0.05, segments=2, rot=(0.0, 0.0, 0.0)):
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=loc)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = size
    activate(obj)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel > 0.0:
        mod = obj.modifiers.new("Bevel", "BEVEL")
        mod.width = bevel
        mod.segments = segments
        mod.limit_method = "ANGLE"
        bpy.ops.object.modifier_apply(modifier=mod.name)
    if mat is not None:
        obj.data.materials.append(mat)
    obj.rotation_euler = rot
    activate(obj)
    bpy.ops.object.shade_flat()
    return obj


def cylinder(name, radius, depth, loc, mat=None, rot=(0.0, 0.0, 0.0), verts=24):
    bpy.ops.mesh.primitive_cylinder_add(radius=radius, depth=depth, vertices=verts, location=loc)
    obj = bpy.context.object
    obj.name = name
    if mat is not None:
        obj.data.materials.append(mat)
    obj.rotation_euler = rot
    activate(obj)
    bpy.ops.object.shade_flat()
    return obj


def torus(name, major, minor, loc, mat=None, rot=(0.0, 0.0, 0.0), major_seg=24, minor_seg=8):
    bpy.ops.mesh.primitive_torus_add(
        major_radius=major, minor_radius=minor,
        major_segments=major_seg, minor_segments=minor_seg, location=loc,
    )
    obj = bpy.context.object
    obj.name = name
    if mat is not None:
        obj.data.materials.append(mat)
    obj.rotation_euler = rot
    activate(obj)
    bpy.ops.object.shade_flat()
    return obj


def cone(name, radius, depth, loc, mat=None, rot=(0.0, 0.0, 0.0), verts=16, radius2=0.0):
    bpy.ops.mesh.primitive_cone_add(radius1=radius, radius2=radius2, depth=depth,
                                    vertices=verts, location=loc)
    obj = bpy.context.object
    obj.name = name
    if mat is not None:
        obj.data.materials.append(mat)
    obj.rotation_euler = rot
    activate(obj)
    bpy.ops.object.shade_flat()
    return obj


def capsule(name, radius, top_mat, bottom_mat, band_mat, loc, seg=14, rings=8):
    """Two-tone ball with an equatorial seam band — a gacha capsule."""
    bpy.ops.mesh.primitive_uv_sphere_add(
        radius=radius, segments=seg, ring_count=rings, location=loc,
    )
    ball = bpy.context.object
    ball.name = name
    ball.data.materials.append(top_mat)
    ball.data.materials.append(bottom_mat)
    for poly in ball.data.polygons:
        poly.material_index = 0 if poly.normal.z > -0.02 else 1
    activate(ball)
    bpy.ops.object.shade_flat()

    band = torus(name + "_band", radius * 0.995, radius * 0.085, loc, band_mat,
                 major_seg=seg, minor_seg=6)
    band.rotation_euler = (math.radians(90), 0.0, 0.0)
    parent_keep(band, ball)
    return ball, band


def spiral(name, r0, r1, turns, count, loc, mat, rot=(0.0, 0.0, 0.0), bevel=0.008):
    curve = bpy.data.curves.new(name, "CURVE")
    curve.dimensions = "3D"
    curve.bevel_depth = bevel
    curve.bevel_resolution = 2
    spline = curve.splines.new("POLY")
    spline.points.add(count - 1)
    for i in range(count):
        t = i / (count - 1)
        angle = t * turns * 2.0 * math.pi
        radius = r0 + (r1 - r0) * t
        spline.points[i].co = (radius * math.cos(angle), radius * math.sin(angle), 0.0, 1.0)
    obj = bpy.data.objects.new(name, curve)
    bpy.context.collection.objects.link(obj)
    obj.location = loc
    obj.rotation_euler = rot
    curve.materials.append(mat)
    activate(obj)
    bpy.ops.object.convert(target="MESH")
    obj = bpy.context.object
    activate(obj)
    bpy.ops.object.shade_flat()
    return obj


def catmull_rom(points, samples_per_span=12):
    """Smooth path through the given points."""
    pts = [points[0]] + list(points) + [points[-1]]
    out = []
    for i in range(len(pts) - 3):
        p0, p1, p2, p3 = pts[i], pts[i + 1], pts[i + 2], pts[i + 3]
        for step in range(samples_per_span):
            t = step / samples_per_span
            t2 = t * t
            t3 = t2 * t
            out.append(tuple(
                0.5 * ((2 * p1[k]) + (-p0[k] + p2[k]) * t
                       + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2
                       + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3)
                for k in range(3)
            ))
    out.append(tuple(points[-1]))
    return out


def tube(name, path, radius, mat=None, wall=0.0, caps=True):
    """A swept tube along a poly path. `wall` > 0 gives it a real inner wall."""
    curve = bpy.data.curves.new(name, "CURVE")
    curve.dimensions = "3D"
    curve.bevel_depth = radius
    curve.bevel_resolution = 3
    curve.fill_mode = "FULL"
    curve.use_fill_caps = caps
    spline = curve.splines.new("POLY")
    spline.points.add(len(path) - 1)
    for i, p in enumerate(path):
        spline.points[i].co = (p[0], p[1], p[2], 1.0)
    obj = bpy.data.objects.new(name, curve)
    bpy.context.collection.objects.link(obj)
    if mat is not None:
        curve.materials.append(mat)
    activate(obj)
    bpy.ops.object.convert(target="MESH")
    obj = bpy.context.object
    if wall > 0.0:
        mod = obj.modifiers.new("Wall", "SOLIDIFY")
        mod.thickness = wall
        mod.offset = -1.0
        mod.use_rim = True
        bpy.ops.object.modifier_apply(modifier=mod.name)
    activate(obj)
    bpy.ops.object.shade_flat()
    return obj


# --- scene reset ----------------------------------------------------------

for obj in list(bpy.data.objects):
    bpy.data.objects.remove(obj, do_unlink=True)
for block in (bpy.data.meshes, bpy.data.curves, bpy.data.materials, bpy.data.images):
    for item in list(block):
        if item.users == 0:
            block.remove(item)

scene = bpy.context.scene
scene.unit_settings.system = "METRIC"
scene.unit_settings.scale_length = 1.0

# --- palette --------------------------------------------------------------

BODY = material("Body", "#8E6260")
BODY_DARK = material("BodyDark", "#6A4748")
BODY_LIGHT = material("BodyLight", "#B08B88")
PANEL = material("Panel", "#5E3E40")
MAUVE = material("Mauve", "#C8A3A9")
SLOT_DARK = material("SlotDark", "#3B2526")
CORAL = material("Coral", "#E0745A")
CORAL_DARK = material("CoralDark", "#C0523C")
CREAM = material("Cream", "#EFE9D8")
MINT = material("Mint", "#86D6CB")
MINT_DARK = material("MintDark", "#5FB3A8")
CAP_RED = material("CapRed", "#E0806C")
CAP_GREEN = material("CapGreen", "#CFDC97")
CAP_CREAM = material("CapCream", "#F0E9D8")
GLASS = material("Glass", "#E4F0F0", rough=0.04, alpha=0.09)

# --- cabinet: solid, with one hollow chute bored through it ----------------
# The body below the shelf is solid. A square shaft drops from the hole in the
# shelf and meets a tunnel that runs forward out of the arch, so a capsule
# travels down a single hollow pipe rather than through a hollowed-out cabinet.

cabinet = rounded_box("Cabinet", (1.10, 0.88, 0.90), (0.0, 0.0, 0.55), BODY, bevel=0.07, segments=2)

# vertical shaft — its floor is the tunnel floor, so nothing has to be climbed
boolean_cut(cabinet, rounded_box("Shaft", (0.32, 0.32, 0.90), (-0.28, 0.06, 0.75), None,
                                 bevel=0.03, segments=2))

# horizontal tunnel — forward from the shaft, out through the front face
boolean_cut(cabinet, rounded_box("Tunnel", (0.34, 0.60, 0.36), (-0.28, -0.15, 0.48), None,
                                 bevel=0.03, segments=2))

# The arch is a rectangle with a semicircular top, joined into one cutter. It
# only rounds the front of the tunnel into a proper opening.
arch_box = rounded_box("ArchBox", (0.38, 0.34, 0.17), (-0.28, -0.44, 0.385), None, bevel=0.0)
arch_top = cylinder("ArchTop", 0.19, 0.34, (-0.28, -0.44, 0.47), None,
                    rot=(math.radians(90), 0.0, 0.0), verts=32)
arch = join_objects([arch_box, arch_top], "ArchCutter")
boolean_cut(cabinet, arch, use_self=True)

rounded_box("BasePlinth", (1.22, 1.00, 0.14), (0.0, 0.0, 0.07), BODY_DARK, bevel=0.05, segments=2)

# The ledge is built after the cabinet was bored, so the shaft has to be cut
# through it as well — otherwise it caps the chute at z 0.97..1.07.
ledge = rounded_box("CabinetLedge", (1.14, 0.92, 0.10), (0.0, -0.02, 1.02), BODY_DARK, bevel=0.04, segments=2)
boolean_cut(ledge, rounded_box("LedgeShaft", (0.40, 0.40, 0.30), (-0.28, 0.06, 1.02), None,
                               bevel=0.03, segments=2))

# --- control panel --------------------------------------------------------

# coin plate: a mauve disc with a dark vertical slot cut through it
coin_plate = cylinder("CoinPlate", 0.10, 0.07, (0.02, -0.505, 0.83), MAUVE,
                       rot=(math.radians(90), 0.0, 0.0), verts=28)
boolean_cut(coin_plate, rounded_box("SlotCutter", (0.034, 0.20, 0.145), (0.02, -0.505, 0.83), None,
                                    bevel=0.008, segments=1))

panel_plate = rounded_box("PanelPlate", (0.98, 0.08, 0.32), (0.0, -0.45, 0.81), PANEL, bevel=0.04, segments=2)
boolean_cut(panel_plate, rounded_box("SlotCutter2", (0.034, 0.20, 0.145), (0.02, -0.505, 0.83), None,
                                     bevel=0.008, segments=1))

# push button: one small mint cap — a short collar with a domed face, joined
# into a single mesh. No separate outer ring, so nothing can poke past the
# edge of the panel plate (x 0.49 wide, z 0.65..0.97).
bpy.ops.mesh.primitive_cylinder_add(radius=0.10, depth=0.06, vertices=28,
                                    location=(0.30, -0.468, 0.83))
button_body = bpy.context.object
button_body.name = "ButtonBody"
button_body.rotation_euler = (math.radians(90), 0.0, 0.0)

bpy.ops.mesh.primitive_uv_sphere_add(radius=0.10, segments=24, ring_count=12,
                                     location=(0.30, -0.498, 0.83))
button_cap = bpy.context.object
button_cap.name = "ButtonCap"
button_cap.scale = (1.0, 0.5, 1.0)
activate(button_cap)
bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)

button = join_objects([button_body, button_cap], "Button")
button.data.materials.clear()
button.data.materials.append(MINT)
for poly in button.data.polygons:
    poly.material_index = 0
activate(button)
bpy.ops.object.shade_flat()

# --- chamber: open front, left and right; glass fills those three faces ----

globe_shell = rounded_box("GlobeShell", (1.04, 0.88, 0.92), (0.0, 0.0, 1.50), BODY, bevel=0.05, segments=2)
inner = rounded_box("GlobeInner", (1.12, 1.04, 0.80), (0.0, -0.16, 1.50), None, bevel=0.04, segments=2)
boolean_cut(globe_shell, inner)

# The shell keeps a solid floor at z 1.04..1.10, which lies inside the shelf and
# would cap the shaft — cut the same bore through it.
boolean_cut(globe_shell, rounded_box("ShellShaft", (0.40, 0.40, 0.30), (-0.28, 0.06, 1.05), None,
                                     bevel=0.03, segments=2))

rounded_box("GlobeVisor", (1.20, 0.98, 0.20), (0.0, -0.03, 2.02), BODY_DARK, bevel=0.10, segments=3)

shelf = rounded_box("GlobeShelf", (1.10, 0.88, 0.14), (0.0, 0.0, 1.09), BODY_DARK, bevel=0.05, segments=2)
boolean_cut(shelf, rounded_box("ShelfHole", (0.30, 0.30, 0.40), (-0.28, 0.06, 1.09), None,
                               bevel=0.02, segments=1))

# --- hatch: the hole is closed until the machine opens it -----------------
# A plate hinged on the rear edge of the hole. Closed it sits flush on the
# shelf and holds the pile back; the game swings the hinge +90 degrees about X
# and it hangs down the rear wall of the shaft, clear of the falling capsule.

hatch_hinge = bpy.data.objects.new("HatchHinge", None)
bpy.context.collection.objects.link(hatch_hinge)
hatch_hinge.empty_display_size = 0.09
hatch_hinge.empty_display_type = "PLAIN_AXES"
hatch_hinge.location = (-0.28, 0.235, 1.16)

# Same tone as the shelf on purpose: closed, the shelf reads as one solid floor
# and the hole only appears when the hatch swings.
hatch = rounded_box("HoleHatch", (0.34, 0.34, 0.026), (-0.28, 0.065, 1.173), BODY_DARK,
                    bevel=0.012, segments=1)
parent_keep(hatch, hatch_hinge)

# capsule pile: eleven capsules, well inside the glass and clear of the hatch so
# the ball that drops reads as the one that was sitting on it. The count is
# deliberately low: the game scatters the heap after every pull and re-stacks it
# wherever it lands, and fourteen capsules packed at random fill the chamber to
# the ceiling — they look jammed. Eleven leave the heap room to breathe.
pile = [
    # bottom layer, minus the square over the drop hole and the back corner
    (-0.28, -0.24, 1.29), (-0.02, -0.24, 1.29), (0.24, -0.24, 1.29),
    (-0.02, 0.01, 1.29), (0.24, 0.01, 1.29),
    (-0.28, 0.23, 1.29), (-0.02, 0.23, 1.29),
    # middle
    (-0.15, -0.12, 1.51), (0.11, -0.12, 1.51), (-0.15, 0.14, 1.51),
    # peak
    (-0.10, -0.02, 1.72),
]

pairs = (CAP_RED, CAP_GREEN)
for index, (px, py, pz) in enumerate(pile):
    top = pairs[index % 2]
    bottom = CAP_CREAM if index % 3 == 0 else pairs[(index + 1) % 2]
    capsule("Cap%02d" % index, 0.125, top, bottom, CAP_CREAM, (px, py, pz),
            seg=14, rings=8)

# glass panes: front, left, right
rounded_box("GlassFront", (1.02, 0.02, 0.79), (0.0, -0.432, 1.50), GLASS, bevel=0.008, segments=1)
rounded_box("GlassLeft", (0.02, 0.80, 0.79), (-0.512, -0.04, 1.50), GLASS, bevel=0.008, segments=1)
rounded_box("GlassRight", (0.02, 0.80, 0.79), (0.512, -0.04, 1.50), GLASS, bevel=0.008, segments=1)

# --- capsules on the floor ------------------------------------------------
# Kept well clear of x = -0.28, the lane a dispensed capsule rolls down and
# comes to rest in, so the player's capsule never lands inside the dressing.

capsule("FloorCapA", 0.135, CAP_CREAM, CAP_RED, CREAM, (-1.02, -0.88, 0.135), seg=16, rings=9)
capsule("FloorCapB", 0.135, CAP_RED, CAP_GREEN, CREAM, (-0.84, -1.20, 0.135), seg=16, rings=9)
capsule("FloorCapC", 0.135, CAP_GREEN, CAP_CREAM, CREAM, (0.95, -1.02, 0.135), seg=16, rings=9)

# --- ground (excluded from the export) ------------------------------------

bpy.ops.mesh.primitive_plane_add(size=14.0, location=(0.0, 0.0, 0.0))
ground = bpy.context.object
ground.name = "Ground"
ground.data.materials.append(material("GroundMat", "#D9D2C6", rough=0.95))

# --- lighting + camera ----------------------------------------------------

world = bpy.data.worlds[0] if bpy.data.worlds else bpy.data.worlds.new("World")
scene.world = world
world.use_nodes = True
world.node_tree.nodes["Background"].inputs[0].default_value = rgba("#E7E2D8")
world.node_tree.nodes["Background"].inputs[1].default_value = 0.75

sun_data = bpy.data.lights.new("Sun", type="SUN")
sun_data.energy = 2.6
sun_data.angle = math.radians(1.5)
sun = bpy.data.objects.new("Sun", sun_data)
scene.collection.objects.link(sun)
sun.rotation_euler = (math.radians(54), math.radians(6), math.radians(38))

fill_data = bpy.data.lights.new("Fill", type="AREA")
fill_data.energy = 45.0
fill_data.size = 4.0
fill = bpy.data.objects.new("Fill", fill_data)
scene.collection.objects.link(fill)
fill.location = (-3.2, -3.0, 2.6)
fill.rotation_euler = (math.radians(66), 0.0, math.radians(-48))

cam_data = bpy.data.cameras.new("Camera")
cam_data.lens = 58
cam = bpy.data.objects.new("Camera", cam_data)
scene.collection.objects.link(cam)
cam.location = (-2.45, -3.55, 2.05)
cam.rotation_euler = (math.radians(76), 0.0, math.radians(-34))
scene.camera = cam

# --- export (ground excluded) ---------------------------------------------

bpy.ops.object.select_all(action="DESELECT")
for obj in scene.objects:
    if obj.name != "Ground":
        obj.select_set(True)
bpy.context.view_layer.objects.active = cam
bpy.ops.export_scene.gltf(
    filepath=GLB_OUT,
    export_format="GLB",
    use_selection=True,
    export_apply=True,
    export_yup=True,
    export_materials="EXPORT",
    export_image_format="AUTO",
)

# --- preview render -------------------------------------------------------

for engine in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE", "CYCLES"):
    try:
        scene.render.engine = engine
        break
    except TypeError:
        continue

scene.render.resolution_x = 900
scene.render.resolution_y = 900
scene.render.resolution_percentage = 100
scene.render.filepath = RENDER_OUT
scene.render.image_settings.file_format = "PNG"
try:
    scene.eevee.taa_render_samples = 32
    scene.eevee.use_raytracing = True
except AttributeError:
    pass

bpy.ops.render.render(write_still=True)

print("MACHINE_BUILD: objects=%d glb=%s" % (len(scene.objects), GLB_OUT))
