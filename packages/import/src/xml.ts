import { Effect } from "effect";

import { MalformedFile, UnsupportedContent } from "./errors";
import { decodeEntities, quote } from "./text";

// A small XML reader for CAMT.053, kept here rather than taken from a library: a statement needs
// elements, attributes, text, entities and CDATA, and nothing a library adds would be used. It reads
// no document type declaration (refused, so no entity can be defined, let alone expanded), caps how
// deep elements nest, and visits each character of the file a bounded number of times.

/** An XML element: what a CAMT.053 statement is made of. */
export type XmlElement = {
  /** Its local name, the namespace prefix dropped (`camt:Ntry` is `Ntry`). */
  name: string;
  /** The file line its opening tag stands on. */
  line: number;
  /** Its attributes by local name, entities decoded. */
  attributes: Map<string, string>;
  /** The text it holds, entities decoded and CDATA sections read as written, not trimmed. */
  text: string;
  children: Array<XmlElement>;
};

/**
 * How deep elements may nest. A CAMT.053 statement nests about twelve deep; a deeper file is no
 * statement, and refusing it keeps the reader's recursion short.
 */
const MAX_DEPTH = 64;

const CDATA_START = "<![CDATA[";

function countNewlines(text: string, from: number, to: number): number {
  let count = 0;

  for (let at = from; at < to; at += 1) {
    if (text.charCodeAt(at) === 10) {
      count += 1;
    }
  }

  return count;
}

/** Where the tag that starts before `from` ends: its `>`, not one inside a quoted attribute value. */
function tagEnd(text: string, from: number): number {
  let quoteMark = "";

  for (let at = from; at < text.length; at += 1) {
    const character = text.charAt(at);

    if (quoteMark !== "") {
      quoteMark = character === quoteMark ? "" : quoteMark;
    } else if (character === '"' || character === "'") {
      quoteMark = character;
    } else if (character === ">") {
      return at;
    }
  }

  return -1;
}

function localName(qualified: string): string {
  return qualified.slice(qualified.lastIndexOf(":") + 1);
}

function isSpace(character: string): boolean {
  return character === " " || character === "\t" || character === "\n" || character === "\r";
}

/**
 * A tag's attributes, `name="value"` or `name='value'`, scanned once from left to right: a regex
 * would backtrack over a long run of characters with no `=` after them, in time quadratic in the
 * tag's length. What is no attribute is read past.
 */
function readAttributes(written: string): Map<string, string> {
  const attributes = new Map<string, string>();
  let at = 0;

  const skipSpaces = () => {
    while (at < written.length && isSpace(written.charAt(at))) {
      at += 1;
    }
  };

  while (at < written.length) {
    skipSpaces();

    const nameStart = at;

    while (at < written.length && !isSpace(written.charAt(at)) && written.charAt(at) !== "=") {
      at += 1;
    }

    const name = written.slice(nameStart, at);

    skipSpaces();

    if (written.charAt(at) !== "=") {
      continue;
    }

    at += 1;
    skipSpaces();

    const quoteMark = written.charAt(at);

    if (quoteMark !== '"' && quoteMark !== "'") {
      continue;
    }

    const end = written.indexOf(quoteMark, at + 1);

    if (end === -1) {
      break;
    }

    if (name !== "") {
      attributes.set(localName(name), decodeEntities(written.slice(at + 1, end)));
    }

    at = end + 1;
  }

  return attributes;
}

/**
 * How many elements a file may hold. A year of a bank's daily statements is some tens of thousands
 * of elements; a million is no statement, and refusing more keeps the reader's memory well under
 * the engine's heap, which a file of 64 MiB of `<a/>` would pass.
 */
const MAX_ELEMENTS = 1_000_000;

/** How many tags may open an element: every `<` but those of closing tags, comments, declarations. */
function countOpeningTags(text: string): number {
  let count = 0;
  let at = text.indexOf("<");

  while (at !== -1) {
    const next = text.charAt(at + 1);

    count += next === "/" || next === "!" || next === "?" ? 0 : 1;
    at = text.indexOf("<", at + 1);
  }

  return count;
}

/**
 * The file's document element; `undefined` when the file holds none. Its lines end in `\n` alone.
 * A file that breaks XML's structure is `MalformedFile`, naming the line; a document type
 * declaration, or more than a million elements, is `UnsupportedContent`.
 */
export const readXml = (text: string) =>
  Effect.gen(function* () {
    // Counted before any element is made, so that refusing costs no memory.
    if (countOpeningTags(text) > MAX_ELEMENTS) {
      return yield* new UnsupportedContent({
        line: 1,
        problem: "More than a million elements: no statement holds that many.",
      });
    }

    const open: Array<XmlElement> = [];
    let document: XmlElement | undefined;
    let line = 1;
    let position = 0;

    /** Moves past what lies before `to`, counting its lines. */
    const advance = (to: number) => {
      line += countNewlines(text, position, to);
      position = to;
    };

    while (position < text.length) {
      const nextTag = text.indexOf("<", position);
      const textEnd = nextTag === -1 ? text.length : nextTag;
      const holder = open.at(-1);
      const between = text.slice(position, textEnd);

      if (holder !== undefined) {
        holder.text += decodeEntities(between);
      } else if (between.trim() !== "") {
        const valueLine = line + countNewlines(between, 0, between.search(/\S/));

        return yield* new MalformedFile({
          line: valueLine,
          problem: "Text outside the document's element.",
        });
      }

      advance(textEnd);

      if (nextTag === -1) {
        break;
      }

      if (text.startsWith("<!--", position)) {
        const end = text.indexOf("-->", position + 4);

        if (end === -1) {
          return yield* new MalformedFile({ line, problem: "A comment is never closed by `-->`." });
        }

        advance(end + 3);

        continue;
      }

      if (text.startsWith(CDATA_START, position)) {
        const end = text.indexOf("]]>", position);

        if (end === -1) {
          return yield* new MalformedFile({
            line,
            problem: "A CDATA section is never closed by `]]>`.",
          });
        }

        if (holder === undefined) {
          return yield* new MalformedFile({
            line,
            problem: "Text outside the document's element.",
          });
        }

        holder.text += text.slice(position + CDATA_START.length, end);
        advance(end + 3);

        continue;
      }

      if (text.startsWith("<!", position)) {
        return yield* new UnsupportedContent({
          line,
          problem:
            "A document type declaration (`<!DOCTYPE`): no statement has one, and none is read.",
        });
      }

      if (text.startsWith("<?", position)) {
        const end = text.indexOf("?>", position + 2);

        if (end === -1) {
          return yield* new MalformedFile({
            line,
            problem: "A processing instruction is never closed by `?>`.",
          });
        }

        advance(end + 2);

        continue;
      }

      const end = tagEnd(text, position + 1);
      const tagLine = line;

      if (end === -1) {
        return yield* new MalformedFile({ line, problem: "A tag is never closed by `>`." });
      }

      const tag = text.slice(position + 1, end);

      advance(end + 1);

      if (tag.startsWith("/")) {
        const name = localName(tag.slice(1).trim());

        if (holder === undefined) {
          return yield* new MalformedFile({
            line: tagLine,
            problem: `${quote(`</${name}>`)} closes no open element.`,
          });
        }

        if (holder.name !== name) {
          return yield* new MalformedFile({
            line: tagLine,
            problem: `${quote(`</${name}>`)} where ${quote(`</${holder.name}>`)} was expected, for the element opened on line ${String(holder.line)}.`,
          });
        }

        open.pop();

        continue;
      }

      const selfClosing = tag.endsWith("/");
      const body = selfClosing ? tag.slice(0, -1) : tag;
      const qualified = /^[^\s/>]+/.exec(body)?.[0] ?? "";

      if (qualified === "") {
        return yield* new MalformedFile({ line: tagLine, problem: "A tag without a name." });
      }

      const element: XmlElement = {
        name: localName(qualified),
        line: tagLine,
        attributes: readAttributes(body.slice(qualified.length)),
        text: "",
        children: [],
      };

      if (holder !== undefined) {
        holder.children.push(element);
      } else if (document === undefined) {
        document = element;
      } else {
        return yield* new MalformedFile({
          line: tagLine,
          problem: "A second document element: an XML file holds one.",
        });
      }

      if (!selfClosing) {
        open.push(element);
      }

      if (open.length > MAX_DEPTH) {
        return yield* new MalformedFile({
          line: tagLine,
          problem: `Elements nested more than ${String(MAX_DEPTH)} deep: no statement is.`,
        });
      }
    }

    const unclosed = open.at(-1);

    if (unclosed !== undefined) {
      return yield* new MalformedFile({
        line,
        problem: `The file ends before ${quote(`</${unclosed.name}>`)}: it may have been cut short.`,
      });
    }

    return document;
  });
