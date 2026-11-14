import { describe, expect, it } from "vitest";
import { isOpaqueLogo } from "../logo";

describe("isOpaqueLogo", () => {
  it("un JPG no tiene transparencia: va en sus colores, no como silueta", () => {
    expect(isOpaqueLogo("https://x.supabase.co/storage/v1/object/public/org-logos/a/b.jpeg")).toBe(true);
    expect(isOpaqueLogo("https://x.supabase.co/storage/v1/object/public/org-logos/a/b.JPG")).toBe(true);
    expect(isOpaqueLogo("https://x.supabase.co/org-logos/a/b.jpg?v=2")).toBe(true);
  });

  it("PNG, WebP y SVG pueden ser transparentes: siguen como silueta", () => {
    expect(isOpaqueLogo("https://x.supabase.co/org-logos/a/b.png")).toBe(false);
    expect(isOpaqueLogo("https://x.supabase.co/org-logos/a/b.webp")).toBe(false);
    expect(isOpaqueLogo("https://x.supabase.co/org-logos/a/b.svg")).toBe(false);
  });

  it("sin logo no hay nada que decidir", () => {
    expect(isOpaqueLogo(null)).toBe(false);
    expect(isOpaqueLogo("")).toBe(false);
  });
});
