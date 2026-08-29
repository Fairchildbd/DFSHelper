import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { ScrollView } from 'react-native';
import { API_URL, fetchMatchupMeta, type MatchupMeta } from '../api';
import {
  AppBar,
  BottomSpacer,
  Card,
  Eyebrow,
  Icon,
  IconPuck,
  InlineNote,
  Loading,
  Meter,
  Mono,
  ErrorState,
  PageTitle,
  RoundButton,
  laneIcon,
  type IconName,
} from '../components/ui';
import { Trans, useTranslation } from '../i18n';
import { edgeColor, mismatchColor, shootoutColor } from '../matchupFormat';
import { getPixels, radius, useStyles, useTheme, type Theme } from '../theme';

export function AboutScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const styles = useStyles(sheet);
  const [meta, setMeta] = useState<MatchupMeta | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setMeta(await fetchMatchupMeta());
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (error) {
    return (
      <ErrorState
        message={error}
        hint={
          <Trans
            i18nKey="error.expectingServer"
            values={{ url: API_URL }}
            components={{ command: <Mono /> }}
          />
        }
        onRetry={load}
      />
    );
  }

  if (!meta) return <Loading />;

  const m = meta.model;
  const bar = m.edgeThreshold;

  const exampleEdges = [84, 78, 67, 64, 49].slice(0, m.topEdges);
  const exampleEdgeScore = Math.sqrt(
    exampleEdges.reduce((acc, e) => acc + e * e, 0) / exampleEdges.length,
  );

  const exampleTotal = 48.5;
  const examplePace = 72;
  const exampleStrongOffense = 74;
  const exampleWeakOffense = 58;
  const exampleDefense = 38;
  const exampleShootout =
    m.shootoutWeights.total *
      clamp(
        ((exampleTotal - m.shootoutTotalFloor) /
          (m.shootoutTotalCeiling - m.shootoutTotalFloor)) *
          100,
        0,
        100,
      ) +
    m.shootoutWeights.offense *
      (m.weakerOffenseWeight * exampleWeakOffense +
        (1 - m.weakerOffenseWeight) * exampleStrongOffense) +
    m.shootoutWeights.defense * (100 - exampleDefense) +
    m.shootoutWeights.pace * examplePace;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <AppBar right={<RoundButton name="fire" />} />
      <PageTitle title={t('about.title')} subtitle={t('about.subtitle')} style={styles.flush} />
      <Text style={styles.lede}>
        <Trans i18nKey="about.lede" components={{ em: <Text style={styles.em} /> }} />
      </Text>
      <Section
        icon="layers-triple-outline"
        title={t('about.lanes.title')}
        hint={t('about.lanes.hint')}
      >
        <Text style={styles.body}>
          <Trans
            i18nKey="about.lanes.body"
            values={{ lanes: meta.lanes.length, edges: meta.lanes.length * 2 }}
            components={{ em: <Text style={styles.em} /> }}
          />
        </Text>
        <View style={styles.laneList}>
          {meta.lanes.map((l, i) => (
            <View key={l.key} style={[styles.laneItem, i === 0 && styles.laneItemFirst]}>
              <Icon name={laneIcon(l.key)} size={17} color={theme.accent} />
              <Text style={styles.laneLabel}>{l.label}</Text>
            </View>
          ))}
        </View>
        <InlineNote>{t('about.lanes.note')}</InlineNote>
      </Section>
      <Section
        icon="scale-balance"
        title={t('about.laneEdge.title')}
        hint={t('about.laneEdge.hint')}
      >
        <Formula
          parts={[
            t('about.laneEdge.formulaUnit'),
            t('about.laneEdge.formulaSuppression'),
            t('about.laneEdge.formulaUsage'),
          ]}
          result={t('about.laneEdge.formulaResult')}
        />
        <Text style={styles.body}>{t('about.laneEdge.body')}</Text>
        <Text style={styles.body}>
          {t('about.laneEdge.coachTerm', { cap: m.maxUsageAdjustment })}
        </Text>
      </Section>
      <Section
        icon="plus-minus-variant"
        title={t('about.sign.title')}
        hint={t('about.sign.hint')}
      >
        <Text style={styles.body}>
          <Trans i18nKey="about.sign.body" components={{ em: <Text style={styles.em} /> }} />
        </Text>
        <View style={styles.signRow}>
          <SignCard
            tone="positive"
            mark={t('about.sign.positive')}
            icon="trending-up"
            text={
              <Trans
                i18nKey="about.sign.positiveBody"
                components={{ em: <Text style={styles.em} /> }}
              />
            }
          />
          <SignCard
            tone="negative"
            mark={t('about.sign.negative')}
            icon="trending-down"
            text={
              <Trans
                i18nKey="about.sign.negativeBody"
                components={{ em: <Text style={styles.em} /> }}
              />
            }
          />
        </View>
        <Text style={styles.warn}>{t('about.sign.warn', { bar })}</Text>
        <Text style={styles.body}>
          <Trans i18nKey="about.sign.trap" components={{ em: <Text style={styles.em} /> }} />
        </Text>
        <View style={styles.exampleBox}>
          <ExampleEdge
            label={t('about.example.runGame')}
            unit={81}
            defense={85}
            edge={-3}
            reading={t('about.example.runGameReading')}
          />
          <View style={styles.divider} />
          <ExampleEdge
            label={t('about.example.tightEnds')}
            unit={28}
            defense={88}
            edge={-60}
            reading={t('about.example.tightEndsReading')}
          />
        </View>
        <Text style={styles.bodyDim}>{t('about.sign.rowsNote')}</Text>
        <Eyebrow color={theme.textFaint}>{t('about.scale.head')}</Eyebrow>
        <View style={styles.scale}>
          <ScaleBand
            value={60}
            label={t('about.scale.highLabel', { bar })}
            note={t('about.scale.advantageOffense')}
          />
          <ScaleBand
            value={30}
            label={t('about.scale.leanOffenseLabel', { bar })}
            note={t('about.scale.leanOffense')}
          />
          <ScaleBand
            value={0}
            label={t('about.scale.evenLabel')}
            note={t('about.scale.even')}
          />
          <ScaleBand
            value={-30}
            label={t('about.scale.leanDefenseLabel', { bar })}
            note={t('about.scale.leanDefense')}
          />
          <ScaleBand
            value={-60}
            label={t('about.scale.lowLabel', { bar })}
            note={t('about.scale.advantageDefense')}
          />
        </View>
      </Section>
      <Section
        icon="trending-up"
        title={t('about.bar.title', { bar })}
        hint={t('about.bar.hint')}
      >
        <Text style={styles.body}>
          <Trans
            i18nKey="about.bar.body"
            values={{ bar, edges: meta.lanes.length * 2 }}
            components={{ em: <Text style={styles.em} /> }}
          />
        </Text>
        <Text style={styles.body}>{t('about.bar.percentile')}</Text>
        <InlineNote icon="alert-circle-outline">
          {t('about.bar.ungraded', { edges: meta.lanes.length * 2 })}
        </InlineNote>
      </Section>
      <Section
        icon="human-handsup"
        title={t('about.mismatch.title')}
        hint={t('about.mismatch.hint')}
      >
        <Text style={styles.body}>
          {t('about.mismatch.rms', {
            topEdges: m.topEdges,
            edges: meta.lanes.length * 2,
          })}
        </Text>
        <Text style={styles.body}>
          {t('about.mismatch.direction', {
            weight: Math.round(m.defenseEdgeWeight * 100),
          })}
        </Text>
        <Worked>
          <Text style={styles.workedLine}>
            <Trans
              i18nKey="about.worked.rms"
              values={{ edges: exampleEdges.join(', '), rms: exampleEdgeScore.toFixed(1) }}
              components={{ num: <Text style={styles.workedNum} /> }}
            />
          </Text>
          <Text style={styles.workedLine}>
            <Trans
              i18nKey="about.worked.defenseCounts"
              values={{ counted: (80 * m.defenseEdgeWeight).toFixed(0) }}
              components={{ num: <Text style={styles.workedNum} /> }}
            />
          </Text>
          <View style={styles.divider} />
          <Text style={styles.workedLine}>
            <Trans
              i18nKey="about.worked.mismatchTotal"
              values={{ score: exampleEdgeScore.toFixed(1) }}
              components={{
                total: (
                  <Text
                    style={[
                      styles.workedTotal,
                      { color: mismatchColor(theme, exampleEdgeScore) },
                    ]}
                  />
                ),
              }}
            />
          </Text>
        </Worked>
        <Text style={styles.bodyDim}>{t('about.mismatch.noScaling')}</Text>
      </Section>
      <Section
        icon="fire"
        title={t('about.shootout.title')}
        hint={t('about.shootout.hint')}
      >
        <Text style={styles.body}>{t('about.shootout.body')}</Text>
        <View style={styles.weights}>
          <WeightRow
            icon="cash-multiple"
            label={t('about.shootout.vegasTotal')}
            note={t('about.shootout.vegasTotalNote')}
            weight={m.shootoutWeights.total}
          />
          <WeightRow
            icon="account-multiple-outline"
            label={t('about.shootout.offenses')}
            note={t('about.shootout.offensesNote')}
            weight={m.shootoutWeights.offense}
          />
          <WeightRow
            icon="shield-outline"
            label={t('about.shootout.defenses')}
            note={t('about.shootout.defensesNote')}
            weight={m.shootoutWeights.defense}
          />
          <WeightRow
            icon="flash-outline"
            label={t('about.shootout.pace')}
            note={t('about.shootout.paceNote')}
            weight={m.shootoutWeights.pace}
          />
        </View>
        <Text style={styles.body}>
          {t('about.shootout.totalLeads', {
            floor: m.shootoutTotalFloor,
            ceiling: m.shootoutTotalCeiling,
            weakerWeight: Math.round(m.weakerOffenseWeight * 100),
          })}
        </Text>
        <Worked>
          <Text style={styles.workedLine}>
            {t('about.worked.shootoutInputs', {
              total: exampleTotal,
              strong: exampleStrongOffense,
              weak: exampleWeakOffense,
              defense: exampleDefense,
              pace: examplePace,
            })}
          </Text>
          <View style={styles.divider} />
          <Text style={styles.workedLine}>
            <Trans
              i18nKey="about.worked.shootoutTotal"
              values={{ score: exampleShootout.toFixed(1) }}
              components={{
                total: (
                  <Text
                    style={[
                      styles.workedTotal,
                      { color: shootoutColor(theme, exampleShootout) },
                    ]}
                  />
                ),
              }}
            />
          </Text>
        </Worked>
        <Text style={styles.body}>
          <Trans
            i18nKey="about.shootout.sections"
            values={{ floor: m.liveGameFloor, tolerance: m.leanTolerance }}
            components={{ em: <Text style={styles.em} /> }}
          />
        </Text>
        <InlineNote>{t('about.shootout.noTotal')}</InlineNote>
      </Section>
      <Section
        icon="account-star-outline"
        title={t('about.playerScore.title')}
        hint={t('about.playerScore.hint')}
      >
        <Text style={styles.body}>{t('about.playerScore.body')}</Text>
        <View style={styles.weights}>
          <WeightRow
            icon="target"
            label={t('about.playerScore.matchupEdge')}
            note={t('about.playerScore.matchupEdgeNote')}
            weight={m.factorWeights.lane_edge}
          />
          <WeightRow
            icon="crown-outline"
            label={t('about.playerScore.quality')}
            note={t('about.playerScore.qualityNote')}
            weight={m.factorWeights.composite}
          />
          <WeightRow
            icon="chart-bar"
            label={t('about.playerScore.volume')}
            note={t('about.playerScore.volumeNote')}
            weight={m.factorWeights.volume}
          />
        </View>
        <Text style={styles.body}>{t('about.playerScore.laneLeads')}</Text>
        <InlineNote>{t('about.playerScore.missingFactor')}</InlineNote>
      </Section>
      <Section
        icon="alert-circle-outline"
        title={t('about.caveats.title')}
        hint={t('about.caveats.hint')}
      >
        <Bullet>
          <Trans
            i18nKey="about.caveats.ordinal"
            components={{ em: <Text style={styles.em} /> }}
          />
        </Bullet>
        <Bullet>{t('about.caveats.withinSlate')}</Bullet>
        <Bullet>
          {t('about.caveats.edgeCount', {
            topEdges: m.topEdges,
            nextEdge: m.topEdges + 1,
          })}
        </Bullet>
        <Bullet>{t('about.caveats.coachKeyed')}</Bullet>
        <Bullet>{t('about.caveats.frozen')}</Bullet>
      </Section>
      <BottomSpacer extra={12} />
    </ScrollView>
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function Section({
  icon,
  title,
  hint,
  children,
}: {
  icon: IconName;
  title: string;
  hint: string;
  children: React.ReactNode;
}) {
  const styles = useStyles(sheet);
  return (
    <Card wash rail style={styles.section}>
      <View style={styles.sectionHead}>
        <IconPuck name={icon} />
        <View style={styles.sectionHeadText}>
          <Text style={styles.sectionTitle}>{title}</Text>
          <Text style={styles.sectionHint}>{hint}</Text>
        </View>
      </View>
      {children}
    </Card>
  );
}

function Formula({ parts, result }: { parts: string[]; result: string }) {
  const styles = useStyles(sheet);
  return (
    <View style={styles.formula}>
      {parts.map((p) => (
        <View key={p} style={styles.formulaPill}>
          <Text style={styles.formulaPart}>{p}</Text>
        </View>
      ))}
      <Text style={styles.formulaEq}>=</Text>
      <View style={styles.formulaResultPill}>
        <Text style={styles.formulaResult}>{result}</Text>
      </View>
    </View>
  );
}

function Worked({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const styles = useStyles(sheet);
  return (
    <View style={styles.workedBox}>
      <Eyebrow color={theme.accent}>{t('about.worked.head')}</Eyebrow>
      {children}
    </View>
  );
}

function SignCard({
  tone,
  mark,
  icon,
  text,
}: {
  tone: 'positive' | 'negative';
  mark: string;
  icon: IconName;
  text: React.ReactNode;
}) {
  const theme = useTheme();
  const styles = useStyles(sheet);
  const color = tone === 'positive' ? theme.great : theme.bad;

  return (
    <View style={[styles.signCard, { borderColor: color }]}>
      <Text style={[styles.signMark, { color }]}>{mark.toUpperCase()}</Text>
      <Text style={styles.signText}>{text}</Text>
      <Icon name={icon} size={22} color={color} style={styles.signIcon} />
    </View>
  );
}

function ExampleEdge({
  label,
  unit,
  defense,
  edge,
  reading,
}: {
  label: string;
  unit: number;
  defense: number;
  edge: number;
  reading: string;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const styles = useStyles(sheet);

  return (
    <View style={styles.example}>
      <View style={styles.exampleRow}>
        <View style={styles.exampleMain}>
          <Text style={styles.exampleLabel}>{label}</Text>
          <Text style={styles.exampleSub}>
            {t('about.example.unitVsDefense', { unit, defense })}
          </Text>
        </View>
        <Text style={[styles.exampleValue, { color: edgeColor(theme, edge) }]}>
          {edge > 0 ? '+' : ''}
          {edge}
        </Text>
      </View>
      <Text style={styles.exampleReading}>{reading}</Text>
    </View>
  );
}

function ScaleBand({ value, label, note }: { value: number; label: string; note: string }) {
  const theme = useTheme();
  const styles = useStyles(sheet);
  return (
    <View style={styles.band}>
      <View style={[styles.bandSwatch, { backgroundColor: edgeColor(theme, value) }]} />
      <Text style={styles.bandLabel}>{label}</Text>
      <Text style={styles.bandNote}>{note}</Text>
    </View>
  );
}

function WeightRow({
  icon,
  label,
  note,
  weight,
}: {
  icon: IconName;
  label: string;
  note: string;
  weight: number;
}) {
  const { t } = useTranslation();
  const styles = useStyles(sheet);
  return (
    <View style={styles.weightRow}>
      <IconPuck name={icon} size="sm" />
      <View style={styles.weightMain}>
        <Text style={styles.weightLabel}>{label}</Text>
        <Text style={styles.weightNote} numberOfLines={2}>
          {note}
        </Text>
        <Meter percent={weight * 100} style={styles.weightMeter} />
      </View>
      <Text style={styles.weightValue}>
        {t('about.weightPercent', { weight: Math.round(weight * 100) })}
      </Text>
    </View>
  );
}

function Bullet({ children }: { children: React.ReactNode }) {
  const theme = useTheme();
  const styles = useStyles(sheet);
  return (
    <View style={styles.bullet}>
      <Icon name="circle-medium" size={16} color={theme.accent} style={styles.bulletDot} />
      <Text style={styles.bulletText}>{children}</Text>
    </View>
  );
}

const sheet = (theme: Theme) => ({
  screen: { flex: 1, backgroundColor: theme.bg },
  content: { paddingHorizontal: 16, paddingBottom: 8, gap: 14 },
  flush: { paddingHorizontal: 0 },

  lede: {
    color: theme.text,
    fontSize: getPixels(15),
    lineHeight: getPixels(23),
  },
  em: { color: theme.accent, fontWeight: '700' as const },

  section: { padding: 14, gap: 10 },
  sectionHead: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 11 },
  sectionHeadText: { flex: 1 },
  sectionTitle: {
    color: theme.text,
    fontSize: getPixels(18),
    fontWeight: '800' as const,
    letterSpacing: -0.3,
  },
  sectionHint: { color: theme.accent, fontSize: getPixels(11.5), marginTop: 1 },

  body: { color: theme.text, fontSize: getPixels(13), lineHeight: getPixels(19.5) },
  bodyDim: { color: theme.textDim, fontSize: getPixels(12), lineHeight: getPixels(18) },
  warn: {
    color: theme.warn,
    fontSize: getPixels(12.5),
    lineHeight: getPixels(18.5),
    fontWeight: '600' as const,
  },

  laneList: { marginTop: 2 },
  laneItem: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 11,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.border,
  },
  laneItemFirst: { borderTopWidth: 0 },
  laneLabel: { color: theme.text, fontSize: getPixels(13.5), flex: 1 },

  formula: {
    flexDirection: 'row' as const,
    flexWrap: 'wrap' as const,
    alignItems: 'center' as const,
    gap: 7,
  },
  formulaPill: {
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: 9,
    backgroundColor: theme.surfaceAlt,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
  },
  formulaPart: { color: theme.textDim, fontSize: getPixels(12) },
  formulaEq: { color: theme.textFaint, fontSize: getPixels(13), fontWeight: '700' as const },
  formulaResultPill: {
    paddingHorizontal: 13,
    paddingVertical: 7,
    borderRadius: 9,
    backgroundColor: theme.accent,
  },
  formulaResult: { color: theme.onAccent, fontSize: getPixels(12), fontWeight: '800' as const },

  signRow: { flexDirection: 'row' as const, gap: 10 },
  signCard: {
    flex: 1,
    padding: 12,
    borderRadius: radius.puck,
    borderWidth: StyleSheet.hairlineWidth,
    backgroundColor: theme.surfaceAlt,
    gap: 6,
  },
  signMark: { fontSize: getPixels(11), fontWeight: '800' as const, letterSpacing: 0.8 },
  signText: { color: theme.text, fontSize: getPixels(12), lineHeight: getPixels(17.5) },
  signIcon: { alignSelf: 'flex-end' as const },

  exampleBox: {
    borderRadius: radius.puck,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
    backgroundColor: theme.surfaceAlt,
    padding: 12,
  },
  example: { gap: 5 },
  exampleRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 10 },
  exampleMain: { flex: 1 },
  exampleLabel: { color: theme.text, fontSize: getPixels(13), fontWeight: '700' as const },
  exampleSub: { color: theme.textFaint, fontSize: getPixels(11), marginTop: 1 },
  exampleValue: {
    fontSize: getPixels(19),
    fontWeight: '800' as const,
    fontVariant: ['tabular-nums' as const],
  },
  exampleReading: { color: theme.textDim, fontSize: getPixels(11.5), lineHeight: getPixels(17) },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: theme.border,
    marginVertical: 10,
  },

  scale: { gap: 8, marginTop: 2 },
  band: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 11 },
  bandSwatch: { width: 26, height: 7, borderRadius: 4 },
  bandLabel: {
    color: theme.text,
    fontSize: getPixels(12.5),
    fontWeight: '700' as const,
    width: 110,
  },
  bandNote: { color: theme.textDim, fontSize: getPixels(12), flex: 1 },

  weights: { gap: 12, marginTop: 2 },
  weightRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 11 },
  weightMain: { flex: 1, gap: 2 },
  weightLabel: { color: theme.text, fontSize: getPixels(13), fontWeight: '700' as const },
  weightNote: { color: theme.textDim, fontSize: getPixels(11), lineHeight: getPixels(15) },
  weightMeter: { marginTop: 4 },
  weightValue: {
    color: theme.text,
    fontSize: getPixels(14),
    fontWeight: '800' as const,
    fontVariant: ['tabular-nums' as const],
    minWidth: 38,
    textAlign: 'right' as const,
  },

  workedBox: {
    borderRadius: radius.puck,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.accent,
    backgroundColor: theme.accentWash,
    padding: 12,
    gap: 6,
  },
  workedLine: { color: theme.text, fontSize: getPixels(12.5), lineHeight: getPixels(18) },
  workedNum: { color: theme.text, fontWeight: '800' as const },
  workedTotal: { fontSize: getPixels(20), fontWeight: '800' as const },

  bullet: { flexDirection: 'row' as const, gap: 6, paddingVertical: 4 },
  bulletDot: { marginTop: 1 },
  bulletText: {
    flex: 1,
    color: theme.text,
    fontSize: getPixels(12.5),
    lineHeight: getPixels(18.5),
  },
});
