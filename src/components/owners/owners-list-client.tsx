"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { Search, Phone, Mail, Building2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { getInitials } from "@/lib/format";
import type { Owner } from "@/lib/types/database";

interface OwnersListClientProps {
  owners: Owner[];
}

export function OwnersListClient({ owners }: OwnersListClientProps) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    if (!query.trim()) return owners;
    const q = query.toLowerCase();
    return owners.filter(
      (o) =>
        o.full_name.toLowerCase().includes(q) ||
        (o.email?.toLowerCase().includes(q) ?? false) ||
        (o.phone?.includes(q) ?? false) ||
        (o.document_number?.includes(q) ?? false)
    );
  }, [owners, query]);

  return (
    <>
      <div className="relative max-w-md">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Buscar por nombre, email, teléfono o DNI…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="pl-9 h-10"
        />
      </div>

      {filtered.length === 0 ? (
        <Card className="p-12 text-center border-dashed">
          <Building2 className="size-10 mx-auto text-muted-foreground/50 mb-3" />
          <p className="text-sm font-medium">No hay propietarios todavía</p>
          <p className="text-xs text-muted-foreground mt-1">
            {query ? "Probá con otra búsqueda" : "Agregá el primero con el botón de arriba"}
          </p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map((owner) => (
            <Link
              key={owner.id}
              href={`/dashboard/propietarios/${owner.id}`}
              className="group focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-xl"
            >
              <Card className="p-4 hover:shadow-md hover:border-primary/30 transition-all duration-200 group-hover:-translate-y-0.5">
                <div className="flex items-start gap-3">
                  <Avatar className="size-11 shrink-0">
                    <AvatarFallback className="bg-primary/10 text-primary font-semibold">
                      {getInitials(owner.full_name)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-medium truncate">{owner.full_name}</h3>
                    <div className="flex flex-col gap-1 mt-2">
                      {owner.phone && (
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <Phone size={11} />
                          <span className="truncate">{owner.phone}</span>
                        </div>
                      )}
                      {owner.email && (
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <Mail size={11} />
                          <span className="truncate">{owner.email}</span>
                        </div>
                      )}
                    </div>
                    {owner.preferred_currency && owner.preferred_currency !== "ARS" && (
                      <Badge variant="secondary" className="mt-2 text-[10px] h-5">
                        Cobra en {owner.preferred_currency}
                      </Badge>
                    )}
                  </div>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
