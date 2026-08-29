import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
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
import {
  AppBar,
  BottomSpacer,
  Card,
  Chip,
  ChipRow,
  ErrorState,
  Loading,
  Mono,
  Notice,
  PageTitle,
  RoundButton,
  SectionTitle,
} from '../components/ui';
import { GAME_SHAPES } from '../matchupFormat';
import { getPixels, radius, useStyles, useTheme, type Theme } from '../theme';

type Filter = GameShape | 'all' | 'ungraded';

export function ThisWeekScreen({
  onSelectGame,
  onBuildLineup,
}: {
  onSelectGame: (game: MatchupSummary) => void;
  onBuildLineup: (slate: SlateSummary, strategy: StrategyDefinition) => void;
}) {
  const t = useTheme();
  const styles = useStyles(sheet);

  const [current, setCurrent] = useState<WeekBlock | null>(null);
  const [previous, setPrevious] = useState<WeekBlock | null>(null);
  const [slates, setSlates] = useState<SlateSummary[]>([]);
  const [strategies, setStrategies] = useState<StrategyDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shapeOrder, setShapeOrder] = useState<GameShape[]>([]);
  const [filter, setFilter] = useState<Filter>('all');

  const load = useCallback(async () => {
    try {
      const res = await fetchThisWeek();
      setShapeOrder(res.shapeOrder ?? []);
      setCurrent(res.current);
      setPrevious(res.previous);
      setError(null);
      try {
        const slateRes = await fetchSlates();
        setSlates(slateRes.slates);
        setStrategies(slateRes.strategies);
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

  const sections = useMemo(() => {
    const games = current?.games ?? [];
    const known = shapeOrder
      .map((shape) => ({
        key: shape as Filter,
        title: GAME_SHAPES[shape].title,
        blurb: GAME_SHAPES[shape].blurb,
        games: games.filter((g) => g.game_shape === shape),
      }))
      .filter((s) => s.games.length > 0);

    const ungraded = games.filter((g) => !g.game_shape || !shapeOrder.includes(g.game_shape));
    if (ungraded.length > 0) {
      known.push({
        key: 'ungraded',
        title: 'Not graded',
        blurb: 'Not enough roster or opponent data to say what kind of game this is.',
        games: ungraded,
      });
    }
    return known;
  }, [current, shapeOrder]);

  const matched = sections.filter((s) => s.key === filter);
  const shown = filter === 'all' || matched.length === 0 ? sections : matched;

  if (error) {
    return (
      <ErrorState
        message={error}
        hint={
          <>
            Expecting the server at {API_URL}. Start it with <Mono>npm run api</Mono>.
          </>
        }
        onRetry={() => {
          setLoading(true);
          load();
        }}
      />
    );
  }

  if (loading) return <Loading />;

  return (
    <ScrollView
      style={styles.screen}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          tintColor={t.textDim}
          onRefresh={() => {
            setRefreshing(true);
            load();
          }}
        />
      }
    >
      <AppBar right={<RoundButton name="fire" />} />
      <PageTitle
        title={current?.label ?? 'This week'}
        subtitle={
          current
            ? `${current.games.length} games · grouped by what kind of game it is`
            : 'No upcoming week'
        }
      />
      {current?.upcoming && (
        <Notice style={styles.noticeBlock}>
          Nothing has kicked off yet, so every number here is a forecast built from prior
          seasons. Predictions are frozen once a game goes final, so what you see now is
          what gets graded next week.
        </Notice>
      )}

      {current?.missing && (
        <Notice icon="alert-circle-outline" tone="warn" style={styles.noticeBlock}>
          No predictions built for this week yet. Run <Mono>npm run db:matchups</Mono>.
        </Notice>
      )}

      {sections.length > 1 && (
        <View style={styles.gutter}>
          <ChipRow>
            <Chip
              label="All"
              count={current?.games.length ?? null}
              active={filter === 'all'}
              onPress={() => setFilter('all')}
            />
            {sections.map((s) => (
              <Chip
                key={s.key}
                label={s.title}
                count={s.games.length}
                active={filter === s.key}
                onPress={() => setFilter(filter === s.key ? 'all' : s.key)}
              />
            ))}
          </ChipRow>
        </View>
      )}

      <LineupBar slates={slates} strategies={strategies} onBuild={onBuildLineup} />
      {shown.map((section) => (
        <View key={section.key}>
          <View style={styles.sectionHead}>
            <Text style={styles.sectionEyebrow}>
              {section.title.toUpperCase()} · {section.games.length}{' '}
              {section.games.length === 1 ? 'GAME' : 'GAMES'}
            </Text>
            <Text style={styles.sectionBlurb}>{section.blurb}</Text>
          </View>
          {section.games.map((g, i) => (
            <MatchupRow key={g.game_id} game={g} rank={i + 1} onPress={onSelectGame} />
          ))}
        </View>
      ))}

      {previous && previous.games.length > 0 && (
        <>
          <View style={styles.gutter}>
            <SectionTitle
              title={`${previous.label} · results`}
              hint="What was ranked, against what actually happened"
            />
          </View>
          {previous.games.some((g) => g.backfilled) && (
            <Notice icon="alert-circle-outline" tone="warn" style={styles.noticeBlock}>
              These grades were produced after the game was played, as a worked example —
              not a forecast the model made in advance. Weeks predicted ahead of kickoff
              will be marked as such.
            </Notice>
          )}

          {previous.games.map((g, i) => (
            <MatchupRow key={g.game_id} game={g} rank={i + 1} onPress={onSelectGame} />
          ))}
        </>
      )}

      <BottomSpacer extra={12} />
    </ScrollView>
  );
}

function LineupBar({
  slates,
  strategies,
  onBuild,
}: {
  slates: SlateSummary[];
  strategies: StrategyDefinition[];
  onBuild: (slate: SlateSummary, strategy: StrategyDefinition) => void;
}) {
  const styles = useStyles(sheet);
  const multiGame = slates.filter((s) => s.contest !== 'showdown');

  if (multiGame.length === 0) {
    return (
      <Notice icon="tray-arrow-down" tone="warn" style={styles.noticeBlock}>
        {slates.length > 0
          ? 'No main-slate salaries imported for this week. A showdown is loaded, and it builds from its own game below. For the main slate, export it from the contest lobby and run '
          : 'No DraftKings salaries imported for this week, so no lineup can be built. Export the slate from the contest lobby and run '}
        <Mono>npm run ingest:dk -- --file DKSalaries.csv</Mono>.
      </Notice>
    );
  }

  return (
    <View style={[styles.gutter, styles.lineupBlock]}>
      {multiGame.map((slate) => (
        <Card key={`${slate.contest}-${slate.game_id ?? 'all'}`} wash rail style={styles.lineupCard}>
          <Text style={styles.slateLabel}>
            MAIN SLATE · {slate.games} {slate.games === 1 ? 'GAME' : 'GAMES'} · {slate.players}{' '}
            PRICED
          </Text>
          {strategies.map((strategy) => (
            <Pressable
              key={strategy.key}
              onPress={() => onBuild(slate, strategy)}
              accessibilityRole="button"
              style={({ pressed }) => [styles.buildButton, pressed && styles.pressed]}
            >
              <Text style={styles.buildLabel}>{strategy.label}</Text>
              <Text style={styles.buildMeta}>{strategy.tagline}</Text>
            </Pressable>
          ))}
        </Card>
      ))}
    </View>
  );
}

const sheet = (t: Theme) => ({
  screen: { flex: 1, backgroundColor: t.bg },
  gutter: { marginHorizontal: 16 },

  noticeBlock: { marginHorizontal: 16, marginBottom: 12 },

  sectionHead: { paddingHorizontal: 16, paddingTop: 18, paddingBottom: 9, gap: 2 },
  sectionEyebrow: {
    color: t.textFaint,
    fontSize: getPixels(11),
    fontWeight: '800' as const,
    letterSpacing: 1,
  },
  sectionBlurb: {
    color: t.textFaint,
    fontSize: getPixels(11.5),
    lineHeight: getPixels(16),
  },

  lineupBlock: { marginTop: 4, marginBottom: 4, gap: 10 },
  lineupCard: { padding: 14, gap: 10 },
  slateLabel: {
    color: t.textFaint,
    fontSize: getPixels(10.5),
    fontWeight: '800' as const,
    letterSpacing: 0.8,
  },
  buildButton: {
    backgroundColor: t.accent,
    borderRadius: radius.puck,
    paddingVertical: 13,
    paddingHorizontal: 14,
  },
  pressed: { opacity: 0.8 },
  buildLabel: { color: t.onAccent, fontSize: getPixels(15), fontWeight: '800' as const },
  buildMeta: {
    color: t.onAccent,
    opacity: 0.85,
    fontSize: getPixels(11.5),
    fontWeight: '600' as const,
    marginTop: 2,
  },
});
