import { useState } from 'react';
import { Pressable, StatusBar, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import type {
  MatchupPlayer,
  MatchupSummary,
  RankedPlayer,
  SlateSummary,
  StrategyDefinition,
} from './src/api';
import { AboutScreen } from './src/screens/AboutScreen';
import { BestBallScreen } from './src/screens/BestBallScreen';
import { LineupScreen } from './src/screens/LineupScreen';
import { MatchupDetailScreen } from './src/screens/MatchupDetailScreen';
import { ThisWeekScreen } from './src/screens/ThisWeekScreen';
import { PlayerDetailScreen, type PlayerRef } from './src/screens/PlayerDetailScreen';
import { RankingsScreen } from './src/screens/RankingsScreen';
import { getPixels, theme } from './src/theme';

type Tab = 'week' | 'bestball' | 'rankings' | 'about';

const TABS: Array<{ key: Tab; label: string }> = [
  { key: 'week', label: 'This Week' },
  { key: 'bestball', label: 'Best Ball' },
  { key: 'rankings', label: 'Rankings' },
  { key: 'about', label: 'About' },
];

/**
 * Four tabs, three of them with a detail stack one level deep. Still no navigation
 * library: the graph is a tab plus an optional game plus an optional player,
 * which is genuinely a few pieces of state rather than a router's worth.
 *
 * `This Week` is the product — one week of predictions and the week just
 * finished. `Best Ball` is the season-wide sweep, which is a different question
 * and a much more expensive one to keep honest. Both open the same detail
 * screens, which is why `game` lives above the tab rather than inside it.
 *
 * `About` is a leaf: it explains what the scores on the other three tabs mean,
 * and every constant it quotes is served from the engine rather than written
 * into the copy.
 */
export default function App() {
  const [tab, setTab] = useState<Tab>('week');
  const [game, setGame] = useState<MatchupSummary | null>(null);
  const [player, setPlayer] = useState<PlayerRef | null>(null);
  const [build, setBuild] = useState<{
    slate: SlateSummary;
    strategy: StrategyDefinition;
  } | null>(null);

  const openFromRankings = (p: RankedPlayer) => setPlayer(p);

  // The matchup payload already carries identity, so the detail screen renders
  // its header immediately and fills in the ranking columns when its own fetch
  // returns.
  const openFromMatchup = (p: MatchupPlayer) =>
    setPlayer({
      gsis_id: p.gsis_id,
      display_name: p.display_name,
      position: p.position,
      team: p.team,
      // Postgres numerics arrive as strings over JSON.
      composite: p.composite == null ? undefined : Number(p.composite),
    });

  let body: React.ReactNode;
  if (build) {
    // The lineup sits above the game and player stack. Opened from This Week
    // it is built from the whole slate, and back returns to the list; opened
    // from a matchup it is that one game's showdown, and back returns to the
    // matchup still sitting underneath it.
    body = (
      <LineupScreen
        slate={build.slate}
        strategy={build.strategy}
        backLabel={game ? 'Matchup' : 'This Week'}
        label={game ? `${game.away_team} @ ${game.home_team}` : undefined}
        onBack={() => setBuild(null)}
      />
    );
  } else if (player) {
    body = (
      <PlayerDetailScreen
        player={player}
        backLabel={game ? 'Matchup' : 'Rankings'}
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

  // The tab bar is hidden inside a detail view so the back arrow is the only
  // way out — switching tabs from three levels deep loses your place.
  const showTabs = !player && !game && !build;

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.root}>
        <StatusBar barStyle="light-content" backgroundColor={theme.bg} />
        <View style={styles.body}>{body}</View>

        {showTabs && (
          <View style={styles.tabBar}>
            {TABS.map((t) => (
              <TabButton
                key={t.key}
                label={t.label}
                active={tab === t.key}
                onPress={() => setTab(t.key)}
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
