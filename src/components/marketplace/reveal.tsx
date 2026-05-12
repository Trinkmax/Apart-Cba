"use client";

import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { cn } from "@/lib/utils";

type Props = {
  children: ReactNode;
  className?: string;
  /** Distance in px the content travels up while revealing. */
  y?: number;
  /** Delay before reveal starts (ms). Compose with index for stagger. */
  delay?: number;
  /** Trigger reveal once and disconnect (default true). */
  once?: boolean;
  /** Reveal threshold (0-1) — how much must be visible. */
  threshold?: number;
  /** Render-as. Defaults to "div". */
  as?: "div" | "section" | "article" | "header" | "li" | "ul";
};

/**
 * Lightweight scroll-reveal wrapper. Renders the children with `opacity: 0` and a
 * tiny translateY, then animates them into view using a CSS class triggered by
 * IntersectionObserver. No animation library — works with React Compiler and is
 * cheap to render. The actual keyframe lives in globals.css (`reveal-up`).
 */
export function Reveal({
  children,
  className,
  y = 18,
  delay = 0,
  once = true,
  threshold = 0.12,
  as = "div",
}: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof window === "undefined") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      el.dataset.reveal = "in";
      return;
    }

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.setAttribute("data-reveal", "in");
            if (once) io.unobserve(entry.target);
          } else if (!once) {
            entry.target.setAttribute("data-reveal", "out");
          }
        }
      },
      { threshold, rootMargin: "0px 0px -8% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [once, threshold]);

  const Tag = as;
  const style = { "--reveal-y": `${y}px`, "--reveal-delay": `${delay}ms` } as CSSProperties;

  return (
    <Tag ref={ref as never} data-reveal="out" style={style} className={cn("reveal", className)}>
      {children}
    </Tag>
  );
}
