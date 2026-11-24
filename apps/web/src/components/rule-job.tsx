import { m } from "@gousset/i18n/messages";
import type { RuleApplyView } from "@gousset/ui/components/rule-editor";
import { usePageLanguage } from "@gousset/ui/hooks/use-page-language";
import { notify } from "@gousset/ui/lib/notify";
import type { ProgressToast } from "@gousset/ui/lib/notify";
import { useEffect, useRef } from "react";

import { linesChanged } from "@/lib/rule-words";
import { useJob } from "@/queries/jobs";

// A rule applied to the past (#25) is a job ("apply-rule"), followed live like an import's: its end
// says how many lines it changed, and reads again what it touched (`useJob`, every month).

/** Where a rule applied to the past stands, from its job's stream; idle without a job. */
export function useRuleJob(jobId: string | undefined): RuleApplyView {
  const { view, gone } = useJob(jobId);

  if (jobId === undefined) {
    return { state: "idle" };
  }

  if (gone || view?.phase === "failed") {
    return { state: "failed" };
  }

  return view?.phase === "completed"
    ? { state: "done", changed: view.done ?? 0 }
    : { state: "running" };
}

/**
 * A rule applied to the past from a place that does not show the rule (a correction's proposal, a
 * new rule's sheet once closed): a toast follows its job, then says how many lines it changed.
 */
export function RuleJobNotice({ jobId }: { jobId: string }) {
  const apply = useRuleJob(jobId);
  const locale = usePageLanguage();
  const toast = useRef<ProgressToast>(undefined);
  const changed = apply.state === "done" ? apply.changed : null;

  useEffect(() => {
    // One toast for the job: made once, then resolved in place (a dismissed one stays closed).
    const shown =
      toast.current ?? notify.progress(`rule-job-${jobId}`, { title: m.rulesApplyingToast() });

    toast.current = shown;

    if (apply.state === "failed") {
      shown.fail({ description: m.ruleRefusalJobUnavailable() });
    } else if (changed !== null) {
      shown.succeed({ title: linesChanged(changed, locale) });
    }
  }, [jobId, apply.state, changed, locale]);

  return null;
}
