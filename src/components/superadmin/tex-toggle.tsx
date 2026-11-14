"use client";

import * as React from "react";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { setOrgTexEnabled } from "@/lib/actions/tex";
import { TexAvatar } from "@/components/tex/tex-avatar";

/** Encender Tex (el agente con Claude) para una organización. Sólo superadmin. */
export function TexToggle({ orgId, enabled }: { orgId: string; enabled: boolean }) {
  const [on, setOn] = React.useState(enabled);
  const [pending, startTransition] = React.useTransition();
  return (
    <label className="mt-3 flex items-center gap-2 rounded-xl bg-[#eef6ff] px-2.5 py-2 text-[12.5px] dark:bg-[#123250]">
      <TexAvatar mood="face" className="size-6" />
      <span className="flex-1 font-medium text-[#0b3d68] dark:text-[#cfe7ff]">Tex (asistente IA)</span>
      <Switch
        checked={on}
        disabled={pending}
        onCheckedChange={(next) => {
          setOn(next);
          startTransition(async () => {
            const r = await setOrgTexEnabled(orgId, next);
            if (!r.ok) {
              setOn(!next);
              toast.error(r.error);
            } else toast.success(next ? "Tex encendido para esta organización." : "Tex apagado.");
          });
        }}
        aria-label="Tex para esta organización"
      />
    </label>
  );
}
