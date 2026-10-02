import { FileSearch } from "lucide-react";

/**
 * Link de rendición inválido (se cortó al copiarlo, o la inmobiliaria anuló
 * esa rendición y generó otra). No decimos si existe: sólo cómo recuperarla.
 */
export default function RendicionNotFound() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-muted/30 px-4 py-16">
      <div className="w-full max-w-md rounded-2xl border bg-card p-8 text-center shadow-sm">
        <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <FileSearch size={26} />
        </div>
        <h1 className="mt-5 text-xl font-semibold tracking-tight">No encontramos esta rendición</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          Puede que el link se haya cortado al copiarlo. Abrilo de nuevo desde el mail o el WhatsApp que te mandaron.
        </p>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">Si sigue sin abrir, pedile a tu inmobiliaria que te reenvíe la rendición.</p>
      </div>
    </div>
  );
}
