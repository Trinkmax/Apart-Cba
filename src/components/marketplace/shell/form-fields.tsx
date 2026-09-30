"use client";

import { useId, useState } from "react";
import { CircleAlert, CircleCheck, Eye, EyeOff, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { suggestEmailFix } from "./email-typo";

/**
 * Campos de formulario de la web (cuenta, perfil). Inputs `rounded-2xl h-12`
 * sobre papel, 16 px (iOS no hace zoom), foco forest y error rojo de marca.
 */
export const inputClass = cn(
  "h-12 w-full rounded-2xl border border-cream-400 bg-paper px-4 font-apart text-base text-ink-900",
  "placeholder:text-ink-500/70 outline-none transition-[border-color,box-shadow] duration-200",
  "focus-visible:border-forest-600 focus-visible:ring-[3px] focus-visible:ring-forest-500/25",
  "disabled:cursor-not-allowed disabled:opacity-60",
  "aria-[invalid=true]:border-[#b42318] aria-[invalid=true]:focus-visible:ring-[#b42318]/20",
);

export const labelClass = "block text-[0.9375rem] font-semibold text-ink-900";

/** Label + control + ayuda + error, con los ids cableados para lectores de pantalla. */
export function Field({
  label,
  optional,
  hint,
  error,
  className,
  children,
}: {
  label: React.ReactNode;
  optional?: boolean;
  hint?: React.ReactNode;
  error?: string | null;
  className?: string;
  /** Recibe los ids a cablear en el control. */
  children: (ids: { id: string; describedBy: string | undefined; invalid: boolean }) => React.ReactNode;
}) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : null;
  const errorId = error ? `${id}-error` : null;
  const describedBy = [errorId, hintId].filter(Boolean).join(" ") || undefined;
  return (
    <div className={cn("space-y-2", className)}>
      <label htmlFor={id} className={labelClass}>
        {label}
        {optional ? <span className="ml-1.5 font-medium text-ink-500">(opcional)</span> : null}
      </label>
      {children({ id, describedBy, invalid: Boolean(error) })}
      {error ? (
        <p id={errorId ?? undefined} className="flex items-start gap-1.5 text-sm font-medium text-[#b42318]">
          <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
          {error}
        </p>
      ) : null}
      {hint ? (
        <p id={hintId ?? undefined} className="text-sm leading-snug text-ink-500">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

type InputProps = Omit<React.ComponentProps<"input">, "type">;

/** Contraseña con botón de mostrar/ocultar (≥ 44 px, con aria-label y aria-pressed). */
export function PasswordInput({ className, ...props }: InputProps) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <input
        {...props}
        type={visible ? "text" : "password"}
        className={cn(inputClass, "pr-14", className)}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? "Ocultar contraseña" : "Mostrar contraseña"}
        aria-pressed={visible}
        className="absolute right-1 top-1/2 flex size-11 -translate-y-1/2 items-center justify-center rounded-full text-ink-500 outline-none transition-colors hover:text-forest-700 focus-visible:ring-[3px] focus-visible:ring-forest-500/30"
      >
        {visible ? <EyeOff aria-hidden className="size-5" /> : <Eye aria-hidden className="size-5" />}
      </button>
    </div>
  );
}

/**
 * Email con sugerencia de typos comunes de dominio ("gmial.com" → "¿Quisiste
 * decir …@gmail.com?"). La sugerencia aparece al salir del campo.
 */
export function EmailInput({
  value,
  onValueChange,
  className,
  onBlur,
  ...props
}: Omit<InputProps, "value" | "onChange"> & { value: string; onValueChange: (v: string) => void }) {
  const [suggestion, setSuggestion] = useState<string | null>(null);
  return (
    <div>
      <input
        {...props}
        type="email"
        inputMode="email"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        value={value}
        onChange={(e) => {
          onValueChange(e.target.value);
          if (suggestion) setSuggestion(null);
        }}
        onBlur={(e) => {
          setSuggestion(suggestEmailFix(e.target.value));
          onBlur?.(e);
        }}
        className={cn(inputClass, className)}
      />
      <div aria-live="polite">
        {suggestion ? (
          <p className="mt-2 text-sm text-ink-700">
            ¿Quisiste decir{" "}
            <button
              type="button"
              onClick={() => {
                onValueChange(suggestion);
                setSuggestion(null);
              }}
              className="rounded font-semibold text-forest-700 underline decoration-forest-700/40 underline-offset-4 outline-none hover:decoration-forest-700 focus-visible:ring-[3px] focus-visible:ring-forest-500/30"
            >
              {suggestion}
            </button>
            ?
          </p>
        ) : null}
      </div>
    </div>
  );
}

const ALERT_TONES = {
  error: { box: "bg-[#fdecea] text-[#b42318] ring-[#b42318]/15", Icon: CircleAlert },
  info: { box: "bg-leaf-100 text-forest-800 ring-leaf-300", Icon: Info },
  ok: { box: "bg-leaf-100 text-forest-800 ring-leaf-300", Icon: CircleCheck },
} as const;

/**
 * Aviso dentro de un formulario. Los errores usan role="alert" (se anuncian
 * al aparecer); los avisos informativos, role="status".
 */
export function FormAlert({
  tone = "error",
  title,
  children,
  className,
}: {
  tone?: keyof typeof ALERT_TONES;
  title?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}) {
  const { box, Icon } = ALERT_TONES[tone];
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn("flex gap-3 rounded-2xl px-4 py-3.5 text-[0.9375rem] leading-snug ring-1", box, className)}
    >
      <Icon aria-hidden className="mt-0.5 size-5 shrink-0" />
      <div className="min-w-0 space-y-1">
        {title ? <p className="font-semibold">{title}</p> : null}
        {children ? <div className="text-pretty">{children}</div> : null}
      </div>
    </div>
  );
}

/** Casilla de verificación de marca (objetivo táctil de toda la fila). */
export function CheckboxRow({
  checked,
  onCheckedChange,
  disabled,
  children,
}: {
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-2xl py-1.5 text-[0.9375rem] leading-relaxed text-ink-700">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onCheckedChange(e.target.checked)}
        className="mt-1 size-5 shrink-0 cursor-pointer rounded-md border-cream-400 accent-forest-700 outline-none focus-visible:ring-[3px] focus-visible:ring-forest-500/30"
      />
      <span>{children}</span>
    </label>
  );
}
