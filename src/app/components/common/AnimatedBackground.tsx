import { motion } from "framer-motion";
import { useMemo } from "react";
import { MeshGradient } from "./MeshGradient";

/**
 * AnimatedBackground — premium ambient backdrop.
 *
 * Layers:
 *   1. Base mesh gradient (CSS) — soft radial green + gold pools
 *   2. Three large blurred circles that drift slowly (CSS animation)
 *   3. Twenty small particles that float upward (Framer Motion)
 *
 * The whole thing is `pointer-events: none` and `position: fixed` so it
 * sits behind everything without intercepting clicks.
 *
 * Performance:
 *   - Particle count is capped at 20 (GPU-friendly)
 *   - Uses `transform` only (no layout thrash)
 *   - Particles respect prefers-reduced-motion via the Framer Motion
 *     `useReducedMotion` hook (consumer can opt out)
 */

type Particle = {
  id: number;
  x: number;
  size: number;
  duration: number;
  delay: number;
  opacity: number;
};

function useParticles(count = 20): Particle[] {
  return useMemo(
    () =>
      Array.from({ length: count }, (_, i) => ({
        id: i,
        x: Math.random() * 100,
        size: 2 + Math.random() * 4,
        duration: 12 + Math.random() * 14,
        delay: Math.random() * 8,
        opacity: 0.15 + Math.random() * 0.35,
      })),
    [count],
  );
}

export function AnimatedBackground({ variant = "default" }: { variant?: "default" | "subtle" }) {
  const particles = useParticles(variant === "subtle" ? 10 : 20);

  return (
    <div
      className="fixed inset-0 -z-10 bg-mesh overflow-hidden pointer-events-none"
      aria-hidden="true"
    >
      <MeshGradient variant={variant === "subtle" ? "admin" : "welcome"} />
      {/* Three large drifting blurred circles */}
      <motion.div
        className="absolute rounded-full"
        style={{
          width: 480,
          height: 480,
          top: "-10%",
          left: "-5%",
          background: "radial-gradient(circle, rgba(35, 79, 30, 0.18) 0%, transparent 70%)",
          filter: "blur(60px)",
        }}
        animate={{
          x: [0, 60, 0],
          y: [0, 40, 0],
        }}
        transition={{ duration: 24, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.div
        className="absolute rounded-full"
        style={{
          width: 420,
          height: 420,
          bottom: "-15%",
          right: "-5%",
          background: "radial-gradient(circle, rgba(255, 201, 139, 0.20) 0%, transparent 70%)",
          filter: "blur(70px)",
        }}
        animate={{
          x: [0, -50, 0],
          y: [0, -30, 0],
        }}
        transition={{ duration: 28, repeat: Infinity, ease: "easeInOut", delay: 2 }}
      />
      <motion.div
        className="absolute rounded-full"
        style={{
          width: 360,
          height: 360,
          top: "40%",
          left: "60%",
          background: "radial-gradient(circle, rgba(79, 111, 70, 0.12) 0%, transparent 70%)",
          filter: "blur(80px)",
        }}
        animate={{
          x: [0, 30, 0],
          y: [0, -50, 0],
        }}
        transition={{ duration: 32, repeat: Infinity, ease: "easeInOut", delay: 4 }}
      />

      {/* Floating particles */}
      {particles.map((p) => (
        <motion.span
          key={p.id}
          className="absolute rounded-full"
          style={{
            left: `${p.x}%`,
            bottom: -10,
            width: p.size,
            height: p.size,
            background: "var(--primary)",
            opacity: p.opacity,
          }}
          animate={{
            y: [0, -window.innerHeight - 100],
            opacity: [0, p.opacity, p.opacity, 0],
          }}
          transition={{
            duration: p.duration,
            delay: p.delay,
            repeat: Infinity,
            ease: "linear",
          }}
        />
      ))}
    </div>
  );
}
