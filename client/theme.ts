import type { Brand } from "../shared/types";

type BrandColors = Pick<
  Brand,
  "primary" | "accent" | "background" | "textColor"
>;

export const projectorPalette = {
  primary: "#1646a0",
  accent: "#ffdc48",
  background: "#ffffff",
  textColor: "#111827",
} as const;

function channels(hex: string) {
  return [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16));
}

function luminance(hex: string) {
  const values = channels(hex).map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722;
}

export function contrastRatio(first: string, second: string) {
  const a = luminance(first),
    b = luminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

export function isLightBrand(brand: Pick<Brand, "background">) {
  return luminance(brand.background) > 0.35;
}

function mix(background: string, foreground: string, amount: number) {
  const base = channels(background),
    ink = channels(foreground);
  return `#${base
    .map((value, index) =>
      Math.round(value * (1 - amount) + ink[index] * amount)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

function inkOn(background: string) {
  return contrastRatio(background, "#111827") >=
    contrastRatio(background, "#ffffff")
    ? "#111827"
    : "#ffffff";
}

export function themeTokens(brand: BrandColors): Record<string, string> {
  const light = isLightBrand(brand),
    readableInk =
      contrastRatio(brand.background, brand.textColor) >= 7
        ? brand.textColor
        : inkOn(brand.background),
    primaryInk =
      contrastRatio(brand.background, brand.primary) >= 4.5
        ? brand.primary
        : readableInk,
    accentInk =
      contrastRatio(brand.background, brand.accent) >= 4.5
        ? brand.accent
        : primaryInk;
  return {
    "--primary": brand.primary,
    "--accent": brand.accent,
    "--bg": brand.background,
    "--text": readableInk,
    "--surface": mix(brand.background, readableInk, light ? 0.015 : 0.03),
    "--surface-soft": mix(brand.background, readableInk, light ? 0.04 : 0.06),
    "--surface-raised": mix(
      brand.background,
      readableInk,
      light ? 0.015 : 0.06,
    ),
    "--input-bg": light
      ? brand.background
      : mix(brand.background, "#000000", 0.12),
    "--muted": mix(brand.background, readableInk, light ? 0.86 : 0.73),
    "--border": mix(brand.background, readableInk, light ? 0.35 : 0.18),
    "--border-strong": mix(brand.background, readableInk, light ? 0.6 : 0.35),
    "--button-text": inkOn(brand.accent),
    "--primary-text": inkOn(brand.primary),
    "--primary-ink": primaryInk,
    "--accent-ink": accentInk,
    "--focus": primaryInk,
    "--danger": light ? "#a71922" : "#ffb5bf",
    "--danger-bg": light ? "#fff1f2" : "#ff617514",
    "--success": light ? "#14532d" : "#c3d7ac",
    "--success-bg": light ? "#edf8ef" : "#b5cf9408",
    "--warning": light ? "#783b09" : "#f8d08b",
    "--warning-bg": light ? "#fff7e6" : "#e0be8c0a",
    "--card-shadow": light ? "0 3px 16px #11182708" : "none",
    "--overlay": light ? "#11182780" : "#070710bb",
    "--chart-bar":
      contrastRatio(brand.background, brand.primary) >= 3
        ? brand.primary
        : readableInk,
  };
}
