/**
 * Whether a broker's file lists its rows newest first, from the days of its rows in file order: its
 * days step down from one row to the next more often than they step up, two rows of one day being
 * no step. Read from the whole file rather than its two ends, so that one row out of place (a late
 * correction at the end of a file listed oldest first) does not turn the file around. A file of one
 * day, or as many steps down as up, keeps its order.
 */
export function listsNewestFirst(days: ReadonlyArray<string>): boolean {
  let down = 0;
  let up = 0;

  for (const [index, day] of days.entries()) {
    const before = days[index - 1];

    if (before !== undefined && day < before) {
      down += 1;
    } else if (before !== undefined && day > before) {
      up += 1;
    }
  }

  return down > up;
}
