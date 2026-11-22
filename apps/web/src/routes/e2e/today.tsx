import { createFileRoute, notFound } from "@tanstack/react-router";
import { useSyncExternalStore } from "react";

import { e2eServerToday } from "../../lib/today.functions";

// The end-to-end harness's probe of the server's clock (apps/e2e/tests/server-clock.spec.ts):
// not found unless the harness started the app.
export const Route = createFileRoute("/e2e/today")({
  loader: async () => {
    const day = await e2eServerToday();

    if (day === null) {
      // oxlint-disable-next-line typescript/only-throw-error -- TanStack Router's not-found signal is a plain object it catches by design.
      throw notFound();
    }

    return { day };
  },
  component: TodayProbe,
});

// UTC on both sides, so that the server and the browser write the same month.
const MONTH = new Intl.DateTimeFormat("en", { month: "long", year: "numeric", timeZone: "UTC" });

const noSubscription = () => () => undefined;
const browserDay = () => new Date().toLocaleDateString("en-CA");
const noBrowserDay = () => null;

function TodayProbe() {
  const { day } = Route.useLoaderData();
  // The server and the hydration render nothing here; the browser's clock is read only after.
  const browser = useSyncExternalStore(noSubscription, browserDay, noBrowserDay);

  return (
    <main>
      <h1>Today</h1>
      <p data-testid="server-month">{MONTH.format(new Date(`${day}T00:00:00Z`))}</p>
      <p data-testid="server-day">{day}</p>
      {browser === null ? null : <p data-testid="browser-day">{browser}</p>}
    </main>
  );
}
