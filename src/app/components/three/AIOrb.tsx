import { Suspense, useMemo, useRef, useState, useCallback } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Float, Points, PointMaterial } from "@react-three/drei";
import { EffectComposer, Bloom, ChromaticAberration } from "@react-three/postprocessing";
import * as THREE from "three";

/**
 * AIOrb — the living, breathing visual centerpiece of Dayjoy AI Assist.
 *
 * An icosahedron with GPU-side simplex-noise vertex displacement ("organic
 * breathing"), a glowing inner core, a wireframe tech shell, and a slow orbit
 * of gold particles. Colors lerp smoothly between assistant states.
 *
 * Performance:
 *  - All geometry/material objects are memoized once.
 *  - dpr capped at [1, 2].
 *  - `mobile` prop halves particle count and disables post-processing.
 *  - Fully inert (falls back to a static gradient circle) when the user has
 *    prefers-reduced-motion enabled — see the exported <AIOrb /> wrapper.
 */

export type AIOrbState =
  | "idle"
  | "thinking"
  | "answering"
  | "listening"
  | "error"
  | "blocked"
  | "verified";

interface StatePalette {
  outer: THREE.Color;
  inner: THREE.Color;
  rim: THREE.Color;
}

const STATE_PALETTES: Record<AIOrbState, StatePalette> = {
  idle: {
    outer: new THREE.Color("#DD6B3D"),
    inner: new THREE.Color("#FFC98B"),
    rim: new THREE.Color("#E8965A"),
  },
  thinking: {
    outer: new THREE.Color("#FFC98B"),
    inner: new THREE.Color("#FFFFFF"),
    rim: new THREE.Color("#FFC98B"),
  },
  answering: {
    outer: new THREE.Color("#FBE7D8"),
    inner: new THREE.Color("#E8965A"),
    rim: new THREE.Color("#DD6B3D"),
  },
  listening: {
    outer: new THREE.Color("#E8965A"),
    inner: new THREE.Color("#F0B27E"),
    rim: new THREE.Color("#FBE7D8"),
  },
  error: {
    outer: new THREE.Color("#B7791F"),
    inner: new THREE.Color("#C62828"),
    rim: new THREE.Color("#B7791F"),
  },
  blocked: {
    outer: new THREE.Color("#C62828"),
    inner: new THREE.Color("#5A1414"),
    rim: new THREE.Color("#C62828"),
  },
  verified: {
    outer: new THREE.Color("#DD6B3D"),
    inner: new THREE.Color("#FFC98B"),
    rim: new THREE.Color("#DD6B3D"),
  },
};

const STATE_ACTIVITY: Record<AIOrbState, number> = {
  idle: 0.35,
  thinking: 1.0,
  answering: 0.7,
  listening: 0.85,
  error: 0.5,
  blocked: 0.9,
  verified: 0.6,
};

// ---------------------------------------------------------------------------
// GLSL — classic Ashima 3D simplex noise, inlined so no extra npm dependency
// is required. Used for organic vertex displacement on the outer shell.
// ---------------------------------------------------------------------------
const SIMPLEX_GLSL = /* glsl */ `
vec4 permute(vec4 x){return mod(((x*34.0)+1.0)*x,289.0);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159 - 0.85373472095314 * r;}
float snoise(vec3 v){
  const vec2 C = vec2(1.0/6.0, 1.0/3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i  = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod(i, 289.0);
  vec4 p = permute(permute(permute(
            i.z + vec4(0.0, i1.z, i2.z, 1.0))
          + i.y + vec4(0.0, i1.y, i2.y, 1.0))
          + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 1.0/7.0;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ *ns.x + ns.yyyy;
  vec4 y = y_ *ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0)*2.0 + 1.0;
  vec4 s1 = floor(b1)*2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
}
`;

const ORB_VERTEX_SHADER = /* glsl */ `
uniform float uTime;
uniform float uAmplitude;
varying vec3 vNormal;
varying float vNoise;
${SIMPLEX_GLSL}
void main() {
  vNormal = normal;
  float n = snoise(position * 1.4 + vec3(0.0, 0.0, uTime * 0.35));
  vNoise = n;
  vec3 displaced = position + normal * n * uAmplitude;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(displaced, 1.0);
}
`;

const ORB_FRAGMENT_SHADER = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uRimColor;
varying vec3 vNormal;
varying float vNoise;
void main() {
  float fresnel = pow(1.0 - abs(dot(normalize(vNormal), vec3(0.0, 0.0, 1.0))), 2.2);
  vec3 base = mix(uColor * 0.85, uColor * 1.25, vNoise * 0.5 + 0.5);
  vec3 col = mix(base, uRimColor, fresnel * 0.6);
  gl_FragColor = vec4(col, 1.0);
}
`;

/** Lerp a THREE.Color ref toward a target color each frame (in place). */
function lerpColorTo(current: THREE.Color, target: THREE.Color, t: number) {
  current.lerp(target, t);
}

function OrbMesh({
  state,
  hovered,
}: {
  state: AIOrbState;
  hovered: boolean;
}) {
  const innerRef = useRef<THREE.Mesh>(null);
  const wireRef = useRef<THREE.Mesh>(null);
  const groupRef = useRef<THREE.Group>(null);

  const geometry = useMemo(() => new THREE.IcosahedronGeometry(1, 4), []);
  const innerGeometry = useMemo(() => new THREE.IcosahedronGeometry(0.7, 3), []);
  const wireGeometry = useMemo(() => new THREE.IcosahedronGeometry(1.02, 1), []);

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uAmplitude: { value: 0.08 },
      uColor: { value: STATE_PALETTES.idle.outer.clone() },
      uRimColor: { value: STATE_PALETTES.idle.rim.clone() },
    }),
    [],
  );

  const shaderMaterial = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: ORB_VERTEX_SHADER,
        fragmentShader: ORB_FRAGMENT_SHADER,
        uniforms,
      }),
    [uniforms],
  );

  const innerColor = useMemo(() => STATE_PALETTES.idle.inner.clone(), []);
  const innerMaterial = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: innerColor,
        transparent: true,
        opacity: 0.9,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    [innerColor],
  );

  const wireMaterial = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: STATE_PALETTES.idle.rim.clone(),
        wireframe: true,
        transparent: true,
        opacity: 0.18,
      }),
    [],
  );

  useFrame((_, delta) => {
    const t = performance.now() / 1000;
    const palette = STATE_PALETTES[state];
    const activity = STATE_ACTIVITY[state];

    uniforms.uTime.value = t;
    const targetAmp = (hovered ? 0.12 : 0.08) * (0.7 + activity * 0.6);
    uniforms.uAmplitude.value = THREE.MathUtils.lerp(uniforms.uAmplitude.value, targetAmp, delta * 3);

    lerpColorTo(uniforms.uColor.value, palette.outer, delta * 2.5);
    lerpColorTo(uniforms.uRimColor.value, palette.rim, delta * 2.5);
    lerpColorTo(innerColor, palette.inner, delta * 2.5);
    innerMaterial.color.copy(innerColor);
    wireMaterial.color.copy(uniforms.uRimColor.value);

    if (innerRef.current) {
      const pulse = 1 + Math.sin(t * (1.5 + activity * 2)) * 0.06 * activity;
      innerRef.current.scale.setScalar(pulse);
    }

    if (groupRef.current) {
      groupRef.current.rotation.y += delta * (0.3 + activity * 0.25);
      const targetScale = hovered ? 1.05 : 1.0;
      const s = THREE.MathUtils.lerp(groupRef.current.scale.x, targetScale, delta * 4);
      groupRef.current.scale.setScalar(s);
    }
    if (wireRef.current) {
      wireRef.current.rotation.y -= delta * 0.15;
      wireRef.current.rotation.x += delta * 0.08;
    }
  });

  return (
    <group ref={groupRef}>
      <mesh geometry={geometry} material={shaderMaterial} />
      <mesh ref={innerRef} geometry={innerGeometry} material={innerMaterial} />
      <mesh ref={wireRef} geometry={wireGeometry} material={wireMaterial} />
      <pointLight color={STATE_PALETTES.idle.inner.getHex()} intensity={2} distance={3} />
    </group>
  );
}

function OrbParticles({ count }: { count: number }) {
  const ref = useRef<THREE.Points>(null);
  const positions = useMemo(() => {
    const arr = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const radius = 1.5 + Math.random() * 1.0;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(Math.random() * 2 - 1);
      arr[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
      arr[i * 3 + 1] = radius * Math.sin(phi) * Math.sin(theta);
      arr[i * 3 + 2] = radius * Math.cos(phi);
    }
    return arr;
  }, [count]);

  useFrame((_, delta) => {
    if (ref.current) {
      ref.current.rotation.y += delta * 0.08;
      ref.current.rotation.x += delta * 0.03;
    }
  });

  return (
    <Points ref={ref} positions={positions} stride={3}>
      <PointMaterial
        transparent
        color="#FFC98B"
        size={0.035}
        sizeAttenuation
        depthWrite={false}
        blending={THREE.AdditiveBlending}
        opacity={0.7}
      />
    </Points>
  );
}

function OrbScene({ state, mobile }: { state: AIOrbState; mobile: boolean }) {
  const [hovered, setHovered] = useState(false);
  const onOver = useCallback(() => setHovered(true), []);
  const onOut = useCallback(() => setHovered(false), []);

  return (
    <>
      <ambientLight intensity={0.3} />
      <directionalLight position={[3, 4, 2]} intensity={1.2} color="#ffffff" />
      <directionalLight position={[-3, -2, 1]} intensity={0.4} color="#FFC98B" />
      <directionalLight position={[0, 1, -4]} intensity={0.6} color="#4F6F46" />

      <Float speed={1.5} rotationIntensity={0.3} floatIntensity={0.2}>
        <group onPointerOver={onOver} onPointerOut={onOut}>
          <OrbMesh state={state} hovered={hovered} />
        </group>
      </Float>

      <OrbParticles count={mobile ? 20 : 70} />

      {!mobile && (
        <EffectComposer>
          <Bloom intensity={0.8} luminanceThreshold={0.2} luminanceSmoothing={0.9} mipmapBlur />
          <ChromaticAberration
            offset={new THREE.Vector2(0.0005, 0.0005)}
            radialModulation={false}
            modulationOffset={0}
          />
        </EffectComposer>
      )}
    </>
  );
}

/** Static, non-WebGL fallback — used for prefers-reduced-motion and render errors. */
function StaticOrb({ state, size }: { state: AIOrbState; size: number }) {
  const palette = STATE_PALETTES[state];
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: "9999px",
        background: `radial-gradient(circle at 35% 30%, ${palette.inner.getStyle()} 0%, ${palette.outer.getStyle()} 65%, ${palette.rim.getStyle()} 100%)`,
        boxShadow: `0 0 ${size * 0.3}px -${size * 0.08}px ${palette.outer.getStyle()}`,
      }}
    />
  );
}

export function AIOrb({
  state = "idle",
  size = 160,
  mobile = false,
  className = "",
}: {
  state?: AIOrbState;
  size?: number;
  mobile?: boolean;
  className?: string;
}) {
  const prefersReducedMotion = useMemo(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches,
    [],
  );

  if (prefersReducedMotion) {
    return (
      <div
        className={className}
        style={{ width: size, height: size }}
        role="img"
        aria-label={`AI assistant is ${state}`}
      >
        <StaticOrb state={state} size={size} />
      </div>
    );
  }

  return (
    <div
      className={className}
      style={{ width: size, height: size }}
      role="img"
      aria-label={`AI assistant is ${state}`}
    >
      <Suspense fallback={<StaticOrb state={state} size={size} />}>
        <Canvas
          camera={{ position: [0, 0, 4], fov: 45 }}
          dpr={[1, 2]}
          gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
          style={{ width: "100%", height: "100%" }}
        >
          <OrbScene state={state} mobile={mobile} />
        </Canvas>
      </Suspense>
    </div>
  );
}

export default AIOrb;
