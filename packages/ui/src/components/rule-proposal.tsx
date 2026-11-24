import { useState } from "react";

import { usePageLanguage } from "../hooks/use-page-language";
import { useUiMessages } from "../hooks/use-ui-messages";
import { formatCount } from "../lib/count";
import { Button } from "./button";
import { Checkbox } from "./checkbox";
import { Dialog } from "./dialog";
import { FormMessage } from "./form-message";
import { TextField } from "./text-field";

/** What the user accepted: the words the label contains, and whether to apply it to the past. */
export type RuleProposalAnswer = {
  words: string;
  applyToPast: boolean;
};

/**
 * What the rule sets, one or the other: the category the line was put in, by its path ("Food ›
 * Groceries"), or the merchant a line paid through an intermediary was given ("Pixelplay").
 */
export type RuleProposalSets =
  | { category: string; merchant?: undefined }
  | { merchant: string; category?: undefined };

export type RuleProposalProps = RuleProposalSets & {
  open: boolean;
  /** Closing it (Cancel, Escape, a press outside) changes nothing. */
  onOpenChange: (open: boolean) => void;
  /** The words offered at first: the line's cleaned label. */
  words: string;
  /** Each change of the words, for the page to count the lines again. */
  onWordsChange?: (words: string) => void;
  /** How many lines already there it would change; none while unknown. */
  reach: number | null;
  /** The longest piece of label a rule may look for: the server's limit. */
  maxLabelText: number;
  /** Makes the rule; the page says a refusal with `error`. */
  onCreate: (answer: RuleProposalAnswer) => Promise<void>;
  error?: string;
  /** The page's language (`<html lang>`) unless given. */
  locale?: string;
};

/**
 * A correction proposes a rule (#25): once a line's category is changed, "Make it a rule?" offers
 * "label contains" the line's cleaned label words, editable, for the category chosen, and to apply
 * it to the lines already there that it would change. Cancel leaves everything as it was. Once
 * the merchant of a line paid through an intermediary is chosen (#30), it proposes the same for
 * that merchant (`merchant` in place of `category`): "label contains PAYPAL *PIXELPLAY" gives
 * Pixelplay.
 *
 * Motion: as `Dialog`, it fades and grows in 200 ms, ease-out, and leaves the same way. Cut under
 * reduced motion.
 */
export function RuleProposal({
  open,
  onOpenChange,
  category,
  merchant,
  words: offered,
  onWordsChange,
  reach,
  maxLabelText,
  onCreate,
  error,
  locale,
}: RuleProposalProps) {
  const messages = useUiMessages().rules;
  const pageLocale = usePageLanguage();
  const writtenIn = locale ?? pageLocale;
  const [words, setWords] = useState(offered);
  const [applyToPast, setApplyToPast] = useState(true);
  const [busy, setBusy] = useState(false);

  const create = async () => {
    setBusy(true);

    try {
      await onCreate({ words: words.trim(), applyToPast: applyToPast && (reach ?? 0) > 0 });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      title={messages.proposal.title}
      description={
        merchant === undefined
          ? messages.proposal.description(category)
          : messages.proposal.descriptionMerchant(merchant)
      }
      open={open}
      onOpenChange={onOpenChange}
      onSubmit={(event) => {
        event.preventDefault();
        void create();
      }}
      actions={
        <Button type="submit" loading={busy}>
          {messages.proposal.create}
        </Button>
      }
    >
      <div data-slot="rule-proposal" className="flex flex-col gap-4">
        <TextField
          label={messages.proposal.label}
          value={words}
          maxLength={maxLabelText}
          autoComplete="off"
          required
          onChange={(event) => {
            setWords(event.target.value);
            onWordsChange?.(event.target.value);
          }}
        />
        {reach !== null && reach > 0 ? (
          <Checkbox
            label={messages.proposal.apply(reach, formatCount(reach, writtenIn))}
            checked={applyToPast}
            onCheckedChange={setApplyToPast}
          />
        ) : null}
        <FormMessage message={error} />
      </div>
    </Dialog>
  );
}
