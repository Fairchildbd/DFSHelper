import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  API_URL,
  fetchSlates,
  fetchThisWeek,
  type GameShape,
  type MatchupSummary,
  type SlateSummary,
  type StrategyDefinition,
  type WeekBlock,
} from '../api';
import { MatchupRow } from '../components/MatchupRow';
import { GAME_SHAPES } from '../matchupFormat';
import { getPixels, theme } from '../theme';

/**
 * The weekly product: one week of predictions, and the week just finished.
 *
 * Deliberately not a week browser. Only the week now in play is forecast, so
 * there is never a screen full of predictions for games two months out that
 * nobody has checked. The season-wide view lives under Best Ball.
 */
export function ThisWeekScreen({
  onSelectGame,
  onBuildLineup,
}: {
  onSelectGame: (game: MatchupSummary) => void;
  onBuildLineup: (slate: SlateSummary, strategy: StrategyDefinition) => void;
}) {
  const [current, setCurrent] = useState<WeekBlock | null>(null);
  const [previous, setPrevious] = useState<WeekBlock | null>(null);
  const [slates, setSlates] = useState<SlateSummary[]>([]);
  const [strategies, setStrategies] = useState<StrategyDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shapeOrder, setShapeOrder] = useState<GameShape[]>([]);

  const load = useCallback(async () => {
    try {
      const res = await fetchThisWeek();
      setShapeOrder(res.shapeOrder ?? []);
      setCurrent(res.current);
      setPrevious(res.previous);
      setError(null);
      // A missing salary import is not an error — it is the ordinary state of a
      // week nobody has drafted yet — so it never blocks the matchup list.
      try {
        const res = await fetchSlates();
        setSlates(res.slates);
        setStrategies(res.strategies);
      } catch {
        setSlates([]);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (error) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorTitle}>Can’t reach the API</Text>
        <Text style={styles.errorBody}>{error}</Text>
        <Text style={styles.errorHint}>
          Expecting the server at {API_URL}. Start it with{' '}
          <Text style={styles.mono}>npm run api</Text>.
        </Text>
      </View>
    );
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={theme.accent} />
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.screen}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          tintColor={theme.textDim}
          onRefresh={() => {
            setRefreshing(true);
            load();
          }}
        />
      }
    >
      <View style={styles.header}>
        <Text style={styles.title}>{current?.label ?? 'This week'}</Text>
        <Text style={styles.subtitle}>
          {current
            ? `${current.games.length} games · grouped by what kind of game it is`
            : 'No upcoming week'}
        </Text>
      </View>

      {current?.upcoming && (
        <View style={styles.notice}>
          <Text style={styles.noticeText}>
            Nothing has kicked off yet, so every number here is a forecast built from
            prior seasons. Predictions are frozen once a game goes final, so what you
            see now is what gets graded next week.
          </Text>
        </View>
      )}

      {current?.missing && (
        <View style={styles.notice}>
          <Text style={styles.noticeText}>
            No predictions built for this week yet. Run{' '}
            <Text style={styles.mono}>npm run db:matchups</Text>.
          </Text>
        </View>
      )}

      <LineupBar slates={slates} strategies={strategies} onBuild={onBuildLineup} />

      {current && (
        <ShapedList games={current.games} order={shapeOrder} onSelect={onSelectGame} />
      )}

      {previous && previous.games.length > 0 && (
        <>
          <View style={styles.header}>
            <Text style={styles.sectionTitle}>{previous.label} · results</Text>
            <Text style={styles.subtitle}>
              What was ranked, against what actually happened
            </Text>
          </View>

          {previous.games.some((g) => g.backfilled) && (
            <View style={[styles.notice, styles.noticeWarn]}>
              <Text style={styles.noticeText}>
                These grades were produced after the game was played, as a worked
                example — not a forecast the model made in advance. Weeks predicted
                ahead of kickoff will be marked as such.
              </Text>
            </View>
          )}

          {previous.games.map((g, i) => (
            <MatchupRow key={g.game_id} game={g} rank={i + 1} onPress={onSelectGame} />
          ))}
        </>
      )}

      <View style={styles.footer} />
    </ScrollView>
  );
}

/**
 * The week's games, grouped into sections rather than ranked one to sixteen.
 *
 * The server has already ordered the rows — sections in `order`, and by
 * projected scoring within each — so this walks the list in the order it
 * arrived and starts a new header whenever the shape changes. Grouping by
 * scanning rather than by bucketing keeps one ordering authority: a section
 * cannot silently reorder itself here and disagree with the query that built
 * it.
 *
 * Rank numbering restarts inside each section, because a game's number is only
 * meaningful against the others answering the same description. "Third-best
 * shootout" is a useful thing to know; "ninth on the slate" across four
 * different kinds of game is not.
 */
function ShapedList({
  games,
  order,
  onSelect,
}: {
  games: MatchupSummary[];
  order: GameShape[];
  onSelect: (game: MatchupSummary) => void;
}) {
  const sections = order
    .map((shape) => ({ shape, games: games.filter((g) => g.game_shape === shape) }))
    .filter((section) => section.games.length > 0);

  // Anything the server could not classify — no gradeable lane, or a row built
  // before the column existed. Shown rather than dropped, under a header that
  // says plainly that the model has no read, so a missing game is never
  // mistaken for a game nobody rated worth playing.
  const unclassified = games.filter(
    (g) => !g.game_shape || !order.includes(g.game_shape),
  );

  return (
    <>
      {sections.map(({ shape, games: rows }) => (
        <View key={shape}>
          <View style={styles.shapeHeader}>
            <View style={[styles.shapeDot, { backgroundColor: GAME_SHAPES[shape].color }]} />
            <View style={styles.shapeText}>
              <Text style={styles.shapeTitle}>{GAME_SHAPES[shape].title}</Text>
              <Text style={styles.shapeBlurb}>{GAME_SHAPES[shape].blurb}</Text>
            </View>
          </View>
          {rows.map((g, i) => (
            <MatchupRow key={g.game_id} game={g} rank={i + 1} onPress={onSelect} />
          ))}
        </View>
      ))}

      {unclassified.length > 0 && (
        <View>
          <View style={styles.shapeHeader}>
            <View style={[styles.shapeDot, { backgroundColor: theme.textFaint }]} />
            <View style={styles.shapeText}>
              <Text style={styles.shapeTitle}>Not graded</Text>
              <Text style={styles.shapeBlurb}>
                Not enough roster or opponent data to say what kind of game this is.
              </Text>
            </View>
          </View>
          {unclassified.map((g, i) => (
            <MatchupRow key={g.game_id} game={g} rank={i + 1} onPress={onSelect} />
          ))}
        </View>
      )}
    </>
  );
}

/**
 * The build button, one per imported multi-game slate.
 *
 * Only offered for slates whose salaries are loaded. An optimizer with no
 * prices is not a degraded feature, it is a wrong answer, so the button is
 * replaced by the one instruction that fixes it rather than shown greyed out.
 *
 * Showdown is deliberately absent. A captain lineup is one game's contest, so
 * its button belongs on that game's page, where the matchup it is built from is
 * on screen — offered up here it would sit above a list of thirteen games while
 * applying to exactly one of them.
 */
function LineupBar({
  slates,
  strategies,
  onBuild,
}: {
  slates: SlateSummary[];
  strategies: StrategyDefinition[];
  onBuild: (slate: SlateSummary, strategy: StrategyDefinition) => void;
}) {
  const multiGame = slates.filter((s) => s.contest !== 'showdown');

  if (multiGame.length === 0) {
    return (
      <View style={styles.notice}>
        <Text style={styles.noticeText}>
          {slates.length > 0
            ? 'No main-slate salaries imported for this week. A showdown is loaded, and it builds from its own game below. For the main slate, export it from the contest lobby and run '
            : 'No DraftKings salaries imported for this week, so no lineup can be built. Export the slate from the contest lobby and run '}
          <Text style={styles.mono}>npm run ingest:dk -- --file DKSalaries.csv</Text>.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.lineupBar}>
      {multiGame.map((slate) => (
        <View key={`${slate.contest}-${slate.game_id ?? 'all'}`} style={styles.slateBlock}>
          <Text style={styles.slateLabel}>
            Main slate · {slate.games} {slate.games === 1 ? 'game' : 'games'} ·{' '}
            {slate.players} priced
          </Text>
          {strategies.map((strategy) => (
            <Pressable
              key={strategy.key}
              style={({ pressed }) => [styles.buildButton, pressed && styles.buildPressed]}
              onPress={() => onBuild(slate, strategy)}
            >
              <Text style={styles.buildLabel}>{strategy.label}</Text>
              <Text style={styles.buildMeta}>{strategy.tagline}</Text>
            </Pressable>
          ))}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  lineupBar: { paddingHorizontal: 16, paddingBottom: 4, gap: 12 },
  slateBlock: { gap: 6 },
  slateLabel: {
    color: theme.textFaint,
    fontSize: getPixels(10.5),
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  buildButton: {
    backgroundColor: theme.accent,
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  buildPressed: { opacity: 0.85 },
  buildLabel: { color: '#08131F', fontSize: getPixels(14.5), fontWeight: '800' },
  buildMeta: { color: '#0C2237', fontSize: getPixels(11), fontWeight: '600', marginTop: 2 },
  screen: { flex: 1, backgroundColor: theme.bg },
  header: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 10 },
  title: { color: theme.text, fontSize: getPixels(30), fontWeight: '800', letterSpacing: -0.5 },
  sectionTitle: { color: theme.text, fontSize: getPixels(20), fontWeight: '800' },
  subtitle: { color: theme.textDim, fontSize: getPixels(13), marginTop: 2 },
  shapeHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 16,
    paddingTop: 18,
    paddingBottom: 8,
    gap: 9,
  },
  shapeDot: { width: 4, alignSelf: 'stretch', borderRadius: 2, marginTop: 2 },
  shapeText: { flex: 1 },
  shapeTitle: {
    color: theme.text,
    fontSize: getPixels(15),
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  shapeBlurb: {
    color: theme.textFaint,
    fontSize: getPixels(11),
    lineHeight: getPixels(15),
    marginTop: 2,
  },
  notice: {
    marginHorizontal: 16,
    marginBottom: 12,
    padding: 12,
    borderRadius: 10,
    backgroundColor: theme.surface,
    borderLeftWidth: 3,
    borderLeftColor: theme.accent,
  },
  noticeWarn: { borderLeftColor: theme.warn },
  noticeText: { color: theme.textDim, fontSize: getPixels(12), lineHeight: getPixels(18) },
  center: { flex: 1, backgroundColor: theme.bg, justifyContent: 'center', padding: 28, gap: 10 },
  errorTitle: { color: theme.text, fontSize: getPixels(20), fontWeight: '700' },
  errorBody: { color: theme.danger, fontSize: getPixels(13) },
  errorHint: { color: theme.textDim, fontSize: getPixels(13), lineHeight: getPixels(19) },
  mono: { color: theme.accent, fontFamily: 'Courier' },
  footer: { height: 32 },
});
