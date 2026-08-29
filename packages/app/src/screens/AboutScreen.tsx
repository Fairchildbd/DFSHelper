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
import { edgeColor, mismatchColor, shootoutColor } from '../matchupFormat';
import { getPixels, radius, useStyles, useTheme, type Theme } from '../theme';

export function AboutScreen() {
  const t = useTheme();
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
          <>
            Expecting the server at {API_URL}. Start it with <Mono>npm run api</Mono>.
          </>
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
      <PageTitle title="About" subtitle="What every number here means" style={styles.flush} />
      <Text style={styles.lede}>
        A player’s <Text style={styles.em}>ranking</Text> says how good he is. His{' '}
        <Text style={styles.em}>coach’s tendencies</Text> say how he will be used. The{' '}
        <Text style={styles.em}>opponent’s profile</Text> says how much that usage is worth
        this week. A <Text style={styles.em}>mismatch</Text> is where those three disagree in
        the offense’s favour — and this app is a way of finding them.
      </Text>
      <Section
        icon="layers-triple-outline"
        title="Lanes"
        hint="The unit-vs-unit matchups a game is broken into"
      >
        <Text style={styles.body}>
          Every game is decomposed into {meta.lanes.length} lanes, each graded in{' '}
          <Text style={styles.em}>both</Text> directions — each offense against the other
          defense. So a full game has {meta.lanes.length * 2} lane edges, not{' '}
          {meta.lanes.length}.
        </Text>
        <View style={styles.laneList}>
          {meta.lanes.map((l, i) => (
            <View key={l.key} style={[styles.laneItem, i === 0 && styles.laneItemFirst]}>
              <Icon name={laneIcon(l.key)} size={17} color={t.accent} />
              <Text style={styles.laneLabel}>{l.label}</Text>
            </View>
          ))}
        </View>
        <InlineNote>
          These are fantasy-shaped rather than football-shaped: there is no linebacker-corps
          lane, because no lineup decision hangs on one.
        </InlineNote>
      </Section>
      <Section
        icon="scale-balance"
        title="Lane edge"
        hint="One lane’s verdict, from −100 to +100"
      >
        <Formula parts={['unit percentile', '− opponent’s suppression', '+ usage tilt']} result="edge" />
        <Text style={styles.body}>
          Both sides are percentiles against the other 31 teams in that same lane, so the
          subtraction is like-for-like and the result already lives on a 0–100 scale. The unit
          figure is role-weighted — a first receiver counts double a second, and so on down —
          so a lane is not flattened by depth nobody plays.
        </Text>
        <Text style={styles.body}>
          The last term is the coach. A staff that force-feeds tight ends makes a tight-end
          mismatch matter more. It is capped at ±{m.maxUsageAdjustment} percentile points on
          purpose: scheme decides how often an edge gets targeted, not whether it exists.
        </Text>
      </Section>
      <Section
        icon="plus-minus-variant"
        title="Reading the sign"
        hint="Which way a lane edge points"
      >
        <Text style={styles.body}>
          An edge is <Text style={styles.em}>signed</Text>, and the sign is the whole direction
          of the matchup:
        </Text>
        <View style={styles.signRow}>
          <SignCard
            tone="positive"
            mark="Positive"
            icon="trending-up"
            text={
              <>
                The <Text style={styles.em}>offense</Text> holds the advantage. Its unit grades
                out above what the defense suppresses.
              </>
            }
          />
          <SignCard
            tone="negative"
            mark="Negative"
            icon="trending-down"
            text={
              <>
                The <Text style={styles.em}>defense</Text> holds the advantage. The opponent
                suppresses this lane better than the offense runs it.
              </>
            }
          />
        </View>
        <Text style={styles.warn}>
          A negative edge is not a weak signal — it is a strong one pointing the other way.
          Past −{bar} it says fade this unit, with the same conviction that +{bar} says play
          it. That is why both extremes are coloured and only the even middle goes grey.
        </Text>
        <Text style={styles.body}>
          The trap is reading a negative as a verdict on the offense. It is not. An edge is a{' '}
          <Text style={styles.em}>difference</Text>, and a small negative usually means both
          units are good:
        </Text>
        <View style={styles.exampleBox}>
          <ExampleEdge
            label="Run game vs front seven"
            unit={81}
            defense={85}
            edge={-3}
            reading="Even. An elite run game meeting an elite front — not a weakness, and not a spot. Nowhere near the bar, so it counts for nothing."
          />
          <View style={styles.divider} />
          <ExampleEdge
            label="Tight ends vs coverage"
            unit={28}
            defense={88}
            edge={-60}
            reading="A real mismatch, and the advantage is the defense’s. Past the bar, so it counts — and it says avoid this unit, not ignore this lane."
          />
        </View>
        <Text style={styles.bodyDim}>
          The list rows say this in words rather than signs, because a bare “−3” tells you the
          opposite of the truth if you read it as a grade.
        </Text>
        <Eyebrow color={t.textFaint}>The full ramp</Eyebrow>
        <View style={styles.scale}>
          <ScaleBand value={60} label={`+${bar} and up`} note="Advantage, offense" />
          <ScaleBand value={30} label={`+20 to +${bar}`} note="Lean offense" />
          <ScaleBand value={0} label="−20 to +20" note="Even" />
          <ScaleBand value={-30} label={`−20 to −${bar}`} note="Lean defense" />
          <ScaleBand value={-60} label={`−${bar} and down`} note="Advantage, defense" />
        </View>
      </Section>
      <Section
        icon="trending-up"
        title={`The ${bar}-point bar`}
        hint="What turns an edge into a mismatch"
      >
        <Text style={styles.body}>
          “{'{n}'} lanes past the {bar}-point bar” counts how many of the{' '}
          {meta.lanes.length * 2} edges have a magnitude of {bar} or more. It is an{' '}
          <Text style={styles.em}>absolute</Text> count, so those lanes are not necessarily in
          the same team’s favour — a game where both offenses have clean spots reads the same
          as one team having all of them. The lane list on the matchup screen is where the
          direction lives.
        </Text>
        <Text style={styles.body}>
          The bar sits at the 75th percentile of lane edges observed across a full season, so a
          typical game has about three and roughly one game in 27 has none. That is the point:
          a slate where every game has mismatches is a slate where the word has stopped
          carrying information.
        </Text>
        <InlineNote icon="alert-circle-outline">
          Lanes that can’t be graded — missing roster or opponent data — are dropped from the
          count entirely rather than scored as neutral. A game short on data can quietly be 5
          of 8 while presenting the same as 5 of {meta.lanes.length * 2}.
        </InlineNote>
      </Section>
      <Section
        icon="human-handsup"
        title="Mismatch score"
        hint="How large the talent gaps are"
      >
        <Text style={styles.body}>
          Built in two steps. First the {m.topEdges} largest edges are combined by
          root-mean-square — not averaged across all {meta.lanes.length * 2}, because one
          severe mismatch is a better spot than four mild ones, and averaging would let neutral
          lanes bury the single exploitable one.
        </Text>
        <Text style={styles.body}>
          Direction counts. A lane the defense wins is real information, but it says fade
          rather than play, and fading scores no fantasy points — so it enters at{' '}
          {Math.round(m.defenseEdgeWeight * 100)}% weight. A defense has to be roughly twice as
          dominant to outrank an offense. Not zero, because a one-sided beating still
          concentrates whatever scoring happens on the side doing the beating.
        </Text>
        <Worked>
          <Text style={styles.workedLine}>
            edges {exampleEdges.join(', ')} → RMS ={' '}
            <Text style={styles.workedNum}>{exampleEdgeScore.toFixed(1)}</Text>
          </Text>
          <Text style={styles.workedLine}>
            a lane the defense wins by 80 counts{' '}
            <Text style={styles.workedNum}>{(80 * m.defenseEdgeWeight).toFixed(0)}</Text>, not
            80
          </Text>
          <View style={styles.divider} />
          <Text style={styles.workedLine}>
            mismatch score ={' '}
            <Text style={[styles.workedTotal, { color: mismatchColor(t, exampleEdgeScore) }]}>
              {exampleEdgeScore.toFixed(1)}
            </Text>
          </Text>
        </Worked>
        <Text style={styles.bodyDim}>
          Nothing scales it. An earlier version multiplied the score by a capped
          game-environment term, which made one number a blend of two questions and a clean
          answer to neither — and, because lookahead lines only exist a few weeks out, ranked
          half a slate by a different formula from the other half. Scoring lives in its own
          score now.
        </Text>
      </Section>
      <Section
        icon="fire"
        title="Shootout score"
        hint="Where the points are, which is a different question"
      >
        <Text style={styles.body}>
          The mismatch score asks where the largest talent gap is. It does not ask whether
          anyone in the game will score. A great defense strangling a bad offense is an
          enormous mismatch and a dead slate; two ordinary offenses behind two broken lines
          with a 48.5 total is a modest mismatch and a live one. Both belong on the weekly
          list, so they get one score each — and the list groups by this one, because what a
          game is worth doing with matters more than where it places on a ladder.
        </Text>
        <View style={styles.weights}>
          <WeightRow
            icon="cash-multiple"
            label="Vegas total"
            note="A market price on the whole game"
            weight={m.shootoutWeights.total}
          />
          <WeightRow
            icon="account-multiple-outline"
            label="Both offenses"
            note="Weighted toward the weaker one — a shootout needs two"
            weight={m.shootoutWeights.offense}
          />
          <WeightRow
            icon="shield-outline"
            label="Both defenses"
            note="How exploitable the two units are, across every lane"
            weight={m.shootoutWeights.defense}
          />
          <WeightRow
            icon="flash-outline"
            label="Combined pace"
            note="Snaps are the raw material; faster is more of them"
            weight={m.shootoutWeights.pace}
          />
        </View>
        <Text style={styles.body}>
          The total leads because it is a market price on the whole game, scaled from{' '}
          {m.shootoutTotalFloor} to {m.shootoutTotalCeiling}. The other three earn their place
          because the market prices points, not fantasy points: it is indifferent to whether
          the scoring is concentrated in one offense. So the weaker of the two offenses carries{' '}
          {Math.round(m.weakerOffenseWeight * 100)}% of the offensive component — a shootout
          needs both teams to score, and one great offense against one broken one is a blowout
          with a single usable side.
        </Text>
        <Worked>
          <Text style={styles.workedLine}>
            total {exampleTotal}, offenses {exampleStrongOffense}/{exampleWeakOffense},
            defenses {exampleDefense}, pace {examplePace}
          </Text>
          <View style={styles.divider} />
          <Text style={styles.workedLine}>
            shootout score ={' '}
            <Text style={[styles.workedTotal, { color: shootoutColor(t, exampleShootout) }]}>
              {exampleShootout.toFixed(1)}
            </Text>
          </Text>
        </Worked>
        <Text style={styles.body}>
          The score and the lean together sort every game into one of four sections. A game
          that clears {m.liveGameFloor} projects real scoring, and whether the two offenses are
          within {m.leanTolerance} percentile points of each other decides whether it is a{' '}
          <Text style={styles.em}>shootout</Text> to stack or{' '}
          <Text style={styles.em}>points, but one-sided</Text> — a single side to attack. Below
          that the game is quiet, and the only useful thing left to say is why: two units that
          genuinely stop people make it a <Text style={styles.em}>defensive game</Text>, and
          anything else is <Text style={styles.em}>low-scoring</Text>, which is the worse of
          the two — nobody stopped anybody, these offenses just cannot move.
        </Text>
        <InlineNote>
          A game with no published total is scored on the remaining three components rather
          than treated as neutral. And note that this is scoring, not weather: roof, surface,
          rest and travel are a separate question this score does not ask.
        </InlineNote>
      </Section>
      <Section
        icon="account-star-outline"
        title="Player matchup score"
        hint="How good the spot is — not how good the player is"
      >
        <Text style={styles.body}>
          Each graded player gets a 0–100 score blending three factors:
        </Text>
        <View style={styles.weights}>
          <WeightRow
            icon="target"
            label="Matchup edge"
            note="His lane, this week"
            weight={m.factorWeights.lane_edge}
          />
          <WeightRow
            icon="crown-outline"
            label="Player quality"
            note="Season-long ranking composite"
            weight={m.factorWeights.composite}
          />
          <WeightRow
            icon="chart-bar"
            label="Projected volume"
            note="Scheme pace and target share for his role"
            weight={m.factorWeights.volume}
          />
        </View>
        <Text style={styles.body}>
          The lane edge leads deliberately. This grade answers “how good is this spot” — the
          Rankings tab already answers “how good is this player”, and a great player in a
          terrible spot is exactly what a DFS tool has to be able to say out loud.
        </Text>
        <InlineNote>
          A missing factor reduces the weight rather than scoring zero: absence is uncertainty,
          not a finding. The confidence figure under each player is how much of the intended
          weight actually survived.
        </InlineNote>
      </Section>
      <Section
        icon="alert-circle-outline"
        title="What these numbers don’t say"
        hint="Worth knowing before you act"
      >
        <Bullet>
          A mismatch score is <Text style={styles.em}>ordinal</Text>, not a projection. It says
          how lopsided a game’s worst lanes are — nothing in it predicts a final score or a
          point total.
        </Bullet>
        <Bullet>
          It ranks within a slate. Two games can have near-identical edge scores and separate
          only on the environment multiplier, which means Vegas broke the tie, not the units.
        </Bullet>
        <Bullet>
          Edge count and mismatch score measure different things. Only the top {m.topEdges}{' '}
          edges feed the score, so a {m.topEdges + 1}th lane past the bar raises the count
          without moving the number above it.
        </Bullet>
        <Bullet>
          Coaching profiles are keyed to the coach, not the team. When a staff is new the
          screen falls back to the franchise’s recent past and labels itself as doing so.
        </Bullet>
        <Bullet>
          Predictions are frozen at kickoff. Anything graded after a game was played is marked
          as a worked example, not a forecast the model made in advance.
        </Bullet>
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
  const t = useTheme();
  const styles = useStyles(sheet);
  return (
    <View style={styles.workedBox}>
      <Eyebrow color={t.accent}>Worked example</Eyebrow>
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
  const t = useTheme();
  const styles = useStyles(sheet);
  const color = tone === 'positive' ? t.great : t.bad;

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
  const t = useTheme();
  const styles = useStyles(sheet);

  return (
    <View style={styles.example}>
      <View style={styles.exampleRow}>
        <View style={styles.exampleMain}>
          <Text style={styles.exampleLabel}>{label}</Text>
          <Text style={styles.exampleSub}>
            unit {unit} vs defense {defense}
          </Text>
        </View>
        <Text style={[styles.exampleValue, { color: edgeColor(t, edge) }]}>
          {edge > 0 ? '+' : ''}
          {edge}
        </Text>
      </View>
      <Text style={styles.exampleReading}>{reading}</Text>
    </View>
  );
}

function ScaleBand({ value, label, note }: { value: number; label: string; note: string }) {
  const t = useTheme();
  const styles = useStyles(sheet);
  return (
    <View style={styles.band}>
      <View style={[styles.bandSwatch, { backgroundColor: edgeColor(t, value) }]} />
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
      <Text style={styles.weightValue}>{Math.round(weight * 100)}%</Text>
    </View>
  );
}

function Bullet({ children }: { children: React.ReactNode }) {
  const t = useTheme();
  const styles = useStyles(sheet);
  return (
    <View style={styles.bullet}>
      <Icon name="circle-medium" size={16} color={t.accent} style={styles.bulletDot} />
      <Text style={styles.bulletText}>{children}</Text>
    </View>
  );
}

const sheet = (t: Theme) => ({
  screen: { flex: 1, backgroundColor: t.bg },
  content: { paddingHorizontal: 16, paddingBottom: 8, gap: 14 },
  flush: { paddingHorizontal: 0 },

  lede: {
    color: t.text,
    fontSize: getPixels(15),
    lineHeight: getPixels(23),
  },
  em: { color: t.accent, fontWeight: '700' as const },

  section: { padding: 14, gap: 10 },
  sectionHead: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 11 },
  sectionHeadText: { flex: 1 },
  sectionTitle: {
    color: t.text,
    fontSize: getPixels(18),
    fontWeight: '800' as const,
    letterSpacing: -0.3,
  },
  sectionHint: { color: t.accent, fontSize: getPixels(11.5), marginTop: 1 },

  body: { color: t.text, fontSize: getPixels(13), lineHeight: getPixels(19.5) },
  bodyDim: { color: t.textDim, fontSize: getPixels(12), lineHeight: getPixels(18) },
  warn: {
    color: t.warn,
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
    borderTopColor: t.border,
  },
  laneItemFirst: { borderTopWidth: 0 },
  laneLabel: { color: t.text, fontSize: getPixels(13.5), flex: 1 },

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
    backgroundColor: t.surfaceAlt,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: t.border,
  },
  formulaPart: { color: t.textDim, fontSize: getPixels(12) },
  formulaEq: { color: t.textFaint, fontSize: getPixels(13), fontWeight: '700' as const },
  formulaResultPill: {
    paddingHorizontal: 13,
    paddingVertical: 7,
    borderRadius: 9,
    backgroundColor: t.accent,
  },
  formulaResult: { color: t.onAccent, fontSize: getPixels(12), fontWeight: '800' as const },

  signRow: { flexDirection: 'row' as const, gap: 10 },
  signCard: {
    flex: 1,
    padding: 12,
    borderRadius: radius.puck,
    borderWidth: StyleSheet.hairlineWidth,
    backgroundColor: t.surfaceAlt,
    gap: 6,
  },
  signMark: { fontSize: getPixels(11), fontWeight: '800' as const, letterSpacing: 0.8 },
  signText: { color: t.text, fontSize: getPixels(12), lineHeight: getPixels(17.5) },
  signIcon: { alignSelf: 'flex-end' as const },

  exampleBox: {
    borderRadius: radius.puck,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: t.border,
    backgroundColor: t.surfaceAlt,
    padding: 12,
  },
  example: { gap: 5 },
  exampleRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 10 },
  exampleMain: { flex: 1 },
  exampleLabel: { color: t.text, fontSize: getPixels(13), fontWeight: '700' as const },
  exampleSub: { color: t.textFaint, fontSize: getPixels(11), marginTop: 1 },
  exampleValue: {
    fontSize: getPixels(19),
    fontWeight: '800' as const,
    fontVariant: ['tabular-nums' as const],
  },
  exampleReading: { color: t.textDim, fontSize: getPixels(11.5), lineHeight: getPixels(17) },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: t.border,
    marginVertical: 10,
  },

  scale: { gap: 8, marginTop: 2 },
  band: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 11 },
  bandSwatch: { width: 26, height: 7, borderRadius: 4 },
  bandLabel: {
    color: t.text,
    fontSize: getPixels(12.5),
    fontWeight: '700' as const,
    width: 110,
  },
  bandNote: { color: t.textDim, fontSize: getPixels(12), flex: 1 },

  weights: { gap: 12, marginTop: 2 },
  weightRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 11 },
  weightMain: { flex: 1, gap: 2 },
  weightLabel: { color: t.text, fontSize: getPixels(13), fontWeight: '700' as const },
  weightNote: { color: t.textDim, fontSize: getPixels(11), lineHeight: getPixels(15) },
  weightMeter: { marginTop: 4 },
  weightValue: {
    color: t.text,
    fontSize: getPixels(14),
    fontWeight: '800' as const,
    fontVariant: ['tabular-nums' as const],
    minWidth: 38,
    textAlign: 'right' as const,
  },

  workedBox: {
    borderRadius: radius.puck,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: t.accent,
    backgroundColor: t.accentWash,
    padding: 12,
    gap: 6,
  },
  workedLine: { color: t.text, fontSize: getPixels(12.5), lineHeight: getPixels(18) },
  workedNum: { color: t.text, fontWeight: '800' as const },
  workedTotal: { fontSize: getPixels(20), fontWeight: '800' as const },

  bullet: { flexDirection: 'row' as const, gap: 6, paddingVertical: 4 },
  bulletDot: { marginTop: 1 },
  bulletText: {
    flex: 1,
    color: t.text,
    fontSize: getPixels(12.5),
    lineHeight: getPixels(18.5),
  },
});
