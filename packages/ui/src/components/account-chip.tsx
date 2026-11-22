import { useUiMessages } from "../hooks/use-ui-messages";
import { cn } from "../lib/utils";
import { Icon } from "./icon";

/** What kind of account it is, which sets its icon. */
export type AccountChipKind = "bank" | "savings" | "card" | "wallet";

export type AccountChipProps = {
  /** The account's name, as the user calls it ("MealCard"). */
  name: string;
  kind: AccountChipKind;
  /** In a filter: this account is one of those chosen. */
  selected?: boolean;
  /** In a filter: a small cross that takes the account out; its label says which. */
  onRemove?: () => void;
};

/**
 * An account's name with its kind's icon, small ("Paid with: MealCard"). In a filter it may be
 * selected, and removable with its own button.
 *
 * Motion: the remove button's colours change in 150 ms; cut under reduced motion.
 */
export function AccountChip({ name, kind, selected = false, onRemove }: AccountChipProps) {
  const messages = useUiMessages();

  return (
    <span
      data-slot="account-chip"
      data-selected={selected || undefined}
      className={cn(
        "inline-flex h-6 max-w-full items-center gap-1 rounded-full pl-2 text-xs font-medium",
        onRemove === undefined ? "pr-2.5" : "pr-0.5",
        selected ? "bg-primary/10 text-primary" : "bg-muted text-foreground",
      )}
    >
      <Icon name={kind} size="sm" />
      <span className="truncate">{name}</span>
      {onRemove === undefined ? null : (
        <button
          type="button"
          aria-label={messages.pieces.remove(name)}
          onClick={onRemove}
          className="grid size-5 shrink-0 cursor-pointer place-items-center rounded-full transition-colors duration-150 ease-out hover:bg-foreground/10"
        >
          <Icon name="close" size="sm" />
        </button>
      )}
    </span>
  );
}
