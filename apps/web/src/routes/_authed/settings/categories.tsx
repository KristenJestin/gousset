import type { Benchmark, CategoryNode, CategoryTree, EntryKind } from "@gousset/core";
import { m } from "@gousset/i18n/messages";
import { Block } from "@gousset/ui/components/app-shell";
import { Button } from "@gousset/ui/components/button";
import {
  CategoryTree as CategoryList,
  CategoryTreeSkeleton,
} from "@gousset/ui/components/category-tree";
import type { CategoryTreeRow } from "@gousset/ui/components/category-tree";
import { AlertDialog } from "@gousset/ui/components/dialog";
import { MenuItem, MenuSeparator } from "@gousset/ui/components/menu";
import { Tab, Tabs, TabsList, TabsPanel } from "@gousset/ui/components/tabs";
import { usePageLanguage } from "@gousset/ui/hooks/use-page-language";
import { formatMoney } from "@gousset/ui/lib/money";
import { notify } from "@gousset/ui/lib/notify";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Suspense, useState } from "react";

import type { CategoryAnswer } from "@/components/category-forms";
import {
  BenchmarkDialog,
  CreateCategoryDialog,
  MergeCategoryDialog,
  MoveCategoryDialog,
  RenameCategoryDialog,
} from "@/components/category-forms";
import {
  archiveCategory,
  createCategory,
  editCategory,
  mergeCategory,
  restoreCategory,
} from "@/functions/categories";
import { categoryRefusalMessage } from "@/i18n/messages";
import type { CategoryView } from "@/lib/categories";
import { choicesOf, parentsOf, rowsOf } from "@/lib/categories";
import { categoryQueries, invalidateCategories } from "@/queries/categories";

/**
 * The categories (#23; docs/wireframes, screen 10): the expense and income categories on two
 * levels, with their six-month average, benchmark and lines, and the archived ones apart. Each
 * change asks in a dialog; a refusal says why in words. There is no "Delete": merging a category
 * into another is how one goes, its lines with it.
 */
export const Route = createFileRoute("/_authed/settings/categories")({
  loader: async ({ context: { queryClient } }) => {
    await queryClient.ensureQueryData(categoryQueries.list());
  },
  component: Categories,
});

function Categories() {
  return (
    <Block title={m.settingsNavCategories()} description={m.categoriesDescription()}>
      <Suspense fallback={<CategoryTreeSkeleton />}>
        <CategoriesContent />
      </Suspense>
    </Block>
  );
}

/** A server call's answer, or a refusal with no code when the server could not be reached. */
async function answerOf<Answer extends CategoryAnswer>(
  action: () => Promise<Answer>,
): Promise<Answer | { ok: false; code: string }> {
  try {
    return await action();
  } catch {
    return { ok: false, code: "UNKNOWN" };
  }
}

/** The dialog a row's menu opened, and on which category. */
type Action = "rename" | "move" | "merge" | "benchmark" | "archive";

function isView(value: string): value is CategoryView {
  return value === "expense" || value === "income" || value === "archived";
}

function CategoriesContent() {
  const { data: tree } = useSuspenseQuery(categoryQueries.list());
  // The currency set benchmarks are written in: the user's own (Settings › General).
  const { currency } = Route.useRouteContext().user;
  const queryClient = useQueryClient();
  const locale = usePageLanguage();
  const [view, setView] = useState<CategoryView>("expense");
  const [creating, setCreating] = useState(false);
  // A new form each time it opens; the last one stays drawn while it closes.
  const [createKey, setCreateKey] = useState(0);
  const [justCreatedId, setJustCreatedId] = useState<string>();
  // The last dialog opened stays drawn while it closes, so that it leaves as it came.
  const [action, setAction] = useState<{ action: Action; node: CategoryNode; key: number }>();
  const [open, setOpen] = useState(false);

  /** Runs a change, then reads again what it touched; its answer for the dialog. */
  async function change(call: () => Promise<CategoryAnswer>): Promise<CategoryAnswer> {
    const answer = await answerOf(call);

    if (answer.ok) {
      await invalidateCategories(queryClient);
    }

    return answer;
  }

  /** A change asked from the menu itself (Restore), its refusal said in a toast. */
  async function changeAtOnce(call: () => Promise<CategoryAnswer>) {
    const answer = await change(call);

    if (!answer.ok) {
      notify.failed({ description: categoryRefusalMessage(answer.code, answer.fallback) });
    }
  }

  const openAction = (next: Action, node: CategoryNode) => {
    setAction({ action: next, node, key: (action?.key ?? 0) + 1 });
    setOpen(true);
  };

  const benchmarkText = (node: CategoryNode) => benchmarkOf(node, currency, locale);

  const toRow = (row: ReturnType<typeof rowsOf>[number]): CategoryTreeRow => {
    const { node } = row;
    const archived = node.archivedAt !== null;

    return {
      id: node.id,
      name: row.name,
      child: row.child,
      // A top-level category counts its children's lines in its average, as its benchmark does.
      average: node.parentId === null ? node.averageWithChildren : node.average,
      benchmark: benchmarkText(node),
      benchmarkSet: node.benchmark.mode === "fixed",
      entries: node.entries,
      justCreated: node.id === justCreatedId,
      actions: archived ? (
        <MenuItem
          icon="undo"
          onSelect={() => changeAtOnce(() => restoreCategory({ data: { categoryId: node.id } }))}
        >
          {m.categoriesRestore()}
        </MenuItem>
      ) : (
        <>
          <MenuItem icon="edit" onSelect={() => openAction("rename", node)}>
            {m.categoriesRename()}
          </MenuItem>
          <MenuItem onSelect={() => openAction("move", node)}>{m.categoriesMove()}</MenuItem>
          <MenuItem onSelect={() => openAction("merge", node)}>{m.categoriesMerge()}</MenuItem>
          <MenuItem onSelect={() => openAction("benchmark", node)}>
            {m.categoriesBenchmark()}
          </MenuItem>
          <MenuSeparator />
          <MenuItem onSelect={() => openAction("archive", node)}>{m.categoriesArchive()}</MenuItem>
        </>
      ),
    };
  };

  const VIEWS = [
    { value: "expense", tab: m.categoriesTabExpense(), list: m.categoriesListExpense() },
    { value: "income", tab: m.categoriesTabIncome(), list: m.categoriesListIncome() },
    { value: "archived", tab: m.categoriesTabArchived(), list: m.categoriesListArchived() },
  ] as const satisfies ReadonlyArray<{ value: CategoryView; tab: string; list: string }>;

  return (
    <div className="flex flex-col gap-4">
      <Tabs
        value={view}
        onValueChange={(next) => {
          if (isView(next)) {
            setView(next);
          }
        }}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <TabsList label={m.categoriesViews()}>
            {VIEWS.map((each) => (
              <Tab key={each.value} value={each.value}>
                {each.tab}
              </Tab>
            ))}
          </TabsList>
          <Button
            icon="add"
            onClick={() => {
              setCreateKey(createKey + 1);
              setCreating(true);
            }}
          >
            {m.categoriesAdd()}
          </Button>
        </div>
        {VIEWS.map((each) => (
          <TabsPanel key={each.value} value={each.value}>
            <CategoryList
              label={each.list}
              rows={rowsOf(tree, each.value).map(toRow)}
              emptyText={
                each.value === "archived" ? m.categoriesNoneArchived() : m.categoriesNoneOfKind()
              }
              locale={locale}
            />
          </TabsPanel>
        ))}
      </Tabs>
      <CreateCategoryDialog
        key={createKey}
        open={creating}
        onOpenChange={setCreating}
        initialKind={view === "income" ? "income" : "expense"}
        parentsOfKind={(kind) => parentsOf(tree, kind)}
        onCreate={async (input) => {
          const answer = await answerOf(() => createCategory({ data: input }));

          if (!answer.ok) {
            return answer;
          }

          setJustCreatedId(answer.id);
          setView(input.kind);
          await invalidateCategories(queryClient);

          return answer;
        }}
      />
      {action === undefined ? null : (
        <ActionDialog
          key={action.key}
          action={action.action}
          node={action.node}
          tree={tree}
          open={open}
          onOpenChange={setOpen}
          change={change}
          currency={currency}
        />
      )}
    </div>
  );
}

/** How a category's benchmark is written in its row: "automatic · €690", "set · €130", "none". */
function benchmarkOf(node: CategoryNode, currency: string, locale: string): string {
  const benchmark = node.benchmark;

  switch (benchmark.mode) {
    case "automatic": {
      const [only, ...others] = node.averageWithChildren;

      // A top-level category's benchmark is its average with its children's; a child's, its own,
      // already in the row. Several currencies are never added together.
      return node.parentId === null && only !== undefined && others.length === 0
        ? m.categoriesBenchmarkShownAutomaticAt({
            amount: formatMoney(only, { locale, whole: true }),
          })
        : m.categoriesBenchmarkShownAutomatic();
    }

    case "fixed":
      // As the user set it, to the cent.
      return m.categoriesBenchmarkShownFixed({
        amount: formatMoney({ minor: benchmark.minor, currency }, { locale }),
      });
    case "none":
      return m.categoriesBenchmarkShownNone();
  }
}

/** The dialog a row's menu opened: each asks for what its change needs, then makes it. */
function ActionDialog({
  action,
  node,
  tree,
  open,
  onOpenChange,
  change,
  currency,
}: {
  action: Action;
  node: CategoryNode;
  tree: CategoryTree;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  change: (call: () => Promise<CategoryAnswer>) => Promise<CategoryAnswer>;
  /** The user's currency, the one a set benchmark is in. */
  currency: string;
}) {
  const categoryId = node.id;
  const kind: EntryKind = node.kind;

  const edit = (patch: { name?: string; parentId?: string | null; benchmark?: Benchmark }) =>
    change(() => editCategory({ data: { categoryId, ...patch } }));

  switch (action) {
    case "rename":
      return (
        <RenameCategoryDialog
          open={open}
          onOpenChange={onOpenChange}
          name={node.name}
          onRename={(name) => edit({ name })}
        />
      );
    case "move":
      return (
        <MoveCategoryDialog
          open={open}
          onOpenChange={onOpenChange}
          name={node.name}
          parentId={node.parentId}
          parents={parentsOf(tree, kind, categoryId)}
          onMove={(parentId) => edit({ parentId })}
        />
      );
    case "merge":
      return (
        <MergeCategoryDialog
          open={open}
          onOpenChange={onOpenChange}
          name={node.name}
          targets={choicesOf(tree, kind, categoryId)}
          onMerge={(intoId) => change(() => mergeCategory({ data: { categoryId, intoId } }))}
        />
      );
    case "benchmark":
      return (
        <BenchmarkDialog
          open={open}
          onOpenChange={onOpenChange}
          name={node.name}
          benchmark={node.benchmark}
          currency={currency}
          onSave={(benchmark) => edit({ benchmark })}
        />
      );
    case "archive":
      return (
        <AlertDialog
          open={open}
          onOpenChange={onOpenChange}
          title={m.categoriesArchiveTitle({ name: node.name })}
          description={m.categoriesArchiveDescription()}
          confirmLabel={m.categoriesArchiveConfirm()}
          onConfirm={async () => {
            const answer = await change(() => archiveCategory({ data: { categoryId } }));

            if (!answer.ok) {
              notify.failed({
                description: categoryRefusalMessage(answer.code, answer.fallback),
              });
            }
          }}
        />
      );
  }
}
