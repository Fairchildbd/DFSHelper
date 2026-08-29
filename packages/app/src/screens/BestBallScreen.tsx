import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  FlatList,
  RefreshControl,
  Text,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import { API_URL, fetchMatchups, fetchWeeks, type MatchupSummary, type WeekInfo } from '../api';
import { MATCHUP_ROW_HEIGHT, MatchupRow } from '../components/MatchupRow';
import {
  AppBar,
  ChipRow,
  ErrorState,
  Mono,
  Notice,
  NumberChip,
  PageTitle,
  RoundButton,
  useBottomInset,
} from '../components/ui';
import { Trans, useTranslation } from '../i18n';
import { getPixels, useStyles, useTheme, type Theme } from '../theme';

const ROWS_ON_FIRST_PAINT = Math.ceil(Dimensions.get('window').height / MATCHUP_ROW_HEIGHT) + 1;

const VIEWPORTS_KEPT_MOUNTED = 11;

export function BestBallScreen({
  onSelectGame,
}: {
  onSelectGame: (game: MatchupSummary) => void;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const styles = useStyles(sheet);

  const [weeks, setWeeks] = useState<WeekInfo[]>([]);
  const [season, setSeason] = useState<number | null>(null);
  const [week, setWeek] = useState<number | null>(null);
  const [upcoming, setUpcoming] = useState(false);
  const [games, setGames] = useState<MatchupSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const requestId = useRef(0);

  const bottomInset = useBottomInset();
  const listPadding = useMemo(() => ({ paddingBottom: bottomInset + 12 }), [bottomInset]);

  const [headerHeight, setHeaderHeight] = useState(0);
  const measureHeader = useCallback((e: LayoutChangeEvent) => {
    const next = e.nativeEvent.layout.height;
    setHeaderHeight((current) => (Math.abs(current - next) > 1 ? next : current));
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchWeeks()
      .then((res) => {
        if (cancelled) return;
        setWeeks(res.weeks);
        setUpcoming(res.upcoming);
        if (res.current) {
          setSeason(res.current.season);
          setWeek(res.current.week);
        } else {
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError((err as Error).message);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const load = useCallback(async () => {
    if (season == null || week == null) return;
    const id = ++requestId.current;
    try {
      const res = await fetchMatchups({ season, week });
      if (id !== requestId.current) return;
      setGames(res.games);
      setError(null);
    } catch (err) {
      if (id === requestId.current) setError((err as Error).message);
    } finally {
      if (id === requestId.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [season, week]);

  useEffect(() => {
    if (season == null || week == null) return;
    setLoading(true);
    load();
  }, [load, season, week]);

  const renderGame = useCallback(
    ({ item, index }: { item: MatchupSummary; index: number }) => (
      <MatchupRow game={item} rank={index + 1} onPress={onSelectGame} />
    ),
    [onSelectGame],
  );

  const selected = weeks.find((w) => w.season === season && w.week === week);

  if (error) {
    return (
      <ErrorState
        message={error}
        hint={
          <Trans
            i18nKey="error.expectingServerMatchups"
            values={{ url: API_URL }}
            components={{ command: <Mono />, matchupCommand: <Mono /> }}
          />
        }
        onRetry={() => {
          setLoading(true);
          load();
        }}
      />
    );
  }

  const header = (
    <View onLayout={measureHeader}>
      <AppBar right={<RoundButton name="fire" />} />
      <PageTitle
        title={t('bestball.title')}
        subtitle={
          selected
            ? t('bestball.subtitle', { week: selected.week, games: selected.games })
            : t('bestball.loadingSchedule')
        }
      />
      <View style={styles.gutter}>
        <ChipRow>
          {weeks.map((w) => (
            <NumberChip
              key={`${w.season}-${w.week}`}
              value={w.week}
              active={w.week === week && w.season === season}
              onPress={() => {
                setSeason(w.season);
                setWeek(w.week);
              }}
            />
          ))}
        </ChipRow>
      </View>
      {upcoming && selected?.played === 0 && (
        <Notice style={[styles.gutter, styles.notice]}>{t('bestball.noKickoffNotice')}</Notice>
      )}
    </View>
  );

  return (
    <FlatList
      data={games}
      keyExtractor={(g) => g.game_id}
      ListHeaderComponent={header}
      renderItem={renderGame}
      getItemLayout={(_data, index) => ({
        length: MATCHUP_ROW_HEIGHT,
        offset: headerHeight + MATCHUP_ROW_HEIGHT * index,
        index,
      })}
      initialNumToRender={ROWS_ON_FIRST_PAINT}
      windowSize={VIEWPORTS_KEPT_MOUNTED}
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
      ListEmptyComponent={
        loading ? (
          <ActivityIndicator style={styles.loader} color={theme.accent} />
        ) : (
          <Text style={styles.empty}>
            <Trans i18nKey="bestball.empty" components={{ command: <Mono /> }} />
          </Text>
        )
      }
      style={styles.list}
      contentContainerStyle={[listPadding, games.length === 0 && styles.flexGrow]}
    />
  );
}

const sheet = (theme: Theme) => ({
  list: { flex: 1, backgroundColor: theme.bg },
  flexGrow: { flexGrow: 1 },
  gutter: { marginHorizontal: 16 },
  notice: { marginBottom: 14 },
  loader: { paddingVertical: 24 },
  empty: {
    color: theme.textDim,
    textAlign: 'center' as const,
    padding: 32,
    fontSize: getPixels(13),
    lineHeight: getPixels(20),
  },
});
