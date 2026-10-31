import { MeshReflectorMaterial, Sparkles } from "@react-three/drei";
import { TABLE_POS, TABLE_TOP } from "./hooks";

const STONE = "#1c1a21";

export default function Room() {
  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} receiveShadow>
        <planeGeometry args={[24, 24]} />
        <MeshReflectorMaterial
          color="#141218"
          blur={[300, 100]}
          resolution={512}
          mixBlur={1}
          mixStrength={10}
          roughness={0.9}
          metalness={0.2}
          mirror={0.4}
        />
      </mesh>
      <mesh position={[0, 4, -6]} receiveShadow>
        <planeGeometry args={[24, 8]} />
        <meshStandardMaterial color={STONE} roughness={0.95} />
      </mesh>
      <mesh position={[-6, 4, 0]} rotation-y={Math.PI / 2} receiveShadow>
        <planeGeometry args={[24, 8]} />
        <meshStandardMaterial color={STONE} roughness={0.95} />
      </mesh>
      <mesh position={[6, 4, 0]} rotation-y={-Math.PI / 2} receiveShadow>
        <planeGeometry args={[24, 8]} />
        <meshStandardMaterial color={STONE} roughness={0.95} />
      </mesh>
      {/* evidence table */}
      <mesh position={[TABLE_POS[0], TABLE_TOP / 2, TABLE_POS[2]]} castShadow receiveShadow>
        <cylinderGeometry args={[0.6, 0.6, TABLE_TOP, 32]} />
        <meshStandardMaterial color="#2a1c12" roughness={0.6} />
      </mesh>
      <Sparkles count={120} scale={[8, 3, 8]} size={1.5} speed={0.25} color="#ffb36b" opacity={0.5} position={[0, 1.5, -1.5]} />
    </group>
  );
}
