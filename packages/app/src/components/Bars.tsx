import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTranslation } from '../i18n';
import { getPixels, radius, useStyles, useTheme, type Theme } from '../theme';

function clamp(pct: number): number {
  return Math.max(0, Math.min(100, pct));
}

export function Meter({
  percent,
  color,
  height = 3,
  style,
}: {
  percent: number;
  color?: string;
  height?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  const styles = useStyles(sheet);

  return (
    <View style={[styles.track, { height, borderRadius: height / 2 }, style]}>
      <View
        style={{
          height,
          borderRadius: height / 2,
          width: `${clamp(percent)}%`,
          backgroundColor: color ?? theme.accent,
        }}
      />
    </View>
  );
}

export function StatRow({
  label,
  value,
  percent,
  note,
  weight,
  color,
  style,
}: {
  label: string;
  value: string;

  percent: number | null;
  note?: string | null;

  weight?: string | null;
  color?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  const styles = useStyles(sheet);

  return (
    <View style={[styles.statRow, style]}>
      <View style={styles.statHead}>
        <Text style={styles.statLabel} numberOfLines={1}>
          {label}
        </Text>
        {weight ? <Text style={styles.statWeight}>{weight}</Text> : null}
        <Text style={styles.statValue}>{value}</Text>
      </View>
      <Meter percent={percent ?? 0} color={percent == null ? theme.textFaint : color} />
      {note ? (
        <Text style={styles.statNote} numberOfLines={1}>
          {note}
        </Text>
      ) : null}
    </View>
  );
}

export interface Weights {
  athletic: number;
  college: number;
  nfl: number;
}

export function ScoreSplitBar({
  weights,
  compact = false,
  inline = false,
}: {
  weights: Weights | null;
  compact?: boolean;

  inline?: boolean;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const styles = useStyles(sheet);
  if (!weights) return null;

  const athletic = Math.round(weights.athletic * 100);
  const college = Math.round(weights.college * 100);
  const nfl = Math.round(weights.nfl * 100);
  if (athletic + college + nfl === 0) return null;

  const segments = [
    { key: 'athletic', value: athletic, color: theme.athletic, label: t('split.workout') },
    { key: 'college', value: college, color: theme.college, label: t('split.college') },
    { key: 'nfl', value: nfl, color: theme.production, label: t('split.nfl') },
  ].filter((s) => s.value > 0);

  const legend = (
    <View style={styles.splitLegend}>
      {segments.map((s) => (
        <Text key={s.key} style={[styles.splitLegendText, { color: s.color }]}>
          {t('split.legendEntry', { percent: s.value, label: s.label })}
        </Text>
      ))}
    </View>
  );

  const bar = (
    <View style={[styles.splitBar, inline && styles.splitBarInline]}>
      {segments.map((s) => (
        <View key={s.key} style={{ flex: s.value, height: '100%', backgroundColor: s.color }} />
      ))}
    </View>
  );

  if (inline) {
    return (
      <View style={styles.splitInline}>
        {legend}
        {bar}
      </View>
    );
  }

  return (
    <View style={compact ? undefined : styles.splitWrap}>
      {!compact && legend}
      {bar}
    </View>
  );
}

const sheet = (theme: Theme) => ({
  track: { backgroundColor: theme.surfaceAlt, overflow: 'hidden' as const, width: '100%' as const },

  statRow: { gap: 5, paddingVertical: 5 },
  statHead: { flexDirection: 'row' as const, alignItems: 'baseline' as const, gap: 8 },
  statLabel: { color: theme.text, fontSize: getPixels(12.5), fontWeight: '600' as const, flex: 1 },
  statWeight: { color: theme.textDim, fontSize: getPixels(11.5), fontVariant: ['tabular-nums' as const] },
  statValue: {
    color: theme.text,
    fontSize: getPixels(12.5),
    fontWeight: '700' as const,
    fontVariant: ['tabular-nums' as const],
  },
  statNote: { color: theme.textFaint, fontSize: getPixels(10.5) },

  splitWrap: { gap: 6 },
  splitInline: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 10 },
  splitBarInline: { flex: 1 },
  splitLegend: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 10 },
  splitLegendText: { fontSize: getPixels(11), fontWeight: '600' as const },
  splitBar: {
    flexDirection: 'row' as const,
    height: 4,
    borderRadius: radius.bar,
    overflow: 'hidden' as const,
    backgroundColor: theme.surfaceAlt,
  },
});
