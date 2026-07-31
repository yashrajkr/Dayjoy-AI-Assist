import { defineConfig } from "vite";
import path from "path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";

function figmaAssetResolver() {
  return {
    name: "figma-asset-resolver",
    resolveId(id: string) {
      if (id.startsWith("figma:asset/")) {
        const filename = id.replace("figma:asset/", "");
        return path.resolve(__dirname, "src/assets", filename);
      }
      return undefined;
    },
  };
}

export default defineConfig({
  plugins: [figmaAssetResolver(), react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    host: "0.0.0.0",
    port: 5173,
    // Don't watch backend, node_modules, dist, etc. — causes ENOSPC.
    watch: {
      ignored: [
        "**/backend/**",
        "**/node_modules/**",
        "**/dist/**",
        "**/.git/**",
        "**/.venv/**",
        "**/data/**",
      ],
    },
  },
  assetsInclude: ["**/*.svg", "**/*.csv"],
  build: {
    // Raise the warning threshold — the Three.js orb chunk is intentionally
    // large and lazy-loaded, so the warning is noise.
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        manualChunks: {
          "react-vendor": ["react", "react-dom", "react-router-dom"],
          "supabase": ["@supabase/supabase-js"],
          "markdown": ["react-markdown", "remark-gfm"],
          "three-vendor": ["three", "@react-three/fiber", "@react-three/drei"],
          "tesseract-vendor": ["tesseract.js"],
          "jsqr-vendor": ["jsqr"],
        },
      },
    },
  },
});
