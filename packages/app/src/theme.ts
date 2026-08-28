import { PixelRatio } from 'react-native';

export const theme = {
  bg: '#0B0F14',
  surface: '#141B24',
  surfaceAlt: '#1C2733',
  border: '#25323F',
  text: '#E8EEF4',
  textDim: '#8A9AAB',
  textFaint: '#5A6B7C',
  accent: '#4DA3FF',
  athletic: '#4DA3FF',
  college: '#C084FC',
  production: '#4ADE80',
  warn: '#FBBF24',
  danger: '#F87171',
} as const;

export function scoreColor(score: number | null): string {
  if (score == null) return theme.textFaint;
  if (score >= 85) return '#34D399';
  if (score >= 70) return '#4ADE80';
  if (score >= 55) return '#A3E635';
  if (score >= 45) return '#94A3B8';
  if (score >= 30) return '#FBBF24';
  return '#F87171';
}

export function confidenceLabel(confidence: number): {
  label: string;
  color: string;
} {
  if (confidence >= 0.85) return { label: 'Full workout', color: theme.production };
  if (confidence >= 0.6) return { label: 'Most drills', color: '#A3E635' };
  if (confidence >= 0.35) return { label: 'Partial', color: theme.warn };
  if (confidence > 0) return { label: 'Sparse', color: theme.danger };
  return { label: 'No workout', color: theme.textFaint };
}

export function getPixels(size: number): number {
  const density = PixelRatio.get();
  if (density < 2) return size;
  if (density < 3) return size * 1.15;
  if (density < 3.5) return size * 1.25;
  return size * 1.3;
}

