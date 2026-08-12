"use client";

import { useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Check, Loader2, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { startTrial, type StartTrialInput } from "@/lib/actions/trial";
import { cn } from "@/lib/utils";

/**
 * Alta en una sola pantalla. Cuatro campos y un botón: cada campo extra cuesta
 * conversión, y la promesa de la landing es entrar en menos de un minuto.
 *
 * El campo "operación" se autocompleta con el nombre de la persona mientras
 * escribe y se despega en cuanto lo edita: personaliza el panel (el nombre sale
 * en la barra superior y en el sidebar) sin cobrarle un tipeo extra al visitante.
 */

const STEPS = [
  "Creando tu cuenta",
  "Armando tu operación",
  "Cargando departamentos y reservas de ejemplo",
  "Listo, entrando al panel",
] as const;

type Field = keyof StartTrialInput;

export function TrialForm() {
  const router = useRouter();
  const uid = useId();
  const [pending, startAction] = useTransition();

  const [fullName, setFullName] = useState("");
  const [orgName, setOrgName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<{ message: string; field?: Field } | null>(null);
  const [step, setStep] = useState(-1);

  // Mientras el visitante no toque el campo, la operación se llama como él. El
  // espejado se escribe en el estado del campo (no se deriva en el render) para
  // que el input sea un controlado común y corriente, con un solo origen de dato.
  const [orgTouched, setOrgTouched] = useState(false);

  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  function runStepTheatre() {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    setStep(0);
    // El alta tarda ~2 s reales (auth + org + las filas sembradas). Los pasos
    // acompañan ese tiempo y se frenan en el anteúltimo hasta que la acción
    // responde: nunca decimos "listo" antes de que lo esté.
    timers.current.push(setTimeout(() => setStep(1), 700));
    timers.current.push(setTimeout(() => setStep(2), 1500));
  }

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setError(null);
    runStepTheatre();

    startAction(async () => {
      const result = await startTrial({
        full_name: fullName,
        org_name: orgName,
        email,
        password,
      });

      timers.current.forEach(clearTimeout);
      timers.current = [];

      if (!result.ok) {
        setStep(-1);
        setError({ message: result.error, field: result.field });
        return;
      }

      setStep(STEPS.length - 1);
      router.push("/dashboard");
      router.refresh();
    });
  }

  const busy = pending || step >= 0;

  return (
    <form onSubmit={onSubmit} className="w-full" noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          id={`${uid}-name`}
          label="Tu nombre y apellido"
          value={fullName}
          onChange={(v) => {
            setFullName(v);
            if (!orgTouched) setOrgName(v);
          }}
          autoComplete="name"
          placeholder="Julián Ceballos"
          invalid={error?.field === "full_name"}
          disabled={busy}
        />
        <FormField
          id={`${uid}-org`}
          label="Cómo se llama tu operación"
          value={orgName}
          onChange={(v) => {
            setOrgTouched(true);
            setOrgName(v);
          }}
          autoComplete="organization"
          placeholder="Ceballos Rentals"
          hint="Es el nombre que vas a ver en el panel. Lo podés cambiar después."
          invalid={error?.field === "org_name"}
          disabled={busy}
        />
        <FormField
          id={`${uid}-email`}
          label="Email"
          type="email"
          value={email}
          onChange={setEmail}
          autoComplete="email"
          placeholder="vos@tudominio.com"
          invalid={error?.field === "email"}
          disabled={busy}
        />
        <FormField
          id={`${uid}-password`}
          label="Contraseña"
          type="password"
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
          placeholder="Mínimo 8 caracteres"
          invalid={error?.field === "password"}
          disabled={busy}
        />
      </div>

      {error && (
        <p
          role="alert"
          className="mt-4 flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2.5 text-sm text-foreground"
        >
          <TriangleAlert size={15} className="mt-px shrink-0 text-destructive" />
          {error.message}
        </p>
      )}

      <Button
        type="submit"
        size="lg"
        disabled={busy}
        className="mt-6 h-12 w-full rounded-full px-7 text-[15px] active:scale-[0.985] sm:w-auto"
      >
        {busy ? (
          <>
            <Loader2 className="animate-spin" />
            Preparando tu panel
          </>
        ) : (
          <>
            Crear mi panel
            <ArrowRight />
          </>
        )}
      </Button>

      {step >= 0 ? (
        <ol className="mt-5 space-y-2" aria-live="polite">
          {STEPS.map((label, i) => (
            <li
              key={label}
              className={cn(
                "flex items-center gap-2.5 text-sm transition-colors duration-300",
                i < step && "text-muted-foreground",
                i === step && "text-foreground",
                i > step && "text-muted-foreground/50"
              )}
            >
              <span className="flex size-4 shrink-0 items-center justify-center">
                {i < step ? (
                  <Check size={13} className="text-primary" />
                ) : i === step ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : (
                  <span className="size-1.5 rounded-full bg-current opacity-50" />
                )}
              </span>
              {label}
            </li>
          ))}
        </ol>
      ) : (
        <p className="mt-4 text-sm text-muted-foreground">
          Sin tarjeta de crédito. El panel abre con datos de ejemplo que podés vaciar de un
          click cuando quieras cargar los tuyos.
        </p>
      )}
    </form>
  );
}

function FormField({
  id,
  label,
  value,
  onChange,
  type = "text",
  placeholder,
  autoComplete,
  hint,
  invalid,
  disabled,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
  autoComplete?: string;
  hint?: string;
  invalid?: boolean;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        disabled={disabled}
        aria-invalid={invalid || undefined}
        className="h-11 md:text-[15px]"
      />
      {hint && <p className="text-xs leading-snug text-muted-foreground">{hint}</p>}
    </div>
  );
}
