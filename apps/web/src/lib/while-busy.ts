/**
 * Runs an action with a form's busy flag up, and always puts it down, even when the action
 * throws: otherwise the form would stay disabled. Outside the components, where the React
 * Compiler has no `try` to handle.
 */
export async function whileBusy<T>(setBusy: (busy: boolean) => void, action: () => Promise<T>) {
  setBusy(true);

  try {
    return await action();
  } finally {
    setBusy(false);
  }
}
