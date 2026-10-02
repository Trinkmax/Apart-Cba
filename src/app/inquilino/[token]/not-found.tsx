import { LinkIcon } from "lucide-react";
import { ForceLightBody } from "@/components/rentals/portal/force-light-body";

/** Link inválido, viejo (se generó uno nuevo) o portal apagado. Sin datos: no sabemos de quién es. */
export default function TenantPortalNotFound() {
  return (
    <div className="light flex min-h-dvh items-center justify-center bg-[#f4f5f7] px-4 py-10 text-foreground">
      <ForceLightBody />
      <div className="w-full max-w-sm rounded-2xl border bg-card p-6 text-center shadow-sm">
        <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <LinkIcon size={22} />
        </span>
        <h1 className="mt-4 text-lg font-semibold tracking-tight">Este link no funciona</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          Puede que la inmobiliaria haya generado uno nuevo o que el contrato ya no esté activo. Pediles el link actualizado y lo
          abrís de nuevo desde acá.
        </p>
      </div>
    </div>
  );
}
