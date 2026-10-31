import { useMemo } from "react";
import { useGLTF } from "@react-three/drei";
import { clone } from "three/examples/jsm/utils/SkeletonUtils.js";
import Safe from "./Safe";
import Candle from "./Candle";
import { BENCH_POS } from "./hooks";

function BenchModel() {
  const { scene } = useGLTF("/models/bench.glb");
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

function BenchFallback() {
  return (
    <mesh position={[0, 0.575, 0]} castShadow receiveShadow>
      <boxGeometry args={[3.2, 1.15, 0.8]} />
      <meshStandardMaterial color="#4a2e1b" roughness={0.7} />
    </mesh>
  );
}

export default function Bench() {
  return (
    <group position={BENCH_POS}>
      {/* model front is +Z (Blender -Y), already facing the camera */}
      <group>
        <Safe fallback={<BenchFallback />}>
          <BenchModel />
        </Safe>
      </group>
      <Candle position={[-1.1, 1.15, 0]} seed={10} />
      <Candle position={[1.1, 1.15, 0]} seed={11} />
    </group>
  );
}
