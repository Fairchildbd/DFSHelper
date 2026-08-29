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
import { Trans, useTranslation } from '../i18n';
import { gameShapeCopy } from '../matchupFormat';
import { getPixels, radius, useStyles, useTheme, type Theme } from '../theme';

type Filter = GameShape | 'all' | 'ungraded';

export function ThisWeekScreen({
  onSelectGame,
  onBuildLineup,
}: {
  onSelectGame: (game: MatchupSummary) => void;
  onBuildLineup: (slate: SlateSummary, strategy: StrategyDefinition) => void;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
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
      .map((shape) => {
        const copy = gameShapeCopy(shape);
        return {
          key: shape as Filter,
          title: copy.title,
          blurb: copy.blurb,
          games: games.filter((g) => g.game_shape === shape),
        };
      })
      .filter((s) => s.games.length > 0);

    const ungraded = games.filter((g) => !g.game_shape || !shapeOrder.includes(g.game_shape));
    if (ungraded.length > 0) {
      known.push({
        key: 'ungraded',
        title: t('week.ungradedTitle'),
        blurb: t('week.ungradedBlurb'),
        games: ungraded,
      });
    }
    return known;
  }, [current, shapeOrder, t]);

  const matched = sections.filter((s) => s.key === filter);
  const shown = filter === 'all' || matched.length === 0 ? sections : matched;

  if (error) {
    return (
      <ErrorState
        message={error}
        hint={
          <Trans
            i18nKey="error.expectingServer"
            values={{ url: API_URL }}
            components={{ command: <Mono /> }}
          />
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
          tintColor={theme.textDim}
          onRefresh={() => {
            setRefreshing(true);
            load();
          }}
        />
      }
    >
      <AppBar right={<RoundButton name="fire" />} />
      <PageTitle
        title={current?.label ?? t('week.title')}
        subtitle={
          current
            ? t('week.subtitle', { games: current.games.length })
            : t('week.noUpcoming')
        }
      />
      {current?.upcoming && (
        <Notice style={styles.noticeBlock}>{t('week.forecastNotice')}</Notice>
      )}

      {current?.missing && (
        <Notice icon="alert-circle-outline" tone="warn" style={styles.noticeBlock}>
          <Trans i18nKey="week.noPredictions" components={{ command: <Mono /> }} />
        </Notice>
      )}

      {sections.length > 1 && (
        <View style={styles.gutter}>
          <ChipRow>
            <Chip
              label={t('week.allGames')}
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
              {t('week.sectionEyebrow', {
                title: section.title,
                count: section.games.length,
              })}
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
              title={t('week.resultsTitle', { label: previous.label })}
              hint={t('week.resultsSubtitle')}
            />
          </View>
          {previous.games.some((g) => g.backfilled) && (
            <Notice icon="alert-circle-outline" tone="warn" style={styles.noticeBlock}>
              {t('week.backfilledNotice')}
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
  const { t } = useTranslation();
  const styles = useStyles(sheet);
  const multiGame = slates.filter((s) => s.contest !== 'showdown');

  if (multiGame.length === 0) {
    return (
      <Notice icon="tray-arrow-down" tone="warn" style={styles.noticeBlock}>
        <Trans
          i18nKey={slates.length > 0 ? 'week.noMainSlate' : 'week.noSalaries'}
          components={{ command: <Mono /> }}
        />
      </Notice>
    );
  }

  return (
    <View style={[styles.gutter, styles.lineupBlock]}>
      {multiGame.map((slate) => (
        <Card key={`${slate.contest}-${slate.game_id ?? 'all'}`} wash rail style={styles.lineupCard}>
          <Text style={styles.slateLabel}>
            {t('week.slateLabel', { count: slate.games, players: slate.players })}
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

const sheet = (theme: Theme) => ({
  screen: { flex: 1, backgroundColor: theme.bg },
  gutter: { marginHorizontal: 16 },

  noticeBlock: { marginHorizontal: 16, marginBottom: 12 },

  sectionHead: { paddingHorizontal: 16, paddingTop: 18, paddingBottom: 9, gap: 2 },
  sectionEyebrow: {
    color: theme.textFaint,
    fontSize: getPixels(11),
    fontWeight: '800' as const,
    letterSpacing: 1,
    textTransform: 'uppercase' as const,
  },
  sectionBlurb: {
    color: theme.textFaint,
    fontSize: getPixels(11.5),
    lineHeight: getPixels(16),
  },

  lineupBlock: { marginTop: 4, marginBottom: 4, gap: 10 },
  lineupCard: { padding: 14, gap: 10 },
  slateLabel: {
    color: theme.textFaint,
    fontSize: getPixels(10.5),
    fontWeight: '800' as const,
    letterSpacing: 0.8,
    textTransform: 'uppercase' as const,
  },
  buildButton: {
    backgroundColor: theme.accent,
    borderRadius: radius.puck,
    paddingVertical: 13,
    paddingHorizontal: 14,
  },
  pressed: { opacity: 0.8 },
  buildLabel: { color: theme.onAccent, fontSize: getPixels(15), fontWeight: '800' as const },
  buildMeta: {
    color: theme.onAccent,
    opacity: 0.85,
    fontSize: getPixels(11.5),
    fontWeight: '600' as const,
    marginTop: 2,
  },
});
