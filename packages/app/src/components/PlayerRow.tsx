import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { weightsOf, type RankedPlayer } from '../api';
import {
  confidenceLabel,
  getPixels,
  radius,
  scoreColor,
  useStyles,
  useTheme,
  type Theme,
} from '../theme';
import { ScoreSplitBar } from './Bars';
import { CardWash } from './Card';

function roleNote(player: RankedPlayer): string | null {
  if (player.position === 'QB' && player.rank_tier === 1) return 'Spot starter';
  if (player.position === 'QB' && player.rank_tier === 2) return 'Backup — no starts';
  if (player.qualified === false) return 'Too few snaps to rank';
  return null;
}

const NAME_LINE = getPixels(21);
const META_LINE = getPixels(17);
const NOTE_LINE = getPixels(15);
const BAR_BLOCK = 4 + 9;
const CARD_PAD_V = 12;
const CARD_GAP = 10;

export const PLAYER_ROW_HEIGHT =
  CARD_PAD_V * 2 + NAME_LINE + META_LINE + NOTE_LINE + BAR_BLOCK + CARD_GAP;

export const PlayerRow = memo(function PlayerRow({
  player,
  onPress,
}: {
  player: RankedPlayer;
  onPress: (player: RankedPlayer) => void;
}) {
  const t = useTheme();
  const styles = useStyles(sheet);
  const confidence = confidenceLabel(t, Number(player.athletic_confidence ?? 0));
  const note = roleNote(player);
  const composite = Number(player.composite);

  return (
    <Pressable
      onPress={() => onPress(player)}
      accessibilityRole="button"
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <CardWash />
      <View style={styles.rankCol}>
        <Text style={styles.rank}>{player.position_rank}</Text>
        <Text style={styles.rankLabel}>{player.position}</Text>
      </View>
      <View style={styles.main}>
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
        <Text style={styles.note} numberOfLines={1}>
          {note ?? ''}
        </Text>
        <View style={styles.barSlot}>
          <ScoreSplitBar weights={weightsOf(player)} compact />
        </View>
      </View>
      <View style={styles.scoreCol}>
        <Text style={[styles.score, { color: scoreColor(t, composite) }]}>
          {composite.toFixed(0)}
        </Text>
        <Text style={[styles.confidence, { color: confidence.color }]} numberOfLines={1}>
          {confidence.label}
        </Text>
      </View>
    </Pressable>
  );
});

const sheet = (t: Theme) => ({
  card: {
    height: PLAYER_ROW_HEIGHT - CARD_GAP,
    marginHorizontal: 16,
    marginBottom: CARD_GAP,
    paddingVertical: CARD_PAD_V,
    paddingLeft: 10,
    paddingRight: 14,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 10,
    backgroundColor: t.surface,
    borderRadius: radius.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: t.border,
    borderLeftWidth: 2,
    borderLeftColor: t.accent,
    overflow: 'hidden' as const,
  },
  pressed: { opacity: 0.75 },

  rankCol: { width: 34, alignItems: 'center' as const },
  rank: { color: t.text, fontSize: getPixels(17), fontWeight: '700' as const },
  rankLabel: { color: t.textFaint, fontSize: getPixels(10), fontWeight: '600' as const },

  main: { flex: 1 },
  name: {
    color: t.text,
    fontSize: getPixels(16),
    lineHeight: NAME_LINE,
    fontWeight: '700' as const,
    letterSpacing: -0.2,
  },
  meta: { color: t.textDim, fontSize: getPixels(12.5), lineHeight: META_LINE },
  note: { color: t.warn, fontSize: getPixels(10.5), lineHeight: NOTE_LINE, fontWeight: '600' as const },
  barSlot: { height: 4, marginTop: 9, justifyContent: 'center' as const },

  scoreCol: { alignItems: 'flex-end' as const, width: 82 },
  score: {
    fontSize: getPixels(26),
    lineHeight: getPixels(30),
    fontWeight: '800' as const,
    fontVariant: ['tabular-nums' as const],
  },
  confidence: { fontSize: getPixels(11), fontWeight: '600' as const },
});
