"use client";

import { CopyButton } from "./copy-button";
import { getLinkExportUrl } from "@/lib/actions/channels";

/**
 * Botón "copiar enlace del calendario saliente" para usar desde Server
 * Components. El closure sobre la server action tiene que crearse en un
 * componente cliente — pasar `() => getLinkExportUrl(id)` directo desde un
 * Server Component rompe la serialización de RSC en runtime.
 */
export function ExportUrlCopy({ linkId, label }: { linkId: string; label?: string }) {
  return (
    <CopyButton
      getValue={() => getLinkExportUrl(linkId)}
      label={label ?? "Copiar enlace de nuestro calendario"}
      size="sm"
    />
  );
}
