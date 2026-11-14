import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { GLASS_LEVEL_SCRIPT, glassLevel, type GlassLevel } from "../glass-level";

const UA = {
  iphone:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1",
  android:
    "Mozilla/5.0 (Linux; Android 14; moto g24) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36",
  desktop:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
};

type Case = { name: string; ua: string; mem?: number; cores?: number; backdrop: boolean; expected: GlassLevel };

const CASES: Case[] = [
  { name: "iPhone (sin deviceMemory)", ua: UA.iphone, cores: 6, backdrop: true, expected: "" },
  { name: "Android gama alta", ua: UA.android, mem: 8, cores: 8, backdrop: true, expected: "" },
  { name: "moto g24 (4 GB)", ua: UA.android, mem: 4, cores: 8, backdrop: true, expected: "bar" },
  { name: "moto e13 (2 GB)", ua: UA.android, mem: 2, cores: 8, backdrop: true, expected: "lite" },
  { name: "Android de 4 núcleos", ua: UA.android, mem: 4, cores: 4, backdrop: true, expected: "lite" },
  { name: "Firefox Android (sin deviceMemory)", ua: UA.android, cores: 8, backdrop: true, expected: "" },
  { name: "compu de 4 núcleos", ua: UA.desktop, mem: 4, cores: 4, backdrop: true, expected: "" },
  { name: "compu con 1 GB", ua: UA.desktop, mem: 1, cores: 8, backdrop: true, expected: "lite" },
  { name: "navegador sin backdrop-filter", ua: UA.iphone, backdrop: false, expected: "lite" },
];

describe("glassLevel", () => {
  for (const c of CASES) {
    it(c.name, () => {
      expect(
        glassLevel({ userAgent: c.ua, deviceMemory: c.mem, hardwareConcurrency: c.cores, supportsBackdrop: c.backdrop }),
      ).toBe(c.expected);
    });
  }
});

describe("GLASS_LEVEL_SCRIPT", () => {
  for (const c of CASES) {
    it(`decide igual que glassLevel: ${c.name}`, () => {
      const attrs: Record<string, string> = {};
      const ctx: Record<string, unknown> = {
        navigator: { userAgent: c.ua, deviceMemory: c.mem, hardwareConcurrency: c.cores },
        CSS: { supports: () => c.backdrop },
        document: { documentElement: { setAttribute: (k: string, v: string) => (attrs[k] = v) } },
      };
      ctx.window = ctx;
      vm.runInNewContext(GLASS_LEVEL_SCRIPT, ctx);
      expect(attrs["data-glass"] ?? "").toBe(c.expected);
    });
  }
});
