import Image from "next/image";
import { ArcBand, BrandDot } from "@/components/marketplace/brand/brand-shapes";
import { cn } from "@/lib/utils";

/**
 * Marco de las pantallas de cuenta (ingresar, registrarse, nueva contraseña).
 * En escritorio: a la izquierda la foto de marca en arco con una frase; a la
 * derecha el formulario. En mobile, sólo el formulario (sin foto que empuje
 * los campos fuera de la pantalla).
 */
export function AuthShell({
  children,
  quote = "Sentite como en casa.",
  className,
}: {
  children: React.ReactNode;
  /** Frase de marca sobre la foto (serif itálica). */
  quote?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "mx-auto grid max-w-7xl gap-10 px-4 pb-16 pt-6 sm:px-6 sm:pt-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-16 lg:px-8 lg:pb-24 lg:pt-12",
        className,
      )}
    >
      <aside aria-hidden className="relative hidden lg:block">
        <div className="sticky top-[104px]">
          <div className="relative mx-auto aspect-[5/6] w-full max-w-[30rem]">
            <ArcBand className="absolute -left-8 -top-4 w-36 text-coral-500" thickness={14} />
            <div className="absolute inset-0 overflow-hidden rounded-b-3xl rounded-t-full bg-leaf-200 shadow-apart-lg">
              <Image
                src="/apart/photos/cuidado-cama-1200.webp"
                alt=""
                fill
                sizes="(min-width: 1024px) 480px, 1px"
                className="object-cover"
              />
            </div>
            <figure className="absolute -bottom-8 -right-4 max-w-[17rem] rounded-3xl bg-paper px-6 py-5 shadow-apart-md ring-1 ring-cream-300 xl:-right-10">
              <blockquote className="font-apart-serif text-[1.5rem] italic leading-snug text-forest-700">
                <span className="text-coral-500">“</span>
                {quote}
                <span className="text-coral-500">”</span>
              </blockquote>
              <figcaption className="mt-2 text-sm font-semibold text-ink-500">El equipo de apart</figcaption>
            </figure>
          </div>
        </div>
      </aside>

      <div className="flex justify-center lg:items-center">
        <div className="w-full max-w-md">{children}</div>
      </div>
    </div>
  );
}

/** Encabezado de un formulario de cuenta: titular forest + bajada serif. */
export function AuthHeading({
  title,
  accent,
  as: Tag = "h1",
}: {
  title: React.ReactNode;
  accent?: React.ReactNode;
  as?: "h1" | "h2";
}) {
  return (
    <div>
      <Tag className="text-[2rem] font-extrabold leading-[1.05] tracking-[-0.025em] text-forest-700 text-balance sm:text-[2.5rem]">
        {title}
        <BrandDot />
      </Tag>
      {accent ? (
        <p className="mt-3 font-apart-serif text-lg italic leading-snug text-forest-600 sm:text-xl">{accent}</p>
      ) : null}
    </div>
  );
}
