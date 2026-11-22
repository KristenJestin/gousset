# Vendored anti-slop (generic rules)

Source: [`dmmulroy/anti-slop`](https://github.com/dmmulroy/anti-slop), commit
`63dbb09f73438e550a6991dc6d778f979ffbf183` (2026-11-20), MIT (`LICENSE`, kept verbatim).

Copied from the skill's bundled plugin, `skills/install-anti-slop/assets/anti-slop/`, without its
`effect/` folder, which lives in `../anti-slop-effect/`. `vendor/eslint-stylistic/` keeps its own
`LICENSE` and `UPSTREAM.md`.

Local changes: none. Registered in the root `vite.config.ts` (`lint.jsPlugins`), every rule an
error. Update with the `install-anti-slop` skill (`.agents/skills/install-anti-slop/`).
