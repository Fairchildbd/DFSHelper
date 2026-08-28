import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { API_URL, fetchMatchupMeta, type MatchupMeta } from '../api';
import { edgeColor, mismatchColor, shootoutColor } from '../matchupFormat';
import { getPixels, theme } from '../theme';

export function AboutScreen() {
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
        <Text style={styles.errorTitle}>Can’t reach the API</Text>
        <Text style={styles.errorBody}>{error}</Text>
        <Text style={styles.errorHint}>
          Expecting the server at {API_URL}. Start it with{' '}
          <Text style={styles.mono}>npm run api</Text>.
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
        <Text style={styles.title}>About</Text>
        <Text style={styles.subtitle}>What every number here means</Text>
      </View>

      <Text style={styles.lede}>
        A player’s ranking says how good he is. His coach’s tendencies say how he
        will be <Text style={styles.em}>used</Text>. The opponent’s profile says how
        much that usage is worth this week. A mismatch is where those three
        disagree in the offense’s favour — and this app is a way of finding them.
      </Text>


      <Section
        title="Lanes"
        hint="The unit-vs-unit matchups a game is broken into"
      >
        <Text style={styles.body}>
          Every game is decomposed into {meta.lanes.length} lanes, each graded in{' '}
          <Text style={styles.em}>both</Text> directions — each offense against the
          other defense. So a full game has {meta.lanes.length * 2} lane edges, not{' '}
          {meta.lanes.length}.
        </Text>
        <View style={styles.laneList}>
          {meta.lanes.map((l) => (
            <View key={l.key} style={styles.laneItem}>
              <Text style={styles.laneDot}>·</Text>
              <Text style={styles.laneLabel}>{l.label}</Text>
            </View>
          ))}
        </View>
        <Text style={styles.bodyDim}>
          These are fantasy-shaped rather than football-shaped: there is no
          linebacker-corps lane, because no lineup decision hangs on one.
        </Text>
      </Section>


      <Section
        title="Lane edge"
        hint="One lane’s verdict, from −100 to +100"
      >
        <Formula
          parts={['unit percentile', '− opponent’s suppression', '+ usage tilt']}
          result="edge"
        />
        <Text style={styles.body}>
          Both sides are percentiles against the other 31 teams in that same lane,
          so the subtraction is like-for-like and the result already lives on a
          0–100 scale. The unit figure is role-weighted — a first receiver counts
          double a second, and so on down — so a lane is not flattened by depth
          nobody plays.
        </Text>
        <Text style={styles.body}>
          The last term is the coach. A staff that force-feeds tight ends makes a
          tight-end mismatch matter more. It is capped at ±{m.maxUsageAdjustment}{' '}
          percentile points on purpose: scheme decides how often an edge gets
          targeted, not whether it exists.
        </Text>
      </Section>


      <Section
        title="Reading the sign"
        hint="Which way a lane edge points"
      >
        <Text style={styles.body}>
          An edge is <Text style={styles.em}>signed</Text>, and the sign is the whole
          direction of the matchup:
        </Text>

        <View style={styles.signRow}>
          <View style={[styles.signCard, { borderLeftColor: edgeColor(60) }]}>
            <Text style={[styles.signMark, { color: edgeColor(60) }]}>positive</Text>
            <Text style={styles.signText}>
              The <Text style={styles.em}>offense</Text> holds the advantage. Its unit
              grades out above what the defense suppresses.
            </Text>
          </View>
          <View style={[styles.signCard, { borderLeftColor: edgeColor(-60) }]}>
            <Text style={[styles.signMark, { color: edgeColor(-60) }]}>negative</Text>
            <Text style={styles.signText}>
              The <Text style={styles.em}>defense</Text> holds the advantage. The
              opponent suppresses this lane better than the offense runs it.
            </Text>
          </View>
        </View>

        <Text style={styles.warn}>
          A negative edge is not a weak signal — it is a strong one pointing the
          other way. Past −{bar} it says fade this unit, with the same conviction
          that +{bar} says play it. That is why both extremes are coloured and only
          the even middle goes grey.
        </Text>

        <Text style={styles.body}>
          The trap is reading a negative as a verdict on the offense. It is not. An
          edge is a <Text style={styles.em}>difference</Text>, and a small negative
          usually means both units are good:
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
          The list rows say this in words rather than signs, because a bare “−3”
          tells you the opposite of the truth if you read it as a grade.
        </Text>

        <Text style={styles.scaleHead}>The full ramp</Text>
        <View style={styles.scale}>
          <ScaleBand value={60} label={`+${bar} and up`} note="Advantage, offense" />
          <ScaleBand value={30} label={`+20 to +${bar}`} note="Lean offense" />
          <ScaleBand value={0} label="−20 to +20" note="Even" />
          <ScaleBand value={-30} label={`−20 to −${bar}`} note="Lean defense" />
          <ScaleBand value={-60} label={`−${bar} and down`} note="Advantage, defense" />
        </View>
      </Section>


      <Section
        title={`The ${bar}-point bar`}
        hint="What turns an edge into a mismatch"
      >
        <Text style={styles.body}>
          “{'{n}'} lanes past the {bar}-point bar” counts how many of the{' '}
          {meta.lanes.length * 2} edges have a magnitude of {bar} or more. It is an{' '}
          <Text style={styles.em}>absolute</Text> count, so those lanes are not
          necessarily in the same team’s favour — a game where both offenses have
          clean spots reads the same as one team having all of them. The lane list
          on the matchup screen is where the direction lives.
        </Text>
        <Text style={styles.body}>
          The bar sits at the 75th percentile of lane edges observed across a full
          season, so a typical game has about three and roughly one game in 27 has
          none. That is the point: a slate where every game has mismatches is a
          slate where the word has stopped carrying information.
        </Text>
        <Text style={styles.bodyDim}>
          Lanes that can’t be graded — missing roster or opponent data — are dropped
          from the count entirely rather than scored as neutral. A game short on
          data can quietly be 5 of 8 while presenting the same as 5 of{' '}
          {meta.lanes.length * 2}.
        </Text>
      </Section>


      <Section
        title="Mismatch score"
        hint="How large the talent gaps are"
      >
        <Text style={styles.body}>
          Built in two steps. First the {m.topEdges} largest edges are combined by
          root-mean-square — not averaged across all {meta.lanes.length * 2}, because
          one severe mismatch is a better spot than four mild ones, and averaging
          would let neutral lanes bury the single exploitable one.
        </Text>
        <Text style={styles.body}>
          Direction counts. A lane the defense wins is real information, but it says
          fade rather than play, and fading scores no fantasy points — so it enters
          at {Math.round(m.defenseEdgeWeight * 100)}% weight. A defense has to be
          roughly twice as dominant to outrank an offense. Not zero, because a
          one-sided beating still concentrates whatever scoring happens on the side
          doing the beating.
        </Text>

        <View style={styles.workedBox}>
          <Text style={styles.workedHead}>Worked example</Text>
          <Text style={styles.workedLine}>
            edges {exampleEdges.join(', ')} → RMS ={' '}
            <Text style={styles.workedNum}>{exampleEdgeScore.toFixed(1)}</Text>
          </Text>
          <Text style={styles.workedLine}>
            a lane the defense wins by 80 counts{' '}
            <Text style={styles.workedNum}>
              {(80 * m.defenseEdgeWeight).toFixed(0)}
            </Text>
            , not 80
          </Text>
          <View style={styles.divider} />
          <Text style={styles.workedLine}>
            mismatch score ={' '}
            <Text style={[styles.workedTotal, { color: mismatchColor(exampleEdgeScore) }]}>
              {exampleEdgeScore.toFixed(1)}
            </Text>
          </Text>
        </View>

        <Text style={styles.bodyDim}>
          Nothing scales it. An earlier version multiplied the score by a capped
          game-environment term, which made one number a blend of two questions and
          a clean answer to neither — and, because lookahead lines only exist a few
          weeks out, ranked half a slate by a different formula from the other half.
          Scoring lives in its own score now.
        </Text>
      </Section>


      <Section
        title="Shootout score"
        hint="Where the points are, which is a different question"
      >
        <Text style={styles.body}>
          The mismatch score asks where the largest talent gap is. It does not ask
          whether anyone in the game will score. A great defense strangling a bad
          offense is an enormous mismatch and a dead slate; two ordinary offenses
          behind two broken lines with a 48.5 total is a modest mismatch and a live
          one. Both belong on the weekly list, so they get one score each — and the
          list groups by this one, because what a game is worth doing with matters
          more than where it places on a ladder.
        </Text>

        <View style={styles.weights}>
          <WeightRow
            label="Vegas total"
            note="A market price on the whole game"
            weight={m.shootoutWeights.total}
          />
          <WeightRow
            label="Both offenses"
            note="Weighted toward the weaker one — a shootout needs two"
            weight={m.shootoutWeights.offense}
          />
          <WeightRow
            label="Both defenses"
            note="How exploitable the two units are, across every lane"
            weight={m.shootoutWeights.defense}
          />
          <WeightRow
            label="Combined pace"
            note="Snaps are the raw material; faster is more of them"
            weight={m.shootoutWeights.pace}
          />
        </View>

        <Text style={styles.body}>
          The total leads because it is a market price on the whole game, scaled from{' '}
          {m.shootoutTotalFloor} to {m.shootoutTotalCeiling}. The other three earn
          their place because the market prices points, not fantasy points: it is
          indifferent to whether the scoring is concentrated in one offense. So the
          weaker of the two offenses carries{' '}
          {Math.round(m.weakerOffenseWeight * 100)}% of the offensive component — a
          shootout needs both teams to score, and one great offense against one
          broken one is a blowout with a single usable side.
        </Text>
        <View style={styles.workedBox}>
          <Text style={styles.workedHead}>Worked example</Text>
          <Text style={styles.workedLine}>
            total {exampleTotal}, offenses {exampleStrongOffense}/{exampleWeakOffense},
            defenses {exampleDefense}, pace {examplePace}
          </Text>
          <View style={styles.divider} />
          <Text style={styles.workedLine}>
            shootout score ={' '}
            <Text style={[styles.workedTotal, { color: shootoutColor(exampleShootout) }]}>
              {exampleShootout.toFixed(1)}
            </Text>
          </Text>
        </View>

        <Text style={styles.body}>
          The score and the lean together sort every game into one of four sections.
          A game that clears {m.liveGameFloor} projects real scoring, and whether the
          two offenses are within {m.leanTolerance} percentile points of each other
          decides whether it is a <Text style={styles.em}>shootout</Text> to stack or{' '}
          <Text style={styles.em}>points, but one-sided</Text> — a single side to
          attack. Below that the game is quiet, and the only useful thing left to say
          is why: two units that genuinely stop people make it a{' '}
          <Text style={styles.em}>defensive game</Text>, and anything else is{' '}
          <Text style={styles.em}>low-scoring</Text>, which is the worse of the two —
          nobody stopped anybody, these offenses just cannot move.
        </Text>
        <Text style={styles.bodyDim}>
          A game with no published total is scored on the remaining three components
          rather than treated as neutral. And note that this is scoring, not weather:
          roof, surface, rest and travel are a separate question this score does not
          ask.
        </Text>
      </Section>


      <Section
        title="Player matchup score"
        hint="How good the spot is — not how good the player is"
      >
        <Text style={styles.body}>
          Each graded player gets a 0–100 score blending three factors:
        </Text>
        <View style={styles.weights}>
          <WeightRow
            label="Matchup edge"
            note="His lane, this week"
            weight={m.factorWeights.lane_edge}
          />
          <WeightRow
            label="Player quality"
            note="Season-long ranking composite"
            weight={m.factorWeights.composite}
          />
          <WeightRow
            label="Projected volume"
            note="Scheme pace and target share for his role"
            weight={m.factorWeights.volume}
          />
        </View>
        <Text style={styles.body}>
          The lane edge leads deliberately. This grade answers “how good is this
          spot” — the Rankings tab already answers “how good is this player”, and a
          great player in a terrible spot is exactly what a DFS tool has to be able
          to say out loud.
        </Text>
        <Text style={styles.bodyDim}>
          A missing factor reduces the weight rather than scoring zero: absence is
          uncertainty, not a finding. The confidence figure under each player is how
          much of the intended weight actually survived.
        </Text>
      </Section>


      <Section title="What these numbers don’t say" hint="Worth knowing before you act">
        <Bullet>
          A mismatch score is <Text style={styles.em}>ordinal</Text>, not a
          projection. It says how lopsided a game’s worst lanes are — nothing in it
          predicts a final score or a point total.
        </Bullet>
        <Bullet>
          It ranks within a slate. Two games can have near-identical edge scores and
          separate only on the environment multiplier, which means Vegas broke the
          tie, not the units.
        </Bullet>
        <Bullet>
          Edge count and mismatch score measure different things. Only the top{' '}
          {m.topEdges} edges feed the score, so a {m.topEdges + 1}th lane past the
          bar raises the count without moving the number above it.
        </Bullet>
        <Bullet>
          Coaching profiles are keyed to the coach, not the team. When a staff is new
          the screen falls back to the franchise’s recent past and labels itself as
          doing so.
        </Bullet>
        <Bullet>
          Predictions are frozen at kickoff. Anything graded after a game was played
          is marked as a worked example, not a forecast the model made in advance.
        </Bullet>
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
  return (
    <View style={styles.example}>
      <View style={styles.exampleRow}>
        <View style={styles.exampleMain}>
          <Text style={styles.exampleLabel}>{label}</Text>
          <Text style={styles.exampleSub}>
            unit {unit} vs defense {defense}
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
