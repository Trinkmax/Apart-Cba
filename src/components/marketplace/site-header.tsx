import Link from "next/link";
import { Heart, Search, User, LogOut, ChevronDown } from "lucide-react";
import { getGuestSession, signOutGuest } from "@/lib/actions/guest-auth";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CompactSearchBar } from "./search-bar";

export async function SiteHeader({ variant = "default" }: { variant?: "default" | "transparent" }) {
  const session = await getGuestSession();
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
      className={
        variant === "transparent"
          ? "absolute top-0 inset-x-0 z-40"
          : "sticky top-0 z-40 bg-white/95 backdrop-blur border-b border-neutral-200"
      }
    >
      <div className="max-w-[1400px] mx-auto px-4 md:px-8 h-20 flex items-center gap-4 md:gap-8">
        <Link href="/" className="flex items-center gap-1 group">
          <span className="text-2xl font-bold tracking-tight text-rose-500 group-hover:text-rose-600 transition-colors">
            rent
          </span>
          <span className="text-2xl font-bold tracking-tight text-neutral-900">OS</span>
        </Link>

        <div className="hidden md:block flex-1 max-w-xl mx-auto">
          <CompactSearchBar />
        </div>

        <div className="ml-auto flex items-center gap-2">
          <Link
            href="/buscar"
            className="md:hidden inline-flex items-center justify-center h-10 w-10 rounded-full border border-neutral-200"
            aria-label="Buscar"
          >
            <Search size={18} />
          </Link>

          {session ? (
            <Link
              href="/favoritos"
              className="hidden md:inline-flex items-center gap-1.5 text-sm font-medium text-neutral-700 hover:text-neutral-900 px-3 py-2"
            >
              <Heart size={16} />
              Favoritos
            </Link>
          ) : null}

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex items-center gap-2 rounded-full border border-neutral-200 pl-3 pr-1.5 py-1.5 hover:shadow-md transition-shadow">
                <ChevronDown size={14} className="text-neutral-600" />
                {session && initials ? (
                  <Avatar className="h-8 w-8">
                    {session.profile.avatar_url ? (
                      <AvatarImage src={session.profile.avatar_url} alt={session.profile.full_name} />
                    ) : null}
                    <AvatarFallback className="bg-neutral-900 text-white text-xs font-medium">
                      {initials}
                    </AvatarFallback>
                  </Avatar>
                ) : (
                  <div className="h-8 w-8 rounded-full bg-neutral-100 grid place-items-center text-neutral-600">
                    <User size={16} />
                  </div>
                )}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              {session ? (
                <>
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
                      className="w-full text-left px-2 py-1.5 text-sm hover:bg-neutral-50 flex items-center gap-2"
                    >
                      <LogOut size={14} />
                      Cerrar sesión
                    </button>
                  </form>
                </>
              ) : (
                <>
                  <DropdownMenuItem asChild>
                    <Link href="/registrarse" className="font-medium">
                      Registrarse
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link href="/ingresar">Ingresar</Link>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem asChild>
                    <Link href="/login" className="text-xs text-neutral-500">
                      Soy anfitrión · Entrar al panel
                    </Link>
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );
}

export function SiteHeaderMobileSearch() {
  return (
    <div className="md:hidden border-b border-neutral-200 bg-white px-4 py-3">
      <CompactSearchBar />
    </div>
  );
}

void Button; // keep import for tree-shaking parity with other pages
