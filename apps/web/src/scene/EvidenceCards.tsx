import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Color, type Group } from "three";
import { useTribunal } from "../store/tribunal";
import { TABLE_POS } from "./hooks";

const GOOD = new Color("#5ac47c").multiplyScalar(2.5);
const BAD = new Color("#e04b3a").multiplyScalar(2.5);

export default function EvidenceCards() {
  const evidence = useTribunal((s) => s.evidence);
  const feed = useTribunal((s) => s.feed);
  const root = useRef<Group>(null);

  const cards = useMemo(() => {
    const forged = new Set<string>();
    for (const f of feed) if (f.kind === "evidence" && !f.verified) f.evidenceIds?.forEach((id) => forged.add(id));
    return evidence.slice(-6).map((e) => ({ id: e.id, ok: !forged.has(e.id) }));
  }, [evidence, feed]);

  useFrame((state) => {
    const g = root.current;
    if (!g) return;
    const t = state.clock.elapsedTime;
    const n = g.children.length;
    g.children.forEach((c, i) => {
      const a = t * 0.3 + (i / n) * Math.PI * 2;
      c.position.set(Math.cos(a) * 0.55, 1.35 + Math.sin(t * 0.9 + i) * 0.04, Math.sin(a) * 0.55);
      c.rotation.y = -a + Math.PI / 2;
    });
  });

  return (
    <group position={TABLE_POS} ref={root}>
      {cards.map((c) => (
        <group key={c.id}>
          <mesh position={[0, 0, -0.003]}>
            <planeGeometry args={[0.29, 0.39]} />
            <meshBasicMaterial color={c.ok ? GOOD : BAD} toneMapped={false} />
          </mesh>
          <mesh>
            <planeGeometry args={[0.25, 0.35]} />
            <meshStandardMaterial color="#e8dcc0" roughness={0.85} side={2} />
          </mesh>
        </group>
      ))}
    </group>
  );
}
