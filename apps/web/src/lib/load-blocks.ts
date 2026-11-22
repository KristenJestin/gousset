import { noop } from "@tanstack/react-query";
import { createIsomorphicFn } from "@tanstack/react-start";

/**
 * Starts a page's block queries from its loader (docs/architecture.md, "Data loading and
 * skeletons"). On the server the page waits for them, so the first visit is rendered filled in,
 * with no skeleton. In the browser it does not wait: the page opens at once and each block waits
 * in its own skeleton, unless the data came with the link's preload (hover or focus).
 *
 * Every query is settled, failed or not: a failure stays in its block, never the whole page's.
 */
export const loadBlocks = createIsomorphicFn()
  .server(async (queries: ReadonlyArray<Promise<void>>) => {
    await Promise.allSettled(queries);
  })
  .client((queries: ReadonlyArray<Promise<void>>) => {
    for (const query of queries) {
      query.catch(noop);
    }
  });
