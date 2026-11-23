import { Effect, Stream } from "effect";

import { JobQueue } from "./queue.server";
import { isOver, sameView } from "./view";
import type { JobView } from "./view";

/**
 * How often the stream reads the job's row again while no attempt of this process runs it: a job
 * waiting for a worker, resumed after a restart, or failed by pg-boss itself.
 */
const RECONCILE_EVERY = "1 second";

/** A comment line now and then, so that no proxy closes a stream that waits. */
const KEEPALIVE_EVERY = "15 seconds";

/** How long the browser waits before connecting again when the stream drops (a restart). */
const RECONNECT_MS = 1000;

/** One view, as a Server-Sent Event. */
const event = (view: JobView) => `data: ${JSON.stringify(view)}\n\n`;

/**
 * How many streams one user may hold open at once: each reads the database every second while its
 * job waits. A screen follows a few imports at a time; more is a page left open many times over.
 */
export const STREAMS_PER_USER = 8;

/** The streams open in this process, by user. */
const openStreams = new Map<string, number>();

function release(owner: string) {
  const left = (openStreams.get(owner) ?? 1) - 1;

  if (left <= 0) {
    openStreams.delete(owner);
  } else {
    openStreams.set(owner, left);
  }
}

/**
 * A job's views as Server-Sent Events, for the page that follows it: where it stands now, then
 * each change, until it is over. `null` when `owner` has no job with this id, `"busy"` when they
 * already hold `STREAMS_PER_USER` streams. Each change of an attempt this process runs is pushed at
 * once; the row is read again every second otherwise.
 */
export const jobEvents = (id: string, owner: string) =>
  Effect.gen(function* () {
    const queue = yield* JobQueue;

    if ((openStreams.get(owner) ?? 0) >= STREAMS_PER_USER) {
      return "busy" as const;
    }

    const first = yield* queue.view(id, owner);

    if (first === null) {
      return null;
    }

    openStreams.set(owner, (openStreams.get(owner) ?? 0) + 1);

    // A row that cannot be read for a moment, or that retention removed, keeps the last view sent.
    let last = first;

    const now = Effect.suspend(() =>
      queue.view(id, owner).pipe(
        Effect.map((view) => view ?? last),
        Effect.orElseSucceed(() => last),
      ),
    );

    const views = Stream.concat(
      Stream.make(first),
      Stream.merge(
        Stream.fromPubSub(queue.changes).pipe(Stream.filter((view) => view.id === id)),
        Stream.tick(RECONCILE_EVERY).pipe(Stream.mapEffect(() => now)),
      ),
    ).pipe(
      Stream.changesWith(sameView),
      Stream.tap((view) =>
        Effect.sync(() => {
          last = view;
        }),
      ),
      Stream.takeUntil(isOver),
    );

    // Ended, or cut by the browser: the stream no longer counts.
    const released = Stream.ensuring(
      views,
      Effect.sync(() => release(owner)),
    );

    const lines = Stream.concat(
      Stream.make(`retry: ${RECONNECT_MS}\n\n`),
      Stream.merge(
        released.pipe(Stream.map(event)),
        Stream.tick(KEEPALIVE_EVERY).pipe(
          Stream.drop(1),
          Stream.map(() => ": keepalive\n\n"),
        ),
        { haltStrategy: "left" },
      ),
    );

    return yield* Stream.toReadableStreamEffect(Stream.encodeText(lines));
  });
