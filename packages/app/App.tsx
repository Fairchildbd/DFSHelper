import { Suspense, lazy, useCallback, useState } from 'react';
import { ActivityIndicator, StatusBar, View } from 'react-native';
import {
  SafeAreaProvider,
  SafeAreaView,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import type {
  MatchupPlayer,
  MatchupSummary,
  RankedPlayer,
  SlateSummary,
  StrategyDefinition,
} from './src/api';
import { BottomInsetProvider, TabBar, tabBarSpace, type TabItem } from './src/components/ui';
import type { PlayerRef } from './src/screens/PlayerDetailScreen';
import { ThisWeekScreen } from './src/screens/ThisWeekScreen';
import { useStyles, useTheme, type Theme } from './src/theme';

const AboutScreen = lazy(() =>
  import('./src/screens/AboutScreen').then((m) => ({ default: m.AboutScreen })),
);
const BestBallScreen = lazy(() =>
  import('./src/screens/BestBallScreen').then((m) => ({ default: m.BestBallScreen })),
);
const LineupScreen = lazy(() =>
  import('./src/screens/LineupScreen').then((m) => ({ default: m.LineupScreen })),
);
const MatchupDetailScreen = lazy(() =>
  import('./src/screens/MatchupDetailScreen').then((m) => ({ default: m.MatchupDetailScreen })),
);
const PlayerDetailScreen = lazy(() =>
  import('./src/screens/PlayerDetailScreen').then((m) => ({ default: m.PlayerDetailScreen })),
);
const RankingsScreen = lazy(() =>
  import('./src/screens/RankingsScreen').then((m) => ({ default: m.RankingsScreen })),
);

type Tab = 'week' | 'bestball' | 'rankings' | 'about';

const TABS: ReadonlyArray<TabItem<Tab>> = [
  { key: 'week', label: 'This Week', icon: 'finance' },
  { key: 'bestball', label: 'Best Ball', icon: 'star-outline' },
  { key: 'rankings', label: 'Rankings', icon: 'crown-outline' },
  { key: 'about', label: 'About', icon: 'information-outline' },
];

export default function App() {
  return (
    <SafeAreaProvider>
      <Shell />
    </SafeAreaProvider>
  );
}

function Shell() {
  const t = useTheme();
  const styles = useStyles(sheet);
  const insets = useSafeAreaInsets();

  const [tab, setTab] = useState<Tab>('week');
  const [game, setGame] = useState<MatchupSummary | null>(null);
  const [player, setPlayer] = useState<PlayerRef | null>(null);
  const [build, setBuild] = useState<{
    slate: SlateSummary;
    strategy: StrategyDefinition;
  } | null>(null);

  const openFromRankings = useCallback((p: RankedPlayer) => setPlayer(p), []);

  const openFromMatchup = useCallback(
    (p: MatchupPlayer) =>
      setPlayer({
        gsis_id: p.gsis_id,
        display_name: p.display_name,
        position: p.position,
        team: p.team,
        composite: p.composite == null ? undefined : Number(p.composite),
      }),
    [],
  );

  const openGame = useCallback((g: MatchupSummary) => setGame(g), []);
  const openBuild = useCallback(
    (slate: SlateSummary, strategy: StrategyDefinition) => setBuild({ slate, strategy }),
    [],
  );
  const closeGame = useCallback(() => setGame(null), []);
  const closePlayer = useCallback(() => setPlayer(null), []);
  const closeBuild = useCallback(() => setBuild(null), []);

  let body: React.ReactNode;
  if (build) {
    body = (
      <LineupScreen
        slate={build.slate}
        strategy={build.strategy}
        backLabel={game ? 'Matchup' : 'This Week'}
        label={game ? `${game.away_team} @ ${game.home_team}` : undefined}
        onBack={closeBuild}
      />
    );
  } else if (player) {
    body = (
      <PlayerDetailScreen
        player={player}
        backLabel={game ? 'Matchup' : 'Rankings'}
        onBack={closePlayer}
      />
    );
  } else if (game) {
    body = (
      <MatchupDetailScreen
        game={game}
        onBack={closeGame}
        onSelectPlayer={openFromMatchup}
        onBuildShowdown={openBuild}
      />
    );
  } else if (tab === 'week') {
    body = <ThisWeekScreen onSelectGame={openGame} onBuildLineup={openBuild} />;
  } else if (tab === 'bestball') {
    body = <BestBallScreen onSelectGame={openGame} />;
  } else if (tab === 'about') {
    body = <AboutScreen />;
  } else {
    body = <RankingsScreen onSelectPlayer={openFromRankings} />;
  }

  const showTabs = !player && !game && !build;

  const bottomInset = showTabs ? tabBarSpace(insets.bottom) : insets.bottom + 12;

  return (
    <View style={styles.root}>
      <StatusBar barStyle={t.mode === 'light' ? 'dark-content' : 'light-content'} />
      <SafeAreaView style={styles.body} edges={['top', 'left', 'right']}>
        <BottomInsetProvider value={bottomInset}>
          <Suspense fallback={<ActivityIndicator style={styles.loader} color={t.accent} />}>
            {body}
          </Suspense>
        </BottomInsetProvider>
      </SafeAreaView>
      {showTabs && <TabBar items={TABS} value={tab} onChange={setTab} />}
    </View>
  );
}

const sheet = (t: Theme) => ({
  root: { flex: 1, backgroundColor: t.bg },
  body: { flex: 1 },
  loader: { flex: 1, alignSelf: 'center' as const, marginTop: 40 },
});
