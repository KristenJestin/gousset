import { Input } from "@ui-sdk/react/input";
import { useRef, useState } from "react";
import type { KeyboardEvent } from "react";

import { useUiMessages } from "../hooks/use-ui-messages";
import { controlClasses, focusRing } from "../lib/form-classes";
import { cn } from "../lib/utils";
import { Button } from "./button";
import { Icon } from "./icon";
import { FormField } from "./text-field";

export type TextListFieldProps = {
  /** Names the field and its list, shown above them, translated ("Labels"). */
  label: string;
  /** The texts already in the list, in order. */
  values: ReadonlyArray<string>;
  /** Called with the whole list once a text is added or removed. */
  onChange: (values: ReadonlyArray<string>) => void;
  /** A line of help under it, linked to its input. */
  description?: string;
  /** Why the list was refused (a text the server would not take), linked to its input. */
  error?: string;
  /** An example of a text, in the input while it is empty. */
  placeholder?: string;
  /** The longest text the input takes. */
  maxLength?: number;
  disabled?: boolean;
};

/**
 * A list of short texts (the labels that name a merchant): each one a chip with its own remove
 * button, then an input and "Add". Enter in the input adds its text too, and never sends the
 * form around it. A text is trimmed, an empty one ignored and one already listed kept once. A
 * chip's long text is cut with an ellipsis; on a phone the chips wrap.
 *
 * Motion: none of its own; the buttons' own (colours in 150 ms, a slight press), cut under
 * reduced motion.
 */
export function TextListField({
  label,
  values,
  onChange,
  description,
  error,
  placeholder,
  maxLength,
  disabled = false,
}: TextListFieldProps) {
  const messages = useUiMessages().list;
  const [draft, setDraft] = useState("");
  const input = useRef<HTMLInputElement>(null);

  const add = () => {
    const text = draft.trim();

    if (text === "") {
      return;
    }

    if (!values.includes(text)) {
      onChange([...values, text]);
    }

    setDraft("");
  };

  const remove = (text: string) => {
    onChange(values.filter((value) => value !== text));
    // The chip and its button are gone: the keyboard goes on from the input.
    input.current?.focus();
  };

  const keyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    // Enter adds, and never submits the form around it; not while an IME is composing a word.
    if (event.key === "Enter" && !event.nativeEvent.isComposing) {
      event.preventDefault();
      add();
    }
  };

  return (
    <FormField label={label} description={description} error={error} disabled={disabled}>
      {values.length === 0 ? null : (
        <ul data-slot="text-list" aria-label={label} className="flex flex-wrap gap-1.5">
          {values.map((value) => (
            <li
              key={value}
              className="inline-flex h-6 max-w-full items-center gap-1 rounded-full bg-muted pr-0.5 pl-2.5 text-xs font-medium text-foreground"
            >
              <span className="truncate" title={value}>
                {value}
              </span>
              <button
                type="button"
                disabled={disabled}
                aria-label={messages.remove(value)}
                onClick={() => remove(value)}
                className="grid size-5 shrink-0 cursor-pointer place-items-center rounded-full transition-colors duration-150 ease-out hover:bg-foreground/10 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Icon name="close" size="sm" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-center gap-2">
        <Input
          ref={input}
          value={draft}
          placeholder={placeholder}
          maxLength={maxLength}
          autoComplete="off"
          enterKeyHint="done"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={keyDown}
          className={cn(controlClasses("md"), focusRing)}
        />
        <Button variant="secondary" icon="add" disabled={disabled} onClick={add}>
          {messages.add}
        </Button>
      </div>
    </FormField>
  );
}
