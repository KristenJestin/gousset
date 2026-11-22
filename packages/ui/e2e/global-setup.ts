import { removeProbes } from "./lint-probe";

// Before any test: no probe page left by a run that was killed.
export default function globalSetup() {
  removeProbes();
}
