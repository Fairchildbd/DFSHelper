import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { API_URL, fetchRankings, type RankedPlayer } from '../api';
import { PLAYER_ROW_HEIGHT, PlayerRow } from '../components/PlayerRow';
import { getPixels, theme } from '../theme';

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
      <View>
        <View style={styles.header}>
          <Text style={styles.title}>Rankings</Text>
          <Text style={styles.subtitle}>
            {total.toLocaleString()} players · composite score
          </Text>
        </View>

        <TextInput
          style={styles.search}
          placeholder="Search players"
          placeholderTextColor={theme.textFaint}
          value={search}
          onChangeText={setSearch}
          autoCorrect={false}
          autoCapitalize="none"
          clearButtonMode="while-editing"
        />

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chips}
        >
          <Chip label="All" active={position === null} onPress={() => setPosition(null)} />
          {POSITIONS.map((p) => (
            <Chip
              key={p}
              label={p}
              active={position === p}
              onPress={() => setPosition(position === p ? null : p)}
            />
          ))}
        </ScrollView>
      </View>
    ),
    [position, search, total],
  );

  if (error) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorTitle}>Can’t reach the API</Text>
        <Text style={styles.errorBody}>{error}</Text>
        <Text style={styles.errorHint}>
          Expecting the server at {API_URL}. Start it with{' '}
          <Text style={styles.mono}>npm run api</Text>, or set{' '}
          <Text style={styles.mono}>EXPO_PUBLIC_API_URL</Text> to your machine’s LAN address
          if you’re on a physical device.
        </Text>
        <Pressable
          style={styles.retry}
          onPress={() => {
            setLoading(true);
            load(0);
          }}
        >
          <Text style={styles.retryText}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <FlatList
      data={players}
      keyExtractor={(p) => p.gsis_id}
      renderItem={renderPlayer}
      getItemLayout={(_data, index) => ({
        length: PLAYER_ROW_HEIGHT,
        offset: PLAYER_ROW_HEIGHT * index,
        index,
      })}
      initialNumToRender={ROWS_ON_FIRST_PAINT}
      windowSize={VIEWPORTS_KEPT_MOUNTED}
      ListHeaderComponent={header}
      stickyHeaderIndices={[]}
      onEndReached={handleEndReached}
      onEndReachedThreshold={0.5}
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
          <Text style={styles.empty}>No players match that filter.</Text>
        )
      }
      ListFooterComponent={
        loadingMore ? <ActivityIndicator style={styles.loader} color={theme.accent} /> : null
      }
      style={styles.list}
      contentContainerStyle={players.length === 0 ? styles.flexGrow : undefined}
    />
  );
}

function Chip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={[styles.chip, active && styles.chipActive]}>
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  list: { flex: 1, backgroundColor: theme.bg },
  flexGrow: { flexGrow: 1 },
  header: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12 },
  title: { color: theme.text, fontSize: getPixels(30), fontWeight: '800', letterSpacing: -0.5 },
  subtitle: { color: theme.textDim, fontSize: getPixels(13), marginTop: 2 },
  search: {
    marginHorizontal: 16,
    backgroundColor: theme.surface,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: theme.text,
    fontSize: getPixels(15),
    borderWidth: 1,
    borderColor: theme.border,
  },
  chips: { paddingHorizontal: 16, paddingVertical: 12, gap: 8 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 16,
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.border,
  },
  chipActive: { backgroundColor: theme.accent, borderColor: theme.accent },
  chipText: { color: theme.textDim, fontSize: getPixels(13), fontWeight: '600' },
  chipTextActive: { color: '#04101C' },
  loader: { paddingVertical: 24 },
  empty: { color: theme.textDim, textAlign: 'center', padding: 32 },
  center: { flex: 1, backgroundColor: theme.bg, justifyContent: 'center', padding: 28, gap: 10 },
  errorTitle: { color: theme.text, fontSize: getPixels(20), fontWeight: '700' },
  errorBody: { color: theme.danger, fontSize: getPixels(13) },
  errorHint: { color: theme.textDim, fontSize: getPixels(13), lineHeight: getPixels(19) },
  mono: { color: theme.accent, fontFamily: 'Courier' },
  retry: {
    marginTop: 8,
    alignSelf: 'flex-start',
    backgroundColor: theme.accent,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 8,
  },
  retryText: { color: '#04101C', fontWeight: '700' },
});
