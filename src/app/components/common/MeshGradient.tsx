import { useMemo } from "react";
import { motion, useReducedMotion } from "framer-motion";

/**
 * MeshGradient — slow, organic, four-layer radial-gradient wash that gives
 * pages a "living" backdrop without ever becoming distracting.
 *
 * Only `transform` and `opacity` are animated (GPU-accelerated, no repaint).
 * Each layer moves at its own speed/direction so the composite never repeats
 * in an obviously loop-able way. Respects prefers-reduced-motion with a
 * static, single-frame gradient.
 */

type MeshVariant = "default" | "welcome" | "admin";

const VARIANT_LAYERS: Record<
  MeshVariant,
  { color: string; top: string; left: string; size: number }[]
> = {
  default: [
    { color: "var(--primary)", top: "10%", left: "15%", size: 46 },
    { color: "var(--gold-accent)", top: "75%", left: "80%", size: 40 },
    { color: "var(--card-beige)", top: "85%", left: "10%", size: 50 },
    { color: "var(--secondary)", top: "20%", left: "85%", size: 38 },
  ],
  welcome: [
    { color: "var(--gold-accent)", top: "15%", left: "20%", size: 52 },
    { color: "var(--primary)", top: "80%", left: "75%", size: 46 },
    { color: "var(--accent)", top: "70%", left: "15%", size: 44 },
    { color: "var(--secondary)", top: "10%", left: "80%", size: 40 },
  ],
  admin: [
    { color: "var(--primary)", top: "5%", left: "10%", size: 36 },
    { color: "var(--secondary)", top: "90%", left: "90%", size: 34 },
    { color: "var(--card-beige)", top: "80%", left: "5%", size: 38 },
    { color: "var(--gold-accent)", top: "15%", left: "90%", size: 28 },
  ],
};

const DURATIONS = [26, 32, 22, 29];
const RANGES: [number, number][] = [
  [-6, 6],
  [7, -5],
  [-5, -7],
  [6, 5],
];

export function MeshGradient({ variant = "default" }: { variant?: MeshVariant }) {
  const reduceMotion = useReducedMotion();
  const layers = useMemo(() => VARIANT_LAYERS[variant], [variant]);

  return (
    <div
      className="absolute inset-0 overflow-hidden pointer-events-none"
      aria-hidden="true"
    >
      {layers.map((layer, i) => {
        const [dx, dy] = RANGES[i % RANGES.length];
        return (
          <motion.div
            key={i}
            className="absolute rounded-full"
            style={{
              top: layer.top,
              left: layer.left,
              width: `${layer.size}vmax`,
              height: `${layer.size}vmax`,
              background: `radial-gradient(circle, ${layer.color} 0%, transparent 70%)`,
              filter: "blur(40px)",
              translateX: "-50%",
              translateY: "-50%",
            }}
            initial={{ opacity: 0.06 }}
            animate={
              reduceMotion
                ? { opacity: 0.08 }
                : {
                    x: [0, dx * 8, 0],
                    y: [0, dy * 8, 0],
                    opacity: [0.05, 0.12, 0.05],
                  }
            }
            transition={
              reduceMotion
                ? { duration: 0 }
                : {
                    duration: DURATIONS[i % DURATIONS.length],
                    repeat: Infinity,
                    ease: "easeInOut",
                  }
            }
          />
        );
      })}
    </div>
  );
}

export default MeshGradient;
