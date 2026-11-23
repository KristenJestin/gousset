import {
  Autocomplete,
  AutocompleteContent,
  AutocompleteInput,
  AutocompleteItem,
  AutocompleteList,
} from "@ui-sdk/react/autocomplete";
import type { ListAnnouncement } from "@ui-sdk/react/autocomplete";

import { useUiMessages } from "../hooks/use-ui-messages";
import { controlClasses, focusRing, itemClasses, popupClasses } from "../lib/form-classes";
import type { UiMessages } from "../lib/messages";
import { cn } from "../lib/utils";
import { FormField } from "./text-field";
import type { FieldProps } from "./text-field";

export type NameFieldProps = FieldProps & {
  /** The text typed: the value, whether or not it is one of the suggestions. */
  value: string;
  onValueChange: (value: string) => void;
  /** Names that exist already, offered while typing; those that contain the text show. */
  suggestions: ReadonlyArray<string>;
  /** What the empty input says, like "A merchant's name". */
  placeholder?: string;
  required?: boolean;
};

/** What screen readers hear once typing pauses, in the page's language. */
function announce(messages: UiMessages["forms"], change: ListAnnouncement) {
  switch (change.type) {
    case "results":
      return change.count === 0 ? null : messages.results(change.count);
    case "removed":
      return null;
  }
}

/**
 * A name typed freely, with the existing names it may mean offered as the user types, on ui-sdk's
 * `Autocomplete`: choosing a suggestion writes it in the field, and a name no suggestion has is
 * kept as typed (a new merchant, say). The text is the value; unlike `Combobox`, it need not be
 * one of the suggestions, and nothing says so when none matches.
 *
 * Motion: the suggestions fade in with a slight scale from the field (150 ms, ease-out) and leave
 * the same way; cut under reduced motion.
 */
export function NameField({
  label,
  hideLabel,
  description,
  error,
  disabled,
  name,
  value,
  onValueChange,
  suggestions,
  placeholder,
  required,
}: NameFieldProps) {
  const messages = useUiMessages().forms;

  return (
    <FormField
      label={label}
      hideLabel={hideLabel}
      description={description}
      error={error}
      disabled={disabled}
      name={name}
    >
      <Autocomplete
        value={value}
        onValueChange={(next) => onValueChange(next)}
        announcement={(change) => announce(messages, change)}
        disabled={disabled}
        required={required}
      >
        <AutocompleteInput
          placeholder={placeholder}
          autoComplete="off"
          className={cn(controlClasses("md"), focusRing)}
        />
        <AutocompleteContent
          sideOffset={4}
          className={cn(
            popupClasses,
            "max-h-(--available-height) w-(--anchor-width) overflow-y-auto",
          )}
        >
          <AutocompleteList>
            {suggestions.map((suggestion) => (
              <AutocompleteItem key={suggestion} value={suggestion} className={itemClasses}>
                <span className="flex-1 truncate">{suggestion}</span>
              </AutocompleteItem>
            ))}
          </AutocompleteList>
        </AutocompleteContent>
      </Autocomplete>
    </FormField>
  );
}
