import { Suspense, lazy, useCallback, useMemo, useState } from 'react';
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
import {
  BottomInsetProvider,
  TabBar,
  tabBarSpace,
  type IconName,
  type TabItem,
} from './src/components/ui';
import { AuthProvider, useAuth } from './src/auth';
import { useTranslation, type MessageKey } from './src/i18n';
import type { PlayerRef } from './src/screens/PlayerDetailScreen';
import { CreateAccountScreen } from './src/screens/CreateAccountScreen';
import { LoginScreen } from './src/screens/LoginScreen';
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

const TABS: ReadonlyArray<{ key: Tab; label: MessageKey; icon: IconName }> = [
  { key: 'week', label: 'app.tab.week', icon: 'finance' },
  { key: 'bestball', label: 'app.tab.bestball', icon: 'star-outline' },
  { key: 'rankings', label: 'app.tab.rankings', icon: 'crown-outline' },
  { key: 'about', label: 'app.tab.about', icon: 'information-outline' },
];

export default function App() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <Shell />
      </AuthProvider>
    </SafeAreaProvider>
  );
}

function Shell() {
  const { t } = useTranslation();
  const theme = useTheme();
  const styles = useStyles(sheet);
  const insets = useSafeAreaInsets();

  const tabs = useMemo<ReadonlyArray<TabItem<Tab>>>(
    () => TABS.map((item) => ({ key: item.key, label: t(item.label), icon: item.icon })),
    [t],
  );

  const { status } = useAuth();
  const signedIn = status === 'signedIn';
  const [authScreen, setAuthScreen] = useState<'signIn' | 'createAccount'>('signIn');
  const openCreateAccount = useCallback(() => setAuthScreen('createAccount'), []);

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

  if (status === 'restoring' || status === 'signedOut') {
    return (
      <View style={styles.root}>
        <StatusBar barStyle={theme.mode === 'light' ? 'dark-content' : 'light-content'} />
        <SafeAreaView style={styles.body} edges={['top', 'left', 'right']}>
          {status === 'restoring' ? (
            <ActivityIndicator
              style={styles.loader}
              color={theme.accent}
              accessibilityLabel={t('auth.restoring')}
            />
          ) : authScreen === 'createAccount' ? (
            <CreateAccountScreen />
          ) : (
            <LoginScreen onCreateAccount={openCreateAccount} />
          )}
        </SafeAreaView>
      </View>
    );
  }

  let body: React.ReactNode;
  if (build) {
    body = (
      <LineupScreen
        slate={build.slate}
        strategy={build.strategy}
        backLabel={game ? t('app.back.matchup') : t('app.back.week')}
        label={game ? `${game.away_team} @ ${game.home_team}` : undefined}
        onBack={closeBuild}
      />
    );
  } else if (player) {
    body = (
      <PlayerDetailScreen
        player={player}
        backLabel={game ? t('app.back.matchup') : t('app.back.rankings')}
        onBack={closePlayer}
      />
    );
  } else if (game) {
    body = (
      <MatchupDetailScreen
        game={game}
        onBack={closeGame}
        onSelectPlayer={openFromMatchup}
        onBuildShowdown={signedIn ? openBuild : undefined}
      />
    );
  } else if (tab === 'week') {
    body = (
      <ThisWeekScreen onSelectGame={openGame} onBuildLineup={signedIn ? openBuild : undefined} />
    );
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
      <StatusBar barStyle={theme.mode === 'light' ? 'dark-content' : 'light-content'} />
      <SafeAreaView style={styles.body} edges={['top', 'left', 'right']}>
        <BottomInsetProvider value={bottomInset}>
          <Suspense fallback={<ActivityIndicator style={styles.loader} color={theme.accent} />}>
            {body}
          </Suspense>
        </BottomInsetProvider>
      </SafeAreaView>
      {showTabs && <TabBar items={tabs} value={tab} onChange={setTab} />}
    </View>
  );
}

const sheet = (theme: Theme) => ({
  root: { flex: 1, backgroundColor: theme.bg },
  body: { flex: 1 },
  loader: { flex: 1, alignSelf: 'center' as const, marginTop: 40 },
});
