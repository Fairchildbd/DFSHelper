import { useEffect, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  fetchPlayer,
  weightsOf,
  type MetricDetail,
  type PlayerDetail,
  type RankedPlayer,
} from '../api';
import { ScoreSplitBar } from '../components/ScoreSplitBar';
import { t as translate, useTranslation, type MessageKey } from '../i18n';
import { confidenceLabel, getPixels, scoreColor, theme } from '../theme';

const DRILL_UNIT_KEYS: Record<string, MessageKey> = {
  forty: 'drill.unit.seconds',
  cone: 'drill.unit.seconds',
  shuttle: 'drill.unit.seconds',
  bench: 'drill.unit.reps',
  vertical: 'drill.unit.inches',
  broad: 'drill.unit.inches',
};

function drillUnits(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(DRILL_UNIT_KEYS).map(([drill, key]) => [drill, translate(key)]),
  );
}

const NO_VALUE = '—';

export type PlayerRef = Pick<RankedPlayer, 'gsis_id' | 'display_name' | 'position'> &
  Partial<RankedPlayer>;

export function PlayerDetailScreen({
  player,
  onBack,
  backLabel = translate('app.back.rankings'),
}: {
  player: PlayerRef;
  onBack: () => void;
  backLabel?: string;
}) {
  const { t } = useTranslation();
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

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Pressable onPress={onBack} style={styles.back} hitSlop={12}>
        <Text style={styles.backText}>‹ {backLabel}</Text>
      </Pressable>

      <Text style={styles.name}>{view.display_name}</Text>
      <Text style={styles.meta}>
        {[
          view.position,
          view.team ?? t('player.freeAgentLong'),
          view.age != null ? t('player.ageYears', { age: Number(view.age).toFixed(1) }) : null,
          view.years_experience != null
            ? t('player.seasons', { count: view.years_experience })
            : null,
        ]
          .filter(Boolean)
          .join(t('player.metaSeparator'))}
      </Text>

      <View style={styles.scoreCard}>
        <View style={styles.scoreMain}>
          <Text
            style={[
              styles.composite,
              { color: scoreColor(view.composite == null ? null : Number(view.composite)) },
            ]}
          >
            {view.composite == null ? NO_VALUE : Number(view.composite).toFixed(1)}
          </Text>
          <Text style={styles.compositeLabel}>{t('player.composite')}</Text>
        </View>
        <View style={styles.scoreRanks}>
          <Rank
            label={t('player.positionRank', { position: view.position })}
            value={view.position_rank}
          />
          <Rank label={t('player.overallRank')} value={view.overall_rank} />
        </View>
      </View>

      <ScoreSplitBar weights={weightsOf(view)} />

      {error && <Text style={styles.error}>{error}</Text>}
      {!detail && !error && <ActivityIndicator style={styles.loader} color={theme.accent} />}

      {detail && (
        <>
          {detail.detail.noRecentProduction && (
            <Note tone="warn">{t('player.noRecentProduction')}</Note>
          )}

          {detail.detail.lowSignalMeasurables && (
            <Note>{t('player.lowSignalMeasurables')}</Note>
          )}

          <Component
            title={t('player.athleticTitle')}
            subtitle={t('player.athleticSubtitle')}
            score={detail.detail.athletic.score}
            weight={Number(view.weight_athletic ?? 0)}
            confidence={detail.detail.athletic.confidence}
            metrics={detail.detail.athletic.metrics}
            units={drillUnits()}
            color={theme.athletic}
          />

          {detail.detail.college.score != null && (
            <Component
              title={t('player.collegeTitle')}
              subtitle={t('player.collegeSubtitle')}
              score={detail.detail.college.score}
              weight={Number(view.weight_college ?? 0)}
              confidence={detail.detail.college.confidence}
              metrics={detail.detail.college.metrics}
              units={{}}
              color={theme.college}
            />
          )}

          {detail.detail.lowSignalProduction && (
            <Note>{t('player.lowSignalProduction')}</Note>
          )}

          <Component
            title={t('player.productionTitle')}
            subtitle={t('player.productionSubtitle')}
            score={detail.detail.production.score}
            weight={Number(view.weight_nfl ?? 0)}
            confidence={detail.detail.production.confidence}
            metrics={detail.detail.production.metrics}
            units={{}}
            color={theme.production}
          />

          {detail.measurables.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>{t('player.rawWorkout')}</Text>
              {detail.measurables.map((m, i) => (
                <View key={i} style={styles.rawRow}>
                  <Text style={styles.rawSource}>
                    {m.source} {m.season ?? ''}{' '}
                    {m.school ? t('player.rawSchool', { school: m.school }) : ''}
                  </Text>
                  <Text style={styles.rawValues}>
                    {[
                      m.forty && t('drill.forty', { value: m.forty }),
                      m.bench != null && t('drill.bench', { value: m.bench }),
                      m.vertical && t('drill.vertical', { value: m.vertical }),
                      m.broad != null && t('drill.broad', { value: m.broad }),
                      m.cone && t('drill.cone', { value: m.cone }),
                      m.shuttle && t('drill.shuttle', { value: m.shuttle }),
                    ]
                      .filter(Boolean)
                      .join('   ') || t('player.noDrills')}
                  </Text>
                </View>
              ))}
            </View>
          )}
        </>
      )}
    </ScrollView>
  );
}

function Component({
  title,
  subtitle,
  score,
  weight,
  confidence,
  metrics,
  units,
  color,
}: {
  title: string;
  subtitle: string;
  score: number | null;
  weight: number;
  confidence: number;
  metrics: MetricDetail[];
  units: Record<string, string>;
  color: string;
}) {
  const { t } = useTranslation();
  const conf = confidenceLabel(confidence);

  return (
    <View style={styles.section}>
      <View style={styles.sectionHead}>
        <View style={{ flex: 1 }}>
          <Text style={styles.sectionTitle}>{title}</Text>
          <Text style={styles.sectionSub}>{subtitle}</Text>
        </View>
        <Text style={[styles.sectionScore, { color: scoreColor(score) }]}>
          {score == null ? NO_VALUE : score.toFixed(0)}
        </Text>
      </View>

      <View style={styles.confRow}>
        <View style={[styles.dot, { backgroundColor: conf.color }]} />
        <Text style={styles.confText}>
          {t('player.confidenceLine', {
            label: conf.label,
            recorded: Math.round(confidence * 100),
            weight: Math.round(weight * 100),
          })}
        </Text>
      </View>

      {confidence < 1 && confidence > 0 && (
        <Text style={styles.shrinkNote}>
          {t('player.shrinkNote', { unmeasured: Math.round((1 - confidence) * 100) })}
        </Text>
      )}

      {metrics.map((m) => (
        <MetricBar key={m.metric} metric={m} unit={units[m.metric] ?? ''} color={color} />
      ))}
    </View>
  );
}

function MetricBar({
  metric,
  unit,
  color,
}: {
  metric: MetricDetail;
  unit: string;
  color: string;
}) {
  const { t } = useTranslation();
  const measured = metric.percentile != null;
  return (
    <View style={styles.metric}>
      <View style={styles.metricHead}>
        <Text style={[styles.metricLabel, !measured && styles.metricLabelDim]}>
          {metric.label}
        </Text>
        <Text style={styles.metricWeight}>
          {t('player.metricWeight', { weight: Math.round(metric.weight * 100) })}
        </Text>
        <Text style={[styles.metricRaw, !measured && styles.metricLabelDim]}>
          {measured
            ? t('player.metricRaw', {
                value: formatRaw(metric.raw, metric.metric),
                unit,
              })
            : t('player.notRecorded')}
        </Text>
      </View>
      <View style={styles.metricTrack}>
        {metric.percentile != null && (
          <View
            style={[
              styles.metricFill,
              { width: `${metric.percentile}%` as const, backgroundColor: color },
            ]}
          />
        )}
      </View>
      <Text style={styles.metricPct}>
        {metric.percentile != null
          ? t('player.percentile', { percentile: metric.percentile.toFixed(0) })
          : NO_VALUE}
      </Text>
    </View>
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
  if (raw == null) return NO_VALUE;
  const value = Number(raw);
  if (PROPORTION_METRICS.has(metric)) {
    return translate('tendency.percent', { value: (value * 100).toFixed(1) });
  }
  if (metric.includes('_per_')) return value.toFixed(3);
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function Rank({ label, value }: { label: string; value: number | null | undefined }) {
  const { t } = useTranslation();

  return (
    <View style={styles.rank}>
      <Text style={styles.rankValue}>
        {value == null ? NO_VALUE : t('player.rankValue', { value })}
      </Text>
      <Text style={styles.rankLabel}>{label}</Text>
    </View>
  );
}

function Note({ children, tone = 'info' }: { children: ReactNode; tone?: 'info' | 'warn' }) {
  return (
    <View style={[styles.note, tone === 'warn' && styles.noteWarn]}>
      <Text style={styles.noteText}>{children}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.bg },
  content: { padding: 16, paddingBottom: 48, gap: 12 },
  back: { paddingVertical: 4 },
  backText: { color: theme.accent, fontSize: getPixels(16), fontWeight: '600' },
  name: { color: theme.text, fontSize: getPixels(28), fontWeight: '800', letterSpacing: -0.5 },
  meta: { color: theme.textDim, fontSize: getPixels(13), marginTop: -6 },
  scoreCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.surface,
    borderRadius: 14,
    padding: 18,
    borderWidth: 1,
    borderColor: theme.border,
  },
  scoreMain: { flex: 1 },
  composite: { fontSize: getPixels(46), fontWeight: '800', fontVariant: ['tabular-nums'] },
  compositeLabel: { color: theme.textDim, fontSize: getPixels(12), fontWeight: '600' },
  scoreRanks: { gap: 12 },
  rank: { alignItems: 'flex-end' },
  rankValue: { color: theme.text, fontSize: getPixels(18), fontWeight: '700' },
  rankLabel: { color: theme.textFaint, fontSize: getPixels(11) },
  section: {
    backgroundColor: theme.surface,
    borderRadius: 14,
    padding: 16,
    gap: 10,
    borderWidth: 1,
    borderColor: theme.border,
  },
  sectionHead: { flexDirection: 'row', alignItems: 'center' },
  sectionTitle: { color: theme.text, fontSize: getPixels(17), fontWeight: '700' },
  sectionSub: { color: theme.textFaint, fontSize: getPixels(12) },
  sectionScore: { fontSize: getPixels(28), fontWeight: '800', fontVariant: ['tabular-nums'] },
  confRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  confText: { color: theme.textDim, fontSize: getPixels(12) },
  shrinkNote: {
    color: theme.warn,
    fontSize: getPixels(12),
    lineHeight: getPixels(17),
    backgroundColor: 'rgba(251,191,36,0.08)',
    padding: 10,
    borderRadius: 8,
  },
  metric: { gap: 3, marginTop: 4 },
  metricHead: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  metricLabel: { color: theme.text, fontSize: getPixels(13), fontWeight: '600', flex: 1 },
  metricLabelDim: { color: theme.textFaint, fontWeight: '400' },
  metricWeight: { color: theme.textFaint, fontSize: getPixels(11) },
  metricRaw: { color: theme.textDim, fontSize: getPixels(12), width: 78, textAlign: 'right' },
  metricTrack: { height: 5, borderRadius: 3, backgroundColor: theme.surfaceAlt, overflow: 'hidden' },
  metricFill: { height: '100%', borderRadius: 3 },
  metricPct: { color: theme.textFaint, fontSize: getPixels(11) },
  note: {
    backgroundColor: 'rgba(77,163,255,0.08)',
    borderLeftWidth: 3,
    borderLeftColor: theme.accent,
    padding: 12,
    borderRadius: 8,
  },
  noteWarn: {
    backgroundColor: 'rgba(251,191,36,0.08)',
    borderLeftColor: theme.warn,
  },
  noteText: { color: theme.textDim, fontSize: getPixels(12.5), lineHeight: getPixels(18) },
  rawRow: { gap: 2 },
  rawSource: { color: theme.textFaint, fontSize: getPixels(11), textTransform: 'capitalize' },
  rawValues: { color: theme.text, fontSize: getPixels(13), fontVariant: ['tabular-nums'] },
  loader: { paddingVertical: 32 },
  error: { color: theme.danger, fontSize: getPixels(13) },
});
