// Runtime theme accents.
//
// The professional retheme maps the legacy neon classes (emerald/teal/cyan/
// violet/indigo/fuchsia/purple — 370+ usages) onto a single accent family via
// Tailwind v4 design tokens. Utilities compile to var(--color-<family>-<shade>),
// so overriding those vars at runtime recolors the ENTIRE site instantly.
//
// Choice is per-browser (localStorage), applied pre-paint by a tiny inline
// script in layout.tsx (no flash of the default theme) and switchable from
// the Settings panel.

export type Ramp = {
  "200": string;
  "300": string;
  "400": string;
  "500": string;
  "600": string;
  "700": string;
  "900": string;
  "950": string;
};

export type ThemePreset = {
  id: string;
  label: string;
  ramp: Ramp;
};

export const THEME_PRESETS: ThemePreset[] = [
  {
    id: "indigo",
    label: "Indigo",
    ramp: {
      "200": "#c7d2fe",
      "300": "#a5b4fc",
      "400": "#818cf8",
      "500": "#6366f1",
      "600": "#4f46e5",
      "700": "#4338ca",
      "900": "#312e81",
      "950": "#1e1b4b",
    },
  },
  {
    id: "blue",
    label: "Blue",
    ramp: {
      "200": "#bfdbfe",
      "300": "#93c5fd",
      "400": "#60a5fa",
      "500": "#3b82f6",
      "600": "#2563eb",
      "700": "#1d4ed8",
      "900": "#1e3a8a",
      "950": "#172554",
    },
  },
  {
    id: "sky",
    label: "Sky",
    ramp: {
      "200": "#bae6fd",
      "300": "#7dd3fc",
      "400": "#38bdf8",
      "500": "#0ea5e9",
      "600": "#0284c7",
      "700": "#0369a1",
      "900": "#0c4a6e",
      "950": "#082f49",
    },
  },
  {
    id: "violet",
    label: "Violet",
    ramp: {
      "200": "#ddd6fe",
      "300": "#c4b5fd",
      "400": "#a78bfa",
      "500": "#8b5cf6",
      "600": "#7c3aed",
      "700": "#6d28d9",
      "900": "#4c1d95",
      "950": "#2e1065",
    },
  },
  {
    id: "emerald",
    label: "Emerald",
    ramp: {
      "200": "#a7f3d0",
      "300": "#6ee7b7",
      "400": "#34d399",
      "500": "#10b981",
      "600": "#059669",
      "700": "#047857",
      "900": "#064e3b",
      "950": "#022c22",
    },
  },
  {
    id: "amber",
    label: "Amber",
    ramp: {
      "200": "#fde68a",
      "300": "#fcd34d",
      "400": "#fbbf24",
      "500": "#f59e0b",
      "600": "#d97706",
      "700": "#b45309",
      "900": "#78350f",
      "950": "#451a03",
    },
  },
  {
    id: "rose",
    label: "Rose",
    ramp: {
      "200": "#fecdd3",
      "300": "#fda4af",
      "400": "#fb7185",
      "500": "#f43f5e",
      "600": "#e11d48",
      "700": "#be123c",
      "900": "#881337",
      "950": "#4c0519",
    },
  },
];

export const DEFAULT_THEME_ID = "indigo";

const RAMP_SHADES = ["200", "300", "400", "500", "600", "700", "900", "950"] as const;
const VAR_FAMILIES = [
  "emerald",
  "teal",
  "cyan",
  "violet",
  "indigo",
  "fuchsia",
  "purple",
] as const;

const THEME_STORAGE_KEY = "mcbm:theme";

export function getThemePreset(id: string | null | undefined): ThemePreset {
  return THEME_PRESETS.find((p) => p.id === id) ?? THEME_PRESETS[0];
}

// Client: apply a preset by overriding the design-token CSS vars on :root.
export function applyThemePreset(id: string): void {
  const preset = getThemePreset(id);
  const root = document.documentElement.style;
  for (const fam of VAR_FAMILIES) {
    for (const shade of RAMP_SHADES) {
      const value = preset.ramp[shade] ?? preset.ramp["500"];
      root.setProperty(`--color-${fam}-${shade}`, value);
    }
  }
}

export function saveThemeId(id: string): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, id);
  } catch {
    // private mode — theme just won't persist
  }
}

export function loadThemeId(): string {
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    return getThemePreset(saved).id;
  } catch {
    return DEFAULT_THEME_ID;
  }
}
