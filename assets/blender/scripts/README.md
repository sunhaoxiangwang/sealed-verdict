# Juror build scripts

Headless rebuild of the four juror costumes on the CC0 Blender Human Base Meshes, then glTF export to `apps/web/public/models/juror_*.glb`.

```bash
cp assets/blender/sealed-verdict.blend assets/blender/sealed-verdict-v2.blend   # costumes_v2 expects the pre-costume scene
/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup assets/blender/sealed-verdict-v2.blend --python assets/blender/scripts/costumes_v2.py
/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup assets/blender/sealed-verdict-v2.blend --python assets/blender/scripts/render_lineup.py
```

Method: fitted tops are body-region shells (smooth, lift, shrinkwrap outside, collar and cuff loops extruded); skirts, robes and coat tails are lofted from the body's own hip and leg cross-sections with flare and hanging folds; fabric weave comes from Poly Haven normal maps.
