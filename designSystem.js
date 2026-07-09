export const palettes = {
  dark: {
    mode: "dark",
    bg: "#0B0D0C",
    surface: "#151816",
    surface2: "#1F2420",
    surface3: "#272D28",
    text: "#F4F7F2",
    muted: "#9EA79D",
    border: "#2A302C",
    primary: "#8BFF5A",
    primarySoft: "#20331B",
    accent: "#FF4F67",
    accentSoft: "#331A20",
    input: "#171B18",
    tab: "#101311",
    overlay: "rgba(0,0,0,0.72)",
  },
  light: {
    mode: "light",
    bg: "#F7F8F3",
    surface: "#FFFFFF",
    surface2: "#EEF2EA",
    surface3: "#E5EBDD",
    text: "#121512",
    muted: "#697166",
    border: "#DCE2D7",
    primary: "#4FD12F",
    primarySoft: "#E7FADA",
    accent: "#E8485C",
    accentSoft: "#FFE5E8",
    input: "#FFFFFF",
    tab: "#FFFFFF",
    overlay: "rgba(0,0,0,0.42)",
  },
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
};

export const radius = {
  sm: 12,
  md: 16,
  lg: 20,
  xl: 24,
  xxl: 28,
  card: 26,
  pill: 999,
};

export const typography = {
  logo: 32,
  screen: 28,
  cardTitle: 23,
  title: 21,
  body: 16,
  small: 13,
  tiny: 12,
};

export const layout = {
  pagePadding: 16,
  cardPadding: 16,
  buttonHeight: 48,
  photoRatio: 4 / 5,
};

export function getTheme(mode) {
  return palettes[mode] || palettes.dark;
}
