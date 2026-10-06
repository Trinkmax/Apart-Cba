import type { ContractFormOptions, PersonOption, PlanPreview, PropertyOption } from "./types";
import type { WizardState, WizardStepKey } from "./wizard-state";

/**
 * Lo cargado en el asistente cuando hay que recargar la página (se actualizó el sistema con un
 * formulario abierto adentro, p. ej. «Inquilino nuevo»): "solo" = al volver, el asistente aparece
 * como estaba (o no había nada sin guardar); "recuperar" = quedó guardado para «Recuperar»;
 * null = no se pudo guardar.
 */
export type KeptForReload = "solo" | "recuperar" | null;

/** Lo que recibe cada paso del asistente. */
export interface StepProps {
  state: WizardState;
  set: (patch: Partial<WizardState> | ((s: WizardState) => Partial<WizardState>)) => void;
  /** campo → mensaje (sólo de los pasos donde ya se intentó avanzar). */
  errors: Record<string, string>;
  options: ContractFormOptions;
  /** Opciones + lo creado en el momento desde el asistente. */
  properties: PropertyOption[];
  people: PersonOption[];
  addProperty: (p: PropertyOption) => void;
  addPerson: (p: PersonOption) => void;
  preview: PlanPreview | null;
  previewLoading: boolean;
  today: string;
  mode: "create" | "edit";
  /** Contrato nuevo o en borrador (se pueden cargar montos reales de ajustes ya pasados). */
  isDraft: boolean;
  /** El contrato ya tiene cobros: las condiciones económicas no se pueden cambiar. */
  hasPayments: boolean;
  contractId: string | null;
  /** Ir a un paso (desde la revisión). */
  goTo: (step: WizardStepKey) => void;
  /** "C-0007" al editar; null en un contrato nuevo. */
  contractLabel: string | null;
  /** Un formulario abierto adentro del asistente falló por un deploy nuevo: guarda ya lo cargado para después de recargar. */
  keepForReload: () => KeptForReload;
}
