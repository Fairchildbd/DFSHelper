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
import { t as translate, useTranslation, type MessageKey } from '../i18n';
import {
  confidenceLabel,
  getPixels,
  radius,
  scoreColor,
  useStyles,
  useTheme,
  type Theme,
} from '../theme';

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
  const theme = useTheme();
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
            view.team ?? t('player.freeAgentLong'),
            view.age != null ? t('player.ageYears', { age: Number(view.age).toFixed(1) }) : null,
            view.years_experience != null
              ? t('player.seasons', { count: view.years_experience })
              : null,
          ]
            .filter(Boolean)
            .join(t('player.metaSeparator'))}
        </Text>
      </View>
      <Card outlined style={styles.hero}>
        <CardWash />
        <View style={styles.heroMain}>
          <View style={styles.compositeWrap}>
            <View style={[styles.halo, glowStyle(theme, 1.6)]} pointerEvents="none" />
            <Text style={[styles.composite, { color: scoreColor(theme, composite) }]}>
              {composite == null ? NO_VALUE : composite.toFixed(1)}
            </Text>
          </View>
          <Text style={styles.compositeLabel}>{t('player.composite')}</Text>
        </View>
        <View style={styles.heroRanks}>
          <Rank
            label={t('player.positionRank', { position: view.position })}
            value={view.position_rank}
          />
          <Rank label={t('player.overallRank')} value={view.overall_rank} />
        </View>
      </Card>
      <ScoreSplitBar weights={weightsOf(view)} inline />
      {error && <Text style={styles.error}>{error}</Text>}
      {!detail && !error && <ActivityIndicator style={styles.loader} color={theme.accent} />}

      {detail && (
        <>
          {detail.detail.noRecentProduction && (
            <InlineNote icon="alert-circle-outline">{t('player.noRecentProduction')}</InlineNote>
          )}

          {detail.detail.lowSignalMeasurables && (
            <InlineNote>{t('player.lowSignalMeasurables')}</InlineNote>
          )}

          <ComponentCard
            icon="run-fast"
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
            <ComponentCard
              icon="school-outline"
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
            <InlineNote>{t('player.lowSignalProduction')}</InlineNote>
          )}

          <ComponentCard
            icon="chart-bar"
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
            <Card wash rail style={styles.card}>
              <View style={styles.cardHead}>
                <IconPuck name="dumbbell" />
                <View style={styles.cardHeadText}>
                  <Text style={styles.cardTitle}>{t('player.rawWorkout')}</Text>
                  {detail.measurables[0] && (
                    <Text style={styles.cardSub} numberOfLines={1}>
                      {[
                        `${detail.measurables[0].source} ${detail.measurables[0].season ?? ''}`.trim(),
                        detail.measurables[0].school,
                      ]
                        .filter(Boolean)
                        .join(t('player.metaSeparator'))}
                    </Text>
                  )}
                </View>
              </View>
              {detail.measurables.map((m, i) => {
                const inches = t('drill.unit.inches');
                const drills = [
                  m.forty && { drill: 'forty', value: `${m.forty}` },
                  m.bench != null && { drill: 'bench', value: `${m.bench}` },
                  m.vertical && { drill: 'vertical', value: `${m.vertical}${inches}` },
                  m.broad != null && { drill: 'broad', value: `${m.broad}${inches}` },
                  m.cone && { drill: 'cone', value: `${m.cone}` },
                  m.shuttle && { drill: 'shuttle', value: `${m.shuttle}` },
                ].filter(Boolean) as Array<{ drill: string; value: string }>;

                return (
                  <View key={i} style={styles.drillGrid}>
                    {drills.length === 0 ? (
                      <Text style={styles.drillEmpty}>{t('player.noDrills')}</Text>
                    ) : (
                      drills.map(({ drill, value }) => (
                        <View key={drill} style={styles.drill}>
                          <Text style={styles.drillLabel}>{drillLabel(drill)}:</Text>
                          <Text style={styles.drillValue}>{value}</Text>
                        </View>
                      ))
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
  const { t } = useTranslation();
  const theme = useTheme();
  const styles = useStyles(sheet);
  const conf = confidenceLabel(theme, confidence);

  return (
    <Card wash rail style={styles.card}>
      <View style={styles.cardHead}>
        <IconPuck name={icon} />
        <View style={styles.cardHeadText}>
          <Text style={styles.cardTitle}>{title}</Text>
          <Text style={styles.cardSub}>{subtitle}</Text>
        </View>
        <Text style={[styles.cardScore, { color: scoreColor(theme, score) }]}>
          {score == null ? NO_VALUE : score.toFixed(0)}
        </Text>
      </View>
      <View style={styles.confRow}>
        <View style={[styles.dot, { backgroundColor: conf.color }]} />
        <Text style={styles.confText} numberOfLines={1}>
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

      <View style={styles.metrics}>
        {metrics.map((m) => (
          <StatRow
            key={m.metric}
            label={m.label}
            weight={t('player.metricWeight', { weight: Math.round(m.weight * 100) })}
            value={
              m.percentile != null
                ? t('player.metricRaw', {
                    value: formatRaw(m.raw, m.metric),
                    unit: units[m.metric] ?? '',
                  })
                : t('player.notRecorded')
            }
            percent={m.percentile}
            note={
              m.percentile != null
                ? t('player.percentile', { percentile: m.percentile.toFixed(0) })
                : NO_VALUE
            }
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

function drillLabel(drill: string): string {
  return translate(`drill.label.${drill}` as MessageKey);
}

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
  const styles = useStyles(sheet);
  return (
    <View style={styles.rank}>
      <Text style={styles.rankValue}>
        {value == null ? NO_VALUE : t('player.rankValue', { value })}
      </Text>
      <Text style={styles.rankLabel}>{label}</Text>
    </View>
  );
}

const sheet = (theme: Theme) => ({
  screen: { flex: 1, backgroundColor: theme.bg },
  content: { paddingHorizontal: 16, paddingBottom: 8, gap: 12 },

  identity: { paddingTop: 2, gap: 3 },
  name: {
    color: theme.text,
    fontSize: getPixels(34),
    lineHeight: getPixels(39),
    fontWeight: '800' as const,
    letterSpacing: -1,
  },
  meta: { color: theme.textDim, fontSize: getPixels(13.5) },

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
    backgroundColor: theme.accentSoft,
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
    color: theme.accent,
    fontSize: getPixels(12.5),
    fontWeight: '700' as const,
    marginTop: 2,
  },
  heroRanks: { gap: 14, alignItems: 'flex-end' as const, minWidth: 74 },
  rank: { alignItems: 'flex-end' as const },
  rankValue: {
    color: theme.text,
    fontSize: getPixels(19),
    fontWeight: '800' as const,
    fontVariant: ['tabular-nums' as const],
  },
  rankLabel: { color: theme.textDim, fontSize: getPixels(11) },

  card: { padding: 14, gap: 8 },
  cardHead: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 11 },
  cardHeadText: { flex: 1 },
  cardTitle: {
    color: theme.text,
    fontSize: getPixels(17),
    fontWeight: '800' as const,
    letterSpacing: -0.3,
  },
  cardSub: { color: theme.textDim, fontSize: getPixels(11.5), marginTop: 1 },
  cardScore: {
    fontSize: getPixels(26),
    fontWeight: '800' as const,
    fontVariant: ['tabular-nums' as const],
  },

  confRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 6 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  confText: { color: theme.textDim, fontSize: getPixels(11), flex: 1 },
  shrinkNote: { color: theme.textFaint, fontSize: getPixels(10.5), lineHeight: getPixels(15) },
  metrics: { marginTop: 2 },

  drillGrid: {
    flexDirection: 'row' as const,
    flexWrap: 'wrap' as const,
    rowGap: 6,
    columnGap: 16,
    marginTop: 2,
  },
  drill: { flexDirection: 'row' as const, gap: 5 },
  drillLabel: { color: theme.textDim, fontSize: getPixels(13) },
  drillValue: {
    color: theme.text,
    fontSize: getPixels(13),
    fontWeight: '700' as const,
    fontVariant: ['tabular-nums' as const],
  },
  drillEmpty: { color: theme.textFaint, fontSize: getPixels(12.5) },

  error: { color: theme.danger, fontSize: getPixels(13), lineHeight: getPixels(19) },
  loader: { paddingVertical: 24 },
});
