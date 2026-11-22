# Vendored anti-slop-effect (Effect rules)

Source: [`dmmulroy/anti-slop`](https://github.com/dmmulroy/anti-slop), commit
`63dbb09f73438e550a6991dc6d778f979ffbf183` (2026-11-20), MIT (`LICENSE`, kept verbatim).

Copied from the skill's bundled plugin, `skills/install-anti-slop/assets/anti-slop/effect/`.
Upstream ships it as `anti-slop/effect/`; here it is a folder of its own beside `../anti-slop/`,
with no other change (it imports nothing outside itself).

Registered in the root `vite.config.ts` (`lint.jsPlugins`), every rule an error. Update with the
`install-anti-slop` skill (`.agents/skills/install-anti-slop/`), pointing it at this folder.
