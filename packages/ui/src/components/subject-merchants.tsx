import { usePageLanguage } from "../hooks/use-page-language";
import { useUiMessages } from "../hooks/use-ui-messages";
import { formatCount } from "../lib/count";
import { Chip } from "./chip";

export type SubjectMerchantsProps = {
  /** The merchants whose rule attaches the subject's expenses, by name. */
  merchants: ReadonlyArray<string>;
  /** How many other rules attach it. */
  otherRules?: number;
  /** The page's language (`<html lang>`) unless given. */
  locale?: string;
};

/**
 * What attaches a subject's expenses on its own (docs/wireframes, screen 5, block 4): the
 * merchants whose expenses land in it, one chip each, and how many other rules attach it; a
 * sentence when nothing does.
 */
export function SubjectMerchants({ merchants, otherRules = 0, locale }: SubjectMerchantsProps) {
  const messages = useUiMessages().subjects;
  const pageLocale = usePageLanguage();
  const writtenIn = locale ?? pageLocale;

  if (merchants.length === 0 && otherRules === 0) {
    return (
      <p data-slot="subject-merchants" className="text-sm text-muted-foreground">
        {messages.merchantsNone}
      </p>
    );
  }

  return (
    <div data-slot="subject-merchants" className="flex flex-col gap-2">
      {merchants.length === 0 ? null : (
        <ul className="flex flex-wrap gap-2">
          {merchants.map((merchant) => (
            <li key={merchant} className="flex">
              <Chip>{merchant}</Chip>
            </li>
          ))}
        </ul>
      )}
      {otherRules === 0 ? null : (
        <p className="text-xs text-muted-foreground">
          {messages.otherRules(otherRules, formatCount(otherRules, writtenIn))}
        </p>
      )}
    </div>
  );
}
