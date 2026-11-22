# Upstream

Bklit UI's charts (https://github.com/bklit/bklit-ui, MIT, see `LICENSE` here; the pattern code
keeps visx's own notice in `patterns/LICENSE-visx-pattern`). `../shimmering-text.tsx` comes from
the same registry under the same licence.

- Installed with `shadcn add @bklit/line-chart` from the registry `https://ui.bklit.com/r/{name}.json`
  on 2026-11-22. The registry has no version of its own; upstream `main` was then at
  `76299da6981e2494836be5ce842720a7fb057891`.
- Local changes: none. The registry's `lib/utils.ts` (clsx and tailwind-merge) was not taken: the
  files import `cn` from `@gousset/ui/lib/utils`, which re-exports the repository's `cn`.
- Kept out of `vp lint` and `vp fmt` (`AGENTS.md`, "Lint"); update by running `shadcn add` again
  and keeping `lib/utils.ts` as it is, then update this file.
