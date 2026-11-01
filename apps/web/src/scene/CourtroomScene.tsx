import { useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { ContactShadows, Environment } from "@react-three/drei";
import { Bloom, EffectComposer, Noise, Vignette } from "@react-three/postprocessing";
import { Vector3 } from "three";
import { easing } from "maath";
import "../styles/scene.css";
import Room from "./Room";
import Lights from "./Lights";
import Bench from "./Bench";
import Juror from "./Juror";
import Seal from "./Seal";
import EvidenceCards from "./EvidenceCards";
import Safe from "./Safe";
import { LITE } from "./hooks";

const Q = new URLSearchParams(typeof location !== "undefined" ? location.search : "");
const DEBUG_TOP = Q.get("top") === "1";
const HIDE = new Set((Q.get("hide") ?? "").split(",").filter(Boolean));
const TARGET = DEBUG_TOP ? new Vector3(0, 0, -1.5) : new Vector3(0, 1.1, -1.2);
const BASE = (DEBUG_TOP ? new Vector3(0.01, 11, -1.5) : new Vector3(0, 2.45, 4.7)).sub(TARGET);
const MAX = 0.15;
const v = new Vector3();

function Rig() {
  const d = useRef({ yaw: 0, pitch: 0 });
  useFrame((state, dt) => {
    easing.damp(d.current, "yaw", -state.pointer.x * MAX, 0.4, dt);
    easing.damp(d.current, "pitch", state.pointer.y * MAX * 0.4, 0.4, dt);
    v.copy(BASE).applyAxisAngle(Y_AXIS, d.current.yaw);
    v.y += d.current.pitch * 2;
    state.camera.position.copy(TARGET).add(v);
    state.camera.lookAt(TARGET);
  });
  return null;
}
const Y_AXIS = new Vector3(0, 1, 0);

export default function CourtroomScene() {
  return (
    <div className="scene-canvas">
      <Canvas
        shadows={LITE ? false : "soft"}
        dpr={LITE ? 1 : [1, 1.5]}
        camera={{ position: [0, 2.45, 4.7], fov: 42, near: 0.1, far: 60 }}
        gl={{ antialias: false, powerPreference: "high-performance" }}
      >
        <color attach="background" args={["#0b0a0d"]} />
        <fogExp2 attach="fog" args={["#0b0a0d", 0.055]} />
        <Safe fallback={null}>
          <Environment files="/hdri/solitude_interior_1k.hdr" environmentIntensity={0.7} />
        </Safe>
        <Lights />
        <Room />
        {!HIDE.has("bench") && <Bench />}
        {!HIDE.has("jurors") && [0, 1, 2, 3].map((i) => (
          <Juror key={i} index={i} />
        ))}
        <ContactShadows position={[0, 0.01, -0.9]} scale={10} blur={2.5} far={3} opacity={0.6} resolution={512} />
        {!HIDE.has("cards") && <EvidenceCards />}
        {!HIDE.has("seal") && <Seal />}
        <Rig />
        {!LITE && <EffectComposer multisampling={4}>
          <Bloom luminanceThreshold={0.8} intensity={0.55} mipmapBlur />
          <Vignette offset={0.3} darkness={0.75} />
          <Noise opacity={0.05} />
        </EffectComposer>}
      </Canvas>
    </div>
  );
}
