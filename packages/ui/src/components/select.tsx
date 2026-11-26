import {
  Select as SelectPart,
  SelectContent,
  SelectItem,
  SelectItemIcon,
  SelectItemIndicator,
  SelectTrigger,
  SelectValue,
  SelectValueIcon,
} from "@ui-sdk/react/select";

import { controlClasses, focusRing, itemClasses, popupClasses } from "../lib/form-classes";
import { paletteText } from "../lib/palette";
import type { PaletteColor } from "../lib/palette";
import { cn } from "../lib/utils";
import { Icon } from "./icon";
import type { IconName } from "./icons";
import { FormField } from "./text-field";
import type { FieldProps } from "./text-field";

/** One choice of a select or a combobox. */
export type ChoiceItem = {
  value: string;
  /** What the user reads, given by the page in its language. */
  label: string;
  /** Shown before the label, in the list and once chosen. */
  icon?: IconName;
  /** The icon's colour (a category's, #205); the muted text's when left out. */
  iconColor?: PaletteColor | null;
  disabled?: boolean;
};

/** A choice's icon, in its colour when it has one: the chosen value's icon copies it. */
export function ChoiceIcon({ item }: { item: ChoiceItem & { icon: IconName } }) {
  return (
    <span
      data-icon={item.icon}
      data-color={item.iconColor ?? undefined}
      className={cn(
        "flex",
        item.iconColor === undefined || item.iconColor === null
          ? undefined
          : paletteText[item.iconColor],
      )}
    >
      <Icon name={item.icon} />
    </span>
  );
}

export type SelectProps = FieldProps & {
  items: ReadonlyArray<ChoiceItem>;
  /** What the trigger says while nothing is chosen. */
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

/**
 * One choice among a short list, on ui-sdk's `Select` (a button with the `combobox` role and a
 * `listbox`). For a long list the user would rather search, use `Combobox`.
 */
export function Select({
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
}: SelectProps) {
  return (
    <FormField
      label={label}
      hideLabel={hideLabel}
      description={description}
      error={error}
      disabled={disabled}
      name={name}
    >
      <SelectPart
        items={items.map((item) => ({
          value: item.value,
          label: item.label,
          disabled: item.disabled,
        }))}
        placeholder={placeholder}
        value={value}
        defaultValue={defaultValue}
        onValueChange={onValueChange}
        required={required}
      >
        <SelectTrigger
          className={cn(
            controlClasses(size),
            focusRing,
            "cursor-pointer text-start data-placeholder:text-muted-foreground",
          )}
        >
          <SelectValueIcon className="flex text-muted-foreground" />
          <SelectValue className="flex-1 truncate" />
          <span className="flex text-muted-foreground">
            <Icon name="selector" />
          </span>
        </SelectTrigger>
        <SelectContent
          sideOffset={4}
          className={cn(
            popupClasses,
            "max-h-(--available-height) min-w-(--anchor-width) overflow-y-auto",
          )}
        >
          {items.map((item) => (
            <ChoiceRow key={item.value} item={item} />
          ))}
        </SelectContent>
      </SelectPart>
    </FormField>
  );
}

function ChoiceRow({ item }: { item: ChoiceItem }) {
  return (
    <SelectItem
      value={item.value}
      label={item.label}
      disabled={item.disabled}
      className={itemClasses}
    >
      {item.icon === undefined ? null : (
        <SelectItemIcon className="flex text-muted-foreground">
          <ChoiceIcon item={{ ...item, icon: item.icon }} />
        </SelectItemIcon>
      )}
      <span className="flex-1 truncate">{item.label}</span>
      <SelectItemIndicator className="flex text-primary">
        <Icon name="check" />
      </SelectItemIndicator>
    </SelectItem>
  );
}
