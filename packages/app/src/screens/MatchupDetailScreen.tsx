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
import { t as translate, useTranslation, type MessageKey } from '../i18n';
import {
  SKILL_POSITIONS,
  edgeColor,
  formatKickoff,
  formatTendency,
  tendencySourceLabel,
} from '../matchupFormat';
import { getPixels, radius, scoreColor, useStyles, useTheme, type Theme } from '../theme';

const STAFF_SIDE_BY_SIDE_WIDTH = 700;

function heroTint(theme: Theme, score: number) {
  const color = scoreColor(theme, score);
  return color === theme.accent
    ? { color, textShadowColor: theme.accentGlow, textShadowRadius: 22 }
    : { color, textShadowRadius: 0 };
}

type Section = 'staffs' | 'lanes' | 'players';

const SECTION_KEYS: Array<{ key: Section; label: MessageKey }> = [
  { key: 'staffs', label: 'matchup.section.staffs' },
  { key: 'lanes', label: 'matchup.section.lanes' },
  { key: 'players', label: 'matchup.section.players' },
];

const UNIT_LABEL_KEYS: Record<MatchupStarter['unit'], MessageKey> = {
  offense: 'matchup.unit.offense',
  defense: 'matchup.unit.defense',
  special: 'matchup.unit.special',
};

const UNIT_TITLE_KEYS: Record<MatchupStarter['unit'], MessageKey> = {
  offense: 'matchup.unitTitle.offense',
  defense: 'matchup.unitTitle.defense',
  special: 'matchup.unitTitle.special',
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
  const { t } = useTranslation();
  const theme = useTheme();
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
      label: t('matchup.unitChip', { team, unit: t(UNIT_LABEL_KEYS[unit]) }),
    });
    return [
      { key: 'skill', label: t('matchup.skillPositions') },
      chip(away, 'offense'),
      chip(home, 'offense'),
      chip(away, 'defense'),
      chip(away, 'special'),
      chip(home, 'defense'),
      chip(home, 'special'),
    ];
  }, [detail, t]);

  const sections = useMemo(
    () => SECTION_KEYS.map((entry) => ({ key: entry.key, label: t(entry.label) })),
    [t],
  );

  if (error) {
    return <ErrorState message={error} onRetry={onBack} />;
  }

  if (!detail || !meta) return <Loading />;

  const score = Number(detail.mismatch_score);
  const isFinal = detail.home_score != null && detail.away_score != null;
  const unitLabels = new Map(meta.lanes.map((l) => [l.key, l.label]));

  const [filterTeam, filterUnit] = filter.split('|');
  const unitTitleKey = UNIT_TITLE_KEYS[filterUnit as MatchupStarter['unit']];
  const listTitle =
    filter === 'skill'
      ? isFinal
        ? t('matchup.gradedPlayers')
        : t('matchup.bestMatchups')
      : t('matchup.starterListTitle', {
          team: filterTeam ?? '',
          unit: t(unitTitleKey ?? 'matchup.unitTitle.fallback'),
        });

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
          {detail.stadium ? t('matchup.stadium', { stadium: detail.stadium }) : ''}
        </Text>
        {isFinal && (
          <Text style={styles.finalScore}>
            {t('matchup.finalScore', {
              away: detail.away_team,
              awayScore: detail.away_score ?? '',
              home: detail.home_team,
              homeScore: detail.home_score ?? '',
            })}
          </Text>
        )}
        <Text style={[styles.heroScore, heroTint(theme, score)]}>{score.toFixed(1)}</Text>
        <Text style={styles.heroLabel}>
          {isFinal ? t('matchup.predictedPrefix') : ''}
          {t('matchup.heroLabel', {
            count: detail.edge_count,
            threshold: meta.edgeThreshold,
          })}
        </Text>
      </View>
      <Notice>
        {t('matchup.talentGap', {
          gap: Number(detail.mismatch_score).toFixed(1),
          scoring:
            detail.shootout_score == null
              ? t('matchup.notGraded')
              : Number(detail.shootout_score).toFixed(1),
        })}
        {detail.lean_team
          ? t('matchup.leaning', { team: detail.lean_team })
          : detail.shootout_score == null
            ? ''
            : t('matchup.evenlySplit')}
        {detail.total_line != null
          ? t('matchup.vegasLine', {
              total: Number(detail.total_line).toFixed(1),
              spread:
                detail.spread_line == null
                  ? ''
                  : t('matchup.spread', {
                      spread: `${Number(detail.spread_line) > 0 ? '+' : ''}${Number(
                        detail.spread_line,
                      ).toFixed(1)}`,
                    }),
            })
          : ''}
      </Notice>
      {detail.total_line == null && (
        <Notice icon="alert-circle-outline" tone="warn">
          {t('matchup.noBettingLine')}
        </Notice>
      )}

      {isFinal && (
        <Card wash rail style={styles.resultCard}>
          <Text style={styles.resultHeadline}>
            {detail.top10_hits == null
              ? t('matchup.noFantasyLines')
              : t('matchup.top10Hits', { hits: detail.top10_hits })}
          </Text>
          {detail.backfilled && (
            <Text style={styles.resultCaveat}>{t('matchup.backfilledCaveat')}</Text>
          )}
        </Card>
      )}

      {showdown && onBuildShowdown && !isFinal && (
        <Pressable
          onPress={() => onBuildShowdown(showdown.slate, showdown.strategy)}
          accessibilityRole="button"
          style={({ pressed }) => [styles.buildButton, pressed && styles.pressed]}
        >
          <Icon name="trophy-outline" size={19} color={theme.onAccent} />
          <View style={styles.buildText}>
            <Text style={styles.buildLabel}>{t('matchup.buildShowdown')}</Text>
            <Text style={styles.buildMeta}>
              {t('matchup.buildShowdownMeta', { players: showdown.slate.players })}
            </Text>
          </View>
        </Pressable>
      )}

      <Segmented items={sections} value={section} onChange={setSection} />
      {section === 'staffs' && (
        <View style={[styles.staffRow, !sideBySideStaff && styles.staffColumn]}>
          <StaffCard profile={detail.detail.away} meta={meta} stacked={!sideBySideStaff} />
          <StaffCard profile={detail.detail.home} meta={meta} stacked={!sideBySideStaff} />
        </View>
      )}

      {section === 'lanes' && (
        <View style={styles.stack}>
          <Text style={styles.sectionHint}>{t('matchup.laneEdgesHint')}</Text>
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
                ? t('matchup.noRankedSpecialists')
                : t('matchup.noDepthChart')}
            </Text>
          ) : (
            <>
              <Text style={styles.sectionHint}>
                {t('matchup.startersHint')}
                {filterUnit === 'special' ? t('matchup.startersHintSpecial') : ''}
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
  const { t } = useTranslation();
  const theme = useTheme();
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
          {t('matchup.edgeSub', {
            lane: laneLabel,
            offense: edge.offenseStrength == null ? '—' : edge.offenseStrength.toFixed(0),
            defense: edge.defenseStrength == null ? '—' : edge.defenseStrength.toFixed(0),
          })}
        </Text>
      </View>
      <Text style={[styles.laneValue, { color: edgeColor(theme, value) }]}>
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
  const { t } = useTranslation();
  const theme = useTheme();
  const styles = useStyles(sheet);
  const offenseSource = tendencySourceLabel(theme, profile.offense.source, profile.coach);

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
          note={
            placed
              ? t('matchup.rankOf', { rank: ordinal(m.rank!), total: m.rankOf })
              : t('matchup.notRanked')
          }
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
            {profile.coach ?? t('matchup.unknownCoach')}
          </Text>
          <Text style={[styles.staffSource, { color: offenseSource.color }]} numberOfLines={2}>
            {offenseSource.label}
            {profile.offense.source === 'coach'
              ? t('matchup.coachGames', { games: profile.offense.nGames })
              : ''}
          </Text>
        </View>
        <View style={styles.teamMark}>
          <Text style={styles.teamMarkText}>{profile.team}</Text>
        </View>
      </View>
      <Eyebrow>{t('matchup.offense')}</Eyebrow>
      {lines(HEADLINE_OFFENSE, offense)}

      <View style={styles.staffSpacer} />
      <Eyebrow>{t('matchup.defense')}</Eyebrow>
      {lines(HEADLINE_DEFENSE, defense)}
    </Card>
  );
}

function ordinal(n: number): string {
  const lastTwo = n % 100;
  if (lastTwo >= 11 && lastTwo <= 13) return translate('ordinal.th', { n });
  switch (n % 10) {
    case 1:
      return translate('ordinal.st', { n });
    case 2:
      return translate('ordinal.nd', { n });
    case 3:
      return translate('ordinal.rd', { n });
    default:
      return translate('ordinal.th', { n });
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
  const { t } = useTranslation();
  const theme = useTheme();
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
          {t('matchup.playerMeta', {
            team: player.team,
            position: `${player.position}${player.pos_rank ?? ''}`,
            lane: player.detail?.laneLabel ?? '',
          })}
        </Text>
        <Text style={styles.playerEdge} numberOfLines={1}>
          {edge == null
            ? t('matchup.notGradeable')
            : t('matchup.playerEdge', {
                edge: `${edge > 0 ? '+' : ''}${edge.toFixed(0)}`,
                ranking:
                  player.composite == null
                    ? t('matchup.unranked')
                    : t('matchup.rankingScore', {
                        score: Number(player.composite).toFixed(0),
                      }),
                volume: Number(player.volume_score).toFixed(0),
              })}
        </Text>
        {player.actual_points != null && (
          <Text style={styles.playerActual} numberOfLines={1}>
            {t('matchup.scoredPpr', { points: Number(player.actual_points).toFixed(1) })}
            {player.predicted_rank != null && player.actual_rank != null
              ? t('matchup.rankedFinished', {
                  predicted: player.predicted_rank,
                  actual: player.actual_rank,
                })
              : ''}
            {statLine(player.actual_line)}
          </Text>
        )}
        {player.detail?.tendencySource === 'team' && (
          <Text style={styles.playerCaveat}>{t('matchup.schemeCaveat')}</Text>
        )}
      </View>
      <Text style={[styles.playerScore, { color: scoreColor(theme, score) }]}>
        {score.toFixed(0)}
      </Text>
    </Pressable>
  );
}

function statLine(line: MatchupPlayer['actual_line']): string {
  if (!line) return '';
  const parts: string[] = [];
  if (line.passingYards) {
    parts.push(translate('stat.passYards', { yards: line.passingYards.toFixed(0) }));
  }
  if (line.rushingYards) {
    parts.push(translate('stat.rushYards', { yards: line.rushingYards.toFixed(0) }));
  }
  if (line.receptions) {
    parts.push(
      translate('stat.receptions', {
        receptions: line.receptions,
        targets: line.targets ?? '?',
      }),
    );
  }
  if (line.receivingYards) {
    parts.push(translate('stat.receivingYards', { yards: line.receivingYards.toFixed(0) }));
  }
  if (line.tds) parts.push(translate('stat.touchdowns', { tds: line.tds }));
  return parts.length > 0 ? translate('stat.line', { line: parts.join(', ') }) : '';
}

function StarterRow({ starter, first }: { starter: MatchupStarter; first: boolean }) {
  const { t } = useTranslation();
  const theme = useTheme();
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
            ? t('matchup.starterRank', {
                rank: `${starter.position}${starter.position_rank}`,
              })
            : ''}
        </Text>
      </View>
      <Text style={[styles.starterScore, { color: scoreColor(theme, starter.composite) }]}>
        {starter.composite == null ? '—' : starter.composite.toFixed(0)}
      </Text>
    </View>
  );
}

const sheet = (theme: Theme) => ({
  screen: { flex: 1, backgroundColor: theme.bg },
  content: { paddingHorizontal: 16, paddingBottom: 8, gap: 12 },
  stack: { gap: 10 },
  pressed: { opacity: 0.75 },

  hero: { alignItems: 'center' as const, paddingTop: 4, paddingBottom: 4 },
  teams: {
    color: theme.text,
    fontSize: getPixels(30),
    fontWeight: '800' as const,
    letterSpacing: -0.5,
  },
  at: { color: theme.textFaint, fontWeight: '500' as const },
  kickoff: { color: theme.textDim, fontSize: getPixels(12.5), marginTop: 4 },
  finalScore: {
    color: theme.text,
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
    color: theme.textDim,
    fontSize: getPixels(11.5),
    textAlign: 'center' as const,
    marginTop: 2,
  },

  resultCard: { padding: 14, gap: 6 },
  resultHeadline: {
    color: theme.text,
    fontSize: getPixels(13.5),
    fontWeight: '700' as const,
    lineHeight: getPixels(19.5),
  },
  resultCaveat: { color: theme.warn, fontSize: getPixels(11), lineHeight: getPixels(16) },

  buildButton: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 11,
    backgroundColor: theme.accent,
    borderRadius: radius.card,
    paddingVertical: 13,
    paddingHorizontal: 14,
  },
  buildText: { flex: 1 },
  buildLabel: { color: theme.onAccent, fontSize: getPixels(14.5), fontWeight: '800' as const },
  buildMeta: {
    color: theme.onAccent,
    opacity: 0.85,
    fontSize: getPixels(11),
    fontWeight: '600' as const,
    marginTop: 2,
    lineHeight: getPixels(15),
  },

  sectionHint: { color: theme.textDim, fontSize: getPixels(12), lineHeight: getPixels(17.5) },
  listTitle: {
    color: theme.text,
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
    color: theme.text,
    fontSize: getPixels(22),
    fontWeight: '800' as const,
    letterSpacing: -0.4,
  },
  staffCoach: { color: theme.textDim, fontSize: getPixels(13), fontWeight: '600' as const },
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
    backgroundColor: theme.surfaceAlt,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  teamMarkText: { color: theme.textDim, fontSize: getPixels(12), fontWeight: '800' as const },

  laneRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 11,
    padding: 12,
  },
  laneMain: { flex: 1 },
  laneLabel: { color: theme.text, fontSize: getPixels(14.5), fontWeight: '700' as const },
  laneSub: { color: theme.textDim, fontSize: getPixels(11), marginTop: 2, lineHeight: getPixels(15) },
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
    backgroundColor: theme.surface,
    borderRadius: radius.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
    borderLeftWidth: 2,
    borderLeftColor: theme.accent,
    overflow: 'hidden' as const,
  },
  rankBadge: {
    width: 24,
    height: 24,
    borderRadius: 7,
    backgroundColor: theme.accentSoft,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  rankText: { color: theme.accent, fontSize: getPixels(12), fontWeight: '700' as const },
  playerMain: { flex: 1, gap: 2 },
  playerName: {
    color: theme.text,
    fontSize: getPixels(16),
    fontWeight: '700' as const,
    letterSpacing: -0.2,
  },
  playerMeta: { color: theme.textDim, fontSize: getPixels(11.5) },
  playerEdge: { color: theme.accent, fontSize: getPixels(11.5), fontWeight: '600' as const },
  playerCaveat: { color: theme.warn, fontSize: getPixels(10) },
  playerActual: { color: theme.positive, fontSize: getPixels(10.5), fontWeight: '600' as const },
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
    borderTopColor: theme.border,
  },
  starterRowFirst: { borderTopWidth: 0 },
  starterRole: {
    color: theme.textFaint,
    fontSize: getPixels(10.5),
    fontWeight: '800' as const,
    letterSpacing: 0.4,
    width: 44,
  },
  starterMain: { flex: 1 },
  starterName: { color: theme.text, fontSize: getPixels(14), fontWeight: '600' as const },
  starterMeta: { color: theme.textFaint, fontSize: getPixels(10.5), marginTop: 1 },
  starterScore: {
    fontSize: getPixels(17),
    fontWeight: '800' as const,
    fontVariant: ['tabular-nums' as const],
    textAlign: 'right' as const,
    minWidth: 34,
  },
});
