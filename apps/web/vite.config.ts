import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import { redact } from "@tanstack/redact/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { varlockVitePlugin } from "@varlock/vite-integration";
import viteReact, { reactCompilerPreset } from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite-plus";

// The Redact comparison of issue #10 (docs/architecture.md, "Redact"): `GOUSSET_REDACT=1` builds
// the app on Redact's runtime instead of React's. The app ships on React.
const onRedact = process.env["GOUSSET_REDACT"] === "1";

export default defineConfig({
  server: {
    port: 3001,
  },
  resolve: {
    tsconfigPaths: true,
  },
  // Redact redirects React's imports in server dependencies too: they must be bundled.
  ssr: onRedact ? { noExternal: true } : {},
  plugins: [
    varlockVitePlugin({ ssrInjectMode: "auto-load" }),
    tailwindcss(),
    tanstackStart(),
    nitro({ preset: "node-server" }),
    viteReact(),
    // React Compiler: memoisation is automatic, nobody writes useMemo by hand.
    babel({ presets: [reactCompilerPreset()] }),
    onRedact ? redact() : null,
  ],
});
