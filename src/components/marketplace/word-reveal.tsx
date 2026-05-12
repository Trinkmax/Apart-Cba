import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";

type Props = {
  text: string;
  className?: string;
  /** Starting --i offset, so multiple WordReveals can be chained. */
  startIndex?: number;
};

/**
 * Splits a string into word spans driven by the global `[data-reveal-letters]`
 * keyframe in globals.css. No JS — pure CSS animation triggered by `--i`. Words
 * (not letters) so wrapping behaves naturally on long sentences.
 *
 * Each emitted child span gets `display: inline-block` from the parent rule,
 * which would normally break wrapping, so we include the trailing space inside
 * each word's span via ` ` to keep words together as atomic units while
 * still allowing line breaks between them.
 */
export function WordReveal({ text, className, startIndex = 0 }: Props) {
  const words = text.split(" ");
  return (
    <span data-reveal-letters className={cn("inline", className)} aria-label={text}>
      {words.map((word, i) => (
        <span
          key={i}
          aria-hidden
          style={{ "--i": startIndex + i } as CSSProperties}
        >
          {word}
          {i < words.length - 1 ? " " : ""}
        </span>
      ))}
    </span>
  );
}
