"use client";

import { useEffect, useState } from "react";

/**
 * Whole seconds left of a pending kick, counted locally from the remaining ms the server sent
 * (`receivedAt` = when that state arrived, so client clock skew does not matter). Null when nothing is pending.
 */
export function useKickSeconds(remainingMs: number | null, receivedAt: number): number | null {
  const [now, setNow] = useState(() => Date.now());
  const pending = remainingMs !== null;
  useEffect(() => {
    if (!pending) return;
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [pending]);
  if (remainingMs === null) return null;
  return Math.ceil(Math.max(0, remainingMs - (now - receivedAt)) / 1000);
}
