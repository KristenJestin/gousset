# Prototype: the 0.2 screens, a finishing pass

A static prototype of the screens the 0.2.0 feedback is about, for the maintainer to validate
before the fixes are coded. Open [`index.html`](index.html) in a browser: no build, no server.

- Plain HTML and CSS. A small script (`assets/proto.js`) only switches the theme, the width and
  the states shown, and replays the motion.
- The colours are the theme's tokens, copied from `packages/ui/src/styles/globals.css`; the few
  tokens the pass proposes to add are marked _proposed_ in `assets/proto.css` and on the scale page.
- Every name, file, label and amount is invented.
- Each page has a side panel: the decisions made, and the alternatives rejected.

It is not code to copy: the fixes are made in `packages/ui` and `apps/web`, with their stories and
tests, as AGENTS.md says.

## Credits

- Geist (`assets/geist-latin-wght-normal.woff2`), SIL Open Font License 1.1
  (`assets/geist-OFL.txt`), taken from `@fontsource-variable/geist` as the app uses it.
- Tabler Icons (MIT), outline, drawn from `@tabler/icons` as CSS masks in `assets/icons.css`.
