import { Component, Suspense, type ReactNode } from "react";
import { useGLTF } from "@react-three/drei";

useGLTF.setDecoderPath("https://www.gstatic.com/draco/versioned/decoders/1.5.7/");

class Boundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(err: unknown) {
    console.warn("[scene] asset failed, using fallback:", err instanceof Error ? err.message : err);
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/** Suspense + error boundary: shows `fallback` while loading and if the asset is missing/broken. */
export default function Safe({ fallback, children }: { fallback: ReactNode; children: ReactNode }) {
  return (
    <Boundary fallback={fallback}>
      <Suspense fallback={fallback}>{children}</Suspense>
    </Boundary>
  );
}
