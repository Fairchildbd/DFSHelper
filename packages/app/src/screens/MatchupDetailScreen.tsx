import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
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
  type MatchupDetail,
  type MatchupMeta,
  type MatchupPlayer,
  type MatchupStarter,
  type MatchupSummary,
  type SideProfile,
  type SlateSummary,
  type StrategyDefinition,
} from '../api';
import { t as translate, useTranslation, type MessageKey } from '../i18n';
import {
  SKILL_POSITIONS,
  describeEdge,
  edgeColor,
  formatKickoff,
  formatTendency,
  mismatchColor,
  tendencySourceLabel,
} from '../matchupFormat';
import { getPixels, scoreColor, theme } from '../theme';

const STAFF_SIDE_BY_SIDE_WIDTH = 700;

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
  const [detail, setDetail] = useState<MatchupDetail | null>(null);
  const [meta, setMeta] = useState<MatchupMeta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('skill');
  const [showdown, setShowdown] = useState<{
    slate: SlateSummary;
    strategy: StrategyDefinition;
  } | null>(null);
  const sideBySideStaff = useWindowDimensions().width >= STAFF_SIDE_BY_SIDE_WIDTH;

  useEffect(() => {
    let cancelled = false;
    setFilter('skill');
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

  if (error) {
    return (
      <View style={styles.center}>
        <Pressable onPress={onBack} style={styles.back}>
          <Text style={styles.backText}>‹ {t('matchup.back')}</Text>
        </Pressable>
        <Text style={styles.errorBody}>{error}</Text>
      </View>
    );
  }

  if (!detail || !meta) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={theme.accent} />
      </View>
    );
  }

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

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Pressable onPress={onBack} style={styles.back}>
        <Text style={styles.backText}>‹ {t('matchup.back')}</Text>
      </Pressable>

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
        <Text style={[styles.heroScore, { color: mismatchColor(score) }]}>
          {score.toFixed(1)}
        </Text>
        <Text style={styles.heroLabel}>
          {isFinal ? t('matchup.predictedPrefix') : ''}
          {t('matchup.heroLabel', {
            count: detail.edge_count,
            threshold: meta.edgeThreshold,
          })}
        </Text>
      </View>

      {showdown && onBuildShowdown && !isFinal && (
        <Pressable
          style={({ pressed }) => [styles.buildButton, pressed && styles.buildPressed]}
          onPress={() => onBuildShowdown(showdown.slate, showdown.strategy)}
        >
          <Text style={styles.buildLabel}>{t('matchup.buildShowdown')}</Text>
          <Text style={styles.buildMeta}>
            {t('matchup.buildShowdownMeta', { players: showdown.slate.players })}
          </Text>
        </Pressable>
      )}

      {isFinal && (
        <View style={[styles.envRow, styles.resultRow]}>
          <Text style={styles.resultHeadline}>
            {detail.top10_hits == null
              ? t('matchup.noFantasyLines')
              : t('matchup.top10Hits', { hits: detail.top10_hits })}
          </Text>
          {detail.backfilled && (
            <Text style={styles.resultCaveat}>{t('matchup.backfilledCaveat')}</Text>
          )}
        </View>
      )}

      <View style={styles.envRow}>
        <Text style={styles.envText}>
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
        </Text>
        {detail.total_line == null && (
          <Text style={styles.envTextMuted}>{t('matchup.noBettingLine')}</Text>
        )}
      </View>

      <Text style={styles.sectionTitle}>{t('matchup.coachingStaffs')}</Text>
      <View style={[styles.staffRow, !sideBySideStaff && styles.staffColumn]}>
        <StaffCard profile={detail.detail.away} meta={meta} stacked={!sideBySideStaff} />
        <StaffCard profile={detail.detail.home} meta={meta} stacked={!sideBySideStaff} />
      </View>

      <Text style={styles.sectionTitle}>{t('matchup.laneEdges')}</Text>
      <Text style={styles.sectionHint}>{t('matchup.laneEdgesHint')}</Text>
      {[...detail.detail.edges]
        .filter((e) => e.edge != null)
        .sort((a, b) => Math.abs(b.edge!) - Math.abs(a.edge!))
        .map((e) => (
          <View key={`${e.lane}-${e.label}`} style={styles.edgeRow}>
            <View style={styles.edgeMain}>
              <Text style={styles.edgeLabel} numberOfLines={1}>
                {e.label}
              </Text>
              <Text style={styles.edgeSub} numberOfLines={1}>
                {t('matchup.edgeSub', {
                  lane: unitLabels.get(e.lane) ?? e.lane,
                  offense: e.offenseStrength == null ? '—' : e.offenseStrength.toFixed(0),
                  defense: e.defenseStrength == null ? '—' : e.defenseStrength.toFixed(0),
                })}
              </Text>
            </View>
            <Text style={[styles.edgeValue, { color: edgeColor(e.edge) }]}>
              {e.edge! > 0 ? '+' : ''}
              {e.edge!.toFixed(0)}
            </Text>
          </View>
        ))}

      <Text style={styles.sectionTitle}>{listTitle}</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.filterRow}
        style={styles.filterScroll}
      >
        {chips.map((c) => (
          <Pressable
            key={c.key}
            onPress={() => setFilter(c.key)}
            style={[styles.filterChip, filter === c.key && styles.filterChipActive]}
          >
            <Text style={[styles.filterText, filter === c.key && styles.filterTextActive]}>
              {c.label}
            </Text>
          </Pressable>
        ))}
      </ScrollView>

      {filter === 'skill' ? (
        players.map((p) => (
          <PlayerMatchupRow key={p.gsis_id} player={p} onPress={onSelectPlayer} />
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
          {starters.map((s) => (
            <StarterRow key={`${s.gsis_id}-${s.role}-${s.slot ?? ''}`} starter={s} />
          ))}
        </>
      )}

      <View style={styles.footer} />
    </ScrollView>
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
  const offenseSource = tendencySourceLabel(profile.offense.source, profile.coach);
  const byKey = (side: 'offense' | 'defense') =>
    new Map(profile[side].metrics.map((m) => [m.metric, m]));

  const offense = byKey('offense');
  const defense = byKey('defense');
  const labels = new Map(
    [...meta.offenseTendencies, ...meta.defenseTendencies].map((d) => [d.key, d]),
  );

  return (
    <View style={[styles.staffCard, stacked && styles.staffCardStacked]}>
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

      <Text style={styles.staffSection}>{t('matchup.offense')}</Text>
      {HEADLINE_OFFENSE.map((key) => {
        const m = offense.get(key);
        const def = labels.get(key);
        if (!m || !def) return null;
        return (
          <TendencyLine
            key={key}
            label={def.label}
            value={formatTendency(m.value, def.unit)}
            rank={m.rank}
            rankOf={m.rankOf}
          />
        );
      })}

      <Text style={styles.staffSection}>{t('matchup.defense')}</Text>
      {HEADLINE_DEFENSE.map((key) => {
        const m = defense.get(key);
        const def = labels.get(key);
        if (!m || !def) return null;
        return (
          <TendencyLine
            key={key}
            label={def.label}
            value={formatTendency(m.value, def.unit)}
            rank={m.rank}
            rankOf={m.rankOf}
          />
        );
      })}
    </View>
  );
}

function ordinal(n: number): string {
  const lastTwo = n % 100;
  if (lastTwo >= 11 && lastTwo <= 13) return translate('ordinal.th', { n });
  switch (n % 10) {
    case 1: return translate('ordinal.st', { n });
    case 2: return translate('ordinal.nd', { n });
    case 3: return translate('ordinal.rd', { n });
    default: return translate('ordinal.th', { n });
  }
}

function TendencyLine({
  label,
  value,
  rank,
  rankOf,
}: {
  label: string;
  value: string;
  rank: number | null;
  rankOf: number | null;
}) {
  const { t } = useTranslation();
  const placed = rank != null && rankOf != null && rankOf > 0;
  const fill = placed ? ((rankOf - rank + 1) / rankOf) * 100 : 0;

  return (
    <View style={styles.tendency}>
      <View style={styles.tendencyHead}>
        <Text style={styles.tendencyLabel} numberOfLines={1}>
          {label}
        </Text>
        <Text style={styles.tendencyValue}>{value}</Text>
      </View>
      <View style={styles.tendencyTrack}>
        <View
          style={[
            styles.tendencyFill,
            {
              width: `${fill}%`,
              backgroundColor: placed ? theme.accent : theme.textFaint,
            },
          ]}
        />
      </View>
      <Text style={styles.tendencyNote} numberOfLines={1}>
        {placed
          ? t('matchup.rankOf', { rank: ordinal(rank), total: rankOf })
          : t('matchup.notRanked')}
      </Text>
    </View>
  );
}

function PlayerMatchupRow({
  player,
  onPress,
}: {
  player: MatchupPlayer;
  onPress: (player: MatchupPlayer) => void;
}) {
  const { t } = useTranslation();
  const score = Number(player.matchup_score);
  const edge = player.lane_edge == null ? null : Number(player.lane_edge);

  return (
    <Pressable
      style={({ pressed }) => [styles.playerRow, pressed && styles.rowPressed]}
      onPress={() => onPress(player)}
    >
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
        <Text style={[styles.playerEdge, { color: edgeColor(edge) }]} numberOfLines={1}>
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
      <View style={styles.playerScoreCol}>
        <Text style={[styles.playerScore, { color: scoreColor(score) }]}>
          {score.toFixed(0)}
        </Text>
        {player.actual_points != null && (
          <Text style={styles.playerActualPoints}>
            {Number(player.actual_points).toFixed(1)}
          </Text>
        )}
      </View>
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

function StarterRow({ starter }: { starter: MatchupStarter }) {
  const { t } = useTranslation();
  const composite = starter.composite;

  return (
    <View style={styles.starterRow}>
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
      <Text style={[styles.starterScore, { color: scoreColor(composite) }]}>
        {composite == null ? '—' : composite.toFixed(0)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.bg },
  content: { padding: 16, gap: 4 },
  center: { flex: 1, backgroundColor: theme.bg, justifyContent: 'center', padding: 28, gap: 12 },
  back: { paddingVertical: 6 },
  backText: { color: theme.accent, fontSize: getPixels(15), fontWeight: '600' },
  errorBody: { color: theme.danger, fontSize: getPixels(13) },

  hero: { alignItems: 'center', paddingVertical: 12 },
  teams: { color: theme.text, fontSize: getPixels(26), fontWeight: '800', letterSpacing: 0.5 },
  at: { color: theme.textFaint, fontWeight: '500' },
  kickoff: { color: theme.textDim, fontSize: getPixels(12), marginTop: 3 },
  finalScore: {
    color: theme.text,
    fontSize: getPixels(15),
    fontWeight: '800',
    marginTop: 6,
    letterSpacing: 0.4,
  },
  heroScore: { fontSize: getPixels(46), fontWeight: '900', marginTop: 8, fontVariant: ['tabular-nums'] },
  heroLabel: { color: theme.textDim, fontSize: getPixels(11), textAlign: 'center' },

  buildButton: {
    backgroundColor: theme.accent,
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginTop: 12,
  },
  buildPressed: { opacity: 0.85 },
  buildLabel: { color: '#08131F', fontSize: getPixels(14.5), fontWeight: '800' },
  buildMeta: { color: '#0C2237', fontSize: getPixels(11), fontWeight: '600', marginTop: 2, lineHeight: getPixels(15) },

  envRow: {
    backgroundColor: theme.surface,
    borderRadius: 10,
    padding: 12,
    marginTop: 8,
    marginBottom: 4,
  },
  envText: { color: theme.textDim, fontSize: getPixels(12), lineHeight: getPixels(18) },
  resultRow: { borderLeftWidth: 3, borderLeftColor: theme.production, gap: 6 },
  resultHeadline: { color: theme.text, fontSize: getPixels(13), fontWeight: '700', lineHeight: getPixels(19) },
  resultCaveat: { color: theme.warn, fontSize: getPixels(11), lineHeight: getPixels(16) },
  envTextMuted: { color: theme.warn, fontSize: getPixels(12), lineHeight: getPixels(18) },

  sectionTitle: {
    color: theme.text,
    fontSize: getPixels(17),
    fontWeight: '700',
    marginTop: 22,
    marginBottom: 4,
  },
  sectionHint: { color: theme.textFaint, fontSize: getPixels(11.5), lineHeight: getPixels(17), marginBottom: 8 },

  staffRow: { flexDirection: 'row', gap: 10 },
  staffColumn: { flexDirection: 'column' },
  staffCard: {
    flex: 1,
    backgroundColor: theme.surface,
    borderRadius: 10,
    padding: 12,
    gap: 2,
  },
  staffCardStacked: { flex: 0, alignSelf: 'stretch' },
  staffTeam: { color: theme.text, fontSize: getPixels(18), fontWeight: '800' },
  staffCoach: { color: theme.textDim, fontSize: getPixels(12.5), fontWeight: '600' },
  staffSource: { fontSize: getPixels(10), fontWeight: '600', marginTop: 2, lineHeight: getPixels(14) },
  staffSection: {
    color: theme.textFaint,
    fontSize: getPixels(10),
    fontWeight: '700',
    letterSpacing: 0.6,
    marginTop: 10,
    textTransform: 'uppercase',
  },

  tendency: { marginTop: 6 },
  tendencyHead: { flexDirection: 'row', justifyContent: 'space-between', gap: 6 },
  tendencyLabel: { color: theme.textDim, fontSize: getPixels(10.5), flex: 1 },
  tendencyValue: {
    color: theme.text,
    fontSize: getPixels(10.5),
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  tendencyTrack: {
    height: 3,
    backgroundColor: theme.surfaceAlt,
    borderRadius: 2,
    marginTop: 3,
    overflow: 'hidden',
  },
  tendencyFill: { height: 3, borderRadius: 2 },
  tendencyNote: { color: theme.textFaint, fontSize: getPixels(9.5), marginTop: 2 },

  edgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 9,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.border,
  },
  edgeMain: { flex: 1 },
  edgeLabel: { color: theme.text, fontSize: getPixels(13.5), fontWeight: '600' },
  edgeSub: { color: theme.textFaint, fontSize: getPixels(10.5), marginTop: 1 },
  edgeValue: { fontSize: getPixels(17), fontWeight: '800', fontVariant: ['tabular-nums'], width: 46, textAlign: 'right' },

  filterScroll: { marginBottom: 6, marginHorizontal: -16 },
  filterRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 16 },
  filterChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.border,
  },
  filterChipActive: { backgroundColor: theme.accent, borderColor: theme.accent },
  filterText: { color: theme.textDim, fontSize: getPixels(12), fontWeight: '600' },
  filterTextActive: { color: '#04101C' },

  playerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.border,
  },
  rowPressed: { backgroundColor: theme.surfaceAlt },
  playerMain: { flex: 1, gap: 2 },
  playerName: { color: theme.text, fontSize: getPixels(15), fontWeight: '600' },
  playerMeta: { color: theme.textDim, fontSize: getPixels(11) },
  playerEdge: { fontSize: getPixels(11), fontWeight: '600' },
  playerCaveat: { color: theme.warn, fontSize: getPixels(10) },
  playerActual: { color: theme.production, fontSize: getPixels(10.5), fontWeight: '600' },
  playerScoreCol: { width: 46, alignItems: 'flex-end' },
  playerActualPoints: {
    color: theme.production,
    fontSize: getPixels(12),
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  playerScore: { fontSize: getPixels(22), fontWeight: '800', fontVariant: ['tabular-nums'], textAlign: 'right' },

  starterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 7,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  },
  starterRole: {
    color: theme.textFaint,
    fontSize: getPixels(10.5),
    fontWeight: '800',
    letterSpacing: 0.4,
    width: 44,
  },
  starterMain: { flex: 1 },
  starterName: { color: theme.text, fontSize: getPixels(14), fontWeight: '600' },
  starterMeta: { color: theme.textFaint, fontSize: getPixels(10.5), marginTop: 1 },
  starterScore: {
    fontSize: getPixels(17),
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
    textAlign: 'right',
    minWidth: 34,
  },

  footer: { height: 40 },
});
