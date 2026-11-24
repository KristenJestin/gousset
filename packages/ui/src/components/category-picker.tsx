import { Combobox } from "./combobox";
import type { ChoiceItem } from "./select";
import type { FieldProps } from "./text-field";

/** A category that can be chosen, with its children, in order. */
export type CategoryChoice = {
  id: string;
  name: string;
  children?: ReadonlyArray<{ id: string; name: string }>;
};

export type CategoryPickerProps = FieldProps & {
  /** The categories offered, top-level ones with their children, in order. */
  categories: ReadonlyArray<CategoryChoice>;
  /** The chosen category's id; `null` for none. */
  value: string | null;
  onValueChange: (id: string) => void;
  /** What the empty input says, like "Search a category". */
  placeholder?: string;
  required?: boolean;
  /** `sm` in a dense panel, the height of a small button. */
  size?: "md" | "sm";
};

/** Between a parent's name and its child's, as the picker writes a child: "Food › Groceries". */
const PATH = " › ";

/**
 * One category among the user's, found by typing (a `Combobox`): each top-level category, then its
 * children named with it ("Food › Groceries"), so that typing a parent's name finds its children
 * too. Choosing one calls `onValueChange` with its id; clearing the text chooses nothing.
 *
 * Motion: as `Combobox`, its list fades and grows in 150 ms. Cut under reduced motion.
 */
export function CategoryPicker({
  categories,
  value,
  onValueChange,
  ...field
}: CategoryPickerProps) {
  const items: ReadonlyArray<ChoiceItem> = categories.flatMap((category) => [
    { value: category.id, label: category.name },
    ...(category.children ?? []).map((child) => ({
      value: child.id,
      label: `${category.name}${PATH}${child.name}`,
    })),
  ]);

  return (
    <Combobox
      {...field}
      items={items}
      value={value}
      onValueChange={(next) => {
        if (next !== null) {
          onValueChange(next);
        }
      }}
    />
  );
}
