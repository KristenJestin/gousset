import { useState } from "react";

/**
 * The sign of a value's last change: 1 when it grew, −1 when it shrank, 0 before any change. The
 * digits' roll reads it to roll up or down.
 */
export function useTrend(value: number): number {
  const [last, setLast] = useState(value);
  const [trend, setTrend] = useState(0);

  if (value !== last) {
    setLast(value);
    setTrend(Math.sign(value - last));
  }

  return trend;
}
