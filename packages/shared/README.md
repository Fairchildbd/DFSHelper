# @dfs/shared — open question on the production blend

The production metric weights in `src/production.ts` have not been shown to
earn their place. This is the evidence, kept next to the code it is about so it
is found before anyone tunes those weights again.

## What was tested

Every DraftKings Millionaire Maker winning lineup from 2023 through 2025 week 11
was replayed against the ranker as it would have stood the morning of each
contest — production window truncated at the contest week, baselines rebuilt
from that truncated window, experience taken as of that season.

Two orderings were then compared against what players actually scored that week:

- the **composite** `scorePlayer` produces, and
- **prior points-per-game alone** — one column, no blend, no percentiles.

Measured as Spearman ρ within position, averaged over 45 contests.

## The result

Restricted to players four or more years in, where the weight table gives
college zero weight — so nothing is missing and nothing is renormalized:

| Position | Composite | Prior PPR/G | Weeks composite wins |
|---|---|---|---|
| QB | 0.300 | **0.310** | 15 / 45 |
| RB | 0.541 | **0.561** | 15 / 45 |
| WR | **0.456** | 0.454 | 25 / 45 |
| TE | 0.390 | **0.395** | 22 / 45 |

A dead heat, with points-per-game slightly ahead at three of four positions.

Comparison is within position on a matched sample. Pooling positions would be
unfair to the composite, which is a percentile *inside* a position by
construction and therefore cannot encode that quarterbacks outscore tight ends —
raw points per game carries that scale for free.

## Why it probably happens

Look at what `RECEIVER` in `src/production.ts` actually blends:

```
fantasy_points_ppr      0.40
target_share            0.20
receiving_epa_per_tgt   0.20
receiving_yards         0.20
```

Receiving yards is *already inside* PPR points. Target share is upstream of it.
EPA per target is efficiency, the least stable of the three season to season. So
60% of the score is three noisier restatements of the 40% that is carrying it,
and averaging them in pulls toward the noise. The same shape appears in the RB
and QB sets.

## Why this matters here rather than being a curiosity

The composite is not confined to the rankings board — it feeds lineup
construction. Per the note at `server/src/lineups.ts:341`, roughly 60% of a
matchup grade is composite and volume. Three extra metrics per position, plus
the baseline machinery to percentile each of them, are being paid for and
returning nothing measurable over a column that already exists.

## What this does not show

The composite is a player-quality ranking, not a weekly projection. Matchups are
meant to sit on top of it, and no matchup layer was involved in this test.
Judging it on "predict this week's points" holds it to a job it never claimed.
The finding is real; it is not proof the design is wrong.

It also says nothing about years 0–3. Those were excluded here on purpose, and
they carry their own defects — see the experience-counting and rookie-weight
issues in `src/scoring.ts`.

## The cheap next step

Ablation. Drop one metric from a position's set, re-run the same replay, and see
whether ρ moves. A metric whose removal leaves ρ unchanged is not earning its
slot and should either be reweighted or cut. Run it per position — the sets are
independent, and RB is the most likely to give a clean signal given it has the
largest gap to close.
