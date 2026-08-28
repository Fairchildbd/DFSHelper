import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  fetchLineup,
  type LineupPick,
  type GameScriptRead,
  type LineupResponse,
  type ShowdownBuild,
  type SlateSummary,
  type StrategyDefinition,
} from '../api';
import { getPixels, theme } from '../theme';

/**
 * The lineup the app exists to produce.
 *
 * Deliberately shows its work. An optimizer that hands over nine names and no
 * reasoning is a black box, and a black box is useless the moment you disagree
 * with it — which is most weeks, because you know things it does not: a player
 * is questionable, a beat writer said something at noon, you already used
 * Mahomes in three other entries. So every pick carries its price, its
 * projection, and where that projection came from, and every pick can be
 * dropped and the lineup rebuilt around what remains.
 */
export function LineupScreen({
  slate,
  strategy,
  onBack,
  backLabel = 'This Week',
  label,
}: {
  slate: SlateSummary;
  strategy: StrategyDefinition;
  onBack: () => void;
  /** Where back goes, since a showdown build is opened from its own matchup. */
  backLabel?: string;
  /** The game, for a showdown, which is a one-game contest by definition. */
  label?: string;
}) {
  const [data, setData] = useState<LineupResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [excludes, setExcludes] = useState<string[]>([]);
  const [locks, setLocks] = useState<string[]>([]);
  /**
   * Which scenario is on screen.
   *
   * Null until the person picks one, which is what lets the model's read be the
   * default without an effect that would fight them for the selection every
   * time the lineup is rebuilt.
   */
  const [choice, setChoice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchLineup({
        contest: slate.contest,
        strategy: strategy.key,
        gameId: slate.game_id,
        locks,
        excludes,
      });
      setData(res);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [slate.contest, slate.game_id, strategy.key, locks, excludes]);

  useEffect(() => {
    load();
  }, [load]);

  const toggleLock = (id: string) =>
    setLocks((current) =>
      current.includes(id) ? current.filter((l) => l !== id) : [...current, id],
    );

  const drop = (id: string) => {
    setLocks((current) => current.filter((l) => l !== id));
    setExcludes((current) => [...current, id]);
  };

  // The model's read is the default until someone chooses otherwise, and no
  // read means all four, since that is the honest answer to an unreadable game.
  const selected = choice ?? data?.read?.scenario ?? ALL;
  const shown = (data?.builds ?? []).filter((b) => selected === ALL || b.key === selected);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Pressable onPress={onBack} style={styles.back}>
        <Text style={styles.backText}>‹ {backLabel}</Text>
      </Pressable>

      {/*
        Showdown gets its own copy rather than the weekly strategy's.
        The slate strategy is a statement about which of thirteen games to
        stack and which to leave alone, and a single-game contest has already
        answered that question — printing it here would describe a decision
        this screen never made.
      */}
      {slate.contest === 'showdown' ? (
        <>
          <Text style={styles.title}>Showdown captain</Text>
          <Text style={styles.subtitle}>
            {label ? `${label} · ` : ''}one captain at 1.5x salary and 1.5x points, five
            flex.
          </Text>
          <Text style={styles.strategyNote}>
            Three entries rather than one, because six players from a single game share
            a ball and a scoreboard: one betting on each offense having the day, and one
            for a game that never gets going. Two receivers from a team at most, and never
            without their quarterback — a third and fourth receiver are competing with the
            first two for the same throws.
          </Text>
        </>
      ) : (
        <>
          <Text style={styles.title}>{strategy.label}</Text>
          <Text style={styles.subtitle}>
            Millionaire Maker · QB, 2 RB, 3 WR, TE, FLEX, DST.
          </Text>
          <Text style={styles.strategyNote}>{strategy.description}</Text>
        </>
      )}

      {data?.stack && (
        <View style={styles.stackBanner}>
          <Text style={styles.stackTitle}>Stacking {data.stack.label}</Text>
          <Text style={styles.stackBody}>
            {data.stack.players} of the nine from this game
            {data.stack.mismatchScore != null
              ? ` · mismatch ${data.stack.mismatchScore.toFixed(0)}, the highest on the slate`
              : ''}
          </Text>
        </View>
      )}

      {loading && !data && <ActivityIndicator color={theme.accent} style={styles.spinner} />}

      {error && (
        <View style={styles.problem}>
          <Text style={styles.problemTitle}>Can’t build a lineup</Text>
          <Text style={styles.problemBody}>{error}</Text>
        </View>
      )}

      {data?.problem && (
        <View style={styles.problem}>
          <Text style={styles.problemTitle}>Nothing to build from</Text>
          <Text style={styles.problemBody}>{data.problem}</Text>
        </View>
      )}

      {data?.builds && (
        <ScenarioPicker
          builds={data.builds}
          read={data.read}
          selected={selected}
          onSelect={setChoice}
        />
      )}

      {shown.map((build) => (
        <BuildCard
          key={build.key}
          build={build}
          locks={locks}
          onLock={toggleLock}
          onDrop={drop}
        />
      ))}

      {data?.builds && (
        <Text style={styles.meta}>
          {data.poolSize} in the pool · defense rates from {data.baselineSeason}
          {data.unavailable > 0 ? ` · ${data.unavailable} out or on IR` : ''}
          {data.ungraded > 0 ? ` · ${data.ungraded} ungraded` : ''}
          {excludes.length > 0 || locks.length > 0
            ? ` · ${excludes.length} dropped, ${locks.length} locked across all three`
            : ''}
        </Text>
      )}

      {data?.builds && (excludes.length > 0 || locks.length > 0) && (
        <Pressable
          onPress={() => {
            setExcludes([]);
            setLocks([]);
          }}
        >
          <Text style={styles.reset}>Reset</Text>
        </Pressable>
      )}

      {data?.lineup && !data.builds && (
        <>
          <View style={styles.summary}>
            <Figure
              label="Avg matchup"
              value={data.lineup.averageGrade.toFixed(0)}
              accent
            />
            <Figure label="Salary" value={`$${data.lineup.salary.toLocaleString()}`} />
            <Figure
              label="Left over"
              value={`$${data.lineup.remaining.toLocaleString()}`}
              warn={data.lineup.remaining > 1500}
            />
          </View>

          {data.lineup.remaining > 1500 && (
            <Text style={styles.leftoverNote}>
              Money left unspent is matchup edge left unbought. It usually means the pool
              is thin at a position — check that the salary file covers the whole slate.
            </Text>
          )}

          {data.lineup.picks.map((pick) => (
            <PickRow
              key={pick.id}
              pick={pick}
              stacked={data.stack != null && pick.gameId === data.stack.gameId}
              locked={locks.includes(pick.id)}
              onLock={() => toggleLock(pick.id)}
              onDrop={() => drop(pick.id)}
            />
          ))}

          <View style={styles.footerRow}>
            <Text style={styles.meta}>
              {data.poolSize} in the pool · defense rates from {data.baselineSeason}
              {data.unavailable > 0 ? ` · ${data.unavailable} out or on IR` : ''}
              {data.ungraded > 0 ? ` · ${data.ungraded} ungraded` : ''}
            </Text>
            {(excludes.length > 0 || locks.length > 0) && (
              <Pressable
                onPress={() => {
                  setExcludes([]);
                  setLocks([]);
                }}
              >
                <Text style={styles.reset}>Reset</Text>
              </Pressable>
            )}
          </View>
        </>
      )}
    </ScrollView>
  );
}

function Figure({
  label,
  value,
  accent,
  warn,
}: {
  label: string;
  value: string;
  accent?: boolean;
  warn?: boolean;
}) {
  return (
    <View style={styles.figure}>
      <Text
        style={[
          styles.figureValue,
          accent && { color: theme.production },
          warn && { color: theme.warn },
        ]}
      >
        {value}
      </Text>
      <Text style={styles.figureLabel}>{label}</Text>
    </View>
  );
}

/** The pseudo-scenario that shows every entry at once. */
const ALL = 'all';

/** A build's name on a chip: the team it backs, or what it is hedging. */
function shortLabel(build: ShowdownBuild): string {
  if (build.team) return build.team;
  return build.key === 'shootout' ? 'Shootout' : 'Low-scoring';
}

/**
 * Which game this is going to be — the one judgement the model does not make
 * for you.
 *
 * The read is offered rather than applied. It is built from the same lane edges
 * as everything else on the matchup screen, so it can be checked; it is marked
 * on the chip it points at; and it is only ever a starting selection, because
 * the person entering the contest knows things the model does not.
 */
function ScenarioPicker({
  builds,
  read,
  selected,
  onSelect,
}: {
  builds: ShowdownBuild[];
  read: GameScriptRead | null;
  selected: string;
  onSelect: (key: string) => void;
}) {
  const recommended = builds.find((b) => b.key === read?.scenario);

  return (
    <View style={styles.picker}>
      <Text style={styles.pickerLabel}>How do you think this game goes?</Text>

      <View style={styles.chips}>
        {builds.map((build) => (
          <Pressable
            key={build.key}
            onPress={() => onSelect(build.key)}
            style={[styles.chip, selected === build.key && styles.chipOn]}
          >
            <Text style={[styles.chipText, selected === build.key && styles.chipTextOn]}>
              {shortLabel(build)}
              {build.key === read?.scenario ? ' ·' : ''}
            </Text>
          </Pressable>
        ))}
        <Pressable
          onPress={() => onSelect(ALL)}
          style={[styles.chip, selected === ALL && styles.chipOn]}
        >
          <Text style={[styles.chipText, selected === ALL && styles.chipTextOn]}>All four</Text>
        </Pressable>
      </View>

      {read && recommended ? (
        <Text style={styles.readNote}>
          <Text style={styles.readLead}>
            Model’s read{read.confidence === 'slight' ? ', slightly' : ''}:{' '}
            {shortLabel(recommended)}.
          </Text>{' '}
          {read.why}
        </Text>
      ) : (
        <Text style={styles.readNote}>
          <Text style={styles.readLead}>No read.</Text> The lanes in this game are too
          even, or too thinly graded, to say which way it goes — which is itself a reason
          to spread across all four rather than pick one.
        </Text>
      )}
    </View>
  );
}

/**
 * One of the four showdown entries.
 *
 * Each carries its own account of what it is betting on, because three lineups
 * that differ by two players are indistinguishable without one — and the whole
 * reason there are three is that they are answers to different questions.
 *
 * Drops and locks are shared: a player ruled out is out of all three, which is
 * what an injury means. A lock that one entry's shape cannot hold turns that
 * entry into its own explanation rather than silently ignoring the lock.
 */
function BuildCard({
  build,
  locks,
  onLock,
  onDrop,
}: {
  build: ShowdownBuild;
  locks: string[];
  onLock: (id: string) => void;
  onDrop: (id: string) => void;
}) {
  return (
    <View style={styles.build}>
      <Text style={styles.buildTitle}>{build.label}</Text>
      <Text style={styles.buildNote}>{build.description}</Text>

      {build.lineup ? (
        <>
          <View style={styles.summary}>
            <Figure label="Avg matchup" value={build.lineup.averageGrade.toFixed(0)} accent />
            <Figure label="Salary" value={`$${build.lineup.salary.toLocaleString()}`} />
            <Figure label="Left over" value={`$${build.lineup.remaining.toLocaleString()}`} />
          </View>

          {build.lineup.picks.map((pick) => (
            <PickRow
              key={pick.id}
              pick={pick}
              locked={locks.includes(pick.id)}
              onLock={() => onLock(pick.id)}
              onDrop={() => onDrop(pick.id)}
            />
          ))}
        </>
      ) : (
        <View style={styles.problem}>
          <Text style={styles.problemTitle}>Can’t build this one</Text>
          <Text style={styles.problemBody}>{build.problem}</Text>
        </View>
      )}
    </View>
  );
}

/**
 * One roster spot.
 *
 * The note under each name is the answer to "why him", and it is deliberately a
 * sentence about football rather than a number from the model: a per-game
 * average over a stated number of games, or the opponent's implied point total
 * for a defense.
 */
function PickRow({
  pick,
  locked,
  stacked,
  onLock,
  onDrop,
}: {
  pick: LineupPick;
  locked: boolean;
  stacked?: boolean;
  onLock: () => void;
  onDrop: () => void;
}) {
  return (
    <View style={[styles.pick, locked && styles.pickLocked, stacked && styles.pickStacked]}>
      <View style={styles.pickHead}>
        <Text style={styles.slot}>{pick.slot.replace(/\d$/, '')}</Text>
        <View style={styles.pickName}>
          <Text style={styles.name} numberOfLines={1}>
            {pick.name}
          </Text>
          <Text style={styles.pickTeam}>
            {pick.position} · {pick.team}
          </Text>
        </View>
        {pick.status === 'Q' && <Text style={styles.flag}>Q</Text>}
        <View style={styles.pickNumbers}>
          <Text style={styles.points}>
            {pick.matchupScore == null ? '—' : pick.matchupScore.toFixed(0)}
          </Text>
          <Text style={styles.cost}>${pick.cost.toLocaleString()}</Text>
        </View>
      </View>

      <Text style={styles.note} numberOfLines={2}>
        {pick.note}
      </Text>

      <View style={styles.actions}>
        <Pressable onPress={onLock} hitSlop={6}>
          <Text style={[styles.action, locked && styles.actionOn]}>
            {locked ? 'Locked' : 'Lock'}
          </Text>
        </Pressable>
        <Pressable onPress={onDrop} hitSlop={6}>
          <Text style={styles.action}>Drop</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.bg },
  content: { padding: 16, gap: 4, paddingBottom: 40 },
  back: { paddingVertical: 6 },
  backText: { color: theme.accent, fontSize: getPixels(14), fontWeight: '600' },
  title: { color: theme.text, fontSize: getPixels(22), fontWeight: '800', marginTop: 4 },
  subtitle: { color: theme.textDim, fontSize: getPixels(12.5), marginBottom: 12 },
  spinner: { marginTop: 32 },
  picker: { marginTop: 6, marginBottom: 2 },
  pickerLabel: {
    color: theme.textDim,
    fontSize: getPixels(12),
    fontWeight: '700',
    marginBottom: 8,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    paddingVertical: 7,
    paddingHorizontal: 11,
    borderRadius: 8,
    backgroundColor: theme.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
  },
  chipOn: { backgroundColor: theme.accent, borderColor: theme.accent },
  chipText: { color: theme.textDim, fontSize: getPixels(12), fontWeight: '700' },
  chipTextOn: { color: '#08131F' },
  readNote: {
    color: theme.textFaint,
    fontSize: getPixels(11),
    lineHeight: getPixels(16),
    marginTop: 8,
  },
  readLead: { color: theme.textDim, fontWeight: '700' },
  build: { marginTop: 18 },
  buildTitle: { color: theme.text, fontSize: getPixels(17), fontWeight: '800' },
  buildNote: {
    color: theme.textFaint,
    fontSize: getPixels(11),
    lineHeight: getPixels(16),
    marginTop: 3,
    marginBottom: 4,
  },

  summary: {
    flexDirection: 'row',
    backgroundColor: theme.surface,
    borderRadius: 10,
    padding: 14,
    marginBottom: 10,
  },
  figure: { flex: 1, alignItems: 'center' },
  figureValue: {
    color: theme.text,
    fontSize: getPixels(19),
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  figureLabel: { color: theme.textFaint, fontSize: getPixels(10.5), marginTop: 2 },
  leftoverNote: {
    color: theme.textFaint,
    fontSize: getPixels(11),
    lineHeight: getPixels(16),
    marginBottom: 10,
  },

  pick: {
    backgroundColor: theme.surface,
    borderRadius: 10,
    padding: 12,
    marginTop: 8,
    gap: 6,
  },
  pickLocked: { borderWidth: 1, borderColor: theme.accent },
  // A left edge rather than a full border, so it reads as "part of the stack"
  // without competing with the lock outline.
  pickStacked: { borderLeftWidth: 3, borderLeftColor: theme.college },
  strategyNote: { color: theme.textFaint, fontSize: getPixels(11), lineHeight: getPixels(16), marginBottom: 12 },
  stackBanner: {
    backgroundColor: theme.surfaceAlt,
    borderRadius: 10,
    padding: 12,
    marginBottom: 10,
    gap: 3,
  },
  stackTitle: { color: theme.college, fontSize: getPixels(13.5), fontWeight: '800' },
  stackBody: { color: theme.textDim, fontSize: getPixels(11.5), lineHeight: getPixels(16) },
  pickHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  slot: {
    color: theme.textFaint,
    fontSize: getPixels(10.5),
    fontWeight: '700',
    width: 38,
  },
  pickName: { flex: 1 },
  name: { color: theme.text, fontSize: getPixels(15), fontWeight: '700' },
  pickTeam: { color: theme.textDim, fontSize: getPixels(11) },
  pickNumbers: { alignItems: 'flex-end' },
  points: {
    color: theme.production,
    fontSize: getPixels(15),
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  cost: { color: theme.textDim, fontSize: getPixels(11), fontVariant: ['tabular-nums'] },
  flag: {
    color: theme.warn,
    fontSize: getPixels(10),
    fontWeight: '800',
    borderColor: theme.warn,
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: 4,
    paddingVertical: 1,
  },
  note: { color: theme.textFaint, fontSize: getPixels(10.5), lineHeight: getPixels(15) },
  actions: { flexDirection: 'row', gap: 16 },
  action: { color: theme.textDim, fontSize: getPixels(11), fontWeight: '600' },
  actionOn: { color: theme.accent },

  problem: {
    backgroundColor: theme.surface,
    borderRadius: 10,
    padding: 14,
    marginTop: 8,
    gap: 6,
  },
  problemTitle: { color: theme.warn, fontSize: getPixels(14), fontWeight: '700' },
  problemBody: { color: theme.textDim, fontSize: getPixels(12), lineHeight: getPixels(18) },

  footerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 14,
  },
  meta: { color: theme.textFaint, fontSize: getPixels(10.5), flex: 1 },
  reset: { color: theme.accent, fontSize: getPixels(11.5), fontWeight: '600' },
});
