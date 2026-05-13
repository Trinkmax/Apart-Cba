"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronDown, Globe, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useMarketplacePrefs } from "@/components/marketplace/marketplace-prefs-provider";
import {
  setMarketplaceCurrency,
  setMarketplaceLocale,
} from "@/lib/actions/marketplace-preferences";

const CURRENCIES = [
  { code: "ARS", name: "Peso argentino", symbol: "$" },
  { code: "USD", name: "Dólar estadounidense", symbol: "US$" },
  { code: "EUR", name: "Euro", symbol: "€" },
] as const;

const LOCALES = [
  { code: "es-AR", label: "Español (AR)" },
  { code: "en-US", label: "English" },
  { code: "pt-BR", label: "Português" },
] as const;

export function CurrencySwitcher({
  variant = "solid",
}: {
  variant?: "hero" | "solid";
}) {
  const router = useRouter();
  const { currency, locale } = useMarketplacePrefs();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function pickCurrency(code: string) {
    if (code === currency) return;
    startTransition(async () => {
      await setMarketplaceCurrency(code);
      router.refresh();
    });
  }

  function pickLocale(code: string) {
    if (code === locale) return;
    startTransition(async () => {
      await setMarketplaceLocale(code);
      router.refresh();
    });
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Idioma y moneda"
          className={cn(
            "inline-flex items-center justify-center gap-1.5 rounded-full h-10 w-10 sm:w-auto sm:px-3.5 text-sm font-medium transition-all border",
            variant === "hero"
              ? "border-white/30 bg-white/10 hover:bg-white/20 text-white backdrop-blur-md"
              : "border-neutral-200 bg-white hover:border-neutral-300 hover:shadow-sm text-neutral-700",
            pending && "opacity-70",
          )}
        >
          {pending ? (
            <Loader2 size={15} strokeWidth={2.25} className="animate-spin" />
          ) : (
            <Globe size={15} strokeWidth={2} />
          )}
          <span className="hidden sm:inline">{currency}</span>
          <ChevronDown size={13} className="hidden sm:inline opacity-60" />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align="end"
        sideOffset={10}
        className="w-72 p-2
                   border border-white/15
                   bg-neutral-900/75 backdrop-blur-2xl backdrop-saturate-150
                   text-white
                   shadow-[0_24px_60px_-15px_rgb(0_0_0/0.55),0_0_0_1px_rgb(255_255_255/0.04)_inset]
                   rounded-2xl"
      >
        <DropdownMenuLabel className="px-2 pt-1 pb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.18em] text-white/55">
          Idioma
        </DropdownMenuLabel>
        {LOCALES.map((l) => (
          <DropdownMenuItem
            key={l.code}
            onSelect={() => pickLocale(l.code)}
            className="flex items-center justify-between cursor-pointer rounded-lg px-2.5 py-2 text-sm text-white/90
                       focus:bg-white/[0.08] focus:text-white
                       data-[highlighted]:bg-white/[0.08] data-[highlighted]:text-white"
          >
            <span>{l.label}</span>
            {locale === l.code ? (
              <Check size={14} className="text-sage-300" />
            ) : null}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator className="my-1.5 bg-white/10" />
        <DropdownMenuLabel className="px-2 pt-1 pb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.18em] text-white/55">
          Moneda
        </DropdownMenuLabel>
        {CURRENCIES.map((c) => (
          <DropdownMenuItem
            key={c.code}
            onSelect={() => pickCurrency(c.code)}
            className="flex items-center justify-between cursor-pointer rounded-lg px-2.5 py-2 text-sm text-white/90
                       focus:bg-white/[0.08] focus:text-white
                       data-[highlighted]:bg-white/[0.08] data-[highlighted]:text-white"
          >
            <div className="flex items-center gap-3">
              <span className="font-mono text-xs text-white/55 w-8">{c.symbol}</span>
              <span>{c.name}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-white/55 font-mono">{c.code}</span>
              {currency === c.code ? (
                <Check size={14} className="text-sage-300" />
              ) : null}
            </div>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
