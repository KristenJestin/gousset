import type { ReactNode } from "react";

import { useUiMessages } from "../hooks/use-ui-messages";
import type { AccountTrackingMode } from "./accounts-overview";
import { Skeleton } from "./skeleton";

function SettingsRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="truncate font-medium text-foreground">{value}</dd>
    </div>
  );
}

export type AccountSettingsProps = {
  /** Already worded by the page ("Current account", "Life insurance"): the account's kind. */
  kind: string;
  tracking: AccountTrackingMode;
  /** An ISO 4217 code ("EUR"), shown as given. */
  currency: string;
  /** Already worded ("14 May 2018"); `null` or left out for unknown. */
  openedOn?: string | null;
  institution?: string;
  /** A card's deferred-debit account, as the user names it; left out for every other kind. */
  settlesInto?: string;
  /** The "Edit" action, opening the account's form. */
  action?: ReactNode;
};

/**
 * An account's settings, read only (docs/wireframes, screen 7, block 4): its kind, how it is
 * tracked, its currency, when it was opened, its institution and, for a card, what it settles
 * into. `action` holds the "Edit" button that opens the form.
 */
export function AccountSettings({
  kind,
  tracking,
  currency,
  openedOn,
  institution,
  settlesInto,
  action,
}: AccountSettingsProps) {
  const messages = useUiMessages().accounts;
  const notSet = messages.settingsNotSet;

  return (
    <div className="flex flex-col gap-3">
      {action === undefined ? null : <div className="flex justify-end">{action}</div>}
      <dl className="flex flex-col gap-2">
        <SettingsRow label={messages.settingsKind} value={kind} />
        <SettingsRow
          label={messages.settingsTracking}
          value={tracking === "lines" ? messages.trackingLines : messages.trackingBalance}
        />
        <SettingsRow label={messages.settingsCurrency} value={currency} />
        <SettingsRow label={messages.settingsOpenedOn} value={openedOn ?? notSet} />
        <SettingsRow label={messages.settingsInstitution} value={institution ?? notSet} />
        {settlesInto === undefined ? null : (
          <SettingsRow label={messages.settingsSettlesInto} value={settlesInto} />
        )}
      </dl>
    </div>
  );
}

/** `AccountSettings` on its way: as many rows as the loaded block has. */
export function AccountSettingsSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-2">
      {Array.from({ length: rows }, (_, row) => (
        <div key={row} className="flex h-5 items-center justify-between gap-4">
          <Skeleton className="h-3.5 w-20" />
          <Skeleton className="h-3.5 w-28" />
        </div>
      ))}
    </div>
  );
}
