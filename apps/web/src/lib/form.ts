/** A text field of a submitted form (the app's forms have no file field); absent reads as empty. */
export function formText(form: FormData, name: string): string {
  return form.get(name)?.toString() ?? "";
}
