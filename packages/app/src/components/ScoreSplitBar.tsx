import { StyleSheet, Text, View } from 'react-native';
import { getPixels, theme } from '../theme';

export interface Weights {
  athletic: number;
  college: number;
  nfl: number;
}

/**
 * Shows how a composite score was actually assembled — how much came from the
 * workout, from college production, and from NFL production. The split is the
 * whole point of the model, so it belongs on the row itself rather than buried
 * in a detail view.
 */
export function ScoreSplitBar({
  weights,
  compact = false,
}: {
  weights: Weights | null;
  compact?: boolean;
}) {
  if (!weights) return null;

  const athletic = Math.round(weights.athletic * 100);
  const college = Math.round(weights.college * 100);
  const nfl = Math.round(weights.nfl * 100);

  // A veteran with no production on record carries no weights at all — there is
  // no composition to show, and a blank bar would read as a rendering bug.
  if (athletic + college + nfl === 0) return null;

  const segments = [
    { value: athletic, color: theme.athletic, label: 'workout' },
    { value: college, color: theme.college, label: 'college' },
    { value: nfl, color: theme.production, label: 'NFL' },
  ].filter((s) => s.value > 0);

  return (
    <View style={compact ? styles.wrapCompact : styles.wrap}>
      <View style={styles.bar}>
        {segments.map((s) => (
          <View
            key={s.label}
            style={[styles.segment, { flex: s.value, backgroundColor: s.color }]}
          />
        ))}
      </View>
      {!compact && (
        <View style={styles.legend}>
          {segments.map((s) => (
            <Text key={s.label} style={[styles.legendText, { color: s.color }]}>
              {s.value}% {s.label}
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
