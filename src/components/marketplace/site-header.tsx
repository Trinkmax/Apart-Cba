"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Heart, LogOut, Search, User } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Logo } from "@/components/brand/logo";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CompactSearchBar } from "./search-bar";
import { CurrencySwitcher } from "./currency-switcher";
import { signOutGuest } from "@/lib/actions/guest-auth";
import type { GuestSession } from "@/lib/actions/guest-auth";
import { cn } from "@/lib/utils";

type Props = {
  session: GuestSession | null;
};

export function SiteHeader({ session }: Props) {
  const pathname = usePathname();
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 80);
    const tick = setTimeout(onScroll, 0);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      clearTimeout(tick);
      window.removeEventListener("scroll", onScroll);
    };
  }, []);

  // Sólo el home tiene hero a pantalla completa con foto de fondo. Las demás
  // páginas siempre muestran el header sólido.
  const isHome = pathname === "/";
  const hero = isHome && !scrolled;

  const initials = session
    ? session.profile.full_name
        .split(" ")
        .map((w) => w[0])
        .slice(0, 2)
        .join("")
        .toUpperCase()
    : null;

  return (
    <header
      className={cn(
        "sticky top-0 z-40 transition-all duration-300",
        hero
          ? "bg-gradient-to-b from-black/35 via-black/15 to-transparent border-b border-transparent"
          : "bg-white/95 backdrop-blur-md border-b border-neutral-200 shadow-sm"
      )}
    >
      <div className="max-w-[1400px] mx-auto px-4 md:px-8 h-20 grid grid-cols-[auto_1fr_auto] md:grid-cols-[1fr_auto_1fr] items-center gap-4 md:gap-8">
        <Link
          href="/"
          aria-label="rentOS — Inicio"
          className="flex items-center transition-opacity hover:opacity-80 justify-self-start"
        >
          <Logo size="lg" variant={hero ? "light" : "dark"} />
        </Link>

        {/* Center — compact search bar SOLO cuando no estamos sobre el hero */}
        <div className="hidden md:block w-full max-w-xl justify-self-center">
          {hero ? null : <CompactSearchBar />}
        </div>

        {/* Right — currency + auth area */}
        <div className="flex items-center gap-1.5 md:gap-2 justify-self-end">
          {/* Mobile search button cuando no estamos en hero */}
          {!hero ? (
            <Link
              href="/buscar"
              className="md:hidden inline-flex items-center justify-center h-10 w-10 rounded-full border border-neutral-200 text-neutral-700"
              aria-label="Buscar"
            >
              <Search size={18} />
            </Link>
          ) : null}

          <CurrencySwitcher variant={hero ? "hero" : "solid"} />

          {session ? (
            <>
              {!hero ? (
                <Link
                  href="/favoritos"
                  className="hidden md:inline-flex items-center gap-1.5 text-sm font-medium text-neutral-700 hover:text-neutral-900 px-3 py-2"
                >
                  <Heart size={16} />
                  Favoritos
                </Link>
              ) : null}
              <UserAvatarMenu session={session} variant={hero ? "hero" : "solid"} initials={initials!} />
            </>
          ) : (
            <AuthCtas variant={hero ? "hero" : "solid"} />
          )}
        </div>
      </div>
    </header>
  );
}

function AuthCtas({ variant }: { variant: "hero" | "solid" }) {
  if (variant === "hero") {
    return (
      <>
        <Link
          href="/ingresar"
          className="hidden sm:inline-flex items-center text-sm font-medium text-white hover:text-sage-100 px-3 py-2"
        >
          Ingresar
        </Link>
        <Link
          href="/registrarse"
          className="inline-flex items-center justify-center text-sm font-semibold rounded-full bg-white text-neutral-900 px-4 h-10 hover:bg-sage-50 transition-colors shadow-sm"
        >
          Crear cuenta
        </Link>
      </>
    );
  }
  return (
    <>
      <Link
        href="/ingresar"
        className="hidden sm:inline-flex items-center text-sm font-medium text-neutral-700 hover:text-neutral-900 px-3 py-2"
      >
        Ingresar
      </Link>
      <Link
        href="/registrarse"
        className="inline-flex items-center justify-center text-sm font-semibold rounded-full bg-sage-600 text-white px-4 h-10 hover:bg-sage-700 transition-colors shadow-sm"
      >
        Crear cuenta
      </Link>
    </>
  );
}

function UserAvatarMenu({
  session,
  variant,
  initials,
}: {
  session: GuestSession;
  variant: "hero" | "solid";
  initials: string;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className={cn(
            "flex items-center gap-2 rounded-full pl-1.5 pr-1.5 py-1 transition-all border",
            variant === "hero"
              ? "border-white/30 bg-white/10 hover:bg-white/20 backdrop-blur-md"
              : "border-neutral-200 bg-white hover:border-neutral-300 hover:shadow-sm"
          )}
          aria-label="Tu cuenta"
        >
          <Avatar className="h-8 w-8">
            {session.profile.avatar_url ? (
              <AvatarImage src={session.profile.avatar_url} alt={session.profile.full_name} />
            ) : null}
            <AvatarFallback className="bg-neutral-900 text-white text-xs font-medium">
              {initials}
            </AvatarFallback>
          </Avatar>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={8} className="w-56">
        <div className="px-3 py-2 text-xs text-neutral-500">
          Sesión iniciada como
          <div className="text-sm font-medium text-neutral-900 truncate">
            {session.profile.full_name}
          </div>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/mi-cuenta">Mi cuenta</Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/mi-cuenta">Mis reservas</Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/favoritos">Favoritos</Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/mi-cuenta/perfil">Perfil</Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <form action={signOutGuest}>
          <button
            type="submit"
            className="w-full text-left px-2 py-1.5 text-sm hover:bg-neutral-50 flex items-center gap-2 rounded-sm"
          >
            <LogOut size={14} />
            Cerrar sesión
          </button>
        </form>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/login" className="text-xs text-neutral-500">
            Soy anfitrión · Entrar al panel
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function SiteHeaderMobileSearch() {
  return (
    <div className="md:hidden border-b border-neutral-200 bg-white px-4 py-3">
      <CompactSearchBar />
    </div>
  );
}

void User; // keep import parity
