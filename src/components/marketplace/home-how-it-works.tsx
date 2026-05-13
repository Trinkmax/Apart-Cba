import { Compass, KeyRound, MessageCircle } from "lucide-react";
import { Reveal } from "@/components/marketplace/reveal";
import { getServerT } from "@/lib/i18n/server";
import type { TKey } from "@/lib/i18n/dict";

type Step = {
  n: string;
  titleKey: TKey;
  bodyKey: TKey;
  icon: React.ComponentType<{ size?: number; className?: string; strokeWidth?: number }>;
};

const STEPS: Step[] = [
  { n: "01", titleKey: "how.step1.title", bodyKey: "how.step1.body", icon: Compass },
  { n: "02", titleKey: "how.step2.title", bodyKey: "how.step2.body", icon: KeyRound },
  { n: "03", titleKey: "how.step3.title", bodyKey: "how.step3.body", icon: MessageCircle },
];

export async function HomeHowItWorks() {
  const t = await getServerT();
  return (
    <section className="bg-neutral-50 border-y border-neutral-200/80">
      <div className="max-w-[1400px] mx-auto px-4 md:px-8 py-16 md:py-24">
        <Reveal className="block max-w-2xl mb-12 md:mb-16">
          <span className="text-[10.5px] font-semibold uppercase tracking-[0.22em] text-sage-700">
            {t("how.eyebrow")}
          </span>
          <h2 className="mt-2 text-2xl md:text-4xl font-bold text-neutral-900 tracking-[-0.02em]">
            {t("how.title.part1")} <span className="italic font-serif font-medium">{t("how.title.part2")}</span>
          </h2>
          <p className="text-sm md:text-base text-neutral-500 mt-2.5 leading-relaxed">
            {t("how.subtitle")}
          </p>
        </Reveal>

        <ol className="grid grid-cols-1 md:grid-cols-3 gap-6 md:gap-0">
          {STEPS.map((step, i) => {
            const Icon = step.icon;
            return (
              <Reveal key={step.n} as="li" delay={150 * i} y={24}>
                <div
                  className={`relative h-full md:px-8 lg:px-10 md:py-4 ${
                    i > 0 ? "md:border-l md:border-neutral-200" : ""
                  }`}
                >
                  <div className="flex items-baseline gap-4">
                    <span
                      className="text-[2.5rem] md:text-[3.25rem] font-serif italic font-normal
                                 text-sage-600/85 leading-none tracking-tight"
                    >
                      {step.n}
                    </span>
                    <span
                      className="inline-flex h-9 w-9 items-center justify-center rounded-full
                                 bg-white border border-sage-200 text-sage-700 shrink-0"
                    >
                      <Icon size={16} strokeWidth={1.75} />
                    </span>
                  </div>
                  <h3 className="mt-5 text-lg md:text-xl font-semibold text-neutral-900 tracking-[-0.01em]">
                    {t(step.titleKey)}
                  </h3>
                  <p className="mt-2 text-sm md:text-[15px] text-neutral-600 leading-relaxed max-w-sm">
                    {t(step.bodyKey)}
                  </p>
                </div>
              </Reveal>
            );
          })}
        </ol>
      </div>
    </section>
  );
}
