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
import { Trans, useTranslation } from '../i18n';
import { gameShapeCopy } from '../matchupFormat';
import { getPixels, theme } from '../theme';

export function ThisWeekScreen({
  onSelectGame,
  onBuildLineup,
}: {
  onSelectGame: (game: MatchupSummary) => void;
  onBuildLineup: (slate: SlateSummary, strategy: StrategyDefinition) => void;
}) {
  const { t } = useTranslation();
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
        <Text style={styles.errorTitle}>{t('error.unreachableTitle')}</Text>
        <Text style={styles.errorBody}>{error}</Text>
        <Text style={styles.errorHint}>
          <Trans
            i18nKey="error.expectingServer"
            values={{ url: API_URL }}
            components={{ command: <Text style={styles.mono} /> }}
          />
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
        <Text style={styles.title}>{current?.label ?? t('week.title')}</Text>
        <Text style={styles.subtitle}>
          {current
            ? t('week.subtitle', { games: current.games.length })
            : t('week.noUpcoming')}
        </Text>
      </View>

      {current?.upcoming && (
        <View style={styles.notice}>
          <Text style={styles.noticeText}>{t('week.forecastNotice')}</Text>
        </View>
      )}

      {current?.missing && (
        <View style={styles.notice}>
          <Text style={styles.noticeText}>
            <Trans
              i18nKey="week.noPredictions"
              components={{ command: <Text style={styles.mono} /> }}
            />
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
            <Text style={styles.sectionTitle}>
              {t('week.resultsTitle', { label: previous.label })}
            </Text>
            <Text style={styles.subtitle}>{t('week.resultsSubtitle')}</Text>
          </View>

          {previous.games.some((g) => g.backfilled) && (
            <View style={[styles.notice, styles.noticeWarn]}>
              <Text style={styles.noticeText}>{t('week.backfilledNotice')}</Text>
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

function ShapedList({
  games,
  order,
  onSelect,
}: {
  games: MatchupSummary[];
  order: GameShape[];
  onSelect: (game: MatchupSummary) => void;
}) {
  const { t } = useTranslation();
  const sections = order
    .map((shape) => ({ shape, games: games.filter((g) => g.game_shape === shape) }))
    .filter((section) => section.games.length > 0);

  const unclassified = games.filter(
    (g) => !g.game_shape || !order.includes(g.game_shape),
  );

  return (
    <>
      {sections.map(({ shape, games: rows }) => (
        <View key={shape}>
          <ShapeHeader {...gameShapeCopy(shape)} />
          {rows.map((g, i) => (
            <MatchupRow key={g.game_id} game={g} rank={i + 1} onPress={onSelect} />
          ))}
        </View>
      ))}

      {unclassified.length > 0 && (
        <View>
          <ShapeHeader
            title={t('week.ungradedTitle')}
            blurb={t('week.ungradedBlurb')}
            color={theme.textFaint}
          />
          {unclassified.map((g, i) => (
            <MatchupRow key={g.game_id} game={g} rank={i + 1} onPress={onSelect} />
          ))}
        </View>
      )}
    </>
  );
}

function ShapeHeader({
  title,
  blurb,
  color,
}: {
  title: string;
  blurb: string;
  color: string;
}) {
  return (
    <View style={styles.shapeHeader}>
      <View style={[styles.shapeDot, { backgroundColor: color }]} />
      <View style={styles.shapeText}>
        <Text style={styles.shapeTitle}>{title}</Text>
        <Text style={styles.shapeBlurb}>{blurb}</Text>
      </View>
    </View>
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
  const multiGame = slates.filter((s) => s.contest !== 'showdown');

  if (multiGame.length === 0) {
    return (
      <View style={styles.notice}>
        <Text style={styles.noticeText}>
          <Trans
            i18nKey={slates.length > 0 ? 'week.noMainSlate' : 'week.noSalaries'}
            components={{ command: <Text style={styles.mono} /> }}
          />
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.lineupBar}>
      {multiGame.map((slate) => (
        <View key={`${slate.contest}-${slate.game_id ?? 'all'}`} style={styles.slateBlock}>
          <Text style={styles.slateLabel}>
            {t('week.slateLabel', { count: slate.games, players: slate.players })}
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
