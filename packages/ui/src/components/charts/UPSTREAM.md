# Upstream

Bklit UI's charts (https://github.com/bklit/bklit-ui, MIT, see `LICENSE` here; the pattern code
keeps visx's own notice in `patterns/LICENSE-visx-pattern`). `../shimmering-text.tsx` comes from
the same registry under the same licence.

- Installed with `shadcn add @bklit/line-chart` from the registry `https://ui.bklit.com/r/{name}.json`
  on 2026-11-22. The registry has no version of its own; upstream `main` was then at
  `76299da6981e2494836be5ce842720a7fb057891`.
- `shadcn add @bklit/bar-chart` on 2026-11-22 added the bar chart's own files (`bar-chart.tsx`,
  `bar.tsx`, `bar-*.ts(x)`); every file it shares with the line chart was identical, so the
  registry had not moved. What it also wrote and was undone: `clsx` and `tailwind-merge` in
  `package.json`, its `lib/utils.ts`, and its own `--chart-*` values in `globals.css` (the theme
  defines them).
- Local changes: the registry's `lib/utils.ts` (clsx and tailwind-merge) was not taken: the
  files import `cn` from `@gousset/ui/lib/utils`, which re-exports the repository's `cn`. The
  tooltip's panel (`TOOLTIP_PANEL_CLASS_NAME` in `tooltip/tooltip-box.tsx`) takes the floating
  surfaces' edge and shadow (`border-popover-border`, `shadow-popover` in place of the blocks'
  border colour and `shadow-lg/5`; `docs/design.md`, "Floating surfaces", #104): keep them when
  updating.
- Kept out of `vp lint` and `vp fmt` (`AGENTS.md`, "Lint"); update by running `shadcn add` again
  and keeping `lib/utils.ts` as it is, then update this file.
