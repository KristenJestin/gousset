import {
  Combobox as ComboboxPart,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxItemIcon,
  ComboboxItemIndicator,
  ComboboxList,
  ComboboxTrigger,
} from "@ui-sdk/react/combobox";
import type { ListAnnouncement } from "@ui-sdk/react/select";
import { useState } from "react";

import { useUiMessages } from "../hooks/use-ui-messages";
import { controlClasses, groupFocusRing, itemClasses, popupClasses } from "../lib/form-classes";
import type { UiMessages } from "../lib/messages";
import { cn } from "../lib/utils";
import { Icon } from "./icon";
import { ChoiceIcon } from "./select";
import type { ChoiceItem } from "./select";
import { FormField } from "./text-field";
import type { FieldProps } from "./text-field";

export type ComboboxProps = FieldProps & {
  items: ReadonlyArray<ChoiceItem>;
  /** What the empty input says, like "Search a category". */
  placeholder?: string;
  /** The chosen value, to control it; `null` for none. */
  value?: string | null;
  /** The value chosen at first, when not controlled. A form reset returns to it. */
  defaultValue?: string | null;
  onValueChange?: (value: string | null) => void;
  required?: boolean;
  /** `sm` in dense rows and toolbars, the height of a small button. */
  size?: "md" | "sm";
};

/** What screen readers hear once typing pauses, in the page's language. */
function announce(messages: UiMessages["forms"], change: ListAnnouncement) {
  switch (change.type) {
    case "results":
      return change.count === 0 ? messages.noMatch : messages.results(change.count);
    case "removed":
      return null;
  }
}

/**
 * One choice among a long list, found by typing, on ui-sdk's `Combobox`: the input filters the
 * list as the user types (case and accents ignored), and says so when nothing matches. The
 * value is always one of the items; the text is only the search.
 */
export function Combobox({
  label,
  hideLabel,
  description,
  error,
  disabled,
  name,
  items,
  placeholder,
  value,
  defaultValue,
  onValueChange,
  required,
  size = "md",
}: ComboboxProps) {
  const messages = useUiMessages().forms;
  const [anchor, setAnchor] = useState<HTMLDivElement | null>(null);
  // The value chosen while uncontrolled; a controlled one is `value`.
  const [chosenHere, setChosenHere] = useState(defaultValue ?? null);
  const chosenValue = value === undefined ? chosenHere : value;
  // The chosen item's icon, drawn from the items themselves: ui-sdk's value icon copies an
  // item's, which only exists once the list has been drawn, never on a page opened closed.
  const chosen = items.find((item) => item.value === chosenValue);

  return (
    <FormField
      label={label}
      hideLabel={hideLabel}
      description={description}
      error={error}
      disabled={disabled}
      name={name}
    >
      <ComboboxPart
        value={value}
        defaultValue={defaultValue}
        onValueChange={(next) => {
          setChosenHere(next);
          onValueChange?.(next);
        }}
        itemToLabel={(chosen) => items.find((item) => item.value === chosen)?.label ?? chosen}
        announcement={(change) => announce(messages, change)}
        // The first match is highlighted while typing, so Enter chooses it.
        autoHighlight
        required={required}
      >
        <div
          ref={setAnchor}
          className={cn(controlClasses(size), groupFocusRing, "pe-1 has-data-disabled:opacity-50")}
        >
          {chosen?.icon === undefined ? null : (
            <span data-slot="combobox-value-icon" className="flex text-muted-foreground">
              <ChoiceIcon item={{ ...chosen, icon: chosen.icon }} />
            </span>
          )}
          <ComboboxInput
            placeholder={placeholder}
            className="h-full min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground data-disabled:cursor-not-allowed"
          />
          <ComboboxTrigger
            aria-label={messages.showOptions}
            className="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-sm text-muted-foreground hover:bg-muted data-disabled:cursor-not-allowed"
          >
            <Icon name="selector" />
          </ComboboxTrigger>
        </div>
        <ComboboxContent
          anchor={anchor}
          sideOffset={4}
          className={cn(
            popupClasses,
            "max-h-(--available-height) w-(--anchor-width) overflow-y-auto",
          )}
        >
          <ComboboxEmpty className="px-2 py-1.5 text-sm text-muted-foreground">
            {messages.noMatch}
          </ComboboxEmpty>
          <ComboboxList>
            {items.map((item) => (
              <ChoiceRow key={item.value} item={item} />
            ))}
          </ComboboxList>
        </ComboboxContent>
      </ComboboxPart>
    </FormField>
  );
}

function ChoiceRow({ item }: { item: ChoiceItem }) {
  return (
    <ComboboxItem
      value={item.value}
      label={item.label}
      disabled={item.disabled}
      className={itemClasses}
    >
      {item.icon === undefined ? null : (
        <ComboboxItemIcon className="flex text-muted-foreground">
          <ChoiceIcon item={{ ...item, icon: item.icon }} />
        </ComboboxItemIcon>
      )}
      <span className="flex-1 truncate">{item.label}</span>
      <ComboboxItemIndicator className="flex text-primary">
        <Icon name="check" />
      </ComboboxItemIndicator>
    </ComboboxItem>
  );
}
