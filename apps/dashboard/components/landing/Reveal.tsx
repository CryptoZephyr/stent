"use client";

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

/**
 * Scroll-triggered reveal for below-the-fold landing sections (home-fit panels,
 * path-list rows, home-commit). Fires once via IntersectionObserver, then
 * disconnects — this is a one-shot entrance, not a re-triggering scroll effect.
 *
 * Mirrors the existing `.con-enter` / `--con-stagger` idiom from the Agent
 * Console timeline (components/console/Timeline.tsx): a stagger index is
 * passed as a CSS custom property and the stylesheet owns the actual
 * transform/opacity animation. This component only decides *when* to add the
 * class, never *how* it animates.
 *
 * Renders children visible-by-default (no class) until the observer fires,
 * so content already in the initial viewport, non-JS environments, and
 * headless renders never end up hidden waiting on a transition that won't run.
 */
export function Reveal({
  as: Tag = "div",
  index = 0,
  className = "",
  children,
  ...rest
}: {
  as?: "div" | "article" | "section";
  index?: number;
  className?: string;
  children: ReactNode;
} & Omit<React.HTMLAttributes<HTMLElement>, "className">) {
  const ref = useRef<HTMLElement | null>(null);
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    if (typeof IntersectionObserver !== "function") {
      // No observer support — show as revealed immediately, no animation.
      setRevealed(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setRevealed(true);
            observer.disconnect();
            break;
          }
        }
      },
      { threshold: 0.2, rootMargin: "0px 0px -10% 0px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const style = { "--reveal-stagger": index } as React.CSSProperties;

  return (
    <Tag
      ref={ref as never}
      className={`${className}${revealed ? " reveal-in" : " reveal-pre"}`.trim()}
      style={style}
      {...rest}
    >
      {children}
    </Tag>
  );
}
