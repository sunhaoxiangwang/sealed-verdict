import { useEffect, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import type { SpotLight } from "three";
import { clamp, fx } from "./hooks";

export default function Lights() {
  const spot = useRef<SpotLight>(null);
  const bench = useRef<SpotLight>(null);
  useEffect(() => {
    const s = spot.current;
    if (s) {
      s.target.position.set(0, 0.9, -1.4);
      s.target.updateMatrixWorld();
    }
    const b = bench.current;
    if (b) {
      b.target.position.set(0, 1.2, -3.4);
      b.target.updateMatrixWorld();
    }
  }, []);
  useFrame((state) => {
    if (!spot.current) return;
    const e = clamp((state.clock.elapsedTime - fx.pulseAt) / 0.3, 0, 1);
    spot.current.intensity = 110 + 160 * Math.sin(e * Math.PI) * (e < 1 ? 1 : 0);
  });
  return (
    <>
      <spotLight
        ref={spot}
        color="#ffb36b"
        intensity={110}
        angle={0.75}
        penumbra={0.7}
        position={[0, 5, -2.2]}
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-bias={-0.0004}
      />
      <directionalLight color="#6f8cff" intensity={0.9} position={[2, 4, -6]} />
      <spotLight ref={bench} color="#ffc78a" intensity={90} angle={0.5} penumbra={0.6} position={[0, 5.5, -1.2]} />
      <hemisphereLight args={["#2a2438", "#0b0a0d", 0.22]} />
    </>
  );
}
