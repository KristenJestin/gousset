import handler from "@tanstack/react-start/server-entry";

import { startJobs } from "./jobs/runtime.server";

// TanStack Start's own server entry, with the job queue started beside it: as soon as the server
// loads the app (`src/boot.nitro.ts` has it load at boot), not at the first request of a visitor.
startJobs();

export default handler;
