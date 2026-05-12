"use client";

import { useEffect, useState } from "react";
import { Check, ChevronDown, Globe } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const CURRENCIES = [
  { code: "ARS", name: "Peso argentino", symbol: "$" },
  { code: "USD", name: "Dólar estadounidense", symbol: "US$" },
  { code: "EUR", name: "Euro", symbol: "€" },
];

const LOCALES = [
  { code: "es-AR", label: "Español (AR)" },
  { code: "en-US", label: "English" },
  { code: "pt-BR", label: "Português" },
];

const COOKIE_DAYS = 365;

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

function writeCookie(name: string, value: string) {
  if (typeof document === "undefined") return;
  const expires = new Date(Date.now() + COOKIE_DAYS * 24 * 60 * 60 * 1000).toUTCString();
  document.cookie = `${name}=${encodeURIComponent(value)}; expires=${expires}; path=/; SameSite=Lax`;
}

export function CurrencySwitcher({
  variant = "solid",
}: {
  variant?: "hero" | "solid";
}) {
  const [currency, setCurrency] = useState("ARS");
  const [locale, setLocale] = useState("es-AR");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const id = setTimeout(() => {
      setMounted(true);
      setCurrency(readCookie("rentos_currency") ?? "ARS");
      setLocale(readCookie("rentos_locale") ?? "es-AR");
    }, 0);
    return () => clearTimeout(id);
  }, []);

  function pickCurrency(code: string) {
    setCurrency(code);
    writeCookie("rentos_currency", code);
  }

  function pickLocale(code: string) {
    setLocale(code);
    writeCookie("rentos_locale", code);
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Idioma y moneda"
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full h-10 px-3 text-sm font-medium transition-all border",
            variant === "hero"
              ? "border-white/30 bg-white/10 hover:bg-white/20 text-white backdrop-blur-md"
              : "border-neutral-200 bg-white hover:border-neutral-300 hover:shadow-sm text-neutral-700"
          )}
        >
          <Globe size={15} strokeWidth={2} />
          {mounted ? (
            <>
              <span className="hidden sm:inline">{currency}</span>
              <ChevronDown size={13} className="opacity-60" />
            </>
          ) : null}
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align="end"
        sideOffset={8}
        className="w-64"
      >
        <DropdownMenuLabel className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
          Idioma
        </DropdownMenuLabel>
        {LOCALES.map((l) => (
          <DropdownMenuItem
            key={l.code}
            onSelect={() => pickLocale(l.code)}
            className="flex items-center justify-between cursor-pointer"
          >
            <span>{l.label}</span>
            {locale === l.code ? (
              <Check size={14} className="text-sage-600" />
            ) : null}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
          Moneda
        </DropdownMenuLabel>
        {CURRENCIES.map((c) => (
          <DropdownMenuItem
            key={c.code}
            onSelect={() => pickCurrency(c.code)}
            className="flex items-center justify-between cursor-pointer"
          >
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs text-neutral-500 w-8">{c.symbol}</span>
              <span>{c.name}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-neutral-500 font-mono">{c.code}</span>
              {currency === c.code ? (
                <Check size={14} className="text-sage-600" />
              ) : null}
            </div>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
