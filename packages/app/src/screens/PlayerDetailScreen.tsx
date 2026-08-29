import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import {
  fetchPlayer,
  weightsOf,
  type MetricDetail,
  type PlayerDetail,
  type RankedPlayer,
} from '../api';
import {
  AppBar,
  BottomSpacer,
  Card,
  CardWash,
  IconPuck,
  InlineNote,
  RoundButton,
  ScoreSplitBar,
  StatRow,
  glowStyle,
  type IconName,
} from '../components/ui';
import {
  confidenceLabel,
  getPixels,
  radius,
  scoreColor,
  useStyles,
  useTheme,
  type Theme,
} from '../theme';

const DRILL_UNITS: Record<string, string> = {
  forty: 's',
  cone: 's',
  shuttle: 's',
  bench: ' reps',
  vertical: '"',
  broad: '"',
};

export type PlayerRef = Pick<RankedPlayer, 'gsis_id' | 'display_name' | 'position'> &
  Partial<RankedPlayer>;

export function PlayerDetailScreen({
  player,
  onBack,
  backLabel = 'Rankings',
}: {
  player: PlayerRef;
  onBack: () => void;
  backLabel?: string;
}) {
  const t = useTheme();
  const styles = useStyles(sheet);
  const [detail, setDetail] = useState<PlayerDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const view: PlayerRef = detail ?? player;

  useEffect(() => {
    let cancelled = false;
    fetchPlayer(player.gsis_id)
      .then((d) => !cancelled && setDetail(d))
      .catch((e) => !cancelled && setError((e as Error).message));
    return () => {
      cancelled = true;
    };
  }, [player.gsis_id]);

  const composite = view.composite == null ? null : Number(view.composite);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <AppBar
        onBack={onBack}
        backLabel={backLabel}
        right={<RoundButton name="star-outline" />}
      />
      <View style={styles.identity}>
        <Text style={styles.name} numberOfLines={2}>
          {view.display_name}
        </Text>
        <Text style={styles.meta}>
          {[
            view.position,
            view.team ?? 'Free agent',
            view.age != null ? `${Number(view.age).toFixed(1)} yrs old` : null,
            view.years_experience != null ? `${view.years_experience} seasons` : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </Text>
      </View>
      <Card outlined style={styles.hero}>
        <CardWash />
        <View style={styles.heroMain}>
          <View style={styles.compositeWrap}>
            <View style={[styles.halo, glowStyle(t, 1.6)]} pointerEvents="none" />
            <Text style={[styles.composite, { color: scoreColor(t, composite) }]}>
              {composite == null ? '—' : composite.toFixed(1)}
            </Text>
          </View>
          <Text style={styles.compositeLabel}>Composite</Text>
        </View>
        <View style={styles.heroRanks}>
          <Rank label={`${view.position} rank`} value={view.position_rank} />
          <Rank label="Overall" value={view.overall_rank} />
        </View>
      </Card>
      <ScoreSplitBar weights={weightsOf(view)} inline />
      {error && <Text style={styles.error}>{error}</Text>}
      {!detail && !error && <ActivityIndicator style={styles.loader} color={t.accent} />}

      {detail && (
        <>
          {detail.detail.noRecentProduction && (
            <InlineNote icon="alert-circle-outline">
              No NFL production on record for this player in the scoring window. After four
              seasons the league’s own usage is the verdict, so this score reflects absence
              of production rather than a graded performance — the workout below is shown
              for reference but does not feed the ranking.
            </InlineNote>
          )}

          {detail.detail.lowSignalMeasurables && (
            <InlineNote>
              Quarterback combine drills measure mobility, not the throwing traits that
              decide the position. This score leans on production by design.
            </InlineNote>
          )}

          <ComponentCard
            icon="run-fast"
            title="Athletic"
            subtitle="Position-weighted combine percentiles"
            score={detail.detail.athletic.score}
            weight={Number(view.weight_athletic ?? 0)}
            confidence={detail.detail.athletic.confidence}
            metrics={detail.detail.athletic.metrics}
            units={DRILL_UNITS}
            color={t.athletic}
          />
          {detail.detail.college.score != null && (
            <ComponentCard
              icon="school-outline"
              title="College"
              subtitle="Per-game rates at the previous level"
              score={detail.detail.college.score}
              weight={Number(view.weight_college ?? 0)}
              confidence={detail.detail.college.confidence}
              metrics={detail.detail.college.metrics}
              units={{}}
              color={t.college}
            />
          )}

          {detail.detail.lowSignalProduction && (
            <InlineNote>
              No public feed grades individual offensive line play. The production figure
              below is snap share — availability and trust, not blocking quality.
            </InlineNote>
          )}

          <ComponentCard
            icon="chart-bar"
            title="Production"
            subtitle="Per-game rates, recent seasons"
            score={detail.detail.production.score}
            weight={Number(view.weight_nfl ?? 0)}
            confidence={detail.detail.production.confidence}
            metrics={detail.detail.production.metrics}
            units={{}}
            color={t.production}
          />
          {detail.measurables.length > 0 && (
            <Card wash rail style={styles.card}>
              <View style={styles.cardHead}>
                <IconPuck name="dumbbell" />
                <View style={styles.cardHeadText}>
                  <Text style={styles.cardTitle}>Raw workout</Text>
                  {detail.measurables[0] && (
                    <Text style={styles.cardSub} numberOfLines={1}>
                      {[
                        `${detail.measurables[0].source} ${detail.measurables[0].season ?? ''}`.trim(),
                        detail.measurables[0].school,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </Text>
                  )}
                </View>
              </View>
              {detail.measurables.map((m, i) => {
                const drills = [
                  m.forty && `40: ${m.forty}`,
                  m.bench != null && `Bench: ${m.bench}`,
                  m.vertical && `Vert: ${m.vertical}"`,
                  m.broad != null && `Broad: ${m.broad}"`,
                  m.cone && `3C: ${m.cone}`,
                  m.shuttle && `Shuttle: ${m.shuttle}`,
                ].filter(Boolean) as string[];

                return (
                  <View key={i} style={styles.drillGrid}>
                    {drills.length === 0 ? (
                      <Text style={styles.drillEmpty}>No drills recorded</Text>
                    ) : (
                      drills.map((d) => {
                        const [label, value] = d.split(': ');
                        return (
                          <View key={d} style={styles.drill}>
                            <Text style={styles.drillLabel}>{label}:</Text>
                            <Text style={styles.drillValue}>{value}</Text>
                          </View>
                        );
                      })
                    )}
                  </View>
                );
              })}
            </Card>
          )}
        </>
      )}

      <BottomSpacer extra={12} />
    </ScrollView>
  );
}

function ComponentCard({
  icon,
  title,
  subtitle,
  score,
  weight,
  confidence,
  metrics,
  units,
  color,
}: {
  icon: IconName;
  title: string;
  subtitle: string;
  score: number | null;
  weight: number;
  confidence: number;
  metrics: MetricDetail[];
  units: Record<string, string>;
  color: string;
}) {
  const t = useTheme();
  const styles = useStyles(sheet);
  const conf = confidenceLabel(t, confidence);

  return (
    <Card wash rail style={styles.card}>
      <View style={styles.cardHead}>
        <IconPuck name={icon} />
        <View style={styles.cardHeadText}>
          <Text style={styles.cardTitle}>{title}</Text>
          <Text style={styles.cardSub}>{subtitle}</Text>
        </View>
        <Text style={[styles.cardScore, { color: scoreColor(t, score) }]}>
          {score == null ? '—' : score.toFixed(0)}
        </Text>
      </View>
      <View style={styles.confRow}>
        <View style={[styles.dot, { backgroundColor: conf.color }]} />
        <Text style={styles.confText} numberOfLines={1}>
          {conf.label} · {Math.round(confidence * 100)}% recorded ·{' '}
          {Math.round(weight * 100)}% of this ranking
        </Text>
      </View>
      {confidence < 1 && confidence > 0 && (
        <Text style={styles.shrinkNote}>
          This score covers only what was recorded, undiscounted. The{' '}
          {Math.round((1 - confidence) * 100)}% that wasn’t measured simply carries less
          weight — it is never held against the player.
        </Text>
      )}

      <View style={styles.metrics}>
        {metrics.map((m) => (
          <StatRow
            key={m.metric}
            label={m.label}
            weight={`${Math.round(m.weight * 100)}%`}
            value={
              m.percentile != null
                ? `${formatRaw(m.raw, m.metric)}${units[m.metric] ?? ''}`
                : 'not recorded'
            }
            percent={m.percentile}
            note={m.percentile != null ? `${m.percentile.toFixed(0)}th percentile` : '—'}
            color={color}
          />
        ))}
      </View>
    </Card>
  );
}

const PROPORTION_METRICS = new Set([
  'interception_rate',
  'target_share',
  'air_yards_share',
  'snap_pct',
  'cfb_completion_pct',
]);

function formatRaw(raw: number | null, metric: string): string {
  if (raw == null) return '—';
  const value = Number(raw);
  if (PROPORTION_METRICS.has(metric)) return `${(value * 100).toFixed(1)}%`;
  if (metric.includes('_per_')) return value.toFixed(3);
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function Rank({ label, value }: { label: string; value: number | null | undefined }) {
  const styles = useStyles(sheet);
  return (
    <View style={styles.rank}>
      <Text style={styles.rankValue}>{value == null ? '—' : `#${value}`}</Text>
      <Text style={styles.rankLabel}>{label}</Text>
    </View>
  );
}

const sheet = (t: Theme) => ({
  screen: { flex: 1, backgroundColor: t.bg },
  content: { paddingHorizontal: 16, paddingBottom: 8, gap: 12 },

  identity: { paddingTop: 2, gap: 3 },
  name: {
    color: t.text,
    fontSize: getPixels(34),
    lineHeight: getPixels(39),
    fontWeight: '800' as const,
    letterSpacing: -1,
  },
  meta: { color: t.textDim, fontSize: getPixels(13.5) },

  hero: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    paddingVertical: 22,
    paddingHorizontal: 18,
    borderRadius: radius.cardLarge,
    gap: 12,
  },
  compositeWrap: { alignItems: 'center' as const, justifyContent: 'center' as const },
  halo: {
    position: 'absolute' as const,
    left: -20,
    right: -20,
    top: 6,
    bottom: 6,
    borderRadius: 999,
    backgroundColor: t.accentSoft,
  },
  heroMain: { flex: 1, alignItems: 'center' as const },
  composite: {
    fontSize: getPixels(52),
    lineHeight: getPixels(58),
    fontWeight: '800' as const,
    fontVariant: ['tabular-nums' as const],
    letterSpacing: -1.5,
  },
  compositeLabel: {
    color: t.accent,
    fontSize: getPixels(12.5),
    fontWeight: '700' as const,
    marginTop: 2,
  },
  heroRanks: { gap: 14, alignItems: 'flex-end' as const, minWidth: 74 },
  rank: { alignItems: 'flex-end' as const },
  rankValue: {
    color: t.text,
    fontSize: getPixels(19),
    fontWeight: '800' as const,
    fontVariant: ['tabular-nums' as const],
  },
  rankLabel: { color: t.textDim, fontSize: getPixels(11) },

  card: { padding: 14, gap: 8 },
  cardHead: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 11 },
  cardHeadText: { flex: 1 },
  cardTitle: {
    color: t.text,
    fontSize: getPixels(17),
    fontWeight: '800' as const,
    letterSpacing: -0.3,
  },
  cardSub: { color: t.textDim, fontSize: getPixels(11.5), marginTop: 1 },
  cardScore: {
    fontSize: getPixels(26),
    fontWeight: '800' as const,
    fontVariant: ['tabular-nums' as const],
  },

  confRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 6 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  confText: { color: t.textDim, fontSize: getPixels(11), flex: 1 },
  shrinkNote: { color: t.textFaint, fontSize: getPixels(10.5), lineHeight: getPixels(15) },
  metrics: { marginTop: 2 },

  drillGrid: {
    flexDirection: 'row' as const,
    flexWrap: 'wrap' as const,
    rowGap: 6,
    columnGap: 16,
    marginTop: 2,
  },
  drill: { flexDirection: 'row' as const, gap: 5 },
  drillLabel: { color: t.textDim, fontSize: getPixels(13) },
  drillValue: {
    color: t.text,
    fontSize: getPixels(13),
    fontWeight: '700' as const,
    fontVariant: ['tabular-nums' as const],
  },
  drillEmpty: { color: t.textFaint, fontSize: getPixels(12.5) },

  error: { color: t.danger, fontSize: getPixels(13), lineHeight: getPixels(19) },
  loader: { paddingVertical: 24 },
});
