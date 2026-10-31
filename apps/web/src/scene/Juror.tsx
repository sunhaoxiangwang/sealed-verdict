import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Text, useGLTF } from "@react-three/drei";
import { clone } from "three/examples/jsm/utils/SkeletonUtils.js";
import type { Group, Mesh, MeshStandardMaterial } from "three";
import { useTribunal } from "../store/tribunal";
import Safe from "./Safe";
import Candle from "./Candle";
import { BYZ, JUROR_LAYOUT, VOTE_COLOR, damp, facingBench, flicker, getMats, newCache } from "./hooks";

function WraithModel() {
  const { scene } = useGLTF("/models/wraith.glb");
  const obj = useMemo(() => {
    const c = clone(scene);
    c.traverse((o) => {
      const m = o as Mesh;
      if (!m.isMesh) return;
      m.castShadow = true;
      if (o.name === "Wraith_Core" && !Array.isArray(m.material)) m.material = m.material.clone(); // per-instance glow
    });
    return c;
  }, [scene]);
  return <primitive object={obj} />;
}

function WraithFallback() {
  return (
    <group>
      <mesh position={[0, 0.85, 0]} castShadow>
        <coneGeometry args={[0.45, 1.7, 16]} />
        <meshStandardMaterial color="#17151b" roughness={0.9} />
      </mesh>
      <mesh name="Wraith_Core" position={[0, 1.75, -0.08]}>
        <sphereGeometry args={[0.09, 16, 16]} />
        <meshStandardMaterial color="#222" emissive="#8ab4ff" emissiveIntensity={1} />
      </mesh>
    </group>
  );
}

function LecternModel() {
  const { scene } = useGLTF("/models/lectern.glb");
  const obj = useMemo(() => {
    const c = clone(scene);
    c.traverse((o) => {
      o.castShadow = true;
      o.receiveShadow = true;
    });
    return c;
  }, [scene]);
  return <primitive object={obj} />;
}

function LecternFallback() {
  return (
    <mesh position={[0, 0.5, 0]} castShadow receiveShadow>
      <boxGeometry args={[0.5, 1.0, 0.35]} />
      <meshStandardMaterial color="#1b1410" roughness={0.7} />
    </mesh>
  );
}

export default function Juror({ index }: { index: number }) {
  const L = JUROR_LAYOUT[index];
  const rotY = facingBench(L.x, L.z);
  const data = useTribunal((s) => s.jurors[index]);

  const bob = useRef<Group>(null);
  const sealed = useRef<Group>(null);
  const glow = useRef<Mesh>(null);
  const wax = useRef<MeshStandardMaterial>(null);
  const ring = useRef<MeshStandardMaterial>(null);
  const cache = useMemo(newCache, []);
  const s = useRef({ sp: 0, revealAt: -1, wasRevealed: false });

  useFrame((state, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05);
    const t = state.clock.elapsedTime;
    const j = useTribunal.getState().jurors[index];
    const S = s.current;
    const byz = !!j?.byzantine;

    S.sp = damp(S.sp, j?.speaking ? 1 : 0, 4, dt);
    if (bob.current) bob.current.position.y = 0.05 * Math.sin(t * 3 + index) * S.sp;

    for (const m of getMats(cache, bob.current, "Wraith_Core")) {
      if (!m.userData.be) m.userData.be = m.emissive.clone();
      if (byz) {
        m.emissive.copy(BYZ);
        m.emissiveIntensity = 0.5 + Math.random() * 3.5;
      } else {
        m.emissive.copy(m.userData.be);
        m.emissiveIntensity = 0.55 + 2.5 * S.sp;
      }
    }

    const committed = !!j?.committed;
    const revealed = !!j?.revealed;
    if (revealed && !S.wasRevealed) S.revealAt = t;
    S.wasRevealed = revealed;

    if (sealed.current) {
      sealed.current.visible = committed && !revealed;
      sealed.current.rotation.y += dt * 0.8;
      if (wax.current) {
        if (byz) {
          wax.current.color.copy(BYZ);
          wax.current.emissive.copy(BYZ);
          wax.current.emissiveIntensity = Math.random() * 1.5;
        } else {
          wax.current.color.set("#9b1b1b");
          wax.current.emissive.set("#3a0505");
          wax.current.emissiveIntensity = 0.4 + 0.1 * flicker(t, index);
        }
      }
    }
    if (glow.current) {
      glow.current.visible = revealed;
      if (revealed) {
        const e = (t - S.revealAt) / 0.6;
        glow.current.scale.setScalar(e < 1 ? 1 + 0.4 * Math.sin(e * Math.PI) : 1);
        const m = glow.current.material as MeshStandardMaterial;
        const c = byz ? BYZ : (VOTE_COLOR[j?.vote ?? "uncertain"] ?? VOTE_COLOR.uncertain);
        m.color.copy(c);
        m.emissive.copy(c);
        m.emissiveIntensity = byz ? 0.3 + Math.random() * 1.2 : 1.1;
      }
    }
  });

  return (
    <>
      <group position={[L.x, 0, L.z]} rotation-y={rotY}>
        <group ref={bob}>
          <Safe fallback={<WraithFallback />}>
            <WraithModel />
          </Safe>
          <group position={[0, 2.5, 0]}>
            <group ref={sealed} visible={false}>
              <mesh>
                <sphereGeometry args={[0.12, 24, 24]} />
                <meshStandardMaterial ref={wax} color="#9b1b1b" roughness={0.4} emissive="#3a0505" />
              </mesh>
              <mesh rotation-x={Math.PI / 2}>
                <torusGeometry args={[0.17, 0.014, 12, 40]} />
                <meshStandardMaterial ref={ring} color="#c9a24a" metalness={0.9} roughness={0.3} />
              </mesh>
            </group>
            <mesh ref={glow} visible={false}>
              <sphereGeometry args={[0.12, 24, 24]} />
              <meshStandardMaterial color="#5ac47c" emissive="#5ac47c" emissiveIntensity={1.1} />
            </mesh>
          </group>
        </group>
        {/* lectern in front of the juror (local +Z = model front) */}
        <group position={[0, 0, 0.7]}>
          <Safe fallback={<LecternFallback />}>
            <LecternModel />
          </Safe>
          <Candle position={[0, 1.0, 0.02]} seed={index} />
        </group>
        {/* plaque on the lectern front (in-canvas text; no DOM roots) */}
        <group position={[0, 0.56, 0.7 + 0.115]}>
          <mesh position={[0, 0, -0.004]}>
            <planeGeometry args={[0.66, 0.17]} />
            <meshStandardMaterial color="#0b0a0d" roughness={0.6} transparent opacity={0.82} />
          </mesh>
          <mesh position={[-0.27, 0.02, 0.001]}>
            <circleGeometry args={[0.014, 16]} />
            <meshBasicMaterial color="#5ac47c" toneMapped={false} />
          </mesh>
          <Text font="/fonts/JetBrainsMono-Medium.ttf" fontSize={0.054} color="#e8dcc0" anchorX="left" anchorY="middle" position={[-0.24, 0.022, 0.001]}>
            {data?.pseudonym ?? "empty seat"}
          </Text>
          <Text font="/fonts/JetBrainsMono-Medium.ttf" fontSize={0.038} color="#a69a86" anchorX="left" anchorY="middle" position={[-0.24, -0.038, 0.001]}>
            {data?.persona ?? ""}
          </Text>
        </group>
      </group>
    </>
  );
}
