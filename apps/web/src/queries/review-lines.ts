import type { LineToReview, LinesToReview } from "@gousset/core";

/** The lines to review without one line, and where it was. */
export function withoutLine(list: LinesToReview, lineId: string) {
  const index = list.lines.findIndex((line) => line.id === lineId);
  const lines = list.lines.filter((line) => line.id !== lineId);

  return { list: { ...list, lines, count: lines.length }, line: list.lines[index], index };
}

/**
 * The lines to review with one line put back where it was, as they stand now: other approvals
 * made meanwhile stay as they are. A line already there is not added twice.
 */
export function withLineBack(
  list: LinesToReview,
  line: LineToReview,
  index: number,
): LinesToReview {
  if (list.lines.some((candidate) => candidate.id === line.id)) {
    return list;
  }

  const lines = list.lines.toSpliced(Math.min(index, list.lines.length), 0, line);

  return { ...list, lines, count: lines.length };
}
