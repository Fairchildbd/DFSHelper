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
import { t as translate, useTranslation } from '../i18n';
import { getPixels, theme } from '../theme';

export function LineupScreen({
  slate,
  strategy,
  onBack,
  backLabel = translate('app.back.week'),
  label,
}: {
  slate: SlateSummary;
  strategy: StrategyDefinition;
  onBack: () => void;
  backLabel?: string;
  label?: string;
}) {
  const { t } = useTranslation();
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

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Pressable onPress={onBack} style={styles.back}>
        <Text style={styles.backText}>‹ {backLabel}</Text>
      </Pressable>

      {slate.contest === 'showdown' ? (
        <>
          <Text style={styles.title}>{t('lineup.showdownTitle')}</Text>
          <Text style={styles.subtitle}>
            {label ? t('lineup.gamePrefix', { label }) : ''}
            {t('lineup.showdownSubtitle')}
          </Text>
          <Text style={styles.strategyNote}>{t('lineup.showdownNote')}</Text>
        </>
      ) : (
        <>
          <Text style={styles.title}>{strategy.label}</Text>
          <Text style={styles.subtitle}>{t('lineup.classicSubtitle')}</Text>
          <Text style={styles.strategyNote}>{strategy.description}</Text>
        </>
      )}

      {data?.stack && (
        <View style={styles.stackBanner}>
          <Text style={styles.stackTitle}>
            {t('lineup.stackingTitle', { game: data.stack.label })}
          </Text>
          <Text style={styles.stackBody}>
            {t('lineup.stackedPlayers', { count: data.stack.players })}
            {data.stack.mismatchScore != null
              ? t('lineup.stackMismatch', {
                  score: data.stack.mismatchScore.toFixed(0),
                })
              : ''}
          </Text>
        </View>
      )}

      {loading && !data && <ActivityIndicator color={theme.accent} style={styles.spinner} />}

      {error && (
        <View style={styles.problem}>
          <Text style={styles.problemTitle}>{t('lineup.cannotBuild')}</Text>
          <Text style={styles.problemBody}>{error}</Text>
        </View>
      )}

      {data?.problem && (
        <View style={styles.problem}>
          <Text style={styles.problemTitle}>{t('lineup.nothingToBuild')}</Text>
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
          {t('lineup.poolMeta', {
            pool: data.poolSize,
            season: String(data.baselineSeason),
          })}
          {data.unavailable > 0 ? t('lineup.unavailable', { count: data.unavailable }) : ''}
          {data.ungraded > 0 ? t('lineup.ungraded', { count: data.ungraded }) : ''}
          {excludes.length > 0 || locks.length > 0
            ? t('lineup.dropsAndLocksAll', {
                dropped: excludes.length,
                locked: locks.length,
              })
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
          <Text style={styles.reset}>{t('lineup.reset')}</Text>
        </Pressable>
      )}

      {data?.lineup && !data.builds && (
        <>
          <View style={styles.summary}>
            <Figure
              label={t('lineup.avgMatchup')}
              value={data.lineup.averageGrade.toFixed(0)}
              accent
            />
            <Figure
              label={t('lineup.salary')}
              value={t('lineup.money', { amount: data.lineup.salary.toLocaleString() })}
            />
            <Figure
              label={t('lineup.leftOver')}
              value={t('lineup.money', { amount: data.lineup.remaining.toLocaleString() })}
              warn={data.lineup.remaining > 1500}
            />
          </View>

          {data.lineup.remaining > 1500 && (
            <Text style={styles.leftoverNote}>{t('lineup.leftoverNote')}</Text>
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
              {t('lineup.poolMeta', {
                pool: data.poolSize,
                season: String(data.baselineSeason),
              })}
              {data.unavailable > 0
                ? t('lineup.unavailable', { count: data.unavailable })
                : ''}
              {data.ungraded > 0 ? t('lineup.ungraded', { count: data.ungraded }) : ''}
            </Text>
            {(excludes.length > 0 || locks.length > 0) && (
              <Pressable
                onPress={() => {
                  setExcludes([]);
                  setLocks([]);
                }}
              >
                <Text style={styles.reset}>{t('lineup.reset')}</Text>
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

const ALL = 'all';

function shortLabel(build: ShowdownBuild): string {
  if (build.team) return build.team;
  return build.key === 'shootout'
    ? translate('lineup.shootout')
    : translate('lineup.lowScoring');
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
  const { t } = useTranslation();
  const recommended = builds.find((b) => b.key === read?.scenario);

  return (
    <View style={styles.picker}>
      <Text style={styles.pickerLabel}>{t('lineup.scenarioQuestion')}</Text>

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
          <Text style={[styles.chipText, selected === ALL && styles.chipTextOn]}>
            {t('lineup.allScenarios')}
          </Text>
        </Pressable>
      </View>

      {read && recommended ? (
        <Text style={styles.readNote}>
          <Text style={styles.readLead}>
            {read.confidence === 'slight'
              ? t('lineup.readLeadSlight', { scenario: shortLabel(recommended) })
              : t('lineup.readLead', { scenario: shortLabel(recommended) })}
          </Text>{' '}
          {read.why}
        </Text>
      ) : (
        <Text style={styles.readNote}>
          <Text style={styles.readLead}>{t('lineup.noReadLead')}</Text>{' '}
          {t('lineup.noReadBody')}
        </Text>
      )}
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
  const { t } = useTranslation();

  return (
    <View style={styles.build}>
      <Text style={styles.buildTitle}>{build.label}</Text>
      <Text style={styles.buildNote}>{build.description}</Text>

      {build.lineup ? (
        <>
          <View style={styles.summary}>
            <Figure
              label={t('lineup.avgMatchup')}
              value={build.lineup.averageGrade.toFixed(0)}
              accent
            />
            <Figure
              label={t('lineup.salary')}
              value={t('lineup.money', { amount: build.lineup.salary.toLocaleString() })}
            />
            <Figure
              label={t('lineup.leftOver')}
              value={t('lineup.money', { amount: build.lineup.remaining.toLocaleString() })}
            />
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
          <Text style={styles.problemTitle}>{t('lineup.cannotBuildThisOne')}</Text>
          <Text style={styles.problemBody}>{build.problem}</Text>
        </View>
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
  const { t } = useTranslation();

  return (
    <View style={[styles.pick, locked && styles.pickLocked, stacked && styles.pickStacked]}>
      <View style={styles.pickHead}>
        <Text style={styles.slot}>{pick.slot.replace(/\d$/, '')}</Text>
        <View style={styles.pickName}>
          <Text style={styles.name} numberOfLines={1}>
            {pick.name}
          </Text>
          <Text style={styles.pickTeam}>
            {t('lineup.pickTeam', { position: pick.position, team: pick.team })}
          </Text>
        </View>
        {pick.status === 'Q' && <Text style={styles.flag}>Q</Text>}
        <View style={styles.pickNumbers}>
          <Text style={styles.points}>
            {pick.matchupScore == null ? '—' : pick.matchupScore.toFixed(0)}
          </Text>
          <Text style={styles.cost}>
            {t('lineup.money', { amount: pick.cost.toLocaleString() })}
          </Text>
        </View>
      </View>

      <Text style={styles.note} numberOfLines={2}>
        {pick.note}
      </Text>

      <View style={styles.actions}>
        <Pressable onPress={onLock} hitSlop={6}>
          <Text style={[styles.action, locked && styles.actionOn]}>
            {locked ? t('lineup.locked') : t('lineup.lock')}
          </Text>
        </Pressable>
        <Pressable onPress={onDrop} hitSlop={6}>
          <Text style={styles.action}>{t('lineup.drop')}</Text>
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
