import Image from "next/image";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Reveal } from "@/components/marketplace/reveal";
import { getServerT } from "@/lib/i18n/server";

export async function HomeHostCta() {
  const t = await getServerT();
  return (
    <section className="max-w-[1400px] mx-auto px-4 md:px-8 py-16 md:py-24">
      <Reveal y={28}>
        <div
          className="relative isolate overflow-hidden rounded-[28px] md:rounded-[40px]
                     min-h-[420px] md:min-h-[520px]
                     flex items-end"
        >
          <Image
            src="/cordoba/sierras.jpg"
            alt=""
            fill
            sizes="(max-width: 1400px) 100vw, 1400px"
            className="object-cover -z-10"
          />
          {/* Dark editorial wash + a sage gradient bottom for legibility */}
          <div
            aria-hidden
            className="absolute inset-0 -z-10 bg-gradient-to-t from-sage-950/90 via-sage-900/55 to-sage-900/20"
          />
          <div
            aria-hidden
            className="absolute inset-0 -z-10 bg-gradient-to-tr from-black/40 via-transparent to-transparent"
          />

          <div className="relative p-7 md:p-14 lg:p-16 max-w-2xl text-white">
            <span className="text-[10.5px] font-semibold uppercase tracking-[0.22em] text-sage-100/85">
              {t("host.eyebrow")}
            </span>
            <h2 className="mt-3 text-3xl md:text-5xl font-bold leading-[1.05] tracking-[-0.02em]">
              {t("host.title.part1")} <span className="italic font-serif font-medium">{t("host.title.part2")}</span>.
            </h2>
            <p className="mt-4 text-sm md:text-base text-white/85 leading-relaxed max-w-md">
              {t("host.subtitle")}
            </p>

            <div className="mt-7 flex flex-col sm:flex-row gap-3">
              <Link
                href="/login"
                className="group inline-flex items-center justify-center gap-2
                           rounded-full bg-white text-neutral-900
                           px-5 py-3 text-sm font-semibold
                           hover:bg-sage-50 transition-colors
                           shadow-[0_10px_30px_-12px_rgb(0_0_0/0.4)]"
              >
                {t("host.cta_primary")}
                <ArrowRight
                  size={16}
                  strokeWidth={2.5}
                  className="transition-transform group-hover:translate-x-0.5"
                />
              </Link>
              <Link
                href="/login"
                className="inline-flex items-center justify-center gap-2
                           rounded-full border border-white/30 bg-white/5 backdrop-blur-sm text-white
                           px-5 py-3 text-sm font-medium
                           hover:bg-white/10 transition-colors"
              >
                {t("host.cta_secondary")}
              </Link>
            </div>
          </div>
        </div>
      </Reveal>
    </section>
  );
}
