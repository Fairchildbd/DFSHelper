import { Pressable, StyleSheet, Text, View } from 'react-native';
import { weightsOf, type RankedPlayer } from '../api';
import { confidenceLabel, getPixels, scoreColor, theme } from '../theme';
import { ScoreSplitBar } from './ScoreSplitBar';

/**
 * Why a player sits where he does when the score alone would not explain it.
 * Quarterbacks are ordered by whether they hold the job before they are ordered
 * by score, so a backup with a flattering number needs to say so on the row.
 */
function roleNote(player: RankedPlayer): string | null {
  if (player.position === 'QB' && player.rank_tier === 1) return 'Spot starter';
  if (player.position === 'QB' && player.rank_tier === 2) return 'Backup — no starts';
  if (player.qualified === false) return 'Too few snaps to rank';
  return null;
}

export function PlayerRow({
  player,
  onPress,
}: {
  player: RankedPlayer;
  onPress: (player: RankedPlayer) => void;
}) {
  const confidence = confidenceLabel(Number(player.athletic_confidence ?? 0));

  return (
    <Pressable
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      onPress={() => onPress(player)}
    >
      <View style={styles.rankCol}>
        <Text style={styles.rank}>{player.position_rank}</Text>
        <Text style={styles.rankLabel}>{player.position}</Text>
      </View>

      <View style={styles.mainCol}>
        <Text style={styles.name} numberOfLines={1}>
          {player.display_name}
        </Text>
        <Text style={styles.meta} numberOfLines={1}>
          {[
            player.team ?? 'FA',
            player.age != null ? `${Number(player.age).toFixed(0)}yr` : null,
            `${player.years_experience ?? 0} exp`,
          ]
            .filter(Boolean)
            .join(' · ')}
        </Text>
        {roleNote(player) && <Text style={styles.unqualified}>{roleNote(player)}</Text>}
        <ScoreSplitBar weights={weightsOf(player)} compact />
      </View>

      <View style={styles.scoreCol}>
        <Text style={[styles.score, { color: scoreColor(Number(player.composite)) }]}>
          {Number(player.composite).toFixed(0)}
        </Text>
        <Text style={[styles.confidence, { color: confidence.color }]} numberOfLines={1}>
          {confidence.label}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.border,
  },
  rowPressed: { backgroundColor: theme.surfaceAlt },
  rankCol: { width: 36, alignItems: 'center' },
  rank: { color: theme.text, fontSize: getPixels(16), fontWeight: '700' },
  rankLabel: { color: theme.textFaint, fontSize: getPixels(10), fontWeight: '600' },
  mainCol: { flex: 1, gap: 3 },
  name: { color: theme.text, fontSize: getPixels(15), fontWeight: '600' },
  meta: { color: theme.textDim, fontSize: getPixels(12) },
  unqualified: { color: theme.warn, fontSize: getPixels(11), fontWeight: '600' },
  scoreCol: { alignItems: 'flex-end', width: 78 },
  score: { fontSize: getPixels(22), fontWeight: '800', fontVariant: ['tabular-nums'] },
  confidence: { fontSize: getPixels(10), fontWeight: '600' },
});
