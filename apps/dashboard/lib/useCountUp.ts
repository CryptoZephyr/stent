"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Animate a numeric value smoothly toward `target` whenever it changes,
 * instead of letting the UI jump straight to the new number. Purely
 * cosmetic — callers still format/display the real, current `target`
 * once the animation settles; nothing here changes what value is "true".
 *
 * Respects `prefers-reduced-motion: reduce` by snapping instantly.
 */
export function useCountUp(target: number, durationMs = 600): number {
  const [value, setValue] = useState(target);
  const fromRef = useRef(target);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const prefersReduced =
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (!Number.isFinite(target)) return;

    if (prefersReduced || !Number.isFinite(fromRef.current)) {
      fromRef.current = target;
      setValue(target);
      return;
    }

    const from = fromRef.current;
    if (from === target) return;

    const start = performance.now();
    const cancelPrev = () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
    cancelPrev();

    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      // ease-out cubic — quick start, gentle settle.
      const eased = 1 - Math.pow(1 - t, 3);
      const next = from + (target - from) * eased;
      setValue(next);
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        fromRef.current = target;
      }
    };
    rafRef.current = requestAnimationFrame(tick);

    return cancelPrev;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, durationMs]);

  return value;
}
