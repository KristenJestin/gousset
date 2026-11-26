// The dense pure logic of the subjects (v0.5, #37; docs/vision.md, "Subjects"): their tree, the
// walk that refuses a cycle, and the counting rule every read of a subject's cost follows, the
// subject's page, its list and the month's "by subject" alike:
//
// - a subject's cost is the distinct expenses attached to it or to any of its descendants, so an
//   expense on House and on Garden shed counts once in House;
// - each at its net cost: its payments less its refunds, per currency of its lines' accounts, as
//   the month counts it;
// - placed by the day it happened (`entry.happened_on`);
// - an expense on several subjects counts whole in each, so subjects' totals never add up;
// - only the user's currency is summed; other currencies are given apart, never converted.

/** A subject as an expense or a line names it. */
export type SubjectName = { readonly id: string; readonly name: string };

/** A subject as its tree reads it. */
export type SubjectNode = {
  readonly id: string;
  /** Null for a top-level subject. */
  readonly parentId: string | null;
  readonly name: string;
};

/** A part of an expense (a payment or a refund), with its entry and its line's currency. */
export type CostPart = {
  readonly entryId: string;
  readonly happenedOn: string;
  readonly categoryId: string;
  readonly role: "payment" | "refund";
  /** Positive, the way its role says. */
  readonly amountMinor: number;
  readonly currency: string;
};

/** An expense at its net cost in one currency (an expense's parts share one), with its subjects. */
export type SubjectCost = {
  readonly entryId: string;
  readonly happenedOn: string;
  readonly categoryId: string;
  readonly currency: string;
  /** Payments less refunds, in minor units. */
  readonly minor: number;
  /** The subjects it is attached to itself, not their parents. */
  readonly subjectIds: ReadonlyArray<string>;
};

const byName = (a: SubjectNode, b: SubjectNode) =>
  a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) ||
  a.name.localeCompare(b.name) ||
  a.id.localeCompare(b.id);

/** Each subject's children, by name. */
function childrenOf<Node extends SubjectNode>(
  nodes: ReadonlyArray<Node>,
): ReadonlyMap<string | null, ReadonlyArray<Node>> {
  const children = new Map<string | null, Array<Node>>();

  for (const node of nodes) {
    const known = children.get(node.parentId);

    if (known === undefined) {
      children.set(node.parentId, [node]);
    } else {
      known.push(node);
    }
  }

  for (const siblings of children.values()) {
    siblings.sort(byName);
  }

  return children;
}

/**
 * The subjects in tree order: each parent before its children, siblings by name (any case), each
 * with its depth, 0 at the top. A subject whose parent is not among them is left out, with its
 * descendants: the database keeps every parent, so none is.
 */
export function treeOrder<Node extends SubjectNode>(
  nodes: ReadonlyArray<Node>,
): ReadonlyArray<Node & { readonly depth: number }> {
  const children = childrenOf(nodes);
  const ordered: Array<Node & { readonly depth: number }> = [];
  const seen = new Set<string>();

  const visit = (parentId: string | null, depth: number) => {
    for (const node of children.get(parentId) ?? []) {
      // A cycle the database let through cannot loop the walk.
      if (!seen.has(node.id)) {
        seen.add(node.id);
        ordered.push({ ...node, depth });
        visit(node.id, depth + 1);
      }
    }
  };

  visit(null, 0);

  return ordered;
}

/**
 * A subject's name with its ancestors', the top first: "House > Garden shed", as a name alone is not
 * enough where subjects are chosen (a name holds no `>`). Its own name when its parents are not
 * among `nodes`.
 */
export function pathOf(nodes: ReadonlyArray<SubjectNode>, id: string): string {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const names: Array<string> = [];
  const walked = new Set<string>();

  for (let at = byId.get(id); at !== undefined && !walked.has(at.id);) {
    walked.add(at.id);
    names.unshift(at.name);
    at = at.parentId === null ? undefined : byId.get(at.parentId);
  }

  return names.join(" > ");
}

/** A subject and every one of its descendants, at any depth. */
export function subtreeOf(nodes: ReadonlyArray<SubjectNode>, id: string): ReadonlySet<string> {
  const children = childrenOf(nodes);
  const subtree = new Set<string>([id]);
  const waiting = [id];

  for (let next = waiting.pop(); next !== undefined; next = waiting.pop()) {
    for (const child of children.get(next) ?? []) {
      if (!subtree.has(child.id)) {
        subtree.add(child.id);
        waiting.push(child.id);
      }
    }
  }

  return subtree;
}

/**
 * Whether putting `id` under `parentId` makes a cycle: the parent is the subject itself, or one of
 * its descendants, which the walk up from the new parent through its ancestors meets. A top-level
 * place (null) never does.
 */
export function makesCycle(
  nodes: ReadonlyArray<SubjectNode>,
  id: string,
  parentId: string | null,
): boolean {
  const parents = new Map(nodes.map((node) => [node.id, node.parentId]));
  const walked = new Set<string>();

  for (let at = parentId; at !== null; at = parents.get(at) ?? null) {
    if (at === id) {
      return true;
    }

    // A loop already there (none, the walk being in every move's transaction) ends the walk.
    if (walked.has(at)) {
      return false;
    }

    walked.add(at);
  }

  return false;
}

/**
 * Each expense's net cost per currency of its lines' accounts, with the subjects it is attached to
 * (`subjectsOf`, by entry): payments less refunds. In the order the expenses come.
 */
export function costsOf(
  parts: ReadonlyArray<CostPart>,
  subjectsOf: ReadonlyMap<string, ReadonlyArray<string>>,
): ReadonlyArray<SubjectCost> {
  const costs = new Map<string, SubjectCost>();

  for (const part of parts) {
    const key = JSON.stringify([part.entryId, part.currency]);
    const signed = part.role === "payment" ? part.amountMinor : -part.amountMinor;
    const known = costs.get(key);

    costs.set(key, {
      entryId: part.entryId,
      happenedOn: part.happenedOn,
      categoryId: part.categoryId,
      currency: part.currency,
      minor: (known?.minor ?? 0) + signed,
      subjectIds: subjectsOf.get(part.entryId) ?? [],
    });
  }

  return [...costs.values()];
}

/**
 * The expenses a subject counts, whose subtree is `subtree` (`subtreeOf`): those attached to any
 * subject of it, each once, however many of them it is attached to.
 */
export function countedIn<Cost extends Pick<SubjectCost, "subjectIds">>(
  costs: ReadonlyArray<Cost>,
  subtree: ReadonlySet<string>,
): ReadonlyArray<Cost> {
  return costs.filter((cost) => cost.subjectIds.some((id) => subtree.has(id)));
}

/** What expenses sum to in the user's currency, and in each other one, never converted. */
export type CurrencySums = {
  readonly own: number;
  /** By currency code, those that sum to nothing left out. */
  readonly elsewhere: ReadonlyArray<readonly [string, number]>;
};

/** What `costs` sum to, per currency, the user's apart from the others. */
export function sumsOf(
  costs: ReadonlyArray<Pick<SubjectCost, "currency" | "minor">>,
  currency: string,
): CurrencySums {
  const sums = new Map<string, number>();

  for (const cost of costs) {
    sums.set(cost.currency, (sums.get(cost.currency) ?? 0) + cost.minor);
  }

  return {
    own: sums.get(currency) ?? 0,
    elsewhere: [...sums]
      .filter(([other, minor]) => other !== currency && minor !== 0)
      .toSorted(([a], [b]) => a.localeCompare(b)),
  };
}

/** The month after `month`, both `YYYY-MM`. */
function nextMonth(month: string): string {
  const year = Number(month.slice(0, 4));
  const index = Number(month.slice(5, 7));

  return index === 12
    ? `${String(year + 1).padStart(4, "0")}-01`
    : `${month.slice(0, 4)}-${String(index + 1).padStart(2, "0")}`;
}

/**
 * The months a subject's cost per month gives, `YYYY-MM`: those of the period (`from` its first,
 * null for all time) up to today's month (`to`, the period's last when it ends before), starting no
 * earlier than the subject's first expense (`first`). None without an expense, or when the first
 * comes after the period.
 */
export function monthsOf(
  from: string | null,
  to: string,
  first: string | null,
): ReadonlyArray<string> {
  if (first === null) {
    return [];
  }

  const months: Array<string> = [];

  for (
    let month = from === null || first > from ? first : from;
    month <= to;
    month = nextMonth(month)
  ) {
    months.push(month);
  }

  return months;
}
