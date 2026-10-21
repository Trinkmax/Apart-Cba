"use client";

import { useState, useTransition } from "react";
import { Check, ChevronDown, ChevronRight, ExternalLink, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { updateUnitGuestInfo, type UnitGuestInfo } from "@/lib/actions/units";
import { GUEST_INSTRUCTIONS_MAX, normalizeMapsUrl } from "@/lib/units/guest-info";
import { cn } from "@/lib/utils";

/** Para reconocer deptos del mismo edificio ("Tucumán 2250 " = "tucumán 2250"). */
function sameAddress(a: string | null, b: string | null): boolean {
  const k = (s: string | null) => (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  return k(a) !== "" && k(a) === k(b);
}

function Chip({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap",
        ok
          ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300"
          : "border-dashed text-muted-foreground"
      )}
    >
      {ok && <Check size={11} />}
      {children}
    </span>
  );
}

/**
 * Lo que cambia de un depto a otro en el instructivo: el link de Google Maps y
 * el instructivo propio del depto (cómo entrar, piso, wifi…). Se guarda depto
 * por depto, en la misma tabla de unidades (migración 076).
 */
export function UnitGuestInfoEditor({ units: initialUnits }: { units: UnitGuestInfo[] }) {
  const [units, setUnits] = useState(initialUnits);
  const [openId, setOpenId] = useState<string | null>(null);

  if (units.length === 0) {
    return <p className="text-sm text-muted-foreground">Todavía no hay deptos cargados.</p>;
  }

  return (
    <div className="rounded-md border divide-y">
      {units.map((u) => {
        const isOpen = openId === u.id;
        // Otro depto del mismo edificio que ya tiene el link: se ofrece copiarlo.
        const sibling = units.find(
          (o) => o.id !== u.id && o.guest_maps_url && sameAddress(o.address, u.address)
        );
        return (
          <div key={u.id}>
            <button
              type="button"
              onClick={() => setOpenId(isOpen ? null : u.id)}
              aria-expanded={isOpen}
              className="w-full flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 p-3 sm:px-4 hover:bg-accent/30 text-left"
            >
              <div className="flex items-center gap-2 min-w-0">
                {isOpen ? <ChevronDown size={16} className="shrink-0" /> : <ChevronRight size={16} className="shrink-0" />}
                <span className="font-mono text-xs font-semibold shrink-0">{u.code}</span>
                <span className="text-sm truncate">
                  {u.name.trim()}
                  {u.address ? <span className="text-muted-foreground"> · {u.address.trim()}</span> : null}
                </span>
              </div>
              <div className="flex items-center gap-1.5 pl-6 sm:pl-0">
                <Chip ok={!!u.guest_maps_url}>Maps</Chip>
                <Chip ok={!!u.guest_instructions}>Instructivo</Chip>
              </div>
            </button>
            {isOpen && (
              <UnitGuestInfoForm
                unit={u}
                siblingMapsUrl={sibling?.guest_maps_url ?? null}
                siblingCode={sibling?.code ?? null}
                onSaved={(next) => {
                  setUnits((list) => list.map((x) => (x.id === next.id ? next : x)));
                  setOpenId(null);
                }}
                onCancel={() => setOpenId(null)}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

function UnitGuestInfoForm({
  unit,
  siblingMapsUrl,
  siblingCode,
  onSaved,
  onCancel,
}: {
  unit: UnitGuestInfo;
  siblingMapsUrl: string | null;
  siblingCode: string | null;
  onSaved: (u: UnitGuestInfo) => void;
  onCancel: () => void;
}) {
  const [maps, setMaps] = useState(unit.guest_maps_url ?? "");
  const [instructions, setInstructions] = useState(unit.guest_instructions ?? "");
  const [mapsError, setMapsError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const dirty =
    maps.trim() !== (unit.guest_maps_url ?? "") ||
    instructions.trim() !== (unit.guest_instructions ?? "");
  const mapsCheck = normalizeMapsUrl(maps);
  const testUrl = mapsCheck.ok ? mapsCheck.url : null;

  function save() {
    if (!mapsCheck.ok) {
      setMapsError(mapsCheck.error);
      return;
    }
    startTransition(async () => {
      const r = await updateUnitGuestInfo({
        unit_id: unit.id,
        guest_maps_url: maps,
        guest_instructions: instructions,
      });
      if (!r.ok) {
        if (r.field === "guest_maps_url") setMapsError(r.error);
        toast.error("No se pudo guardar", { description: r.error });
        return;
      }
      toast.success(`${unit.code} guardado`, { description: "Ya sale en el instructivo de sus reservas." });
      onSaved(r.unit);
    });
  }

  return (
    <div className="border-t bg-muted/20 p-3 sm:p-4 space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor={`maps_${unit.id}`}>Link de Google Maps</Label>
        <div className="flex items-center gap-2">
          <Input
            id={`maps_${unit.id}`}
            value={maps}
            onChange={(e) => {
              setMaps(e.target.value);
              setMapsError(null);
            }}
            placeholder="https://maps.app.goo.gl/…"
            inputMode="url"
            aria-invalid={!!mapsError}
          />
          {testUrl && (
            <a
              href={testUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 whitespace-nowrap text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              <ExternalLink size={13} /> Probar
            </a>
          )}
        </div>
        {mapsError ? (
          <p className="text-xs text-destructive">{mapsError}</p>
        ) : (
          <p className="text-[11px] text-muted-foreground">
            En Google Maps: buscá la dirección → «Compartir» → «Copiar vínculo».
            {!maps.trim() && siblingMapsUrl && siblingCode ? (
              <>
                {" "}
                <button
                  type="button"
                  onClick={() => setMaps(siblingMapsUrl)}
                  className="font-medium text-foreground underline underline-offset-2"
                >
                  Usar el de {siblingCode} (misma dirección)
                </button>
              </>
            ) : null}
          </p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={`instr_${unit.id}`}>Instructivo del depto</Label>
        <Textarea
          id={`instr_${unit.id}`}
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          rows={6}
          maxLength={GUEST_INSTRUCTIONS_MAX}
          placeholder={"Lo propio de este depto: cómo entrar, piso, cochera, wifi y clave…\nEj.: Piso 4, depto A. Wifi: AT4A · Clave: bienvenidos"}
          className="text-sm leading-relaxed"
        />
        <p className="text-[11px] text-muted-foreground">
          Lo que es igual para todos (el reglamento, por ejemplo) va en el texto del instructivo, no acá.
        </p>
      </div>

      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={isPending}>
          Cancelar
        </Button>
        <Button size="sm" onClick={save} disabled={isPending || !dirty}>
          {isPending && <Loader2 size={14} className="mr-1.5 animate-spin" />}
          Guardar
        </Button>
      </div>
    </div>
  );
}
