import { useEffect, useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import {
  fetchMatchup,
  fetchMatchupMeta,
  fetchSlates,
  type LaneEdgeDetail,
  type MatchupDetail,
  type MatchupMeta,
  type MatchupPlayer,
  type MatchupStarter,
  type MatchupSummary,
  type SideProfile,
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
  ErrorState,
  Eyebrow,
  Icon,
  IconPuck,
  Loading,
  Notice,
  RoundButton,
  Segmented,
  StatRow,
  laneIcon,
} from '../components/ui';
import {
  SKILL_POSITIONS,
  edgeColor,
  formatKickoff,
  formatTendency,
  tendencySourceLabel,
} from '../matchupFormat';
import { getPixels, radius, scoreColor, useStyles, useTheme, type Theme } from '../theme';

const STAFF_SIDE_BY_SIDE_WIDTH = 700;

function heroTint(t: Theme, score: number) {
  const color = scoreColor(t, score);
  return color === t.accent
    ? { color, textShadowColor: t.accentGlow, textShadowRadius: 22 }
    : { color, textShadowRadius: 0 };
}

type Section = 'staffs' | 'lanes' | 'players';

const SECTIONS: Array<{ key: Section; label: string }> = [
  { key: 'staffs', label: 'Staffs' },
  { key: 'lanes', label: 'Lane edges' },
  { key: 'players', label: 'Players' },
];

const UNIT_LABEL: Record<MatchupStarter['unit'], string> = {
  offense: 'Off',
  defense: 'DEF',
  special: 'SPT',
};

const UNIT_TITLE: Record<MatchupStarter['unit'], string> = {
  offense: 'starting offense',
  defense: 'starting defense',
  special: 'starting special teams',
};

const HEADLINE_OFFENSE = ['proe', 'sec_per_play', 'play_action_rate', 'te_target_share'];
const HEADLINE_DEFENSE = ['blitz_rate', 'pressure_rate', 'epa_allowed_pass', 'epa_allowed_rush'];

export function MatchupDetailScreen({
  game,
  onBack,
  onSelectPlayer,
  onBuildShowdown,
}: {
  game: MatchupSummary;
  onBack: () => void;
  onSelectPlayer: (player: MatchupPlayer) => void;
  onBuildShowdown?: (slate: SlateSummary, strategy: StrategyDefinition) => void;
}) {
  const t = useTheme();
  const styles = useStyles(sheet);

  const [detail, setDetail] = useState<MatchupDetail | null>(null);
  const [meta, setMeta] = useState<MatchupMeta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [section, setSection] = useState<Section>('staffs');
  const [filter, setFilter] = useState('skill');
  const [showdown, setShowdown] = useState<{
    slate: SlateSummary;
    strategy: StrategyDefinition;
  } | null>(null);
  const sideBySideStaff = useWindowDimensions().width >= STAFF_SIDE_BY_SIDE_WIDTH;

  useEffect(() => {
    let cancelled = false;
    setFilter('skill');
    setSection('staffs');
    Promise.all([fetchMatchup(game.game_id), fetchMatchupMeta()])
      .then(([d, m]) => {
        if (cancelled) return;
        setDetail(d);
        setMeta(m);
      })
      .catch((err) => !cancelled && setError((err as Error).message));
    return () => {
      cancelled = true;
    };
  }, [game.game_id]);

  useEffect(() => {
    let cancelled = false;
    fetchSlates()
      .then((res) => {
        if (cancelled) return;
        const slate = res.slates.find(
          (s) => s.contest === 'showdown' && s.game_id === game.game_id,
        );
        const strategy = res.strategies[0];
        setShowdown(slate && strategy ? { slate, strategy } : null);
      })
      .catch(() => {
        if (!cancelled) setShowdown(null);
      });
    return () => {
      cancelled = true;
    };
  }, [game.game_id]);

  const players = useMemo(() => {
    if (!detail || filter !== 'skill') return [];
    return detail.players.filter((p) => SKILL_POSITIONS.includes(p.position));
  }, [detail, filter]);

  const starters = useMemo(() => {
    if (!detail || filter === 'skill') return [];
    const [team, unit] = filter.split('|');
    const mine = detail.starters.filter((s) => s.team === team && s.unit === unit);
    return unit === 'special' ? mine.filter((p) => p.composite != null) : mine;
  }, [detail, filter]);

  const chips = useMemo(() => {
    if (!detail) return [];
    const { away_team: away, home_team: home } = detail;
    const chip = (team: string, unit: MatchupStarter['unit']) => ({
      key: `${team}|${unit}`,
      label: `${team} ${UNIT_LABEL[unit]}`,
    });
    return [
      { key: 'skill', label: 'Skill Positions' },
      chip(away, 'offense'),
      chip(home, 'offense'),
      chip(away, 'defense'),
      chip(away, 'special'),
      chip(home, 'defense'),
      chip(home, 'special'),
    ];
  }, [detail]);

  if (error) {
    return <ErrorState message={error} onRetry={onBack} />;
  }

  if (!detail || !meta) return <Loading />;

  const score = Number(detail.mismatch_score);
  const isFinal = detail.home_score != null && detail.away_score != null;
  const unitLabels = new Map(meta.lanes.map((l) => [l.key, l.label]));

  const [filterTeam, filterUnit] = filter.split('|');
  const listTitle =
    filter === 'skill'
      ? isFinal
        ? 'Graded players, against what they scored'
        : 'Best matchups'
      : `${filterTeam} ${UNIT_TITLE[filterUnit as MatchupStarter['unit']] ?? 'starters'}`;

  const edges = [...detail.detail.edges]
    .filter((e) => e.edge != null)
    .sort((a, b) => Math.abs(b.edge!) - Math.abs(a.edge!));

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <AppBar onBack={onBack} right={<RoundButton name="fire" />} />
      <View style={styles.hero}>
        <Text style={styles.teams}>
          {detail.away_team} <Text style={styles.at}>@</Text> {detail.home_team}
        </Text>
        <Text style={styles.kickoff}>
          {formatKickoff(detail.gameday, detail.gametime)}
          {detail.stadium ? ` · ${detail.stadium}` : ''}
        </Text>
        {isFinal && (
          <Text style={styles.finalScore}>
            FINAL {detail.away_team} {detail.away_score} – {detail.home_score}{' '}
            {detail.home_team}
          </Text>
        )}
        <Text style={[styles.heroScore, heroTint(t, score)]}>{score.toFixed(1)}</Text>
        <Text style={styles.heroLabel}>
          {isFinal ? 'predicted ' : ''}mismatch score · {detail.edge_count} lane
          {detail.edge_count === 1 ? '' : 's'} past the {meta.edgeThreshold}-point bar
        </Text>
      </View>
      <Notice>
        Talent gap {Number(detail.mismatch_score).toFixed(1)} · scoring{' '}
        {detail.shootout_score == null
          ? 'not graded'
          : Number(detail.shootout_score).toFixed(1)}
        {detail.lean_team
          ? `, leaning ${detail.lean_team}`
          : detail.shootout_score == null
            ? ''
            : ', evenly split'}
        {detail.total_line != null
          ? ` (total ${Number(detail.total_line).toFixed(1)}${
              detail.spread_line != null
                ? `, spread ${Number(detail.spread_line) > 0 ? '+' : ''}${Number(
                    detail.spread_line,
                  ).toFixed(1)}`
                : ''
            })`
          : ''}
      </Notice>
      {detail.total_line == null && (
        <Notice icon="alert-circle-outline" tone="warn">
          No betting line published yet. The talent gap is unaffected; the scoring read is
          built from the units and pace alone.
        </Notice>
      )}

      {isFinal && (
        <Card wash rail style={styles.resultCard}>
          <Text style={styles.resultHeadline}>
            {detail.top10_hits == null
              ? 'No fantasy lines were recorded for this game.'
              : `${detail.top10_hits} of the ten highest-graded players finished in the game’s real top ten.`}
          </Text>
          {detail.backfilled && (
            <Text style={styles.resultCaveat}>
              Graded after the fact. This prediction was generated from a model whose inputs
              already include this game, so treat it as a worked example rather than as a
              forecast that was actually made in advance.
            </Text>
          )}
        </Card>
      )}

      {showdown && onBuildShowdown && !isFinal && (
        <Pressable
          onPress={() => onBuildShowdown(showdown.slate, showdown.strategy)}
          accessibilityRole="button"
          style={({ pressed }) => [styles.buildButton, pressed && styles.pressed]}
        >
          <Icon name="trophy-outline" size={19} color={t.onAccent} />
          <View style={styles.buildText}>
            <Text style={styles.buildLabel}>Build showdown captain lineup</Text>
            <Text style={styles.buildMeta}>
              {showdown.slate.players} priced for this game · captain at 1.5x salary and 1.5x
              points
            </Text>
          </View>
        </Pressable>
      )}

      <Segmented items={SECTIONS} value={section} onChange={setSection} />
      {section === 'staffs' && (
        <View style={[styles.staffRow, !sideBySideStaff && styles.staffColumn]}>
          <StaffCard profile={detail.detail.away} meta={meta} stacked={!sideBySideStaff} />
          <StaffCard profile={detail.detail.home} meta={meta} stacked={!sideBySideStaff} />
        </View>
      )}

      {section === 'lanes' && (
        <View style={styles.stack}>
          <Text style={styles.sectionHint}>
            Each unit’s percentile against the same unit league-wide, minus how well the
            opponent defends it. Positive favours the offense.
          </Text>
          {edges.map((e) => (
            <LaneEdgeRow
              key={`${e.lane}-${e.label}`}
              edge={e}
              laneLabel={unitLabels.get(e.lane) ?? e.lane}
            />
          ))}
        </View>
      )}

      {section === 'players' && (
        <View style={styles.stack}>
          <Text style={styles.listTitle}>{listTitle}</Text>
          <ChipRow style={styles.chipRow}>
            {chips.map((c) => (
              <Chip
                key={c.key}
                label={c.label}
                active={filter === c.key}
                onPress={() => setFilter(c.key)}
              />
            ))}
          </ChipRow>
          {filter === 'skill' ? (
            players.map((p, i) => (
              <PlayerMatchupRow
                key={p.gsis_id}
                player={p}
                rank={i + 1}
                onPress={onSelectPlayer}
              />
            ))
          ) : starters.length === 0 ? (
            <Text style={styles.sectionHint}>
              {filterUnit === 'special'
                ? 'Nobody on this unit carries a ranking yet.'
                : 'No depth chart published for this team yet.'}
            </Text>
          ) : (
            <>
              <Text style={styles.sectionHint}>
                One player per slot on the published depth chart. Backups are not listed, and
                the number is his overall ranking score.
                {filterUnit === 'special'
                  ? ' Kickers, punters and snappers are not ranked yet, so they are held back.'
                  : ''}
              </Text>
              <Card style={styles.starterCard}>
                {starters.map((s, i) => (
                  <StarterRow
                    key={`${s.gsis_id}-${s.role}-${s.slot ?? ''}`}
                    starter={s}
                    first={i === 0}
                  />
                ))}
              </Card>
            </>
          )}
        </View>
      )}

      <BottomSpacer extra={12} />
    </ScrollView>
  );
}

function LaneEdgeRow({ edge, laneLabel }: { edge: LaneEdgeDetail; laneLabel: string }) {
  const t = useTheme();
  const styles = useStyles(sheet);
  const value = edge.edge!;

  return (
    <Card wash rail style={styles.laneRow}>
      <IconPuck name={laneIcon(edge.lane)} />
      <View style={styles.laneMain}>
        <Text style={styles.laneLabel} numberOfLines={2}>
          {edge.label}
        </Text>
        <Text style={styles.laneSub} numberOfLines={2}>
          {laneLabel} · unit{' '}
          {edge.offenseStrength == null ? '—' : edge.offenseStrength.toFixed(0)} vs defense{' '}
          {edge.defenseStrength == null ? '—' : edge.defenseStrength.toFixed(0)}
        </Text>
      </View>
      <Text style={[styles.laneValue, { color: edgeColor(t, value) }]}>
        {value > 0 ? '+' : ''}
        {value.toFixed(0)}
      </Text>
    </Card>
  );
}

function StaffCard({
  profile,
  meta,
  stacked,
}: {
  profile: SideProfile;
  meta: MatchupMeta;
  stacked: boolean;
}) {
  const t = useTheme();
  const styles = useStyles(sheet);
  const offenseSource = tendencySourceLabel(t, profile.offense.source, profile.coach);

  const byKey = (side: 'offense' | 'defense') =>
    new Map(profile[side].metrics.map((m) => [m.metric, m]));

  const offense = byKey('offense');
  const defense = byKey('defense');
  const labels = new Map(
    [...meta.offenseTendencies, ...meta.defenseTendencies].map((tend) => [tend.key, tend]),
  );

  const lines = (keys: string[], source: Map<string, { value: number; rank: number | null; rankOf: number | null }>) =>
    keys.map((key) => {
      const m = source.get(key);
      const def = labels.get(key);
      if (!m || !def) return null;
      const placed = m.rank != null && m.rankOf != null && m.rankOf > 0;
      return (
        <StatRow
          key={key}
          label={def.label}
          value={formatTendency(m.value, def.unit)}
          percent={placed ? ((m.rankOf! - m.rank! + 1) / m.rankOf!) * 100 : null}
          note={placed ? `${ordinal(m.rank!)} of ${m.rankOf}` : 'Not ranked'}
        />
      );
    });

  return (
    <Card outlined style={[styles.staffCard, stacked && styles.staffCardStacked]}>
      <CardWash />
      <View style={styles.staffHead}>
        <View style={styles.staffHeadText}>
          <Text style={styles.staffTeam}>{profile.team}</Text>
          <Text style={styles.staffCoach} numberOfLines={1}>
            {profile.coach ?? 'Unknown'}
          </Text>
          <Text style={[styles.staffSource, { color: offenseSource.color }]} numberOfLines={2}>
            {offenseSource.label}
            {profile.offense.source === 'coach' ? ` · ${profile.offense.nGames}g` : ''}
          </Text>
        </View>
        <View style={styles.teamMark}>
          <Text style={styles.teamMarkText}>{profile.team}</Text>
        </View>
      </View>
      <Eyebrow>Offense</Eyebrow>
      {lines(HEADLINE_OFFENSE, offense)}

      <View style={styles.staffSpacer} />
      <Eyebrow>Defense</Eyebrow>
      {lines(HEADLINE_DEFENSE, defense)}
    </Card>
  );
}

function ordinal(n: number): string {
  const lastTwo = n % 100;
  if (lastTwo >= 11 && lastTwo <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

function PlayerMatchupRow({
  player,
  rank,
  onPress,
}: {
  player: MatchupPlayer;
  rank: number;
  onPress: (player: MatchupPlayer) => void;
}) {
  const t = useTheme();
  const styles = useStyles(sheet);
  const score = Number(player.matchup_score);
  const edge = player.lane_edge == null ? null : Number(player.lane_edge);

  return (
    <Pressable
      onPress={() => onPress(player)}
      accessibilityRole="button"
      style={({ pressed }) => [styles.playerCard, pressed && styles.pressed]}
    >
      <CardWash />
      <View style={styles.rankBadge}>
        <Text style={styles.rankText}>{rank}</Text>
      </View>
      <View style={styles.playerMain}>
        <Text style={styles.playerName} numberOfLines={1}>
          {player.display_name}
        </Text>
        <Text style={styles.playerMeta} numberOfLines={1}>
          {player.team} · {player.position}
          {player.pos_rank != null ? `${player.pos_rank}` : ''} ·{' '}
          {player.detail?.laneLabel ?? ''}
        </Text>
        <Text style={styles.playerEdge} numberOfLines={1}>
          {edge == null
            ? 'Matchup not gradeable'
            : `${edge > 0 ? '+' : ''}${edge.toFixed(0)} unit edge · ${
                player.composite == null
                  ? 'unranked'
                  : `${Number(player.composite).toFixed(0)} ranking`
              } · ${Number(player.volume_score).toFixed(0)} volume`}
        </Text>
        {player.actual_points != null && (
          <Text style={styles.playerActual} numberOfLines={1}>
            {`Scored ${Number(player.actual_points).toFixed(1)} PPR`}
            {player.predicted_rank != null && player.actual_rank != null
              ? ` · ranked #${player.predicted_rank}, finished #${player.actual_rank}`
              : ''}
            {statLine(player.actual_line)}
          </Text>
        )}
        {player.detail?.tendencySource === 'team' && (
          <Text style={styles.playerCaveat}>
            Scheme profile is the team’s, not this staff’s
          </Text>
        )}
      </View>
      <Text style={[styles.playerScore, { color: scoreColor(t, score) }]}>
        {score.toFixed(0)}
      </Text>
    </Pressable>
  );
}

function statLine(line: MatchupPlayer['actual_line']): string {
  if (!line) return '';
  const parts: string[] = [];
  if (line.passingYards) parts.push(`${line.passingYards.toFixed(0)} pass yd`);
  if (line.rushingYards) parts.push(`${line.rushingYards.toFixed(0)} rush yd`);
  if (line.receptions) parts.push(`${line.receptions}/${line.targets ?? '?'} rec`);
  if (line.receivingYards) parts.push(`${line.receivingYards.toFixed(0)} rec yd`);
  if (line.tds) parts.push(`${line.tds} TD`);
  return parts.length > 0 ? ` · ${parts.join(', ')}` : '';
}

function StarterRow({ starter, first }: { starter: MatchupStarter; first: boolean }) {
  const t = useTheme();
  const styles = useStyles(sheet);

  return (
    <View style={[styles.starterRow, first && styles.starterRowFirst]}>
      <Text style={styles.starterRole}>{starter.role}</Text>
      <View style={styles.starterMain}>
        <Text style={styles.starterName} numberOfLines={1}>
          {starter.display_name}
        </Text>
        <Text style={styles.starterMeta} numberOfLines={1}>
          {starter.role_name ?? starter.position ?? ''}
          {starter.position_rank != null && starter.position != null
            ? ` · ${starter.position}${starter.position_rank}`
            : ''}
        </Text>
      </View>
      <Text style={[styles.starterScore, { color: scoreColor(t, starter.composite) }]}>
        {starter.composite == null ? '—' : starter.composite.toFixed(0)}
      </Text>
    </View>
  );
}

const sheet = (t: Theme) => ({
  screen: { flex: 1, backgroundColor: t.bg },
  content: { paddingHorizontal: 16, paddingBottom: 8, gap: 12 },
  stack: { gap: 10 },
  pressed: { opacity: 0.75 },

  hero: { alignItems: 'center' as const, paddingTop: 4, paddingBottom: 4 },
  teams: {
    color: t.text,
    fontSize: getPixels(30),
    fontWeight: '800' as const,
    letterSpacing: -0.5,
  },
  at: { color: t.textFaint, fontWeight: '500' as const },
  kickoff: { color: t.textDim, fontSize: getPixels(12.5), marginTop: 4 },
  finalScore: {
    color: t.text,
    fontSize: getPixels(15),
    fontWeight: '800' as const,
    marginTop: 6,
    letterSpacing: 0.4,
  },
  heroScore: {
    fontSize: getPixels(58),
    lineHeight: getPixels(66),
    fontWeight: '800' as const,
    letterSpacing: -2,
    marginTop: 6,
    fontVariant: ['tabular-nums' as const],
    textShadowOffset: { width: 0, height: 0 },
  },
  heroLabel: {
    color: t.textDim,
    fontSize: getPixels(11.5),
    textAlign: 'center' as const,
    marginTop: 2,
  },

  resultCard: { padding: 14, gap: 6 },
  resultHeadline: {
    color: t.text,
    fontSize: getPixels(13.5),
    fontWeight: '700' as const,
    lineHeight: getPixels(19.5),
  },
  resultCaveat: { color: t.warn, fontSize: getPixels(11), lineHeight: getPixels(16) },

  buildButton: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 11,
    backgroundColor: t.accent,
    borderRadius: radius.card,
    paddingVertical: 13,
    paddingHorizontal: 14,
  },
  buildText: { flex: 1 },
  buildLabel: { color: t.onAccent, fontSize: getPixels(14.5), fontWeight: '800' as const },
  buildMeta: {
    color: t.onAccent,
    opacity: 0.85,
    fontSize: getPixels(11),
    fontWeight: '600' as const,
    marginTop: 2,
    lineHeight: getPixels(15),
  },

  sectionHint: { color: t.textDim, fontSize: getPixels(12), lineHeight: getPixels(17.5) },
  listTitle: {
    color: t.text,
    fontSize: getPixels(19),
    fontWeight: '800' as const,
    letterSpacing: -0.4,
  },
  chipRow: { marginTop: -4, marginBottom: -4 },

  staffRow: { flexDirection: 'row' as const, gap: 10 },
  staffColumn: { flexDirection: 'column' as const },
  staffCard: { flex: 1, padding: 14, borderRadius: radius.card },
  staffCardStacked: { flex: 0, alignSelf: 'stretch' as const },
  staffHead: { flexDirection: 'row' as const, alignItems: 'flex-start' as const, gap: 10 },
  staffHeadText: { flex: 1 },
  staffTeam: {
    color: t.text,
    fontSize: getPixels(22),
    fontWeight: '800' as const,
    letterSpacing: -0.4,
  },
  staffCoach: { color: t.textDim, fontSize: getPixels(13), fontWeight: '600' as const },
  staffSource: {
    fontSize: getPixels(11),
    fontWeight: '600' as const,
    marginTop: 3,
    lineHeight: getPixels(15),
  },
  staffSpacer: { height: 8 },
  teamMark: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: t.surfaceAlt,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: t.border,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  teamMarkText: { color: t.textDim, fontSize: getPixels(12), fontWeight: '800' as const },

  laneRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 11,
    padding: 12,
  },
  laneMain: { flex: 1 },
  laneLabel: { color: t.text, fontSize: getPixels(14.5), fontWeight: '700' as const },
  laneSub: { color: t.textDim, fontSize: getPixels(11), marginTop: 2, lineHeight: getPixels(15) },
  laneValue: {
    fontSize: getPixels(21),
    fontWeight: '800' as const,
    fontVariant: ['tabular-nums' as const],
    minWidth: 46,
    textAlign: 'right' as const,
  },

  playerCard: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 10,
    padding: 12,
    paddingLeft: 10,
    backgroundColor: t.surface,
    borderRadius: radius.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: t.border,
    borderLeftWidth: 2,
    borderLeftColor: t.accent,
    overflow: 'hidden' as const,
  },
  rankBadge: {
    width: 24,
    height: 24,
    borderRadius: 7,
    backgroundColor: t.accentSoft,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  rankText: { color: t.accent, fontSize: getPixels(12), fontWeight: '700' as const },
  playerMain: { flex: 1, gap: 2 },
  playerName: {
    color: t.text,
    fontSize: getPixels(16),
    fontWeight: '700' as const,
    letterSpacing: -0.2,
  },
  playerMeta: { color: t.textDim, fontSize: getPixels(11.5) },
  playerEdge: { color: t.accent, fontSize: getPixels(11.5), fontWeight: '600' as const },
  playerCaveat: { color: t.warn, fontSize: getPixels(10) },
  playerActual: { color: t.positive, fontSize: getPixels(10.5), fontWeight: '600' as const },
  playerScore: {
    fontSize: getPixels(26),
    fontWeight: '800' as const,
    fontVariant: ['tabular-nums' as const],
    minWidth: 40,
    textAlign: 'right' as const,
  },

  starterCard: { paddingHorizontal: 12 },
  starterRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 10,
    paddingVertical: 9,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: t.border,
  },
  starterRowFirst: { borderTopWidth: 0 },
  starterRole: {
    color: t.textFaint,
    fontSize: getPixels(10.5),
    fontWeight: '800' as const,
    letterSpacing: 0.4,
    width: 44,
  },
  starterMain: { flex: 1 },
  starterName: { color: t.text, fontSize: getPixels(14), fontWeight: '600' as const },
  starterMeta: { color: t.textFaint, fontSize: getPixels(10.5), marginTop: 1 },
  starterScore: {
    fontSize: getPixels(17),
    fontWeight: '800' as const,
    fontVariant: ['tabular-nums' as const],
    textAlign: 'right' as const,
    minWidth: 34,
  },
});
