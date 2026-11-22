/** A result's text stays under this by default (docs/mcp.md, "Results and errors"). */
export const RESULT_LIMIT = 20_000;

/** An error's text stays under this. */
export const ERROR_LIMIT = 2000;

/** The line that ends a page but the last, saying how to read on. */
const footer = (part: number, parts: number, call: string) =>
  `\n\n(Part ${part} of ${parts}. Read on with: ${call})`;

/** The pages of a text, cut between lines, each at most `room` long. */
function pagesOf(text: string, room: number): Array<string> {
  const pages: Array<string> = [];
  let page = "";

  for (const line of text.split("\n")) {
    // A single line longer than a page is cut where it must be.
    for (let start = 0; start < Math.max(line.length, 1); start += room) {
      const piece = line.slice(start, start + room);
      const joined = page === "" ? piece : `${page}\n${piece}`;

      if (joined.length > room && page !== "") {
        pages.push(page);
        page = piece;
      } else {
        page = joined;
      }
    }
  }

  pages.push(page);

  return pages;
}

export type Page = { text: string } | { outOfRange: number };

/**
 * The part of a result the call asks for. A text over the limit is cut into pages; each page but
 * the last ends with the call that reads the next one, written in full.
 *
 * The cursor is the page's number: the call is made again, which reads the same data unless it
 * changed in between.
 */
export function pageOf(
  text: string,
  cursor: string | undefined,
  nextCall: (cursor: string) => string,
  limit = RESULT_LIMIT,
): Page {
  if (text.length <= limit && cursor === undefined) {
    return { text };
  }

  // The room a footer takes, measured on the call it writes (its cursor at its longest), so that
  // a long call never pushes a page over the limit.
  const footerRoom = footer(99_999, 99_999, nextCall("99999")).length;
  const pages = pagesOf(text, Math.max(limit - footerRoom, 1));
  const index = cursor === undefined ? 0 : Number(cursor) - 1;
  const page = pages[index];

  if (!Number.isInteger(index) || page === undefined) {
    return { outOfRange: pages.length };
  }

  if (index === pages.length - 1) {
    return {
      text:
        pages.length === 1 ? page : `${page}\n\n(Part ${index + 1} of ${pages.length}, the last.)`,
    };
  }

  const next = String(index + 2);

  return {
    text: `${page}${footer(index + 1, pages.length, nextCall(next))}`,
  };
}

/** An error's text: what went wrong, what to do, and a valid call; never over its limit. */
export function errorText(message: string, example: string | undefined): string {
  const tail = example === undefined ? "" : `\nA valid call: ${example}`;
  const room = ERROR_LIMIT - tail.length;
  const cut = message.length > room ? `${message.slice(0, room - 1)}…` : message;

  return `${cut}${tail}`;
}
