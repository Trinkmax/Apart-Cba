"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Redo2, Undo2, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  undoSettlementEdit,
  redoSettlementEdit,
} from "@/lib/actions/settlements";
import { cn } from "@/lib/utils";

export interface UndoState {
  canUndo: boolean;
  undoLabel: string | null;
  canRedo: boolean;
  redoLabel: string | null;
}

type Mode = "undo" | "redo";

/**
 * Deshacer / Rehacer del documento.
 *
 * Restaura snapshots completos (ver migración 047), así que cubre por igual
 * editar un importe, borrar un cargo, reordenar o regenerar. NO cubre el
 * estado ni el pago: mover plata ya registrada se revierte por su propio
 * flujo, no con un Ctrl+Z.
 *
 * Fricción sólo donde hay plata: si la liquidación está pagada, el cambio
 * puede mover el neto y hay que decidir si impacta en Caja — ahí pedimos
 * confirmación con el mismo switch que el resto de las ediciones. Si no está
 * pagada, es un clic y listo (con "Rehacer" en el toast por las dudas).
 */
export function UndoRedoButtons({
  settlementId,
  state,
  paid,
  disabled,
}: {
  settlementId: string;
  state: UndoState;
  paid: boolean;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [confirm, setConfirm] = useState<Mode | null>(null);
  const [impactCaja, setImpactCaja] = useState(true);

  // El toast de éxito ofrece la acción inversa, o sea `run` se llama a sí
  // misma. Referenciarla dentro de su propio useCallback es un acceso previo a
  // la declaración (y el React Compiler lo rechaza), así que va por una ref
  // sincronizada — el patrón estándar de "último callback".
  const runRef = useRef<((mode: Mode, impact: boolean) => void) | null>(null);

  const run = useCallback(
    (mode: Mode, impact: boolean) => {
      start(async () => {
        try {
          const fn = mode === "undo" ? undoSettlementEdit : redoSettlementEdit;
          const res = await fn({
            settlement_id: settlementId,
            impact_caja: impact,
          });
          setConfirm(null);
          toast.success(
            mode === "undo"
              ? `Deshecho · ${res.label}`
              : `Rehecho · ${res.label}`,
            {
              description: res.adjustmentId
                ? "Se posteó el asiento de ajuste en Caja."
                : undefined,
              // El camino de vuelta a un clic. Sólo cuando NO está pagada: ahí
              // la operación puede mover plata y tiene que pasar sí o sí por la
              // confirmación, no por un botón del toast.
              action: paid
                ? undefined
                : {
                    label: mode === "undo" ? "Rehacer" : "Deshacer",
                    onClick: () =>
                      runRef.current?.(
                        mode === "undo" ? "redo" : "undo",
                        impact,
                      ),
                  },
            },
          );
          router.refresh();
        } catch (e) {
          toast.error(
            mode === "undo" ? "No se pudo deshacer" : "No se pudo rehacer",
            { description: (e as Error).message },
          );
        }
      });
    },
    [router, settlementId, paid],
  );

  useEffect(() => {
    runRef.current = run;
  }, [run]);

  const trigger = useCallback(
    (mode: Mode) => {
      if (disabled || pending) return;
      if (mode === "undo" && !state.canUndo) return;
      if (mode === "redo" && !state.canRedo) return;
      // Pagada → puede haber asiento en Caja: preguntamos antes.
      if (paid) {
        setImpactCaja(true);
        setConfirm(mode);
        return;
      }
      run(mode, true);
    },
    [disabled, pending, paid, run, state.canUndo, state.canRedo],
  );

  // Ctrl/Cmd+Z y Ctrl/Cmd+Shift+Z. El reflejo es justamente el punto de la
  // feature: se ignora si el foco está en un campo de texto (ahí Z es el undo
  // nativo del input) o si hay un diálogo abierto.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key.toLowerCase() !== "z" || !(e.metaKey || e.ctrlKey)) return;
      const el = document.activeElement as HTMLElement | null;
      if (
        el &&
        (el.tagName === "INPUT" ||
          el.tagName === "TEXTAREA" ||
          el.tagName === "SELECT" ||
          el.isContentEditable)
      ) {
        return;
      }
      if (document.querySelector("[role=dialog],[role=alertdialog]")) return;
      e.preventDefault();
      trigger(e.shiftKey ? "redo" : "undo");
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [trigger]);

  const label = confirm === "undo" ? state.undoLabel : state.redoLabel;

  return (
    <>
      <div className="flex items-center rounded-md overflow-hidden bg-white/15">
        <HeaderIconButton
          onClick={() => trigger("undo")}
          disabled={disabled || pending || !state.canUndo}
          title={
            state.canUndo
              ? `Deshacer: ${state.undoLabel} (${MOD_KEY}Z)`
              : "No hay cambios para deshacer"
          }
          ariaLabel={
            state.canUndo
              ? `Deshacer: ${state.undoLabel}`
              : "No hay cambios para deshacer"
          }
        >
          {pending ? (
            <Loader2 size={13} className="animate-spin" />
          ) : (
            <Undo2 size={13} />
          )}
          <span className="hidden sm:inline">Deshacer</span>
        </HeaderIconButton>
        <span className="w-px h-4 bg-white/25" aria-hidden />
        <HeaderIconButton
          onClick={() => trigger("redo")}
          disabled={disabled || pending || !state.canRedo}
          title={
            state.canRedo
              ? `Rehacer: ${state.redoLabel} (${MOD_KEY}⇧Z)`
              : "No hay cambios para rehacer"
          }
          ariaLabel={
            state.canRedo
              ? `Rehacer: ${state.redoLabel}`
              : "No hay cambios para rehacer"
          }
        >
          <Redo2 size={13} />
          <span className="sr-only sm:not-sr-only">Rehacer</span>
        </HeaderIconButton>
      </div>

      <AlertDialog
        open={confirm !== null}
        onOpenChange={(o) => !o && setConfirm(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm === "undo" ? "Deshacer" : "Rehacer"}
              {label ? ` · ${label}` : ""}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 text-sm">
                <p>
                  Esta liquidación está <strong>pagada</strong>. Si al{" "}
                  {confirm === "undo" ? "deshacer" : "rehacer"} cambia el neto,
                  elegí qué pasa con Caja.
                </p>
                <label className="flex items-start gap-3 rounded-lg border p-3 cursor-pointer">
                  <Switch
                    checked={impactCaja}
                    onCheckedChange={setImpactCaja}
                    className="mt-0.5"
                  />
                  <span className="flex-1">
                    <span className="flex items-center gap-1.5 font-medium">
                      <Wallet size={14} />
                      {impactCaja ? "Impacta en Caja" : "Solo visual"}
                    </span>
                    <span className="block text-xs text-muted-foreground mt-0.5">
                      {impactCaja
                        ? "Postea un asiento de ajuste por la diferencia. El egreso original queda intacto."
                        : "Corrige el documento sin tocar Caja. El egreso registrado no cambia."}
                    </span>
                  </span>
                </label>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancelar</AlertDialogCancel>
            <Button
              onClick={() => confirm && run(confirm, impactCaja)}
              disabled={pending}
              className="gap-1.5"
            >
              {pending && <Loader2 size={14} className="animate-spin" />}
              {confirm === "undo" ? "Deshacer" : "Rehacer"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/**
 * Se muestran las dos variantes en vez de detectar la plataforma: leer
 * `navigator` en el render da mismatch de hidratación (el servidor no lo tiene)
 * y corregirlo por efecto encadena renders. "⌘/Ctrl+Z" se entiende igual y no
 * cuesta nada.
 */
const MOD_KEY = "⌘/Ctrl+";

function HeaderIconButton({
  onClick,
  disabled,
  title,
  ariaLabel,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  title: string;
  ariaLabel: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={ariaLabel}
      className={cn(
        "inline-flex items-center gap-1.5 h-7 px-2.5 text-[12px] font-medium text-white transition-colors",
        "hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60",
        "disabled:opacity-40 disabled:hover:bg-transparent disabled:cursor-not-allowed",
      )}
    >
      {children}
    </button>
  );
}
