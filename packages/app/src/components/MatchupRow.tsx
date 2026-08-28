import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { MatchupSummary } from '../api';
import { describeEdge, edgeColor, formatKickoff, shootoutColor } from '../matchupFormat';
import { getPixels, theme } from '../theme';

/**
 * One game in a matchup list.
 *
 * Renders in two modes off the same row. Before kickoff it is a forecast: the
 * mismatch score and the headline edge. Afterwards it also carries the final
 * score and how many of the ten highest-graded players actually finished in the
 * game's real top ten — which is the only honest way to show a prediction next
 * to what happened.
 */
export function MatchupRow({
  game,
  rank,
  onPress,
}: {
  game: MatchupSummary;
  rank: number;
  onPress: (game: MatchupSummary) => void;
}) {
  const edge = game.top_edge_value == null ? null : Number(game.top_edge_value);
  const isFinal = game.home_score != null && game.away_score != null;
  const gap = Number(game.mismatch_score);

  // The list is grouped by scoring shape, so the row leads with the score that
  // decided which section it landed in. A row with no shootout score — nothing
  // gradeable, or a row predating the column — falls back to the talent gap and
  // the caption says which number is on screen, rather than showing a bar built
  // from NaN.
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
          {isFinal ? 'Final' : formatKickoff(game.gameday, game.gametime)}
          {game.away_coach && game.home_coach
            ? ` · ${lastName(game.away_coach)} vs ${lastName(game.home_coach)}`
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
              ? 'No fantasy lines recorded'
              : `${game.top10_hits} of our top 10 finished in the real top 10`}
            {game.backfilled ? ' · graded after the fact' : ''}
          </Text>
        ) : (
          <Text style={styles.meta} numberOfLines={1}>
            {game.edge_count} mismatch{game.edge_count === 1 ? '' : 'es'} · gap{' '}
            {gap.toFixed(0)}
            {game.total_line != null
              ? ` · total ${Number(game.total_line).toFixed(1)}`
              : ' · no line yet'}
          </Text>
        )}
      </View>

      <View style={styles.scoreCol}>
        <Text style={[styles.score, { color }]}>{score.toFixed(0)}</Text>
        <Text style={styles.scoreCaption}>
          {isFinal ? 'predicted' : shootout == null ? 'gap' : 'scoring'}
        </Text>
      </View>
    </Pressable>
  );
}

function lastName(name: string): string {
  const parts = name.trim().split(' ');
  return parts.length > 1 ? parts.slice(1).join(' ') : name;
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    paddingVertical: 14,
    paddingHorizontal: 16,
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.border,
  },
  rowPressed: { backgroundColor: theme.surfaceAlt },
  rankCol: { width: 26, paddingTop: 2 },
  rank: { color: theme.textFaint, fontSize: getPixels(15), fontWeight: '700' },
  mainCol: { flex: 1, gap: 4 },
  teamLine: { flexDirection: 'row', alignItems: 'baseline', gap: 10 },
  teams: { color: theme.text, fontSize: getPixels(17), fontWeight: '700', letterSpacing: 0.3 },
  at: { color: theme.textFaint, fontWeight: '500' },
  finalScore: {
    color: theme.textDim,
    fontSize: getPixels(14),
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  kickoff: { color: theme.textFaint, fontSize: getPixels(11) },
  barTrack: {
    height: 4,
    borderRadius: 2,
    backgroundColor: theme.surfaceAlt,
    overflow: 'hidden',
    marginTop: 3,
  },
  barFill: { height: 4, borderRadius: 2 },
  edgeLine: { fontSize: getPixels(12.5), fontWeight: '600', marginTop: 2 },
  meta: { color: theme.textDim, fontSize: getPixels(11) },
  scoreCol: { alignItems: 'flex-end', width: 58 },
  score: { fontSize: getPixels(24), fontWeight: '800', fontVariant: ['tabular-nums'] },
  scoreCaption: { color: theme.textFaint, fontSize: getPixels(9), fontWeight: '600' },
});
