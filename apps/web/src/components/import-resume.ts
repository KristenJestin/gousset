import type { ImportSummary as Import, ProfileChoice } from "@gousset/core/imports";
import type { CsvProfile } from "@gousset/import";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { resumeImport } from "@/functions/imports";
import { importFailureMessage } from "@/i18n/imports";
import { importKeys } from "@/queries/imports";

/** The imports' rows are read again: an import moved on. */
export function useRefreshImports() {
  const queryClient = useQueryClient();

  return () => queryClient.invalidateQueries({ queryKey: importKeys.all });
}

/**
 * Runs the import again with the user's answers: its account, how to read its CSV (a definition
 * made on the screen, or a profile chosen, which the import then records).
 */
export function useResume(summary: Import) {
  const refresh = useRefreshImports();
  const [refused, setRefused] = useState<string>();

  const resume = async (
    accountId: string | null,
    csvProfile: CsvProfile | null,
    profile: ProfileChoice | null = null,
  ) => {
    const answer = await resumeImport({
      data: { importId: summary.id, accountId, csvProfile, profile },
    });

    if ("refused" in answer) {
      setRefused(importFailureMessage(answer.refused));
    } else {
      setRefused(undefined);
    }

    await refresh();
  };

  return { resume, refused };
}
