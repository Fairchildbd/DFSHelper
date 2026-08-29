import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  fetchLineup,
  type GameScriptRead,
  type LineupPick,
  type LineupResponse,
  type ShowdownBuild,
  type SlateSummary,
  type StrategyDefinition,
} from '../api';
import {
  AppBar,
  BottomSpacer,
  Card,
  CardWash,
  Chip,
  ChipRow,
  Icon,
  InlineNote,
  Notice,
  PageTitle,
  RoundButton,
} from '../components/ui';
import { getPixels, radius, scoreColor, useStyles, useTheme, type Theme } from '../theme';

const ALL = 'all';

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
  backLabel?: string;
  label?: string;
}) {
  const t = useTheme();
  const styles = useStyles(sheet);

  const [data, setData] = useState<LineupResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [excludes, setExcludes] = useState<string[]>([]);
  const [locks, setLocks] = useState<string[]>([]);
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

  const selected = choice ?? data?.read?.scenario ?? ALL;
  const shown = (data?.builds ?? []).filter((b) => selected === ALL || b.key === selected);
  const isShowdown = slate.contest === 'showdown';

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <AppBar onBack={onBack} backLabel={backLabel} right={<RoundButton name="fire" />} />
      <PageTitle
        title={isShowdown ? 'Showdown captain' : strategy.label}
        subtitle={
          isShowdown
            ? `${label ? `${label} · ` : ''}one captain at 1.5x salary and 1.5x points, five flex`
            : 'Millionaire Maker · QB, 2 RB, 3 WR, TE, FLEX, DST'
        }
        style={styles.flush}
      />
      <InlineNote icon="lightbulb-outline">
        {isShowdown
          ? 'Three entries rather than one, because six players from a single game share a ball and a scoreboard: one betting on each offense having the day, and one for a game that never gets going. Two receivers from a team at most, and never without their quarterback — a third and fourth receiver are competing with the first two for the same throws.'
          : strategy.description}
      </InlineNote>
      {data?.stack && (
        <Notice icon="layers-triple-outline">
          <Text style={styles.stackTitle}>Stacking {data.stack.label}. </Text>
          {data.stack.players} of the nine from this game
          {data.stack.mismatchScore != null
            ? ` · mismatch ${data.stack.mismatchScore.toFixed(0)}, the highest on the slate`
            : ''}
        </Notice>
      )}

      {loading && !data && <ActivityIndicator color={t.accent} style={styles.spinner} />}

      {error && <Problem title="Can’t build a lineup" body={error} />}
      {data?.problem && <Problem title="Nothing to build from" body={data.problem} />}

      {data?.builds && (
        <ScenarioPicker
          builds={data.builds}
          read={data.read}
          selected={selected}
          onSelect={setChoice}
        />
      )}

      {shown.map((build) => (
        <BuildCard key={build.key} build={build} locks={locks} onLock={toggleLock} onDrop={drop} />
      ))}

      {data?.lineup && !data.builds && (
        <>
          <Summary
            grade={data.lineup.averageGrade}
            salary={data.lineup.salary}
            remaining={data.lineup.remaining}
          />
          {data.lineup.remaining > 1500 && (
            <InlineNote icon="alert-circle-outline">
              Money left unspent is matchup edge left unbought. It usually means the pool is
              thin at a position — check that the salary file covers the whole slate.
            </InlineNote>
          )}

          <View style={styles.picks}>
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
          </View>
        </>
      )}

      {data && (
        <View style={styles.footerRow}>
          <Text style={styles.meta}>
            {data.poolSize} in the pool · defense rates from {data.baselineSeason}
            {data.unavailable > 0 ? ` · ${data.unavailable} out or on IR` : ''}
            {data.ungraded > 0 ? ` · ${data.ungraded} ungraded` : ''}
            {data.builds && (excludes.length > 0 || locks.length > 0)
              ? ` · ${excludes.length} dropped, ${locks.length} locked across all three`
              : ''}
          </Text>
          {(excludes.length > 0 || locks.length > 0) && (
            <Pressable
              onPress={() => {
                setExcludes([]);
                setLocks([]);
              }}
              accessibilityRole="button"
              hitSlop={8}
            >
              <Text style={styles.reset}>Reset</Text>
            </Pressable>
          )}
        </View>
      )}

      <BottomSpacer extra={12} />
    </ScrollView>
  );
}

function Summary({
  grade,
  salary,
  remaining,
}: {
  grade: number;
  salary: number;
  remaining: number;
}) {
  const t = useTheme();
  const styles = useStyles(sheet);
  return (
    <Card wash rail style={styles.summary}>
      <Figure label="Avg matchup" value={grade.toFixed(0)} tint={scoreColor(t, grade)} />
      <Figure label="Salary" value={`$${salary.toLocaleString()}`} />
      <Figure label="Left over" value={`$${remaining.toLocaleString()}`} warn={remaining > 1500} />
    </Card>
  );
}

function Figure({
  label,
  value,
  tint,
  warn,
}: {
  label: string;
  value: string;
  tint?: string;
  warn?: boolean;
}) {
  const t = useTheme();
  const styles = useStyles(sheet);
  return (
    <View style={styles.figure}>
      <Text
        style={[
          styles.figureValue,
          tint != null && { color: tint },
          warn && { color: t.warn },
        ]}
      >
        {value}
      </Text>
      <Text style={styles.figureLabel}>{label}</Text>
    </View>
  );
}

function Problem({ title, body }: { title: string; body: string }) {
  const styles = useStyles(sheet);
  return (
    <Card style={styles.problem}>
      <Text style={styles.problemTitle}>{title}</Text>
      <Text style={styles.problemBody}>{body}</Text>
    </Card>
  );
}

function shortLabel(build: ShowdownBuild): string {
  if (build.team) return build.team;
  return build.key === 'shootout' ? 'Shootout' : 'Low-scoring';
}

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
  const styles = useStyles(sheet);
  const recommended = builds.find((b) => b.key === read?.scenario);

  return (
    <View style={styles.picker}>
      <Text style={styles.pickerLabel}>How do you think this game goes?</Text>
      <ChipRow style={styles.pickerChips}>
        {builds.map((build) => (
          <Chip
            key={build.key}
            label={`${shortLabel(build)}${build.key === read?.scenario ? ' ·' : ''}`}
            active={selected === build.key}
            onPress={() => onSelect(build.key)}
          />
        ))}
        <Chip label="All four" active={selected === ALL} onPress={() => onSelect(ALL)} />
      </ChipRow>
      <Text style={styles.readNote}>
        {read && recommended ? (
          <>
            <Text style={styles.readLead}>
              Model’s read{read.confidence === 'slight' ? ', slightly' : ''}:{' '}
              {shortLabel(recommended)}.
            </Text>{' '}
            {read.why}
          </>
        ) : (
          <>
            <Text style={styles.readLead}>No read.</Text> The lanes in this game are too even,
            or too thinly graded, to say which way it goes — which is itself a reason to spread
            across all four rather than pick one.
          </>
        )}
      </Text>
    </View>
  );
}

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
  const styles = useStyles(sheet);

  return (
    <View style={styles.build}>
      <Text style={styles.buildTitle}>{build.label}</Text>
      <Text style={styles.buildNote}>{build.description}</Text>
      {build.lineup ? (
        <>
          <Summary
            grade={build.lineup.averageGrade}
            salary={build.lineup.salary}
            remaining={build.lineup.remaining}
          />
          <View style={styles.picks}>
            {build.lineup.picks.map((pick) => (
              <PickRow
                key={pick.id}
                pick={pick}
                locked={locks.includes(pick.id)}
                onLock={() => onLock(pick.id)}
                onDrop={() => onDrop(pick.id)}
              />
            ))}
          </View>
        </>
      ) : (
        <Problem title="Can’t build this one" body={build.problem ?? 'No lineup available.'} />
      )}
    </View>
  );
}

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
  const t = useTheme();
  const styles = useStyles(sheet);

  return (
    <View style={[styles.pick, locked && styles.pickLocked, stacked && styles.pickStacked]}>
      {(locked || stacked) && <CardWash />}

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
          <Text style={[styles.points, { color: scoreColor(t, pick.matchupScore) }]}>
            {pick.matchupScore == null ? '—' : pick.matchupScore.toFixed(0)}
          </Text>
          <Text style={styles.cost}>${pick.cost.toLocaleString()}</Text>
        </View>
      </View>
      <Text style={styles.note} numberOfLines={2}>
        {pick.note}
      </Text>
      <View style={styles.actions}>
        <Pressable
          onPress={onLock}
          hitSlop={6}
          accessibilityRole="button"
          style={({ pressed }) => [styles.action, locked && styles.actionOn, pressed && styles.pressed]}
        >
          <Icon
            name={locked ? 'lock' : 'lock-open-variant-outline'}
            size={13}
            color={locked ? t.accent : t.textDim}
          />
          <Text style={[styles.actionText, locked && styles.actionTextOn]}>
            {locked ? 'Locked' : 'Lock'}
          </Text>
        </Pressable>
        <Pressable
          onPress={onDrop}
          hitSlop={6}
          accessibilityRole="button"
          style={({ pressed }) => [styles.action, pressed && styles.pressed]}
        >
          <Icon name="close" size={13} color={t.textDim} />
          <Text style={styles.actionText}>Drop</Text>
        </Pressable>
      </View>
    </View>
  );
}

const sheet = (t: Theme) => ({
  screen: { flex: 1, backgroundColor: t.bg },
  content: { paddingHorizontal: 16, paddingBottom: 8, gap: 12 },
  flush: { paddingHorizontal: 0 },
  spinner: { marginTop: 32 },
  pressed: { opacity: 0.65 },

  stackTitle: { fontWeight: '800' as const, color: t.text },

  picker: { gap: 8 },
  pickerLabel: {
    color: t.text,
    fontSize: getPixels(13.5),
    fontWeight: '700' as const,
  },
  pickerChips: { marginTop: -6, marginBottom: -6 },
  readNote: { color: t.textDim, fontSize: getPixels(11.5), lineHeight: getPixels(17) },
  readLead: { color: t.accent, fontWeight: '700' as const },

  build: { gap: 10, marginTop: 8 },
  buildTitle: {
    color: t.text,
    fontSize: getPixels(18),
    fontWeight: '800' as const,
    letterSpacing: -0.3,
  },
  buildNote: {
    color: t.textDim,
    fontSize: getPixels(11.5),
    lineHeight: getPixels(16.5),
    marginTop: -6,
  },

  summary: { flexDirection: 'row' as const, padding: 14 },
  figure: { flex: 1, alignItems: 'center' as const },
  figureValue: {
    color: t.text,
    fontSize: getPixels(20),
    fontWeight: '800' as const,
    fontVariant: ['tabular-nums' as const],
  },
  figureLabel: { color: t.textDim, fontSize: getPixels(10.5), marginTop: 3 },

  picks: { gap: 8 },
  pick: {
    backgroundColor: t.surface,
    borderRadius: radius.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: t.border,
    padding: 12,
    gap: 7,
    overflow: 'hidden' as const,
  },
  pickLocked: { borderColor: t.accent },
  pickStacked: { borderLeftWidth: 2, borderLeftColor: t.accent },
  pickHead: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 10 },
  slot: {
    color: t.textFaint,
    fontSize: getPixels(10.5),
    fontWeight: '800' as const,
    letterSpacing: 0.4,
    width: 38,
  },
  pickName: { flex: 1 },
  name: { color: t.text, fontSize: getPixels(15), fontWeight: '700' as const },
  pickTeam: { color: t.textDim, fontSize: getPixels(11) },
  pickNumbers: { alignItems: 'flex-end' as const },
  points: {
    fontSize: getPixels(17),
    fontWeight: '800' as const,
    fontVariant: ['tabular-nums' as const],
  },
  cost: {
    color: t.textDim,
    fontSize: getPixels(11),
    fontVariant: ['tabular-nums' as const],
  },
  flag: {
    color: t.warn,
    fontSize: getPixels(10),
    fontWeight: '800' as const,
    borderColor: t.warn,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 5,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  note: { color: t.textFaint, fontSize: getPixels(10.5), lineHeight: getPixels(15) },

  actions: { flexDirection: 'row' as const, gap: 8 },
  action: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.chip,
    backgroundColor: t.surfaceAlt,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'transparent',
  },
  actionOn: { borderColor: t.accent, backgroundColor: t.accentSoft },
  actionText: { color: t.textDim, fontSize: getPixels(11), fontWeight: '700' as const },
  actionTextOn: { color: t.accent },

  problem: { padding: 14, gap: 6 },
  problemTitle: { color: t.warn, fontSize: getPixels(14.5), fontWeight: '800' as const },
  problemBody: { color: t.textDim, fontSize: getPixels(12), lineHeight: getPixels(18) },

  footerRow: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    gap: 12,
    marginTop: 6,
  },
  meta: { color: t.textFaint, fontSize: getPixels(10.5), flex: 1, lineHeight: getPixels(15) },
  reset: { color: t.accent, fontSize: getPixels(12), fontWeight: '700' as const },
});
