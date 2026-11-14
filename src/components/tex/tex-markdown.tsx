import * as React from "react";
import Link from "next/link";

/**
 * Markdown mínimo y seguro para las respuestas de Tex (nov-2026): párrafos,
 * listas con "-" o "1.", **negrita**, `código` y links internos [texto](/ruta).
 * Nunca HTML crudo: todo sale como elementos de React. Los links externos se
 * muestran como texto (Tex no tiene por qué mandar a ningún lado afuera).
 */

// Links: sólo internos ("/ruta"); "//dominio" o "/\\dominio" NO (son otro sitio).
const INLINE = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\(\/(?![\/\\])[^)\s]*\))/g;

function inline(text: string, key: string, onNavigate?: () => void): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(INLINE)) {
    const idx = m.index ?? 0;
    if (idx > last) out.push(text.slice(last, idx));
    const tok = m[0];
    const k = `${key}-${i++}`;
    if (tok.startsWith("**")) out.push(<strong key={k} className="font-semibold text-foreground">{tok.slice(2, -2)}</strong>);
    else if (tok.startsWith("`")) out.push(<code key={k} className="rounded bg-muted px-1 py-0.5 text-[0.9em]">{tok.slice(1, -1)}</code>);
    else {
      const label = tok.slice(1, tok.indexOf("]("));
      const href = tok.slice(tok.indexOf("](") + 2, -1);
      out.push(
        <Link key={k} href={href} onClick={onNavigate} className="font-medium text-[oklch(0.45_0.09_152)] underline underline-offset-2 dark:text-[oklch(0.84_0.09_150)]">
          {label}
        </Link>,
      );
    }
    last = idx + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function TexMarkdown({ text, onNavigate }: { text: string; onNavigate?: () => void }) {
  const lines = text.replace(/\r/g, "").split("\n");
  const blocks: React.ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let para: string[] = [];

  const flushPara = () => {
    if (para.length === 0) return;
    const k = `p${blocks.length}`;
    blocks.push(
      <p key={k} className="leading-relaxed">
        {para.map((l, i) => (
          <React.Fragment key={i}>
            {i > 0 ? <br /> : null}
            {inline(l, `${k}-${i}`, onNavigate)}
          </React.Fragment>
        ))}
      </p>,
    );
    para = [];
  };
  const flushList = () => {
    if (!list) return;
    const k = `l${blocks.length}`;
    const Tag = list.ordered ? "ol" : "ul";
    blocks.push(
      <Tag key={k} className={list.ordered ? "list-decimal space-y-1 pl-5" : "space-y-1 pl-0"}>
        {list.items.map((it, i) => (
          <li key={i} className={list!.ordered ? "pl-1" : "flex gap-2"}>
            {list!.ordered ? null : <span aria-hidden className="mt-[0.6em] size-1.5 shrink-0 rounded-full bg-current opacity-50" />}
            <span>{inline(it, `${k}-${i}`, onNavigate)}</span>
          </li>
        ))}
      </Tag>,
    );
    list = null;
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const bullet = /^\s*[-•*]\s+(.*)$/.exec(line);
    const ordered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (bullet || ordered) {
      flushPara();
      const isOrdered = Boolean(ordered);
      if (!list || list.ordered !== isOrdered) {
        flushList();
        list = { ordered: isOrdered, items: [] };
      }
      list.items.push((bullet ?? ordered)![1]);
      continue;
    }
    if (!line.trim()) {
      flushPara();
      flushList();
      continue;
    }
    flushList();
    // Títulos: Tex no debería usarlos; si vienen, van como negrita.
    para.push(line.replace(/^#{1,6}\s+(.*)$/, "**$1**"));
  }
  flushPara();
  flushList();
  return <div className="space-y-2">{blocks}</div>;
}
