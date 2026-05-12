import Link from "next/link";
import {
  ArrowUpRight,
  Building2,
  Mountain,
  Wine,
  Briefcase,
} from "lucide-react";
import { Reveal } from "@/components/marketplace/reveal";

type Vibe = {
  title: string;
  caption: string;
  href: string;
  icon: React.ComponentType<{ size?: number; className?: string; strokeWidth?: number }>;
  /** Subtle background blob — sage tints, no candy color. */
  blobClass: string;
  iconBgClass: string;
};

const VIBES: Vibe[] = [
  {
    title: "Capital cordobesa",
    caption: "Para quedarte donde la noche empieza temprano y termina tarde.",
    href: "/buscar?ciudad=C%C3%B3rdoba",
    icon: Building2,
    blobClass: "from-sage-50 to-white",
    iconBgClass: "bg-sage-100 text-sage-700",
  },
  {
    title: "Sierras que abrazan",
    caption: "Aire serrano, fogón al atardecer y un río a 10 minutos.",
    href: "/buscar?vibe=montana",
    icon: Mountain,
    blobClass: "from-stone-50 to-white",
    iconBgClass: "bg-stone-200 text-stone-700",
  },
  {
    title: "Casas para juntadas",
    caption: "Cuatro habitaciones, parrilla, pileta y silencio.",
    href: "/buscar?tipo=casa",
    icon: Wine,
    blobClass: "from-orange-50 to-white",
    iconBgClass: "bg-orange-100 text-orange-700",
  },
  {
    title: "Workation con vista",
    caption: "Wi-Fi rápido, escritorio amplio y café al lado.",
    href: "/buscar?vibe=diseno",
    icon: Briefcase,
    blobClass: "from-sage-50 to-white",
    iconBgClass: "bg-sage-100 text-sage-700",
  },
];

export function HomeInspiration() {
  return (
    <section className="max-w-[1400px] mx-auto px-4 md:px-8 py-12 md:py-20">
      <Reveal className="block mb-10 md:mb-12">
        <div className="flex items-end justify-between gap-6">
          <div>
            <span className="text-[10.5px] font-semibold uppercase tracking-[0.22em] text-sage-700">
              Inspiración
            </span>
            <h2 className="mt-2 text-2xl md:text-4xl font-bold text-neutral-900 tracking-[-0.02em]">
              Elegí cómo querés <span className="italic font-serif font-medium">irte</span>
            </h2>
            <p className="text-sm md:text-base text-neutral-500 mt-2 max-w-md">
              Curaduría por mood. Cada vibe linkea a una búsqueda ya filtrada.
            </p>
          </div>
        </div>
      </Reveal>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-5">
        {VIBES.map((vibe, i) => {
          const Icon = vibe.icon;
          return (
            <Reveal key={vibe.title} delay={120 * i} y={24}>
              <Link
                href={vibe.href}
                className="group relative flex flex-col justify-between
                           h-56 md:h-72 p-6 md:p-7
                           rounded-3xl overflow-hidden
                           bg-gradient-to-br
                           border border-neutral-200/80
                           hover:border-neutral-300
                           hover:shadow-[0_24px_60px_-24px_rgb(0_0_0/0.18)]
                           hover:-translate-y-0.5
                           transition-all duration-500"
                style={{}}
                aria-label={vibe.title}
              >
                <div
                  className={`absolute inset-0 -z-10 bg-gradient-to-br ${vibe.blobClass} opacity-100`}
                  aria-hidden
                />
                {/* Soft radial glow that brightens on hover */}
                <div
                  aria-hidden
                  className="absolute -bottom-24 -right-24 h-64 w-64 rounded-full
                             bg-[radial-gradient(circle,rgba(124,142,116,0.16)_0%,transparent_70%)]
                             opacity-0 group-hover:opacity-100 transition-opacity duration-700"
                />

                <div
                  className={`inline-flex h-11 w-11 items-center justify-center rounded-2xl ${vibe.iconBgClass}`}
                >
                  <Icon size={20} strokeWidth={1.75} />
                </div>

                <div>
                  <h3 className="text-lg md:text-xl font-semibold text-neutral-900 tracking-[-0.01em]">
                    {vibe.title}
                  </h3>
                  <p className="mt-1.5 text-sm text-neutral-600 leading-relaxed line-clamp-2">
                    {vibe.caption}
                  </p>
                  <div className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-neutral-900 transition-all group-hover:gap-2">
                    Explorar
                    <ArrowUpRight
                      size={16}
                      strokeWidth={2}
                      className="transition-transform group-hover:rotate-12"
                    />
                  </div>
                </div>
              </Link>
            </Reveal>
          );
        })}
      </div>
    </section>
  );
}
