import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { varlockVitePlugin } from "@varlock/vite-integration";
import viteReact, { reactCompilerPreset } from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite-plus";

export default defineConfig({
  server: {
    port: 3001,
  },
  resolve: {
    tsconfigPaths: true,
  },
  plugins: [
    varlockVitePlugin({ ssrInjectMode: "auto-load" }),
    tailwindcss(),
    tanstackStart(),
    // The plugin loads the app as the server starts, and its job queue with it.
    nitro({ preset: "node-server", plugins: ["./src/boot.nitro.ts"] }),
    viteReact(),
    // React Compiler: memoisation is automatic, nobody writes useMemo by hand.
    babel({ presets: [reactCompilerPreset()] }),
  ],
});
