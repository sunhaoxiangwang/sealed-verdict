import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import { clone } from "three/examples/jsm/utils/SkeletonUtils.js";
import type { Group, PointLight } from "three";
import Safe from "./Safe";
import { flicker, getMats, newCache } from "./hooks";

function CandleModel() {
  const { scene } = useGLTF("/models/candle.glb");
  const obj = useMemo(() => {
    const c = clone(scene);
    c.traverse((o) => {
      const m = o as import("three").Mesh;
      if (m.isMesh && o.name === "Candle_Ember" && !Array.isArray(m.material)) m.material = m.material.clone();
    });
    return c;
  }, [scene]);
  return <primitive object={obj} />;
}

function CandleFallback() {
  return (
    <group>
      <mesh position={[0, 0.15, 0]}>
        <cylinderGeometry args={[0.035, 0.04, 0.3, 12]} />
        <meshStandardMaterial color="#d8cdb0" roughness={0.8} />
      </mesh>
      <mesh name="Candle_Ember" position={[0, 0.32, 0]}>
        <sphereGeometry args={[0.02, 8, 8]} />
        <meshStandardMaterial color="#ff9a3c" emissive="#ff7a1c" emissiveIntensity={2} />
      </mesh>
    </group>
  );
}

export default function Candle({ position, seed = 0 }: { position: [number, number, number]; seed?: number }) {
  const body = useRef<Group>(null);
  const light = useRef<PointLight>(null);
  const cache = useMemo(newCache, []);
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    const f = flicker(t, seed + 1);
    if (light.current) light.current.intensity = 1.3 * (1 + 0.15 * f);
    for (const m of getMats(cache, body.current, "Candle_Ember")) m.emissiveIntensity = 2.5 * (1 + 0.2 * f);
  });
  return (
    <group position={position}>
      <group ref={body}>
        <Safe fallback={<CandleFallback />}>
          <CandleModel />
        </Safe>
      </group>
      <pointLight ref={light} position={[0, 0.4, 0]} color="#ff9a3c" intensity={1.3} distance={3.0} decay={2} />
    </group>
  );
}
