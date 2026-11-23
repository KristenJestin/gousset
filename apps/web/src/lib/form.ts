/** A text field of a submitted form (the app's forms have no file field); absent reads as empty. */
export function formText(form: FormData, name: string): string {
  return form.get(name)?.toString() ?? "";
}

/**
 * After a refusal, the form keeps what was typed but its passwords: they are emptied, to be typed
 * again, and the first of them in the form takes the focus. Writing a value sends no `input` event, so the
 * refusal's message stays until the person types.
 */
export function emptyPasswords(form: HTMLFormElement, names: ReadonlyArray<string>): void {
  const emptied = new Set(names);
  const inputs = [...form.querySelectorAll("input")].filter((input) => emptied.has(input.name));

  for (const input of inputs) {
    input.value = "";
  }

  inputs[0]?.focus();
}
