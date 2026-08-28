import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  API_URL,
  fetchMatchups,
  fetchWeeks,
  type MatchupSummary,
  type WeekInfo,
} from '../api';
import { MATCHUP_ROW_HEIGHT, MatchupRow } from '../components/MatchupRow';
import { Trans, useTranslation } from '../i18n';
import { getPixels, theme } from '../theme';

const ROWS_ON_FIRST_PAINT = Math.ceil(Dimensions.get('window').height / MATCHUP_ROW_HEIGHT) + 1;

const VIEWPORTS_KEPT_MOUNTED = 11;

export function BestBallScreen({
  onSelectGame,
}: {
  onSelectGame: (game: MatchupSummary) => void;
}) {
  const { t } = useTranslation();
  const [weeks, setWeeks] = useState<WeekInfo[]>([]);
  const [season, setSeason] = useState<number | null>(null);
  const [week, setWeek] = useState<number | null>(null);
  const [upcoming, setUpcoming] = useState(false);
  const [games, setGames] = useState<MatchupSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const requestId = useRef(0);

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
      <View style={styles.center}>
        <Text style={styles.errorTitle}>{t('error.unreachableTitle')}</Text>
        <Text style={styles.errorBody}>{error}</Text>
        <Text style={styles.errorHint}>
          <Trans
            i18nKey="error.expectingServerMatchups"
            values={{ url: API_URL }}
            components={{
              command: <Text style={styles.mono} />,
              matchupCommand: <Text style={styles.mono} />,
            }}
          />
        </Text>
      </View>
    );
  }

  const header = (
    <View>
      <View style={styles.header}>
        <Text style={styles.title}>{t('bestball.title')}</Text>
        <Text style={styles.subtitle}>
          {selected
            ? t('bestball.subtitle', { week: selected.week, games: selected.games })
            : t('bestball.loadingSchedule')}
        </Text>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chips}
      >
        {weeks.map((w) => (
          <Pressable
            key={`${w.season}-${w.week}`}
            onPress={() => {
              setSeason(w.season);
              setWeek(w.week);
            }}
            style={[
              styles.chip,
              w.built === 0 && styles.chipEmpty,
              w.week === week && styles.chipActive,
            ]}
          >
            <Text
              style={[
                styles.chipText,
                w.built === 0 && styles.chipTextEmpty,
                w.week === week && styles.chipTextActive,
              ]}
            >
              {w.week}
            </Text>
          </Pressable>
        ))}
      </ScrollView>

      {upcoming && selected?.played === 0 && (
        <View style={styles.notice}>
          <Text style={styles.noticeText}>{t('bestball.noKickoffNotice')}</Text>
        </View>
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
        offset: MATCHUP_ROW_HEIGHT * index,
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
            <Trans
              i18nKey="bestball.empty"
              components={{ command: <Text style={styles.mono} /> }}
            />
          </Text>
        )
      }
      style={styles.list}
      contentContainerStyle={games.length === 0 ? styles.flexGrow : undefined}
    />
  );
}


const styles = StyleSheet.create({
  list: { flex: 1, backgroundColor: theme.bg },
  flexGrow: { flexGrow: 1 },
  header: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12 },
  title: { color: theme.text, fontSize: getPixels(30), fontWeight: '800', letterSpacing: -0.5 },
  subtitle: { color: theme.textDim, fontSize: getPixels(13), marginTop: 2 },
  chips: { paddingHorizontal: 16, paddingBottom: 12, gap: 8 },
  chip: {
    minWidth: 34,
    alignItems: 'center',
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: 16,
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.border,
  },
  chipActive: { backgroundColor: theme.accent, borderColor: theme.accent },
  chipEmpty: { borderStyle: 'dashed' },
  chipTextEmpty: { color: theme.textFaint },
  chipText: { color: theme.textDim, fontSize: getPixels(13), fontWeight: '600' },
  chipTextActive: { color: '#04101C' },
  notice: {
    marginHorizontal: 16,
    marginBottom: 12,
    padding: 12,
    borderRadius: 10,
    backgroundColor: theme.surface,
    borderLeftWidth: 3,
    borderLeftColor: theme.warn,
  },
  noticeText: { color: theme.textDim, fontSize: getPixels(12), lineHeight: getPixels(18) },

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
  teams: { color: theme.text, fontSize: getPixels(17), fontWeight: '700', letterSpacing: 0.3 },
  at: { color: theme.textFaint, fontWeight: '500' },
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
  scoreCol: { alignItems: 'flex-end', width: 56 },
  score: { fontSize: getPixels(24), fontWeight: '800', fontVariant: ['tabular-nums'] },
  pure: { color: theme.textFaint, fontSize: getPixels(9), fontWeight: '600' },

  loader: { paddingVertical: 24 },
  empty: { color: theme.textDim, textAlign: 'center', padding: 32, lineHeight: getPixels(20) },
  center: { flex: 1, backgroundColor: theme.bg, justifyContent: 'center', padding: 28, gap: 10 },
  errorTitle: { color: theme.text, fontSize: getPixels(20), fontWeight: '700' },
  errorBody: { color: theme.danger, fontSize: getPixels(13) },
  errorHint: { color: theme.textDim, fontSize: getPixels(13), lineHeight: getPixels(19) },
  mono: { color: theme.accent, fontFamily: 'Courier' },
});
