import { Suspense, lazy, useState } from 'react';
import { ActivityIndicator, Pressable, StatusBar, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import type {
  MatchupPlayer,
  MatchupSummary,
  RankedPlayer,
  SlateSummary,
  StrategyDefinition,
} from './src/api';
import type { PlayerRef } from './src/screens/PlayerDetailScreen';
import { ThisWeekScreen } from './src/screens/ThisWeekScreen';
import { useTranslation, type MessageKey } from './src/i18n';
import { getPixels, theme } from './src/theme';

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

const TABS: Array<{ key: Tab; label: MessageKey }> = [
  { key: 'week', label: 'app.tab.week' },
  { key: 'bestball', label: 'app.tab.bestball' },
  { key: 'rankings', label: 'app.tab.rankings' },
  { key: 'about', label: 'app.tab.about' },
];

export default function App() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>('week');
  const [game, setGame] = useState<MatchupSummary | null>(null);
  const [player, setPlayer] = useState<PlayerRef | null>(null);
  const [build, setBuild] = useState<{
    slate: SlateSummary;
    strategy: StrategyDefinition;
  } | null>(null);

  const openFromRankings = (p: RankedPlayer) => setPlayer(p);

  const openFromMatchup = (p: MatchupPlayer) =>
    setPlayer({
      gsis_id: p.gsis_id,
      display_name: p.display_name,
      position: p.position,
      team: p.team,
      composite: p.composite == null ? undefined : Number(p.composite),
    });

  let body: React.ReactNode;
  if (build) {
    body = (
      <LineupScreen
        slate={build.slate}
        strategy={build.strategy}
        backLabel={game ? t('app.back.matchup') : t('app.back.week')}
        label={game ? `${game.away_team} @ ${game.home_team}` : undefined}
        onBack={() => setBuild(null)}
      />
    );
  } else if (player) {
    body = (
      <PlayerDetailScreen
        player={player}
        backLabel={game ? t('app.back.matchup') : t('app.back.rankings')}
        onBack={() => setPlayer(null)}
      />
    );
  } else if (game) {
    body = (
      <MatchupDetailScreen
        game={game}
        onBack={() => setGame(null)}
        onSelectPlayer={openFromMatchup}
        onBuildShowdown={(slate, strategy) => setBuild({ slate, strategy })}
      />
    );
  } else if (tab === 'week') {
    body = (
      <ThisWeekScreen
        onSelectGame={setGame}
        onBuildLineup={(slate, strategy) => setBuild({ slate, strategy })}
      />
    );
  } else if (tab === 'bestball') {
    body = <BestBallScreen onSelectGame={setGame} />;
  } else if (tab === 'about') {
    body = <AboutScreen />;
  } else {
    body = <RankingsScreen onSelectPlayer={openFromRankings} />;
  }

  const showTabs = !player && !game && !build;

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.root}>
        <StatusBar barStyle="light-content" backgroundColor={theme.bg} />
        <View style={styles.body}>
          <Suspense
            fallback={<ActivityIndicator style={styles.screenLoader} color={theme.accent} />}
          >
            {body}
          </Suspense>
        </View>

        {showTabs && (
          <View style={styles.tabBar}>
            {TABS.map((entry) => (
              <TabButton
                key={entry.key}
                label={t(entry.label)}
                active={tab === entry.key}
                onPress={() => setTab(entry.key)}
              />
            ))}
          </View>
        )}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

function TabButton({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={styles.tab}>
      <Text style={[styles.tabText, active && styles.tabTextActive]}>{label}</Text>
      <View style={[styles.tabRule, active && styles.tabRuleActive]} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screenLoader: { flex: 1, alignSelf: 'center', marginTop: 40 },
  root: { flex: 1, backgroundColor: theme.bg },
  body: { flex: 1 },
  tabBar: {
    flexDirection: 'row',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.border,
    backgroundColor: theme.bg,
  },
  tab: { flex: 1, alignItems: 'center', paddingTop: 10, gap: 8 },
  tabText: { color: theme.textDim, fontSize: getPixels(13), fontWeight: '700' },
  tabTextActive: { color: theme.text },
  tabRule: { height: 2, width: '55%', backgroundColor: 'transparent', borderRadius: 1 },
  tabRuleActive: { backgroundColor: theme.accent },
});
