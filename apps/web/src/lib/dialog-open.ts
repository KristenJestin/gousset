/**
 * Whether a dialog is open over the page (a form, the list of shortcuts, a rule proposed), other
 * than the sheet a line's detail is below 1024 px: the review's keys (#35) then do nothing, so that
 * a key meant for the dialog never acts on the line behind it.
 */
export function aDialogIsOpen(): boolean {
  return [...document.querySelectorAll('[role="dialog"], [role="alertdialog"]')].some(
    (dialog) => dialog.querySelector('[data-slot="line-detail"]') === null,
  );
}
