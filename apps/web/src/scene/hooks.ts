import { Color, MathUtils, type Mesh, type MeshStandardMaterial, type Object3D } from "three";

/** Shared mutable FX channel (read in useFrame; never triggers React renders). */
export const fx = { pulseAt: -1e9 };

/** `?lite=1` drops reflections, shadows, post-processing and sparkles: for weak laptops and headless checks. */
export const LITE = typeof location !== "undefined" && new URLSearchParams(location.search).get("lite") === "1";

export const damp = MathUtils.damp;
export const clamp = MathUtils.clamp;

/** Smooth pseudo-noise in roughly [-1, 1]. */
export const flicker = (t: number, seed: number) =>
  Math.sin(t * 9.1 + seed * 13.7) * 0.5 + Math.sin(t * 15.7 + seed * 5.3) * 0.3 + Math.sin(t * 3.3 + seed * 2.1) * 0.2;

export function easeOutBounce(x: number) {
  const n1 = 7.5625;
  const d1 = 2.75;
  if (x < 1 / d1) return n1 * x * x;
  if (x < 2 / d1) return n1 * (x -= 1.5 / d1) * x + 0.75;
  if (x < 2.5 / d1) return n1 * (x -= 2.25 / d1) * x + 0.9375;
  return n1 * (x -= 2.625 / d1) * x + 0.984375;
}

export const VOTE_COLOR: Record<string, Color> = {
  true: new Color("#5ac47c"),
  false: new Color("#e04b3a"),
  uncertain: new Color("#d7a73b"),
};
export const BYZ = new Color("#7fcf5a");

export const BENCH_POS: [number, number, number] = [0, 0, -3.2];
export const TABLE_POS: [number, number, number] = [0, 0, -1.9];
export const TABLE_TOP = 0.75;

/** Juror slots: x within +-2.3, z within -1.4..-0.4, outer seats forward. */
export const JUROR_LAYOUT = [
  { x: -2.05, z: -0.4 },
  { x: -1.05, z: -1.4 },
  { x: 1.05, z: -1.4 },
  { x: 2.05, z: -0.4 },
];
/** Y rotation so local -Z (the model front) points at the bench. */
export const CAMERA_POS: [number, number, number] = [0, 2.45, 4.7];
/** Jurors face the camera (audience); the bench is the backdrop behind them. */
/** Blender's front (-Y) exports as glTF +Z, so local +Z is the model's face. */
export const facingBench = (x: number, z: number) => Math.atan2(CAMERA_POS[0] - x, CAMERA_POS[2] - z);

export type MatCache = { mats: MeshStandardMaterial[]; n: number };
export const newCache = (): MatCache => ({ mats: [], n: 0 });

/** Finds (and every ~30 frames re-finds) standard materials of meshes named `name` (or all meshes when null). */
export function getMats(c: MatCache, root: Object3D | null, name: string | null) {
  if (c.n-- <= 0) {
    c.n = 30;
    c.mats = [];
    root?.traverse((o) => {
      const m = o as Mesh;
      if (m.isMesh && (name === null || o.name.startsWith(name)) && !Array.isArray(m.material) && "emissive" in m.material) {
        c.mats.push(m.material as MeshStandardMaterial);
      }
    });
  }
  return c.mats;
}
