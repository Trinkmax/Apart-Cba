"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft, ArrowRight, History, Loader2, Rocket, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { formatTimeAgo } from "@/lib/format";
import { previewContractPlan, saveRentalContract } from "@/lib/actions/rentals-contracts";
import type { RentalContractStatus } from "@/lib/types/database";
import type { ContractFormOptions, PersonOption, PlanPreview, PropertyOption } from "./types";
import { WIZARD_STEPS, overridesForSave, parseWizard, previewInputOf, stepOfField, type WizardState, type WizardStepKey } from "./wizard-state";
import { entryOf } from "./wizard-derived";
import type { StepProps } from "./wizard-step-props";
import { WizardStepsBar } from "./wizard-steps-bar";
import { WizardSummary } from "./wizard-summary";
import { StepProperty } from "./wizard-step-property";
import { StepParties } from "./wizard-step-parties";
import { StepTerms } from "./wizard-step-terms";
import { StepAdjustment } from "./wizard-step-adjustment";
import { StepBilling } from "./wizard-step-billing";
import { StepFees } from "./wizard-step-fees";
import { StepServices } from "./wizard-step-services";
import { StepReview } from "./wizard-step-review";

/**
 * Asistente de alta / edición de contratos: pasos con barra de progreso,
 * navegación libre entre pasos visitados, resumen en vivo (con los índices
 * reales, calculado en el servidor) y borrador local para no perder lo tipeado.
 */

const STORAGE_PREFIX = "rentos.alquileres.wizard.";

interface StoredDraft {
  v: 1;
  savedAt: string;
  step: number;
  state: WizardState;
}

function subscribeStorage(cb: () => void) {
  window.addEventListener("storage", cb);
  return () => window.removeEventListener("storage", cb);
}

export interface ContractWizardProps {
  mode: "create" | "edit";
  contractId?: string | null;
  contractStatus?: RentalContractStatus | null;
  contractLabel?: string | null;
  initial: WizardState;
  options: ContractFormOptions;
  hasPayments?: boolean;
  /** Paso con el que abre (p. ej. al venir de "Corregir ajuste"). */
  initialStep?: number;
}

export function ContractWizard({ mode, contractId = null, contractStatus = null, contractLabel = null, initial, options, hasPayments = false, initialStep = 0 }: ContractWizardProps) {
  const router = useRouter();
  const storageKey = STORAGE_PREFIX + (contractId ?? "nuevo");
  const last = WIZARD_STEPS.length - 1;
  const isDraft = mode === "create" || contractStatus === "borrador";
  const topRef = useRef<HTMLDivElement>(null);

  const [state, setState] = useState<WizardState>(initial);
  const [step, setStep] = useState(Math.min(Math.max(0, initialStep), last));
  const [visited, setVisited] = useState(mode === "edit" ? last : Math.min(Math.max(0, initialStep), last));
  const [attempted, setAttempted] = useState<Set<WizardStepKey>>(() => new Set());
  const [serverError, setServerError] = useState<{ field: string; message: string } | null>(null);
  const [dirty, setDirty] = useState(false);
  const [dismissedStored, setDismissedStored] = useState(false);
  const [extraProperties, setExtraProperties] = useState<PropertyOption[]>([]);
  const [extraPeople, setExtraPeople] = useState<PersonOption[]>([]);
  const [preview, setPreview] = useState<PlanPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [saving, startSaving] = useTransition();
  const [savingKind, setSavingKind] = useState<"draft" | "activate" | null>(null);

  // Borrador local: se lee sin efecto (servidor = null) y se ofrece recuperarlo.
  const storedRaw = useSyncExternalStore(
    subscribeStorage,
    () => {
      try {
        return window.localStorage.getItem(storageKey);
      } catch {
        return null;
      }
    },
    () => null,
  );
  const stored = useMemo<StoredDraft | null>(() => {
    if (!storedRaw) return null;
    try {
      const d = JSON.parse(storedRaw) as StoredDraft;
      return d?.v === 1 && d.state ? d : null;
    } catch {
      return null;
    }
  }, [storedRaw]);
  const showRestore = Boolean(stored) && !dirty && !dismissedStored;

  useEffect(() => {
    if (!dirty) return;
    const t = setTimeout(() => {
      try {
        window.localStorage.setItem(storageKey, JSON.stringify({ v: 1, savedAt: new Date().toISOString(), step, state } satisfies StoredDraft));
      } catch {
        /* sin storage: seguimos sin borrador local */
      }
    }, 500);
    return () => clearTimeout(t);
  }, [dirty, state, step, storageKey]);

  // Vista previa con los índices reales (debounced; descarta respuestas viejas).
  const previewInput = previewInputOf(state);
  const previewKey = previewInput ? JSON.stringify(previewInput) : null;
  const seq = useRef(0);
  useEffect(() => {
    if (!previewKey) return;
    const id = ++seq.current;
    const t = setTimeout(async () => {
      setPreviewLoading(true);
      const res = await previewContractPlan(JSON.parse(previewKey));
      if (id !== seq.current) return;
      setPreviewLoading(false);
      if (res.ok) setPreview(res.preview);
    }, 450);
    return () => clearTimeout(t);
  }, [previewKey]);
  const shownPreview = previewKey ? preview : null;

  const properties = useMemo(
    () => [...options.properties, ...extraProperties.filter((p) => !options.properties.some((o) => o.id === p.id))],
    [options.properties, extraProperties],
  );
  const people = useMemo(() => [...options.people, ...extraPeople.filter((p) => !options.people.some((o) => o.id === p.id))], [options.people, extraPeople]);

  const { issues } = parseWizard(state);
  const errors: Record<string, string> = {};
  for (const i of issues) if (attempted.has(i.step) && !errors[i.field]) errors[i.field] = i.message;
  if (serverError && !errors[serverError.field]) errors[serverError.field] = serverError.message;
  const flagged = new Set(issues.filter((i) => attempted.has(i.step)).map((i) => i.step));

  function set(patch: Partial<WizardState> | ((s: WizardState) => Partial<WizardState>)) {
    setState((s) => ({ ...s, ...(typeof patch === "function" ? patch(s) : patch) }));
    setDirty(true);
    setServerError(null);
  }

  function goToIndex(i: number) {
    const target = Math.min(Math.max(0, i), last);
    setStep(target);
    setVisited((v) => Math.max(v, target));
    topRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  }
  const goTo = (key: WizardStepKey) => goToIndex(WIZARD_STEPS.findIndex((s) => s.key === key));

  function next() {
    const key = WIZARD_STEPS[step].key;
    const issue = issues.find((x) => x.step === key);
    if (issue) {
      setAttempted((a) => new Set(a).add(key));
      toast.error("Revisá este paso", { description: issue.message });
      return;
    }
    goToIndex(step + 1);
  }

  function restore() {
    if (!stored) return;
    setState(stored.state);
    setStep(Math.min(Math.max(0, stored.step), last));
    setVisited(last);
    setDirty(true);
    toast.success("Recuperamos lo que estabas cargando");
  }
  function discardStored() {
    try {
      window.localStorage.removeItem(storageKey);
    } catch {
      /* nada */
    }
    setDismissedStored(true);
  }

  function save(activate: boolean) {
    const parsed = parseWizard(state);
    if (!parsed.input) {
      setAttempted(new Set(WIZARD_STEPS.map((s) => s.key)));
      const first = parsed.issues[0];
      toast.error("Faltan datos", { description: first?.message });
      if (first) goTo(first.step);
      return;
    }
    const entry = activate && state.generate_entry_charge ? entryOf(state, options.settings) : null;
    setSavingKind(activate ? "activate" : "draft");
    startSaving(async () => {
      const res = await saveRentalContract({
        id: contractId,
        input: parsed.input,
        overrides: isDraft ? overridesForSave(state) : undefined,
        activate: activate ? { entryItems: entry?.chargeItems ?? [], entryDueDate: state.start_date > options.today ? state.start_date : options.today } : null,
      });
      if (!res.ok) {
        if (res.field) setServerError({ field: res.field, message: res.error });
        toast.error(activate ? "No se pudo activar el contrato" : "No se pudo guardar", { description: res.error });
        const key = stepOfField(res.field);
        if (key) goTo(key);
        return;
      }
      try {
        window.localStorage.removeItem(storageKey);
      } catch {
        /* nada */
      }
      setDirty(false);
      if (activate && res.activated) toast.success("Contrato activado", { description: "Ya rige: se armó el cronograma de ajustes y los cargos que tocan." });
      else if (activate) toast.warning("Se guardó, pero no se pudo activar", { description: res.activationError ?? undefined });
      else toast.success(isDraft ? "Borrador guardado" : "Cambios guardados", { description: isDraft ? "Activalo cuando esté firmado." : undefined });
      router.push(`/dashboard/alquileres/contratos/${res.contractId}`);
    });
  }

  const stepProps: StepProps = {
    state,
    set,
    errors,
    options,
    properties,
    people,
    addProperty: (p) => setExtraProperties((list) => [...list, p]),
    addPerson: (p) => setExtraPeople((list) => [...list, p]),
    preview: shownPreview,
    previewLoading: previewKey ? previewLoading : false,
    today: options.today,
    mode,
    isDraft,
    hasPayments,
    contractId,
    goTo,
    contractLabel,
  };
  const key = WIZARD_STEPS[step].key;

  return (
    <div ref={topRef} className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_21rem] lg:items-start scroll-mt-4">
      <div className="min-w-0 space-y-4">
        {showRestore && stored && (
          <div className="rounded-xl border border-sky-500/30 bg-sky-500/[0.07] px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-3">
            <History size={18} className="text-sky-600 shrink-0 hidden sm:block" />
            <p className="text-sm flex-1">
              Tenés datos sin guardar de este contrato <span className="text-muted-foreground">({formatTimeAgo(stored.savedAt)})</span>.
            </p>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={discardStored}>
                Descartar
              </Button>
              <Button size="sm" onClick={restore}>
                Recuperar
              </Button>
            </div>
          </div>
        )}
        <WizardStepsBar current={step} visited={visited} flagged={flagged} onGo={goToIndex} />
        <Card key={key} className="p-4 sm:p-6 gap-0 animate-fade-up">
          {key === "propiedad" && <StepProperty {...stepProps} />}
          {key === "partes" && <StepParties {...stepProps} />}
          {key === "plazo" && <StepTerms {...stepProps} />}
          {key === "ajuste" && <StepAdjustment {...stepProps} />}
          {key === "cobro" && <StepBilling {...stepProps} />}
          {key === "honorarios" && <StepFees {...stepProps} />}
          {key === "servicios" && <StepServices {...stepProps} />}
          {key === "revision" && <StepReview {...stepProps} />}
        </Card>
        <div className="sticky bottom-3 z-20 flex items-center justify-between gap-2 rounded-xl border bg-background/95 backdrop-blur px-3 py-2.5 shadow-sm sm:static sm:border-0 sm:bg-transparent sm:backdrop-blur-none sm:p-0 sm:shadow-none">
          <Button type="button" variant="ghost" onClick={() => goToIndex(step - 1)} disabled={step === 0 || saving} className="gap-1.5">
            <ArrowLeft size={15} /> Atrás
          </Button>
          <div className="flex items-center gap-2">
            {(step === last || (mode === "edit" && !isDraft)) && (
              <Button type="button" variant={step === last && isDraft ? "outline" : "default"} onClick={() => save(false)} disabled={saving} className="gap-1.5">
                {saving && savingKind === "draft" ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
                {isDraft ? <span>Guardar borrador</span> : <span>Guardar cambios</span>}
              </Button>
            )}
            {step === last && isDraft ? (
              <Button type="button" onClick={() => save(true)} disabled={saving} className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white">
                {saving && savingKind === "activate" ? <Loader2 size={15} className="animate-spin" /> : <Rocket size={15} />} Activar contrato
              </Button>
            ) : step < last ? (
              <Button type="button" variant={mode === "edit" && !isDraft ? "outline" : "default"} onClick={next} disabled={saving} className="gap-1.5">
                Siguiente <ArrowRight size={15} />
              </Button>
            ) : null}
          </div>
        </div>
      </div>
      <aside className="lg:sticky lg:top-4 min-w-0">
        <WizardSummary {...stepProps} />
      </aside>
    </div>
  );
}
