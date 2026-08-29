import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  FlatList,
  RefreshControl,
  StyleSheet,
  TextInput,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import { API_URL, fetchRankings, type RankedPlayer } from '../api';
import { PLAYER_ROW_HEIGHT, PlayerRow } from '../components/PlayerRow';
import {
  AppBar,
  Chip,
  ChipRow,
  Empty,
  ErrorState,
  Icon,
  Mono,
  PageTitle,
  RoundButton,
  useBottomInset,
} from '../components/ui';
import { Trans, useTranslation } from '../i18n';
import { getPixels, radius, useStyles, useTheme, type Theme } from '../theme';

const PAGE_SIZE = 50;

const ROWS_ON_FIRST_PAINT = Math.ceil(Dimensions.get('window').height / PLAYER_ROW_HEIGHT) + 1;

const VIEWPORTS_KEPT_MOUNTED = 11;

function appendUnique(prev: RankedPlayer[], next: RankedPlayer[]): RankedPlayer[] {
  const seen = new Set(prev.map((p) => p.gsis_id));
  const fresh = next.filter((p) => !seen.has(p.gsis_id));
  return fresh.length === next.length ? [...prev, ...next] : [...prev, ...fresh];
}

const POSITIONS = ['QB', 'RB', 'WR', 'TE', 'LB', 'EDGE', 'DT', 'DE', 'CB', 'S', 'OT', 'OG', 'C'];

export function RankingsScreen({
  onSelectPlayer,
}: {
  onSelectPlayer: (player: RankedPlayer) => void;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const styles = useStyles(sheet);

  const [position, setPosition] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [players, setPlayers] = useState<RankedPlayer[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
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
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const load = useCallback(
    async (offset: number) => {
      const id = ++requestId.current;
      try {
        const result = await fetchRankings({
          position,
          search: debouncedSearch,
          limit: PAGE_SIZE,
          offset,
        });
        if (id !== requestId.current) return;
        setPlayers((prev) => (offset === 0 ? result.players : appendUnique(prev, result.players)));
        setTotal(result.total);
        setError(null);
      } catch (err) {
        if (id !== requestId.current) return;
        setError((err as Error).message);
      } finally {
        if (id === requestId.current) {
          setLoading(false);
          setLoadingMore(false);
          setRefreshing(false);
        }
      }
    },
    [position, debouncedSearch],
  );

  useEffect(() => {
    setLoading(true);
    setPlayers([]);
    load(0);
  }, [load]);

  const handleEndReached = () => {
    if (loadingMore || loading || players.length >= total) return;
    setLoadingMore(true);
    load(players.length);
  };

  const renderPlayer = useCallback(
    ({ item }: { item: RankedPlayer }) => <PlayerRow player={item} onPress={onSelectPlayer} />,
    [onSelectPlayer],
  );

  const header = useMemo(
    () => (
      <View onLayout={measureHeader}>
        <AppBar right={<RoundButton name="fire" />} />
        <PageTitle
          title={t('rankings.title')}
          subtitle={t('rankings.subtitle', { total: total.toLocaleString() })}
        />
        <View style={styles.searchWrap}>
          <Icon name="magnify" size={18} color={theme.textFaint} />
          <TextInput
            style={styles.searchInput}
            placeholder={t('rankings.searchPlaceholder')}
            placeholderTextColor={theme.textFaint}
            value={search}
            onChangeText={setSearch}
            autoCorrect={false}
            autoCapitalize="none"
            clearButtonMode="while-editing"
          />
        </View>
        <View style={styles.gutter}>
          <ChipRow>
            <Chip
              label={t('rankings.allPositions')}
              active={position === null}
              onPress={() => setPosition(null)}
            />
            {POSITIONS.map((p) => (
              <Chip
                key={p}
                label={p}
                active={position === p}
                onPress={() => setPosition(position === p ? null : p)}
              />
            ))}
          </ChipRow>
        </View>
      </View>
    ),
    [position, search, total, styles, theme, measureHeader, t],
  );

  if (error) {
    return (
      <ErrorState
        message={error}
        hint={
          <Trans
            i18nKey="error.expectingServerLan"
            values={{ url: API_URL }}
            components={{ command: <Mono />, envVar: <Mono /> }}
          />
        }
        onRetry={() => {
          setLoading(true);
          load(0);
        }}
      />
    );
  }

  return (
    <FlatList
      data={players}
      keyExtractor={(p) => p.gsis_id}
      renderItem={renderPlayer}
      getItemLayout={(_data, index) => ({
        length: PLAYER_ROW_HEIGHT,
        offset: headerHeight + PLAYER_ROW_HEIGHT * index,
        index,
      })}
      initialNumToRender={ROWS_ON_FIRST_PAINT}
      windowSize={VIEWPORTS_KEPT_MOUNTED}
      ListHeaderComponent={header}
      onEndReached={handleEndReached}
      onEndReachedThreshold={0.5}
      keyboardShouldPersistTaps="handled"
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          tintColor={theme.textDim}
          onRefresh={() => {
            setRefreshing(true);
            load(0);
          }}
        />
      }
      ListEmptyComponent={
        loading ? (
          <ActivityIndicator style={styles.loader} color={theme.accent} />
        ) : (
          <Empty>{t('rankings.empty')}</Empty>
        )
      }
      ListFooterComponent={
        loadingMore ? <ActivityIndicator style={styles.loader} color={theme.accent} /> : null
      }
      style={styles.list}
      contentContainerStyle={[listPadding, players.length === 0 && styles.flexGrow]}
    />
  );
}

const sheet = (theme: Theme) => ({
  list: { flex: 1, backgroundColor: theme.bg },
  flexGrow: { flexGrow: 1 },
  gutter: { marginHorizontal: 16 },

  searchWrap: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
    marginHorizontal: 16,
    paddingHorizontal: 13,
    height: 44,
    backgroundColor: theme.surface,
    borderRadius: radius.chip,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
  },
  searchInput: {
    flex: 1,
    color: theme.text,
    fontSize: getPixels(15),
    padding: 0,
  },

  loader: { paddingVertical: 24 },
});
