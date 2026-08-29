import { useMemo } from 'react';
import { PixelRatio, StyleSheet, useColorScheme } from 'react-native';
import { t } from './i18n';

export type Mode = 'dark' | 'light';

export interface Theme {
  mode: Mode;

  bg: string;
  bgElevated: string;
  surface: string;
  surfaceAlt: string;
  border: string;
  borderStrong: string;

  text: string;
  textDim: string;
  textFaint: string;

  accent: string;
  accentSoft: string;
  accentWash: string;
  accentGlow: string;
  onAccent: string;

  cardWash: readonly [string, string, string];

  great: string;
  good: string;
  even: string;
  weak: string;
  bad: string;

  athletic: string;
  college: string;
  production: string;

  warn: string;
  danger: string;
  positive: string;

  glassTint: string;
  glassBorder: string;
  glassHighlight: string;

  blurTint: 'light' | 'dark';
  blurIntensity: number;

  glow: {
    shadowColor: string;
    shadowOpacity: number;
    shadowRadius: number;
    shadowOffset: { width: number; height: number };
  };
}

const ACCENT_DARK = '#FF5A24';
const ACCENT_LIGHT = '#EF4E1E';

export const darkTheme: Theme = {
  mode: 'dark',

  bg: '#0A0A0B',
  bgElevated: '#111113',
  surface: '#141417',
  surfaceAlt: '#1D1D21',
  border: '#26262B',
  borderStrong: '#34343B',

  text: '#F4F4F6',
  textDim: '#9E9EA7',
  textFaint: '#6A6A73',

  accent: ACCENT_DARK,
  accentSoft: 'rgba(255, 90, 36, 0.16)',
  accentWash: 'rgba(255, 90, 36, 0.07)',
  accentGlow: 'rgba(255, 90, 36, 0.75)',
  onAccent: '#FFFFFF',

  cardWash: ['rgba(255, 90, 36, 0.13)', 'rgba(255, 90, 36, 0.03)', 'rgba(255, 90, 36, 0)'],

  great: ACCENT_DARK,
  good: '#FF8A3D',
  even: '#94A3B8',
  weak: '#C99A33',
  bad: '#FBBF24',

  athletic: '#FFC46B',
  college: '#FF8A3D',
  production: '#FF5A24',

  warn: '#FBBF24',
  danger: '#F87171',
  positive: '#4ADE80',

  glassTint: 'rgba(22, 22, 26, 0.55)',
  glassBorder: 'rgba(255, 255, 255, 0.10)',
  glassHighlight: 'rgba(255, 255, 255, 0.16)',
  blurTint: 'dark',
  blurIntensity: 40,

  glow: {
    shadowColor: ACCENT_DARK,
    shadowOpacity: 0.55,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 0 },
  },
};

export const lightTheme: Theme = {
  mode: 'light',

  bg: '#FBF9F8',
  bgElevated: '#FFFFFF',
  surface: '#FFFFFF',
  surfaceAlt: '#F3F0EE',
  border: '#EAE5E1',
  borderStrong: '#DBD4CF',

  text: '#141416',
  textDim: '#6B6B73',
  textFaint: '#9A9AA2',

  accent: ACCENT_LIGHT,
  accentSoft: 'rgba(239, 78, 30, 0.11)',
  accentWash: 'rgba(239, 78, 30, 0.05)',
  accentGlow: 'rgba(239, 78, 30, 0.45)',
  onAccent: '#FFFFFF',

  cardWash: ['rgba(255, 110, 50, 0.14)', 'rgba(255, 110, 50, 0.035)', 'rgba(255, 110, 50, 0)'],

  great: ACCENT_LIGHT,
  good: '#F97316',
  even: '#64748B',
  weak: '#CA9A2B',
  bad: '#8F6408',

  athletic: '#F5A623',
  college: '#F97316',
  production: ACCENT_LIGHT,

  warn: '#D97706',
  danger: '#DC2626',
  positive: '#16A34A',

  glassTint: 'rgba(255, 255, 255, 0.62)',
  glassBorder: 'rgba(0, 0, 0, 0.07)',
  glassHighlight: 'rgba(255, 255, 255, 0.85)',
  blurTint: 'light',
  blurIntensity: 55,

  glow: {
    shadowColor: ACCENT_LIGHT,
    shadowOpacity: 0.3,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 2 },
  },
};

export function useTheme(): Theme {
  return useColorScheme() === 'light' ? lightTheme : darkTheme;
}

type NamedStyles<T> = { [P in keyof T]: object };

const styleCache = new WeakMap<object, Partial<Record<Mode, unknown>>>();

export function useStyles<T extends NamedStyles<T>>(factory: (theme: Theme) => T): T {
  const theme = useTheme();
  return useMemo(() => {
    let entry = styleCache.get(factory);
    if (!entry) {
      entry = {};
      styleCache.set(factory, entry);
    }
    if (!entry[theme.mode]) entry[theme.mode] = StyleSheet.create(factory(theme));
    return entry[theme.mode] as T;
  }, [factory, theme]);
}

export const SCORE_MIDPOINT = 45;

export function scoreColor(theme: Theme, score: number | null): string {
  if (score == null) return theme.textFaint;
  return score > SCORE_MIDPOINT ? theme.accent : theme.even;
}

export function confidenceLabel(
  theme: Theme,
  confidence: number,
): { label: string; color: string } {
  if (confidence >= 0.85) return { label: t('confidence.full'), color: theme.accent };
  if (confidence >= 0.6) return { label: t('confidence.most'), color: theme.accent };
  if (confidence >= 0.35) return { label: t('confidence.partial'), color: theme.warn };
  if (confidence > 0) return { label: t('confidence.sparse'), color: theme.danger };
  return { label: t('confidence.none'), color: theme.textFaint };
}

export function getPixels(size: number): number {
  const density = PixelRatio.get();
  if (density < 2) return size;
  if (density < 3) return size * 1.15;
  if (density < 3.5) return size * 1.25;
  return size * 1.3;
}

export const radius = {
  chip: 999,
  card: 14,
  cardLarge: 18,
  puck: 12,
  bar: 3,
} as const;

export const space = {
  gutter: 16,
  card: 14,
} as const;
