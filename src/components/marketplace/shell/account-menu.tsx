"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { CalendarCheck, Heart, LayoutDashboard, LogOut, UserRound } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ApartButton } from "@/components/marketplace/brand/apart-button";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { notifyAuthChanged, type GuestIdentity } from "./use-guest-identity";

/** Páginas que no tienen sentido como destino de vuelta después de ingresar. */
const NO_RETURN = new Set(["/", "/ingresar", "/registrarse", "/reset-password"]);

/** "/ingresar" con la página actual como destino de vuelta. */
export function signInHref(pathname: string | null): string {
  if (!pathname || NO_RETURN.has(pathname) || pathname.startsWith("/auth/")) return "/ingresar";
  return `/ingresar?redirect=${encodeURIComponent(pathname)}`;
}

/** Páginas que requieren sesión: al salir, volvemos al inicio. */
function isPrivatePath(pathname: string | null): boolean {
  return Boolean(pathname && (pathname.startsWith("/mi-cuenta") || pathname.startsWith("/favoritos")));
}

/** Cierra la sesión en este navegador y deja la web consistente. */
export function useGuestSignOut() {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, setPending] = useState(false);
  async function signOut() {
    setPending(true);
    try {
      await createClient().auth.signOut({ scope: "local" });
    } catch {
      // Aunque falle la red, la cookie local se borra igual.
    }
    notifyAuthChanged();
    if (isPrivatePath(pathname)) router.replace("/");
    router.refresh();
    setPending(false);
  }
  return { signOut, pending };
}

/** Avatar del huésped: foto si tiene, si no iniciales forest sobre salvia. */
export function GuestAvatar({
  identity,
  className,
}: {
  identity: Extract<GuestIdentity, { status: "guest" }>;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "relative inline-flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-leaf-200 text-[0.8125rem] font-bold text-forest-700 ring-1 ring-forest-700/10",
        className,
      )}
    >
      {identity.avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- avatar externo chico, sin optimizar
        <img src={identity.avatarUrl} alt="" className="size-full object-cover" />
      ) : (
        <span aria-hidden>{identity.initials}</span>
      )}
    </span>
  );
}

const itemClass =
  "min-h-11 cursor-pointer gap-3 rounded-xl px-3 text-[0.9375rem] font-medium text-ink-800 focus:bg-leaf-100 focus:text-forest-700 [&_svg]:size-[1.1rem] [&_svg]:text-forest-600";

/**
 * Isla de cuenta del header de escritorio. Mientras resuelve la sesión muestra
 * un círculo neutro del mismo tamaño (sin parpadeo "Ingresar" → avatar).
 */
export function AccountMenu({ identity }: { identity: GuestIdentity }) {
  const pathname = usePathname();
  const { signOut, pending } = useGuestSignOut();

  if (identity.status === "loading") {
    return <span aria-hidden className="block size-9 rounded-full bg-cream-200" />;
  }

  if (identity.status === "anonymous") {
    return (
      <ApartButton asChild variant="secondary" size="sm">
        <Link href={signInHref(pathname)}>Ingresar</Link>
      </ApartButton>
    );
  }

  if (identity.status === "staff") {
    return (
      <ApartButton asChild variant="secondary" size="sm">
        <Link href="/dashboard">
          <LayoutDashboard aria-hidden />
          Ir al panel
        </Link>
      </ApartButton>
    );
  }

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={
            identity.hasActiveReservations
              ? `Tu cuenta, ${identity.firstName}. Tenés reservas en curso`
              : `Tu cuenta, ${identity.firstName}`
          }
          className="relative inline-flex size-11 items-center justify-center rounded-full outline-none transition-transform focus-visible:ring-[3px] focus-visible:ring-forest-500/40 motion-safe:hover:scale-[1.03]"
        >
          <GuestAvatar identity={identity} />
          {identity.hasActiveReservations ? (
            <span
              aria-hidden
              className="absolute right-0.5 top-0.5 size-3 rounded-full bg-coral-500 ring-2 ring-cream"
            />
          ) : null}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        sideOffset={10}
        className="w-64 rounded-2xl border-cream-300 bg-paper p-1.5 font-apart shadow-apart-lg"
      >
        <div className="flex items-center gap-3 px-3 pb-3 pt-2">
          <GuestAvatar identity={identity} />
          <div className="min-w-0">
            <p className="text-xs text-ink-500">Hola,</p>
            <p className="truncate text-[0.9375rem] font-bold text-forest-700">{identity.name}</p>
          </div>
        </div>
        <DropdownMenuSeparator className="mx-1 bg-cream-300" />
        <DropdownMenuItem asChild className={itemClass}>
          <Link href="/mi-cuenta">
            <CalendarCheck aria-hidden />
            Mis reservas
            {identity.hasActiveReservations ? (
              <span className="ml-auto size-2 rounded-full bg-coral-500" aria-hidden />
            ) : null}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild className={itemClass}>
          <Link href="/favoritos">
            <Heart aria-hidden />
            Favoritos
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild className={itemClass}>
          <Link href="/mi-cuenta/perfil">
            <UserRound aria-hidden />
            Mis datos
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator className="mx-1 bg-cream-300" />
        <DropdownMenuItem
          className={itemClass}
          disabled={pending}
          onSelect={() => {
            void signOut();
          }}
        >
          <LogOut aria-hidden />
          Salir
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
