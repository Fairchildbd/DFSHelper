import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from '../i18n';
import { getPixels, theme } from '../theme';

export interface Weights {
  athletic: number;
  college: number;
  nfl: number;
}

export function ScoreSplitBar({
  weights,
  compact = false,
}: {
  weights: Weights | null;
  compact?: boolean;
}) {
  const { t } = useTranslation();

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

  return (
    <View style={compact ? styles.wrapCompact : styles.wrap}>
      <View style={styles.bar}>
        {segments.map((s) => (
          <View
            key={s.key}
            style={[styles.segment, { flex: s.value, backgroundColor: s.color }]}
          />
        ))}
      </View>
      {!compact && (
        <View style={styles.legend}>
          {segments.map((s) => (
            <Text key={s.key} style={[styles.legendText, { color: s.color }]}>
              {t('split.legendEntry', { percent: s.value, label: s.label })}
            </Text>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 6 },
  wrapCompact: {},
  bar: {
    flexDirection: 'row',
    height: 4,
    borderRadius: 2,
    overflow: 'hidden',
    backgroundColor: theme.border,
  },
  segment: { height: '100%' },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  legendText: { fontSize: getPixels(11), fontWeight: '600' },
});
