import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import { clone } from "three/examples/jsm/utils/SkeletonUtils.js";
import { Object3D, type Group, type InstancedMesh, type Mesh } from "three";
import { useTribunal } from "../store/tribunal";
import Safe from "./Safe";
import { TABLE_POS, TABLE_TOP, clamp, easeOutBounce, flicker, fx, getMats, newCache } from "./hooks";

const REST = TABLE_TOP + 0.006;
const SHARDS = 20;
const dummy = new Object3D();

function SealModel() {
  const { scene } = useGLTF("/models/seal.glb");
  const obj = useMemo(() => {
    const c = clone(scene);
    c.traverse((o) => {
      const m = o as Mesh;
      if (m.isMesh && !Array.isArray(m.material)) m.material = m.material.clone();
    });
    return c;
  }, [scene]);
  return <primitive object={obj} />;
}

function SealFallback() {
  return (
    <mesh position={[0, 0.03, 0]}>
      <cylinderGeometry args={[0.5, 0.5, 0.06, 32]} />
      <meshStandardMaterial color="#9b1b1b" roughness={0.45} />
    </mesh>
  );
}

export default function Seal() {
  const sealG = useRef<Group>(null);
  const parch = useRef<Group>(null);
  const shards = useRef<InstancedMesh>(null);
  const cache = useMemo(newCache, []);
  const st = useRef({
    start: null as number | null,
    landed: false,
    broke: false,
    shardsOn: false,
    pos: new Float32Array(SHARDS * 3),
    vel: new Float32Array(SHARDS * 3),
    scl: new Float32Array(SHARDS),
  });

  useEffect(() => {
    // init hidden shard matrices
    const m = shards.current;
    if (m) m.visible = false;
  }, []);

  useFrame((state, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05);
    const t = state.clock.elapsedTime;
    const s = useTribunal.getState();
    const S = st.current;
    const on = !!s.certificate && s.phase === "verdict";
    if (parch.current) parch.current.visible = on;
    if (sealG.current) {
      sealG.current.visible = on;
      if (on) {
        if (S.start === null) {
          S.start = t;
          S.landed = false;
        }
        const e = clamp((t - S.start) / 0.5, 0, 1);
        sealG.current.position.y = REST + (1.2 - REST) * (1 - easeOutBounce(e));
        if (!S.landed && e >= 1) {
          S.landed = true;
          fx.pulseAt = t;
        }
      } else S.start = null;

      // crack tint + flicker
      for (const m of getMats(cache, sealG.current, null)) {
        if (!m.userData.bc) m.userData.bc = m.color.clone();
        if (s.chainBroken) {
          m.color.set("#2a0a0a");
          m.emissive.set("#ff2200");
          m.emissiveIntensity = Math.max(0, 0.35 + 0.35 * flicker(t, 7)) * (Math.random() > 0.9 ? 2 : 1);
        } else {
          m.color.copy(m.userData.bc);
          m.emissiveIntensity = m.userData.be ?? m.emissiveIntensity;
        }
      }
    }

    // shards
    const sh = shards.current;
    if (s.chainBroken && !S.broke) {
      S.broke = true;
      S.shardsOn = true;
      for (let i = 0; i < SHARDS; i++) {
        const a = Math.random() * Math.PI * 2;
        const r = Math.random() * 0.12;
        S.pos.set([Math.cos(a) * r, REST + 0.05, Math.sin(a) * r], i * 3);
        const v = 0.4 + Math.random() * 0.9;
        S.vel.set([Math.cos(a) * v, 1 + Math.random() * 1.5, Math.sin(a) * v], i * 3);
        S.scl[i] = 0.6 + Math.random() * 0.8;
      }
    } else if (!s.chainBroken && S.broke) {
      S.broke = false;
      S.shardsOn = false;
    }
    if (sh) {
      sh.visible = S.shardsOn;
      if (S.shardsOn) {
        for (let i = 0; i < SHARDS; i++) {
          const p = S.pos;
          const v = S.vel;
          const k = i * 3;
          if (v[k + 1] !== 0 || v[k] !== 0) {
            v[k + 1] -= 9.8 * dt;
            p[k] += v[k] * dt;
            p[k + 1] += v[k + 1] * dt;
            p[k + 2] += v[k + 2] * dt;
            const onTable = Math.hypot(p[k], p[k + 2]) < 0.6;
            const floor = onTable ? TABLE_TOP : 0.02;
            if (p[k + 1] <= floor) {
              p[k + 1] = floor;
              v[k] = v[k + 1] = v[k + 2] = 0;
            }
          }
          dummy.position.set(p[k], p[k + 1], p[k + 2]);
          dummy.rotation.set(i, i * 2, t * (v[k + 1] !== 0 ? 6 : 0) + i);
          dummy.scale.setScalar(S.scl[i]);
          dummy.updateMatrix();
          sh.setMatrixAt(i, dummy.matrix);
        }
        sh.instanceMatrix.needsUpdate = true;
      }
    }
  });

  return (
    <group position={TABLE_POS}>
      <group ref={parch} visible={false}>
        <mesh position={[0, TABLE_TOP + 0.003, 0]} rotation={[-Math.PI / 2, 0, 0.15]} receiveShadow>
          <planeGeometry args={[0.6, 0.8]} />
          <meshStandardMaterial color="#e8dcc0" roughness={0.85} side={2} />
        </mesh>
      </group>
      <group ref={sealG} visible={false} scale={0.35}>
        <Safe fallback={<SealFallback />}>
          <SealModel />
        </Safe>
      </group>
      <group position={[0, 0, 0]}>
        <instancedMesh ref={shards} args={[undefined, undefined, SHARDS]} frustumCulled={false} castShadow>
          <boxGeometry args={[0.04, 0.012, 0.03]} />
          <meshStandardMaterial color="#9b1b1b" emissive="#5a0a0a" roughness={0.5} />
        </instancedMesh>
      </group>
    </group>
  );
}
