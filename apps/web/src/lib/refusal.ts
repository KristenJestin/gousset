/**
 * Runs a server function for its effect, and gives the code it refused with, or `undefined` when
 * it went through: a server function refuses by throwing an error whose message is a code the
 * interface translates (`errorMessage`). Outside the components, where the React Compiler has no
 * `try` to handle.
 */
export async function refusalOf<T>(action: () => Promise<T>): Promise<string | undefined> {
  try {
    await action();

    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : "UNKNOWN";
  }
}
