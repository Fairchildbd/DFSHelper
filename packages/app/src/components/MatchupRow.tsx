import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { MatchupSummary } from '../api';
import { useTranslation } from '../i18n';
import { describeEdge, edgeColor, formatKickoff, shootoutColor } from '../matchupFormat';
import { getPixels, theme } from '../theme';

const TEAMS_LINE = getPixels(22);
const KICKOFF_LINE = getPixels(16);
const EDGE_LINE = getPixels(17.5);
const META_LINE = getPixels(16);
const BAR_HEIGHT = 4;
const BAR_MARGIN = 3;
const EDGE_MARGIN = 2;
const ROW_GAP = 4;
const ROW_PAD_V = 14;

export const MATCHUP_ROW_HEIGHT =
  ROW_PAD_V * 2 +
  TEAMS_LINE +
  KICKOFF_LINE +
  BAR_HEIGHT +
  BAR_MARGIN +
  EDGE_LINE * 2 +
  EDGE_MARGIN +
  META_LINE +
  ROW_GAP * 4;

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
  const edge = game.top_edge_value == null ? null : Number(game.top_edge_value);
  const isFinal = game.home_score != null && game.away_score != null;
  const gap = Number(game.mismatch_score);

  const shootout = game.shootout_score == null ? null : Number(game.shootout_score);
  const score = shootout ?? gap;
  const color = shootoutColor(score);

  return (
    <Pressable
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      onPress={() => onPress(game)}
    >
      <View style={styles.rankCol}>
        <Text style={styles.rank}>{rank}</Text>
      </View>

      <View style={styles.mainCol}>
        <View style={styles.teamLine}>
          <Text style={styles.teams}>
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

        <View style={styles.barTrack}>
          <View style={[styles.barFill, { width: `${score}%`, backgroundColor: color }]} />
        </View>

        <Text style={[styles.edgeLine, { color: edgeColor(edge) }]} numberOfLines={2}>
          {describeEdge(game.top_edge_label, edge)}
        </Text>

        {isFinal ? (
          <Text style={styles.meta} numberOfLines={1}>
            {game.top10_hits == null
              ? t('row.noFantasyLines')
              : t('row.top10Hits', { hits: game.top10_hits })}
            {game.backfilled ? t('row.gradedAfterTheFact') : ''}
          </Text>
        ) : (
          <Text style={styles.meta} numberOfLines={1}>
            {t('row.mismatchSummary', {
              count: game.edge_count,
              gap: gap.toFixed(0),
            })}
            {game.total_line != null
              ? t('row.totalLine', { total: Number(game.total_line).toFixed(1) })
              : t('row.noLineYet')}
          </Text>
        )}
      </View>

      <View style={styles.scoreCol}>
        <Text style={[styles.score, { color }]}>{score.toFixed(0)}</Text>
        <Text style={styles.scoreCaption}>
          {isFinal
            ? t('row.captionPredicted')
            : shootout == null
              ? t('row.captionGap')
              : t('row.captionScoring')}
        </Text>
      </View>
    </Pressable>
  );
});

function lastName(name: string): string {
  const parts = name.trim().split(' ');
  return parts.length > 1 ? parts.slice(1).join(' ') : name;
}

const styles = StyleSheet.create({
  row: {
    height: MATCHUP_ROW_HEIGHT,
    flexDirection: 'row',
    paddingVertical: ROW_PAD_V,
    paddingHorizontal: 16,
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.border,
  },
  rowPressed: { backgroundColor: theme.surfaceAlt },
  rankCol: { width: 26, paddingTop: 2 },
  rank: { color: theme.textFaint, fontSize: getPixels(15), fontWeight: '700' },
  mainCol: { flex: 1, gap: ROW_GAP },
  teamLine: { flexDirection: 'row', alignItems: 'baseline', gap: 10 },
  teams: {
    color: theme.text,
    fontSize: getPixels(17),
    lineHeight: TEAMS_LINE,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  at: { color: theme.textFaint, fontWeight: '500' },
  finalScore: {
    color: theme.textDim,
    fontSize: getPixels(14),
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  kickoff: { color: theme.textFaint, fontSize: getPixels(11), lineHeight: KICKOFF_LINE },
  barTrack: {
    height: BAR_HEIGHT,
    borderRadius: 2,
    backgroundColor: theme.surfaceAlt,
    overflow: 'hidden',
    marginTop: BAR_MARGIN,
  },
  barFill: { height: BAR_HEIGHT, borderRadius: 2 },
  edgeLine: {
    fontSize: getPixels(12.5),
    lineHeight: EDGE_LINE,
    height: EDGE_LINE * 2,
    fontWeight: '600',
    marginTop: EDGE_MARGIN,
  },
  meta: { color: theme.textDim, fontSize: getPixels(11), lineHeight: META_LINE },
  scoreCol: { alignItems: 'flex-end', width: 58 },
  score: { fontSize: getPixels(24), fontWeight: '800', fontVariant: ['tabular-nums'] },
  scoreCaption: { color: theme.textFaint, fontSize: getPixels(9), fontWeight: '600' },
});
