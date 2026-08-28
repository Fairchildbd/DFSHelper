import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { API_URL, fetchMatchupMeta, type MatchupMeta } from '../api';
import { Trans, useTranslation } from '../i18n';
import { edgeColor, mismatchColor, shootoutColor } from '../matchupFormat';
import { getPixels, theme } from '../theme';

export function AboutScreen() {
  const { t } = useTranslation();
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
      <View style={styles.center}>
        <Text style={styles.errorTitle}>{t('error.unreachableTitle')}</Text>
        <Text style={styles.errorBody}>{error}</Text>
        <Text style={styles.errorHint}>
          <Trans
            i18nKey="error.expectingServer"
            values={{ url: API_URL }}
            components={{ command: <Text style={styles.mono} /> }}
          />
        </Text>
      </View>
    );
  }

  if (!meta) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={theme.accent} />
      </View>
    );
  }

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
      <View style={styles.header}>
        <Text style={styles.title}>{t('about.title')}</Text>
        <Text style={styles.subtitle}>{t('about.subtitle')}</Text>
      </View>

      <Text style={styles.lede}>
        <Trans i18nKey="about.lede" components={{ em: <Text style={styles.em} /> }} />
      </Text>


      <Section title={t('about.lanes.title')} hint={t('about.lanes.hint')}>
        <Text style={styles.body}>
          <Trans
            i18nKey="about.lanes.body"
            values={{ lanes: meta.lanes.length, edges: meta.lanes.length * 2 }}
            components={{ em: <Text style={styles.em} /> }}
          />
        </Text>
        <View style={styles.laneList}>
          {meta.lanes.map((l) => (
            <View key={l.key} style={styles.laneItem}>
              <Text style={styles.laneDot}>·</Text>
              <Text style={styles.laneLabel}>{l.label}</Text>
            </View>
          ))}
        </View>
        <Text style={styles.bodyDim}>{t('about.lanes.note')}</Text>
      </Section>


      <Section title={t('about.laneEdge.title')} hint={t('about.laneEdge.hint')}>
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


      <Section title={t('about.sign.title')} hint={t('about.sign.hint')}>
        <Text style={styles.body}>
          <Trans i18nKey="about.sign.body" components={{ em: <Text style={styles.em} /> }} />
        </Text>

        <View style={styles.signRow}>
          <View style={[styles.signCard, { borderLeftColor: edgeColor(60) }]}>
            <Text style={[styles.signMark, { color: edgeColor(60) }]}>
              {t('about.sign.positive')}
            </Text>
            <Text style={styles.signText}>
              <Trans
                i18nKey="about.sign.positiveBody"
                components={{ em: <Text style={styles.em} /> }}
              />
            </Text>
          </View>
          <View style={[styles.signCard, { borderLeftColor: edgeColor(-60) }]}>
            <Text style={[styles.signMark, { color: edgeColor(-60) }]}>
              {t('about.sign.negative')}
            </Text>
            <Text style={styles.signText}>
              <Trans
                i18nKey="about.sign.negativeBody"
                components={{ em: <Text style={styles.em} /> }}
              />
            </Text>
          </View>
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

        <Text style={styles.scaleHead}>{t('about.scale.head')}</Text>
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


      <Section title={t('about.bar.title', { bar })} hint={t('about.bar.hint')}>
        <Text style={styles.body}>
          <Trans
            i18nKey="about.bar.body"
            values={{ bar, edges: meta.lanes.length * 2 }}
            components={{ em: <Text style={styles.em} /> }}
          />
        </Text>
        <Text style={styles.body}>{t('about.bar.percentile')}</Text>
        <Text style={styles.bodyDim}>
          {t('about.bar.ungraded', { edges: meta.lanes.length * 2 })}
        </Text>
      </Section>


      <Section title={t('about.mismatch.title')} hint={t('about.mismatch.hint')}>
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

        <View style={styles.workedBox}>
          <Text style={styles.workedHead}>{t('about.worked.head')}</Text>
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
                    style={[styles.workedTotal, { color: mismatchColor(exampleEdgeScore) }]}
                  />
                ),
              }}
            />
          </Text>
        </View>

        <Text style={styles.bodyDim}>{t('about.mismatch.noScaling')}</Text>
      </Section>


      <Section title={t('about.shootout.title')} hint={t('about.shootout.hint')}>
        <Text style={styles.body}>{t('about.shootout.body')}</Text>

        <View style={styles.weights}>
          <WeightRow
            label={t('about.shootout.vegasTotal')}
            note={t('about.shootout.vegasTotalNote')}
            weight={m.shootoutWeights.total}
          />
          <WeightRow
            label={t('about.shootout.offenses')}
            note={t('about.shootout.offensesNote')}
            weight={m.shootoutWeights.offense}
          />
          <WeightRow
            label={t('about.shootout.defenses')}
            note={t('about.shootout.defensesNote')}
            weight={m.shootoutWeights.defense}
          />
          <WeightRow
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
        <View style={styles.workedBox}>
          <Text style={styles.workedHead}>{t('about.worked.head')}</Text>
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
                    style={[styles.workedTotal, { color: shootoutColor(exampleShootout) }]}
                  />
                ),
              }}
            />
          </Text>
        </View>

        <Text style={styles.body}>
          <Trans
            i18nKey="about.shootout.sections"
            values={{ floor: m.liveGameFloor, tolerance: m.leanTolerance }}
            components={{ em: <Text style={styles.em} /> }}
          />
        </Text>
        <Text style={styles.bodyDim}>{t('about.shootout.noTotal')}</Text>
      </Section>


      <Section title={t('about.playerScore.title')} hint={t('about.playerScore.hint')}>
        <Text style={styles.body}>{t('about.playerScore.body')}</Text>
        <View style={styles.weights}>
          <WeightRow
            label={t('about.playerScore.matchupEdge')}
            note={t('about.playerScore.matchupEdgeNote')}
            weight={m.factorWeights.lane_edge}
          />
          <WeightRow
            label={t('about.playerScore.quality')}
            note={t('about.playerScore.qualityNote')}
            weight={m.factorWeights.composite}
          />
          <WeightRow
            label={t('about.playerScore.volume')}
            note={t('about.playerScore.volumeNote')}
            weight={m.factorWeights.volume}
          />
        </View>
        <Text style={styles.body}>{t('about.playerScore.laneLeads')}</Text>
        <Text style={styles.bodyDim}>{t('about.playerScore.missingFactor')}</Text>
      </Section>


      <Section title={t('about.caveats.title')} hint={t('about.caveats.hint')}>
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

      <View style={styles.footer} />
    </ScrollView>
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <Text style={styles.sectionHint}>{hint}</Text>
      {children}
    </View>
  );
}

function Formula({ parts, result }: { parts: string[]; result: string }) {
  return (
    <View style={styles.formula}>
      {parts.map((p) => (
        <Text key={p} style={styles.formulaPart}>
          {p}
        </Text>
      ))}
      <Text style={styles.formulaEq}>=</Text>
      <Text style={styles.formulaResult}>{result}</Text>
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

  return (
    <View style={styles.example}>
      <View style={styles.exampleRow}>
        <View style={styles.exampleMain}>
          <Text style={styles.exampleLabel}>{label}</Text>
          <Text style={styles.exampleSub}>
            {t('about.example.unitVsDefense', { unit, defense })}
          </Text>
        </View>
        <Text style={[styles.exampleValue, { color: edgeColor(edge) }]}>
          {edge > 0 ? '+' : ''}
          {edge}
        </Text>
      </View>
      <Text style={styles.exampleReading}>{reading}</Text>
    </View>
  );
}

function ScaleBand({
  value,
  label,
  note,
}: {
  value: number;
  label: string;
  note: string;
}) {
  return (
    <View style={styles.band}>
      <View style={[styles.bandSwatch, { backgroundColor: edgeColor(value) }]} />
      <Text style={styles.bandLabel}>{label}</Text>
      <Text style={styles.bandNote}>{note}</Text>
    </View>
  );
}

function WeightRow({
  label,
  note,
  weight,
}: {
  label: string;
  note: string;
  weight: number;
}) {
  return (
    <View style={styles.weightRow}>
      <View style={styles.weightBarTrack}>
        <View style={[styles.weightBarFill, { width: `${weight * 100}%` }]} />
      </View>
      <View style={styles.weightMain}>
        <Text style={styles.weightLabel}>{label}</Text>
        <Text style={styles.weightNote}>{note}</Text>
      </View>
      <Text style={styles.weightValue}>{Math.round(weight * 100)}%</Text>
    </View>
  );
}

function Bullet({ children }: { children: React.ReactNode }) {
  return (
    <View style={styles.bullet}>
      <Text style={styles.bulletDot}>·</Text>
      <Text style={styles.bulletText}>{children}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.bg },
  content: { padding: 16, paddingTop: 12 },
  center: { flex: 1, backgroundColor: theme.bg, justifyContent: 'center', padding: 28, gap: 10 },
  errorTitle: { color: theme.text, fontSize: getPixels(20), fontWeight: '700' },
  errorBody: { color: theme.danger, fontSize: getPixels(13) },
  errorHint: { color: theme.textDim, fontSize: getPixels(13), lineHeight: getPixels(19) },
  mono: { color: theme.accent, fontFamily: 'Courier' },

  header: { paddingBottom: 10 },
  title: { color: theme.text, fontSize: getPixels(30), fontWeight: '800', letterSpacing: -0.5 },
  subtitle: { color: theme.textDim, fontSize: getPixels(13), marginTop: 2 },

  lede: {
    color: theme.text,
    fontSize: getPixels(14),
    lineHeight: getPixels(22),
    paddingBottom: 4,
  },
  em: { color: theme.text, fontWeight: '700' },

  section: { marginTop: 26 },
  sectionTitle: { color: theme.text, fontSize: getPixels(19), fontWeight: '800' },
  sectionHint: {
    color: theme.textFaint,
    fontSize: getPixels(11.5),
    lineHeight: getPixels(17),
    marginTop: 1,
    marginBottom: 10,
  },
  body: { color: theme.textDim, fontSize: getPixels(13), lineHeight: getPixels(20), marginBottom: 10 },
  bodyDim: { color: theme.textFaint, fontSize: getPixels(12), lineHeight: getPixels(18.5), marginBottom: 4 },
  warn: {
    color: theme.text,
    fontSize: getPixels(13),
    lineHeight: getPixels(20),
    marginBottom: 12,
    paddingLeft: 11,
    borderLeftWidth: 3,
    borderLeftColor: theme.warn,
  },

  laneList: { marginBottom: 10, gap: 3 },
  laneItem: { flexDirection: 'row', gap: 8 },
  laneDot: { color: theme.accent, fontSize: getPixels(13), lineHeight: getPixels(19), fontWeight: '900' },
  laneLabel: { color: theme.text, fontSize: getPixels(13), lineHeight: getPixels(19), flex: 1 },

  formula: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
    marginBottom: 12,
  },
  formulaPart: {
    color: theme.textDim,
    fontSize: getPixels(11.5),
    fontWeight: '600',
    backgroundColor: theme.surface,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  formulaEq: { color: theme.textFaint, fontSize: getPixels(12), fontWeight: '700' },
  formulaResult: {
    color: theme.bg,
    fontSize: getPixels(11.5),
    fontWeight: '800',
    backgroundColor: theme.accent,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },

  signRow: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  signCard: {
    flex: 1,
    backgroundColor: theme.surface,
    borderRadius: 10,
    borderLeftWidth: 3,
    padding: 11,
    gap: 5,
  },
  signMark: { fontSize: getPixels(11), fontWeight: '800', letterSpacing: 0.6, textTransform: 'uppercase' },
  signText: { color: theme.textDim, fontSize: getPixels(12), lineHeight: getPixels(18) },

  exampleBox: {
    backgroundColor: theme.surface,
    borderRadius: 10,
    padding: 12,
    marginBottom: 10,
  },
  example: { gap: 6 },
  exampleRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  exampleMain: { flex: 1 },
  exampleLabel: { color: theme.text, fontSize: getPixels(13), fontWeight: '600' },
  exampleSub: { color: theme.textFaint, fontSize: getPixels(11), marginTop: 1 },
  exampleValue: { fontSize: getPixels(20), fontWeight: '900', fontVariant: ['tabular-nums'] },
  exampleReading: { color: theme.textDim, fontSize: getPixels(12), lineHeight: getPixels(18) },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: theme.border,
    marginVertical: 12,
  },

  scaleHead: {
    color: theme.textFaint,
    fontSize: getPixels(10),
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginTop: 8,
    marginBottom: 8,
  },
  scale: { gap: 7 },
  band: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  bandSwatch: { width: 26, height: 8, borderRadius: 4 },
  bandLabel: {
    color: theme.text,
    fontSize: getPixels(12),
    fontWeight: '600',
    width: 96,
    fontVariant: ['tabular-nums'],
  },
  bandNote: { color: theme.textDim, fontSize: getPixels(12), flex: 1 },

  workedBox: {
    backgroundColor: theme.surface,
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
  },
  workedHead: {
    color: theme.textFaint,
    fontSize: getPixels(10),
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  workedLine: { color: theme.textDim, fontSize: getPixels(12.5), lineHeight: getPixels(20) },
  workedNum: { color: theme.text, fontWeight: '700', fontVariant: ['tabular-nums'] },
  workedTotal: { fontSize: getPixels(18), fontWeight: '900', fontVariant: ['tabular-nums'] },

  weights: { gap: 10, marginBottom: 12 },
  weightRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  weightBarTrack: {
    width: 44,
    height: 6,
    borderRadius: 3,
    backgroundColor: theme.surfaceAlt,
    overflow: 'hidden',
  },
  weightBarFill: { height: 6, borderRadius: 3, backgroundColor: theme.accent },
  weightMain: { flex: 1 },
  weightLabel: { color: theme.text, fontSize: getPixels(13), fontWeight: '600' },
  weightNote: { color: theme.textFaint, fontSize: getPixels(11), marginTop: 1 },
  weightValue: {
    color: theme.text,
    fontSize: getPixels(13),
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },

  bullet: { flexDirection: 'row', gap: 8, marginBottom: 9 },
  bulletDot: { color: theme.accent, fontSize: getPixels(13), lineHeight: getPixels(20), fontWeight: '900' },
  bulletText: { color: theme.textDim, fontSize: getPixels(13), lineHeight: getPixels(20), flex: 1 },

  footer: { height: 40 },
});
