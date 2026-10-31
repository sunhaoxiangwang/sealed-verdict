import { useMemo } from "react";
import { MeshReflectorMaterial, Sparkles, useGLTF, useTexture } from "@react-three/drei";
import { RepeatWrapping, type Mesh, type MeshStandardMaterial, type Texture } from "three";
import { clone } from "three/examples/jsm/utils/SkeletonUtils.js";
import Safe from "./Safe";
import { TABLE_POS, TABLE_TOP } from "./hooks";

const STONE = "#1c1a21";

function CourtroomSet() {
  const { scene } = useGLTF("/models/courtroom.glb");
  const obj = useMemo(() => {
    const c = clone(scene);
    c.traverse((o) => {
      const m = o as Mesh;
      if (!m.isMesh) return;
      m.castShadow = !o.name.startsWith("CR_Ceiling");
      m.receiveShadow = true;
      const mat = m.material as MeshStandardMaterial;
      if (o.name.startsWith("CR_SconceFlame") || o.name.startsWith("CR_ChandFlame")) {
        mat.emissiveIntensity = 3;
        mat.toneMapped = false;
      }
    });
    return c;
  }, [scene]);
  return <primitive object={obj} />;
}

function SetFallback() {
  return (
    <group>
      <mesh position={[0, 4, -6.6]} receiveShadow>
        <planeGeometry args={[12, 8]} />
        <meshStandardMaterial color={STONE} roughness={0.95} />
      </mesh>
      <mesh position={[-6, 4, 0]} rotation-y={Math.PI / 2} receiveShadow>
        <planeGeometry args={[14, 8]} />
        <meshStandardMaterial color={STONE} roughness={0.95} />
      </mesh>
      <mesh position={[6, 4, 0]} rotation-y={-Math.PI / 2} receiveShadow>
        <planeGeometry args={[14, 8]} />
        <meshStandardMaterial color={STONE} roughness={0.95} />
      </mesh>
    </group>
  );
}

function tile(t: Texture, n: number) {
  t.wrapS = t.wrapT = RepeatWrapping;
  t.repeat.set(n, n);
  return t;
}

function ParquetFloor() {
  const [map, roughnessMap, normalMap] = useTexture([
    "/textures/parquet/diff.jpg",
    "/textures/parquet/rough.jpg",
    "/textures/parquet/normal.jpg",
  ]);
  useMemo(() => [map, roughnessMap, normalMap].forEach((t) => tile(t, 7)), [map, roughnessMap, normalMap]);
  return (
    <mesh rotation-x={-Math.PI / 2} receiveShadow>
      <planeGeometry args={[14, 14]} />
      <MeshReflectorMaterial
        map={map}
        roughnessMap={roughnessMap}
        normalMap={normalMap}
        color="#6b5236"
        blur={[300, 100]}
        resolution={512}
        mixBlur={1}
        mixStrength={6}
        roughness={0.8}
        metalness={0.05}
        mirror={0.35}
      />
    </mesh>
  );
}

function PlainFloor() {
  return (
    <mesh rotation-x={-Math.PI / 2} receiveShadow>
      <planeGeometry args={[14, 14]} />
      <MeshReflectorMaterial color="#141218" blur={[300, 100]} resolution={512} mixBlur={1} mixStrength={10} roughness={0.9} metalness={0.2} mirror={0.4} />
    </mesh>
  );
}

export default function Room() {
  return (
    <group>
      <Safe fallback={<PlainFloor />}>
        <ParquetFloor />
      </Safe>
      <Safe fallback={<SetFallback />}>
        <CourtroomSet />
      </Safe>
      {/* chandelier and sconce light */}
      <pointLight position={[0, 4.3, -0.8]} color="#ffb36b" intensity={18} distance={9} decay={2} />
      {/* evidence table */}
      <mesh position={[TABLE_POS[0], TABLE_TOP / 2, TABLE_POS[2]]} castShadow receiveShadow>
        <cylinderGeometry args={[0.6, 0.6, TABLE_TOP, 32]} />
        <meshStandardMaterial color="#2a1c12" roughness={0.6} />
      </mesh>
      <Sparkles count={120} scale={[8, 3, 8]} size={1.5} speed={0.25} color="#ffb36b" opacity={0.5} position={[0, 1.5, -1.5]} />
    </group>
  );
}
