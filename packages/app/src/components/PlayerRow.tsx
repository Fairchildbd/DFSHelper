import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { weightsOf, type RankedPlayer } from '../api';
import { confidenceLabel, getPixels, scoreColor, theme } from '../theme';
import { ScoreSplitBar } from './ScoreSplitBar';

function roleNote(player: RankedPlayer): string | null {
  if (player.position === 'QB' && player.rank_tier === 1) return 'Spot starter';
  if (player.position === 'QB' && player.rank_tier === 2) return 'Backup — no starts';
  if (player.qualified === false) return 'Too few snaps to rank';
  return null;
}

const NAME_LINE = getPixels(20);
const META_LINE = getPixels(17);
const NOTE_LINE = getPixels(16);
const BAR_HEIGHT = 4;
const ROW_GAP = 3;
const ROW_PAD_V = 12;

export const PLAYER_ROW_HEIGHT =
  ROW_PAD_V * 2 + NAME_LINE + META_LINE + NOTE_LINE + BAR_HEIGHT + ROW_GAP * 3;

export const PlayerRow = memo(function PlayerRow({
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
        <Text style={styles.unqualified} numberOfLines={1}>
          {roleNote(player) ?? ''}
        </Text>
        <View style={styles.barSlot}>
          <ScoreSplitBar weights={weightsOf(player)} compact />
        </View>
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
});

const styles = StyleSheet.create({
  row: {
    height: PLAYER_ROW_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: ROW_PAD_V,
    paddingHorizontal: 16,
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.border,
  },
  rowPressed: { backgroundColor: theme.surfaceAlt },
  rankCol: { width: 36, alignItems: 'center' },
  rank: { color: theme.text, fontSize: getPixels(16), fontWeight: '700' },
  rankLabel: { color: theme.textFaint, fontSize: getPixels(10), fontWeight: '600' },
  mainCol: { flex: 1, gap: ROW_GAP },
  name: { color: theme.text, fontSize: getPixels(15), lineHeight: NAME_LINE, fontWeight: '600' },
  meta: { color: theme.textDim, fontSize: getPixels(12), lineHeight: META_LINE },
  unqualified: {
    color: theme.warn,
    fontSize: getPixels(11),
    lineHeight: NOTE_LINE,
    fontWeight: '600',
  },
  barSlot: { height: BAR_HEIGHT, justifyContent: 'center' },
  scoreCol: { alignItems: 'flex-end', width: 78 },
  score: { fontSize: getPixels(22), fontWeight: '800', fontVariant: ['tabular-nums'] },
  confidence: { fontSize: getPixels(10), fontWeight: '600' },
});
