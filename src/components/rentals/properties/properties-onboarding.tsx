import { Building, FileSignature, KeyRound } from "lucide-react";
import { Card } from "@/components/ui/card";
import { NewPropertyButton } from "./new-property-button";

const STEPS = [
  {
    icon: Building,
    title: "Cargá la propiedad y su dueño",
    body: "La dirección y quién es el propietario (si son varios, con su %). A él se le rinde lo que se cobra.",
  },
  {
    icon: FileSignature,
    title: "Sumá el mandato y los servicios",
    body: "El mandato de administración firmado y los números de cuenta de EPEC, Ecogas, Aguas Cordobesas o Rentas.",
  },
  {
    icon: KeyRound,
    title: "Alquilala con un contrato",
    body: "Inquilino, garantes, precio e índice de ajuste. Desde ahí salen los cobros de cada mes y las rendiciones.",
  },
];

/** Primera vez: en lugar de "no hay nada", cómo arrancar en tres pasos. */
export function PropertiesOnboarding() {
  return (
    <Card className="p-5 sm:p-6 border-dashed gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-base font-semibold">Tus propiedades en alquiler, en un solo lugar</p>
          <p className="text-sm text-muted-foreground mt-1 max-w-xl">
            Cada departamento, casa o local que administra la inmobiliaria: quién es el dueño, si está alquilado o vacante, y todo
            su historial.
          </p>
        </div>
        <NewPropertyButton label="Cargar la primera propiedad" />
      </div>
      <ol className="grid gap-4 sm:grid-cols-3">
        {STEPS.map((s, i) => (
          <li key={s.title} className="flex gap-3 sm:flex-col sm:gap-2.5">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-teal-500/10 text-teal-700 dark:text-teal-300 text-xs font-semibold tabular-nums">
              {i + 1}
            </span>
            <div className="min-w-0">
              <p className="text-sm font-medium leading-snug flex items-center gap-1.5">
                <s.icon size={14} className="text-muted-foreground" /> {s.title}
              </p>
              <p className="text-xs text-muted-foreground leading-relaxed mt-0.5">{s.body}</p>
            </div>
          </li>
        ))}
      </ol>
    </Card>
  );
}
