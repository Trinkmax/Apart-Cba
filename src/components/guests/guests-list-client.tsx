"use client";

import { useState, useMemo } from "react";
import { Search, Phone, Mail, Globe, BadgeCheck, ShieldAlert } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { getInitials, formatTimeAgo } from "@/lib/format";
import { GuestProfileDialog } from "@/components/guests/guest-profile-dialog";
import { RenameGuestButton } from "@/components/guests/rename-guest-button";
import type { Guest } from "@/lib/types/database";

export function GuestsListClient({ guests }: { guests: Guest[] }) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    if (!query.trim()) return guests;
    const q = query.toLowerCase();
    return guests.filter(
      (g) =>
        g.full_name.toLowerCase().includes(q) ||
        g.email?.toLowerCase().includes(q) ||
        g.phone?.includes(q) ||
        g.document_number?.includes(q)
    );
  }, [guests, query]);

  return (
    <>
      <div className="relative max-w-md">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Buscar nombre, email, teléfono, DNI…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="pl-9 h-10"
        />
      </div>

      {filtered.length === 0 ? (
        <Card className="p-12 text-center border-dashed text-sm text-muted-foreground">
          {query ? "Sin resultados" : "Aún no cargaste huéspedes"}
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="divide-y">
            {filtered.map((g) => (
              <div key={g.id} className="flex items-stretch group hover:bg-accent/30 transition-colors">
                <GuestProfileDialog guest={g}>
                  <button
                    type="button"
                    className="flex-1 flex items-center gap-3 p-3 text-left"
                  >
                    <Avatar className="size-10">
                      <AvatarFallback className="bg-primary/10 text-primary text-xs font-semibold">
                        {getInitials(g.full_name)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm truncate group-hover:text-primary transition-colors">
                          {g.full_name}
                        </span>
                        {g.blacklisted && (
                          <Badge variant="destructive" className="gap-1 text-[10px]">
                            <ShieldAlert size={10} /> Blacklist
                          </Badge>
                        )}
                      </div>
                    <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground">
                      {g.phone && (
                        <span className="flex items-center gap-1">
                          <Phone size={10} /> {g.phone}
                        </span>
                      )}
                      {g.email && (
                        <span className="flex items-center gap-1 truncate">
                          <Mail size={10} /> {g.email}
                        </span>
                      )}
                      {g.country && g.country !== "AR" && (
                        <span className="flex items-center gap-1">
                          <Globe size={10} /> {g.country}
                        </span>
                      )}
                    </div>
                  </div>
                    <div className="text-right text-xs">
                      <div className="font-medium flex items-center gap-1">
                        <BadgeCheck size={12} className="text-emerald-500" />
                        {g.total_bookings}
                      </div>
                      {g.last_stay_at && (
                        <div className="text-muted-foreground mt-0.5">
                          {formatTimeAgo(g.last_stay_at)}
                        </div>
                      )}
                    </div>
                  </button>
                </GuestProfileDialog>
                <div className="flex items-center pr-2">
                  <RenameGuestButton guestId={g.id} currentName={g.full_name} />
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </>
  );
}
