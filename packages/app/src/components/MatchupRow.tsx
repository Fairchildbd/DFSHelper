import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { MatchupSummary } from '../api';
import { useTranslation } from '../i18n';
import { describeEdge, formatKickoff } from '../matchupFormat';
import { getPixels, radius, scoreColor, useStyles, useTheme, type Theme } from '../theme';
import { CardWash } from './Card';
import { Icon, glowStyle } from './Icon';

const TEAMS_LINE = getPixels(26);
const KICKOFF_LINE = getPixels(16);
const EDGE_LINE = getPixels(17.5);
const META_LINE = getPixels(16);
const BAR_BLOCK = 3 + 9;
const CARD_PAD_V = 14;
const CARD_GAP = 10;

export const MATCHUP_ROW_HEIGHT =
  CARD_PAD_V * 2 +
  TEAMS_LINE +
  KICKOFF_LINE +
  BAR_BLOCK +
  EDGE_LINE * 2 +
  META_LINE +
  4 +
  CARD_GAP;

export const MatchupRow = memo(function MatchupRow({
  game,
  rank,
  onPress,
}: {
  game: MatchupSummary;
  rank: number;
  onPress: (game: MatchupSummary) => void;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const styles = useStyles(sheet);

  const edge = game.top_edge_value == null ? null : Number(game.top_edge_value);
  const isFinal = game.home_score != null && game.away_score != null;
  const gap = Number(game.mismatch_score);
  const shootout = game.shootout_score == null ? null : Number(game.shootout_score);
  const score = shootout ?? gap;
  const tint = scoreColor(theme, score);

  return (
    <Pressable
      onPress={() => onPress(game)}
      accessibilityRole="button"
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <CardWash />
      <View style={styles.rankBadge}>
        <Text style={styles.rankText}>{rank}</Text>
      </View>
      <View style={styles.main}>
        <View style={styles.teamLine}>
          <Text style={styles.teams} numberOfLines={1}>
            {game.away_team} <Text style={styles.at}>@</Text> {game.home_team}
          </Text>
          {isFinal && (
            <Text style={styles.finalScore}>
              {game.away_score}–{game.home_score}
            </Text>
          )}
        </View>
        <Text style={styles.kickoff} numberOfLines={1}>
          {isFinal ? t('row.final') : formatKickoff(game.gameday, game.gametime)}
          {game.away_coach && game.home_coach
            ? t('row.coachVsCoach', {
                away: lastName(game.away_coach),
                home: lastName(game.home_coach),
              })
            : ''}
        </Text>
        <View style={styles.track}>
          <View
            style={[
              styles.fill,
              { width: `${Math.max(0, Math.min(100, score))}%`, backgroundColor: tint },
            ]}
          />
        </View>
        <Text style={styles.edge} numberOfLines={2}>
          {describeEdge(game.top_edge_label, edge)}
        </Text>
        <Text style={styles.meta} numberOfLines={1}>
          {isFinal
            ? `${
                game.top10_hits == null
                  ? t('row.noFantasyLines')
                  : t('row.top10Hits', { hits: game.top10_hits })
              }${game.backfilled ? t('row.gradedAfterTheFact') : ''}`
            : `${t('row.mismatchSummary', {
                count: game.edge_count,
                gap: gap.toFixed(0),
              })}${
                game.total_line != null
                  ? t('row.totalLine', { total: Number(game.total_line).toFixed(1) })
                  : t('row.noLineYet')
              }`}
        </Text>
      </View>
      <View style={styles.scoreCol}>
        <Text style={[styles.score, { color: tint }]}>{score.toFixed(0)}</Text>
        <Text style={styles.scoreCaption}>
          {isFinal
            ? t('row.captionPredicted')
            : shootout == null
              ? t('row.captionGap')
              : t('row.captionScoring')}
        </Text>
        <View style={[styles.flame, glowStyle(theme, 0.5)]}>
          <Icon name="fire" size={17} color={theme.accent} />
        </View>
      </View>
    </Pressable>
  );
});

function lastName(name: string): string {
  const parts = name.trim().split(' ');
  return parts.length > 1 ? parts.slice(1).join(' ') : name;
}

const sheet = (theme: Theme) => ({
  card: {
    height: MATCHUP_ROW_HEIGHT - CARD_GAP,
    marginHorizontal: 16,
    marginBottom: CARD_GAP,
    paddingVertical: CARD_PAD_V,
    paddingRight: 14,
    paddingLeft: 12,
    flexDirection: 'row' as const,
    gap: 10,
    backgroundColor: theme.surface,
    borderRadius: radius.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
    borderLeftWidth: 2,
    borderLeftColor: theme.accent,
    overflow: 'hidden' as const,
  },
  pressed: { opacity: 0.75 },

  rankBadge: {
    width: 24,
    height: 24,
    borderRadius: 7,
    backgroundColor: theme.accentSoft,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    marginTop: 2,
  },
  rankText: { color: theme.accent, fontSize: getPixels(12), fontWeight: '700' as const },

  main: { flex: 1 },
  teamLine: { flexDirection: 'row' as const, alignItems: 'baseline' as const, gap: 10 },
  teams: {
    color: theme.text,
    fontSize: getPixels(19),
    lineHeight: TEAMS_LINE,
    fontWeight: '800' as const,
    letterSpacing: 0.2,
    flexShrink: 1,
  },
  at: { color: theme.textFaint, fontWeight: '500' as const },
  finalScore: {
    color: theme.textDim,
    fontSize: getPixels(14),
    fontWeight: '700' as const,
    fontVariant: ['tabular-nums' as const],
  },
  kickoff: { color: theme.textDim, fontSize: getPixels(11.5), lineHeight: KICKOFF_LINE },

  track: {
    height: 3,
    borderRadius: 1.5,
    backgroundColor: theme.surfaceAlt,
    overflow: 'hidden' as const,
    marginTop: 9,
  },
  fill: { height: 3, borderRadius: 1.5 },

  edge: {
    color: theme.accent,
    fontSize: getPixels(12.5),
    lineHeight: EDGE_LINE,
    height: EDGE_LINE * 2,
    fontWeight: '600' as const,
    marginTop: 4,
  },
  meta: { color: theme.textDim, fontSize: getPixels(11.5), lineHeight: META_LINE },

  scoreCol: { width: 58, alignItems: 'center' as const },
  score: {
    fontSize: getPixels(27),
    lineHeight: getPixels(31),
    fontWeight: '800' as const,
    fontVariant: ['tabular-nums' as const],
  },
  scoreCaption: { color: theme.textDim, fontSize: getPixels(10), fontWeight: '500' as const },
  flame: {
    marginTop: 10,
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: theme.accentSoft,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.accent,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
});
