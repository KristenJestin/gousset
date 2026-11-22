import { defineConfig } from "react-doctor/api";

// React Doctor (docs/architecture.md, "Quality"): in full in `verify`, and on each pull request
// through its Action, for what the pull request introduces. Nothing leaves CI.
export default defineConfig({
  projects: ["apps/web", "packages/ui"],
  // An error fails the run; a warning stays a comment to answer.
  blocking: "error",
  // The score is computed on React Doctor's server: the code's findings would leave CI.
  noScore: true,
  share: false,
  // The supply-chain pass asks a third party (Socket.dev) about every dependency.
  supplyChain: { enabled: false },
  // Vendored code keeps its upstream form (AGENTS.md, "Lint"): Bklit's charts, as its shadcn
  // registry installs them. Paths are relative to each project.
  ignore: {
    files: ["src/components/charts/**", "src/components/shimmering-text.tsx"],
  },
});
