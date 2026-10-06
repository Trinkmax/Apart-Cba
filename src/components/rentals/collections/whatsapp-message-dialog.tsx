"use client";

import { useEffect, useState } from "react";
import { Check, Copy, Loader2, MessageCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { isStaleDeployError } from "@/lib/action-failure";

export type WhatsappLoadResult = { ok: true; text: string; waUrl: string | null } | { ok: false; error: string };

/**
 * Mensaje para WhatsApp: se ve (y se puede retocar) antes de mandarlo.
 * "Copiar y abrir WhatsApp" copia el texto y abre el chat sin `?text=` (iOS
 * rompe los emojis en la URL); la persona pega y envía.
 */
export function WhatsappMessageDialog({
  open,
  onOpenChange,
  title,
  description,
  load,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  load: () => Promise<WhatsappLoadResult>;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="size-8 rounded-lg bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
              <MessageCircle size={16} />
            </span>
            {title}
          </DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        {open && <MessageBody load={load} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function MessageBody({ load, onDone }: { load: () => Promise<WhatsappLoadResult>; onDone: () => void }) {
  const [state, setState] = useState<{ status: "loading" } | { status: "error"; error: string } | { status: "ready"; waUrl: string | null }>({
    status: "loading",
  });
  const [text, setText] = useState("");
  const [copied, setCopied] = useState(false);
  // La función se fija al abrir: el cuerpo se monta una vez por apertura.
  const [loader] = useState(() => load);

  useEffect(() => {
    let alive = true;
    loader()
      .then((res) => {
        if (!alive) return;
        if (!res.ok) {
          setState({ status: "error", error: res.error });
          return;
        }
        setText(res.text);
        setState({ status: "ready", waUrl: res.waUrl });
      })
      .catch((e: unknown) => {
        if (!alive) return;
        setState({
          status: "error",
          error: isStaleDeployError(e)
            ? "Se actualizó el sistema mientras tenías esto abierto: recargá la página para seguir."
            : "No pudimos armar el mensaje. Revisá la conexión y probá de nuevo.",
        });
      });
    return () => {
      alive = false;
    };
  }, [loader]);

  async function copy(): Promise<boolean> {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      return true;
    } catch {
      toast.error("No se pudo copiar", { description: "Seleccioná el texto y copialo a mano." });
      return false;
    }
  }

  /**
   * El link abre el chat (acción por defecto del <a>, sin bloqueadores de
   * pop-ups) y el texto se copia en el mismo click, con el documento todavía
   * en foco: así funciona también en Safari.
   */
  function copyOnOpen() {
    navigator.clipboard
      .writeText(text)
      .then(() => toast.success("Mensaje copiado", { description: "Pegalo en el chat de WhatsApp y mandalo." }))
      .catch(() => toast.error("No se pudo copiar", { description: "Volvé y copialo con el botón Copiar." }));
    setTimeout(onDone, 150);
  }

  if (state.status === "loading") {
    return (
      <div className="space-y-2 py-1" aria-busy="true" aria-label="Armando el mensaje">
        {[92, 100, 76, 88, 60, 40].map((w, i) => (
          <div key={i} className="h-3.5 rounded bg-muted animate-pulse" style={{ width: `${w}%` }} />
        ))}
      </div>
    );
  }
  if (state.status === "error") {
    return <p className="rounded-lg border border-rose-500/25 bg-rose-500/5 px-3 py-2.5 text-sm text-rose-700 dark:text-rose-300">{state.error}</p>;
  }
  return (
    <>
      <Textarea
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setCopied(false);
        }}
        rows={Math.min(14, Math.max(6, text.split("\n").length + 1))}
        className="text-sm leading-relaxed resize-y"
        aria-label="Mensaje para WhatsApp"
      />
      {!state.waUrl && (
        <p className="text-xs text-muted-foreground">
          El inquilino no tiene un celular válido cargado: copiá el mensaje y mandalo desde tu WhatsApp.
        </p>
      )}
      <DialogFooter className="gap-2 sm:gap-2">
        <Button variant="outline" onClick={copy} className="gap-2">
          {copied ? <Check size={14} className="text-emerald-600" /> : <Copy size={14} />}
          {copied ? "Copiado" : "Copiar"}
        </Button>
        {state.waUrl && (
          <Button asChild className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white">
            <a href={state.waUrl} target="_blank" rel="noopener noreferrer" onClick={copyOnOpen}>
              <MessageCircle size={14} /> Copiar y abrir WhatsApp
            </a>
          </Button>
        )}
      </DialogFooter>
    </>
  );
}

/** Spinner chico para botones en curso. */
export function Spinner() {
  return <Loader2 size={14} className="animate-spin" />;
}
