"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft, ArrowRight, History, Loader2, RefreshCcw, Rocket, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { formatTimeAgo } from "@/lib/format";
import { isStaleDeployError, toastActionFailure } from "@/lib/action-failure";
import { previewContractPlan, saveRentalContract } from "@/lib/actions/rentals-contracts";
import { useLiveContext } from "@/lib/realtime/live-context";
import { joinNamesEs } from "@/lib/rentals/renewal";
import type { RentalContractStatus } from "@/lib/types/database";
import type { ContractFormOptions, PersonOption, PlanPreview, PropertyOption } from "./types";
import {
  WIZARD_STEPS,
  guarantorsMissingConsent,
  overridesForSave,
  parseWizard,
  partyField,
  previewInputOf,
  stepOfField,
  type WizardState,
  type WizardStepKey,
} from "./wizard-state";
import {
  autoRestoreMarkValid,
  decodeWizardDraft,
  encodeAutoRestoreMark,
  encodeWizardDraft,
  legacyWizardDraftKey,
  ownWizardDraft,
  planWizardDraft,
  wizardAsideKey,
  wizardAutoRestoreKey,
  wizardDraftAfterSave,
  wizardDraftKey,
  type StoredWizardDraft,
} from "./wizard-draft";
import type { KeptForReload } from "./wizard-step-props";
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
 * reales, calculado en el servidor) y borrador local para no perder lo tipeado
 * (por organización y usuario: ver wizard-draft.ts).
 */

function subscribeStorage(cb: () => void) {
  window.addEventListener("storage", cb);
  return () => window.removeEventListener("storage", cb);
}

/**
 * Guarda lo de esta pantalla en la clave principal. Si todavía hay un borrador de antes sin decidir
 * (`olderRaw`), primero lo pone aparte: lo nuevo queda guardado y lo de antes se sigue pudiendo
 * recuperar o descartar. Si no se puede poner aparte, no se pisa. false = no se guardó (modo
 * privado, storage bloqueado o lleno).
 */
function persistDraft(key: string, olderRaw: string | null, step: number, state: WizardState): boolean {
  try {
    if (olderRaw !== null) window.localStorage.setItem(wizardAsideKey(key), olderRaw);
    window.localStorage.setItem(key, encodeWizardDraft(step, state));
    return true;
  } catch {
    return false;
  }
}

function readRaw(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Deja `raw` en la clave, o la borra si es null. false si no hay storage. */
function putRaw(key: string | null, raw: string | null): boolean {
  if (!key) return false;
  try {
    if (raw === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, raw);
    return true;
  } catch {
    return false;
  }
}

/** Marca de esta pestaña: "al recargar, reponé lo cargado". false si no se pudo dejar. */
function markAutoRestore(storageKey: string): boolean {
  try {
    window.sessionStorage.setItem(wizardAutoRestoreKey(storageKey), encodeAutoRestoreMark());
    return true;
  } catch {
    return false;
  }
}

/** Al abrir: hay marca vigente y el borrador al que se refiere sigue guardado. */
function shouldAutoRestore(storageKey: string | null): boolean {
  if (!storageKey || typeof window === "undefined") return false;
  try {
    return autoRestoreMarkValid(window.sessionStorage.getItem(wizardAutoRestoreKey(storageKey))) && window.localStorage.getItem(storageKey) !== null;
  } catch {
    return false;
  }
}

function clearAutoRestoreMark(storageKey: string | null) {
  if (!storageKey) return;
  try {
    window.sessionStorage.removeItem(wizardAutoRestoreKey(storageKey));
  } catch {
    /* sin storage: no hay marca */
  }
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

/**
 * El borrador es de una organización y un usuario. Si cambian con la pantalla abierta (el selector
 * de organización no navega: refresca la página), el asistente vuelve a arrancar con las opciones
 * de la nueva. Lo cargado era de la otra: no puede guardarse —ni ofrecerse— en esta. Queda en su
 * clave para cuando se vuelva a esa organización.
 */
export function ContractWizard(props: ContractWizardProps) {
  const live = useLiveContext();
  // Sin organización o usuario (fuera del panel) no hay borrador: nunca una clave compartida por todo el navegador.
  const storageKey = live?.organizationId && live.userId ? wizardDraftKey(props.contractId ?? null, live.organizationId, live.userId) : null;
  return <ContractWizardBody key={storageKey ?? "sin-borrador"} {...props} storageKey={storageKey} />;
}

function ContractWizardBody({
  mode,
  contractId = null,
  contractStatus = null,
  contractLabel = null,
  initial,
  options,
  hasPayments = false,
  initialStep = 0,
  storageKey,
}: ContractWizardProps & { storageKey: string | null }) {
  const router = useRouter();
  const legacyKey = legacyWizardDraftKey(contractId);
  const last = WIZARD_STEPS.length - 1;
  const isDraft = mode === "create" || contractStatus === "borrador";
  const topRef = useRef<HTMLDivElement>(null);

  const [state, setState] = useState<WizardState>(initial);
  const [step, setStep] = useState(Math.min(Math.max(0, initialStep), last));
  const [visited, setVisited] = useState(mode === "edit" ? last : Math.min(Math.max(0, initialStep), last));
  const [attempted, setAttempted] = useState<Set<WizardStepKey>>(() => new Set());
  const [serverError, setServerError] = useState<{ field: string; message: string } | null>(null);
  const [dirty, setDirty] = useState(false);
  // Qué se hizo con el borrador que estaba guardado al abrir: hasta que se elige, no se pisa.
  const [draftChoice, setDraftChoice] = useState<"pendiente" | "recuperado" | "descartado">("pendiente");
  // Esta pantalla ya escribió su propio borrador: lo guardado es lo de acá, no algo para recuperar.
  const [wroteDraft, setWroteDraft] = useState(false);
  // Para guardar lo suyo, esta pantalla puso aparte el borrador de antes que todavía no se eligió (wizardAsideKey).
  const [keptAside, setKeptAside] = useState(false);
  const [autoRestored, setAutoRestored] = useState(false);
  const [extraProperties, setExtraProperties] = useState<PropertyOption[]>([]);
  const [extraPeople, setExtraPeople] = useState<PersonOption[]>([]);
  const [preview, setPreview] = useState<PlanPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [saving, startSaving] = useTransition();
  const [savingKind, setSavingKind] = useState<"draft" | "activate" | null>(null);
  // Campo al que saltar cuando algo falta (p. ej. la propiedad o el inquilino): no alcanza con abrir el paso.
  const [focusRequest, setFocusRequest] = useState<{ field: string } | null>(null);

  const clampStep = (n: number) => Math.min(Math.max(0, n), last);
  // Si es renovación lo dice el contrato, no lo guardado en el navegador (que puede ser de antes).
  // Un campo que el borrador no trae (es de antes de que existiera) queda con el valor de arranque.
  const restoredState = (draft: StoredWizardDraft): WizardState => ({ ...initial, ...draft.state, is_renewal: initial.is_renewal });

  // Ids de esta organización: lo que ofrece el asistente y lo que ya trae el contrato (puede estar archivado).
  const knownIds = useMemo(
    () =>
      new Set(
        [...options.properties.map((p) => p.id), ...options.people.map((p) => p.id), initial.property_id, ...initial.parties.map((p) => p.person_id)].filter(Boolean),
      ),
    [options.properties, options.people, initial],
  );

  // Borrador local: se lee sin efecto (servidor = null) y se ofrece recuperarlo. Antes de que esta
  // pantalla escriba, es el de la clave principal (o el que había quedado aparte); el de la clave
  // vieja cuenta sólo si demuestra ser de esta organización (planWizardDraft). Después, lo único
  // para ofrecer es lo de antes que esta pantalla puso aparte.
  const storedRaw = useSyncExternalStore(
    subscribeStorage,
    () => {
      if (!storageKey) return null;
      try {
        const ls = window.localStorage;
        const asideKey = wizardAsideKey(storageKey);
        if (keptAside) return ls.getItem(asideKey);
        if (wroteDraft) return null;
        return planWizardDraft(ownWizardDraft(ls.getItem(storageKey), ls.getItem(asideKey)).raw, ls.getItem(legacyKey), knownIds).offer;
      } catch {
        return null;
      }
    },
    () => null,
  );
  const stored = useMemo(() => decodeWizardDraft(storedRaw), [storedRaw]);
  // Un borrador de antes que todavía nadie recuperó ni descartó. Mientras exista, el aviso queda
  // arriba (aunque ya se haya tocado algo). Lo que se carga ahora se guarda igual y no lo pisa: al
  // primer guardado, lo de antes pasa aparte (persistDraft).
  const pendingStored = stored && draftChoice === "pendiente" ? stored : null;

  // Una sola vez al abrir (si las opciones se refrescan, no se vuelve a mudar nada):
  // - La clave vieja era una sola para todo el navegador: se muda a la de esta persona sólo si es de
  //   esta organización (si no, traería montos, garantías y notas de otra). La que no se puede
  //   comprobar se deja para su dueño: a nadie más se le ofrece.
  // - Si la clave principal está vacía, lo que había quedado aparte vuelve a ella para ofrecerse.
  const migratedRef = useRef(false);
  useEffect(() => {
    if (!storageKey || migratedRef.current) return;
    migratedRef.current = true;
    try {
      const ls = window.localStorage;
      const asideKey = wizardAsideKey(storageKey);
      const own = ownWizardDraft(ls.getItem(storageKey), ls.getItem(asideKey));
      const plan = planWizardDraft(own.raw, ls.getItem(legacyKey), knownIds);
      // Si el de la clave vieja es más nuevo, va a la principal y el de aparte sigue aparte.
      if (plan.adopt && plan.offer !== null) ls.setItem(storageKey, plan.offer);
      else if (own.promoteAside && own.raw !== null) {
        ls.setItem(storageKey, own.raw);
        ls.removeItem(asideKey);
      }
      if (plan.removeLegacy) ls.removeItem(legacyKey);
    } catch {
      /* sin storage: no hay nada que mudar */
    }
  }, [storageKey, legacyKey, knownIds]);

  // Volver de «Recargar» después de que guardar falló por un deploy: el aviso prometió que lo
  // cargado vuelve a aparecer, así que se repone solo. La marca es de esta pestaña, se lee una sola
  // vez al abrir (la que deja esta misma pantalla al fallar es para después de recargar) y se borra.
  // No se muestra: en el servidor da false sin romper la hidratación. El borrador recién se puede
  // leer después de hidratar, así que se repone con un ajuste de state durante render (como pms-board).
  const [restoreOnOpen] = useState(() => shouldAutoRestore(storageKey));
  if (restoreOnOpen && pendingStored && !dirty && !autoRestored) {
    setAutoRestored(true);
    setState(restoredState(pendingStored));
    setStep(clampStep(pendingStored.step));
    setVisited(last);
    setDirty(true);
    setDraftChoice("recuperado");
  }
  useEffect(() => {
    // Sólo al abrir (la clave no cambia sin volver a montar): una marca que deje esta pantalla después queda para la próxima.
    clearAutoRestoreMark(storageKey);
  }, [storageKey]);
  useEffect(() => {
    if (autoRestored) toast.success("Recuperamos lo que estabas cargando", { id: "contrato-recuperado" });
  }, [autoRestored]);

  // El borrador se escribe medio segundo después de cada cambio (la página promete que lo cargado
  // queda guardado), también con un borrador de antes sin decidir: ese pasa aparte la primera vez.
  // Con el contrato ya guardado, una escritura que había quedado pendiente no lo vuelve a dejar (si
  // no, reaparecería "sin guardar").
  const savedRef = useRef(false);
  const olderRaw = pendingStored && !keptAside ? storedRaw : null;
  useEffect(() => {
    if (!dirty || !storageKey) return;
    const t = setTimeout(() => {
      if (savedRef.current || !persistDraft(storageKey, olderRaw, step, state)) return;
      setWroteDraft(true);
      if (olderRaw !== null) setKeptAside(true);
    }, 500);
    return () => clearTimeout(t);
  }, [dirty, state, step, storageKey, olderRaw]);

  /**
   * Guarda ya lo cargado, sin esperar el medio segundo (no llegó respuesta del servidor). Con
   * `forReload` (deploy nuevo: hay que recargar) deja además la marca para que al volver se reponga
   * solo. "solo": vuelve solo; "recuperar": queda para «Recuperar»; null: no se pudo guardar.
   */
  function keepNow(forReload: boolean): KeptForReload {
    if (!storageKey || !persistDraft(storageKey, olderRaw, step, state)) return null;
    setWroteDraft(true);
    if (olderRaw !== null) setKeptAside(true);
    return forReload && markAutoRestore(storageKey) ? "solo" : "recuperar";
  }

  // Vista previa con los índices reales (debounced; descarta respuestas viejas).
  const previewInput = previewInputOf(state);
  const previewKey = previewInput ? JSON.stringify(previewInput) : null;
  const seq = useRef(0);
  useEffect(() => {
    if (!previewKey) return;
    const id = ++seq.current;
    const t = setTimeout(async () => {
      setPreviewLoading(true);
      try {
        const res = await previewContractPlan(JSON.parse(previewKey));
        if (id !== seq.current) return;
        // Si no se pudo calcular, el resumen vuelve a "—": las cifras de antes serían de otros datos.
        setPreview(res.ok ? res.preview : null);
      } catch {
        // Sin respuesta (conexión o deploy nuevo): el resumen es una ayuda, no frena la carga, pero
        // tampoco muestra cifras de antes del cambio. Si fue un deploy, guardar lo avisa con «Recargar».
        if (id === seq.current) setPreview(null);
      } finally {
        if (id === seq.current) setPreviewLoading(false);
      }
    }, 450);
    return () => clearTimeout(t);
  }, [previewKey]);
  const shownPreview = previewKey ? preview : null;

  // Corre después de montar el paso (si hubo que cambiar de paso): busca el campo marcado, lo centra y lo enfoca.
  useEffect(() => {
    if (!focusRequest) return;
    const frame = requestAnimationFrame(() => {
      // Sin un control con ese ancla (un aviso general del paso) no se salta: el paso ya muestra el aviso.
      const el = document.querySelector<HTMLElement>(`[data-wizard-field="${CSS.escape(focusRequest.field)}"]`);
      if (!el) return;
      el.scrollIntoView({ block: "center", behavior: "smooth" });
      el.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [focusRequest]);

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
    savedRef.current = false;
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
      // El aviso nombra lo que falta ("Falta el inquilino…") y el foco va a ese campo.
      toast.error(issue.message);
      setFocusRequest({ field: issue.field });
      return;
    }
    goToIndex(step + 1);
  }

  function restore() {
    if (!pendingStored) return;
    // Si estaba aparte (esta pantalla ya guardaba lo suyo), vuelve ya a la clave principal: es lo que
    // sigue de acá en adelante. Reemplaza lo que se venía cargando, como avisa el cartel.
    if (keptAside && storageKey && putRaw(storageKey, storedRaw)) {
      putRaw(wizardAsideKey(storageKey), null);
      setKeptAside(false);
    }
    setState(restoredState(pendingStored));
    setStep(clampStep(pendingStored.step));
    setVisited(last);
    setDirty(true);
    setDraftChoice("recuperado");
    toast.success("Recuperamos lo que estabas cargando");
  }
  function discardStored() {
    // Sólo lo que se ofreció: aparte si esta pantalla ya guardaba lo suyo (eso no se toca); si no, en
    // la clave principal. Uno de la clave vieja que no se pudo adoptar no es lo que se ofreció.
    if (storageKey) putRaw(keptAside ? wizardAsideKey(storageKey) : storageKey, null);
    setKeptAside(false);
    clearAutoRestoreMark(storageKey);
    setDraftChoice("descartado");
  }

  function save(activate: boolean) {
    const parsed = parseWizard(state);
    if (!parsed.input) {
      setAttempted(new Set(WIZARD_STEPS.map((s) => s.key)));
      const first = parsed.issues[0];
      const where = first ? WIZARD_STEPS.find((s) => s.key === first.step)?.label : undefined;
      toast.error(first?.message ?? "Faltan datos", { description: where ? `Está en el paso «${where}».` : undefined });
      if (first) {
        goTo(first.step);
        setFocusRequest({ field: first.field });
      }
      return;
    }
    // Renovación (art. 1225 CCyC): el borrador se guarda sin las firmas de los
    // garantes, pero no se activa —ni se guarda ya vigente— sin la fecha de cada uno.
    const unsigned = guarantorsMissingConsent(state, options.today);
    if (unsigned.length && (activate || !isDraft)) {
      const names = joinNamesEs(unsigned.map((p) => people.find((x) => x.id === p.person_id)?.fullName ?? "un garante"));
      const many = unsigned.length > 1;
      toast.error(many ? "Faltan las firmas de los garantes" : "Falta la firma de un garante", {
        description: many
          ? `Es una renovación: cargá la fecha en que firmaron ${names} (art. 1225 CCyC), o sacá del contrato al que no firme.`
          : `Es una renovación: cargá la fecha en que firmó ${names} (art. 1225 CCyC), o sacalo del contrato si no firma.`,
      });
      goTo("partes");
      setFocusRequest({ field: partyField.consent(unsigned[0].key) });
      return;
    }
    const entry = activate && state.generate_entry_charge ? entryOf(state, options.settings) : null;
    setSavingKind(activate ? "activate" : "draft");
    startSaving(async () => {
      let res: Awaited<ReturnType<typeof saveRentalContract>>;
      try {
        res = await saveRentalContract({
          id: contractId,
          input: parsed.input,
          overrides: isDraft ? overridesForSave(state) : undefined,
          activate: activate ? { entryItems: entry?.chargeItems ?? [], entryDueDate: state.start_date > options.today ? state.start_date : options.today } : null,
        });
      } catch (error) {
        // No llegó respuesta (conexión o deploy nuevo): lo cargado queda ya mismo en el borrador de
        // este navegador. Con un deploy nuevo hay que recargar: al volver, se repone solo; si la marca
        // no se pudo dejar, queda el aviso de arriba para recuperarlo.
        const kept = dirty ? keepNow(isStaleDeployError(error)) : null;
        toastActionFailure(error, activate ? "No se pudo activar el contrato" : "No se pudo guardar", {
          afterReload: kept === "solo" ? "Lo que cargaste vuelve a aparecer." : kept === "recuperar" ? "Después, tocá «Recuperar» arriba de los pasos." : undefined,
        });
        return;
      }
      if (!res.ok) {
        if (res.field) setServerError({ field: res.field, message: res.error });
        toast.error(activate ? "No se pudo activar el contrato" : "No se pudo guardar", { description: res.error });
        const key = stepOfField(res.field);
        if (key) goTo(key);
        if (res.field) setFocusRequest({ field: res.field });
        return;
      }
      savedRef.current = true;
      // Lo de esta pantalla ya está en el sistema. Un borrador de antes que nadie eligió se conserva
      // para la próxima en un alta (puede ser otro contrato) y se tira al editar (wizardDraftAfterSave).
      if (storageKey) {
        const asideKey = wizardAsideKey(storageKey);
        const after = wizardDraftAfterSave(mode === "create", !wroteDraft && pendingStored ? storedRaw : null, readRaw(asideKey));
        putRaw(storageKey, after.main);
        putRaw(asideKey, after.aside);
      }
      clearAutoRestoreMark(storageKey);
      setDirty(false);
      if (activate && res.activated) toast.success("Contrato activado", { description: "Ya rige: se armó el cronograma de ajustes y los cargos que tocan." });
      else if (activate) toast.warning("Se guardó, pero no se pudo activar", { description: res.activationError ?? undefined });
      // El aviso del servidor nombra los cargos que no se recalcularon (gastos de ingreso, extras): que se lea antes de que se vaya.
      else
        toast.success(isDraft ? "Borrador guardado" : "Cambios guardados", {
          description: isDraft ? "Activalo cuando esté firmado." : (res.notice ?? undefined),
          duration: !isDraft && res.notice ? 12000 : undefined,
        });
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
    // Sin nada sin guardar no hay nada que perder: al recargar, el contrato está como estaba.
    keepForReload: () => (dirty ? keepNow(true) : "solo"),
  };
  const key = WIZARD_STEPS[step].key;
  const unsignedCount = guarantorsMissingConsent(state, options.today).length;

  return (
    <div ref={topRef} className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_21rem] lg:items-start scroll-mt-4">
      <div className="min-w-0 space-y-4">
        {pendingStored && (
          <div className="rounded-xl border border-sky-500/30 bg-sky-500/[0.07] px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-3">
            <History size={18} className="text-sky-600 shrink-0 hidden sm:block" />
            <div className="flex-1 min-w-0 space-y-0.5">
              <p className="text-sm">
                Tenés datos sin guardar de este contrato <span className="text-muted-foreground">({formatTimeAgo(pendingStored.savedAt)})</span>.
              </p>
              {dirty && (
                <p className="text-xs text-muted-foreground leading-snug">
                  Lo que cargás ahora también queda guardado. «Recuperar» lo cambia por lo anterior;{" "}
                  {mode === "create" ? "si no elegís, lo anterior queda para la próxima vez." : "si guardás los cambios, lo anterior se descarta."}
                </p>
              )}
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={discardStored} disabled={saving}>
                Descartar
              </Button>
              <Button size="sm" onClick={restore} disabled={saving}>
                Recuperar
              </Button>
            </div>
          </div>
        )}
        {initial.is_renewal && isDraft && (
          <div className="rounded-xl border border-teal-500/30 bg-teal-500/[0.07] px-4 py-3 flex gap-3">
            <RefreshCcw size={18} className="text-teal-600 dark:text-teal-400 shrink-0 mt-0.5 hidden sm:block" />
            <div className="min-w-0 space-y-1">
              <p className="text-sm font-medium">Es una renovación: un contrato nuevo que se firma ahora.</p>
              <p className="text-xs text-muted-foreground leading-snug">
                Copiamos las condiciones y las personas del anterior. El régimen, la rescisión, el sellado y el código RELI van como en un contrato nuevo: revisalos junto con el plazo y el
                precio.
              </p>
              {unsignedCount > 0 && (
                <p className="text-xs text-amber-800 dark:text-amber-200 leading-snug">
                  {unsignedCount === 1 ? "Falta la fecha en que el garante firmó" : `Faltan las fechas en que ${unsignedCount} garantes firmaron`} la renovación (art. 1225 CCyC): cargala en{" "}
                  <button type="button" onClick={() => goTo("partes")} className="underline underline-offset-2 hover:no-underline font-medium">
                    Inquilino y garantes
                  </button>{" "}
                  antes de activar.
                </p>
              )}
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
