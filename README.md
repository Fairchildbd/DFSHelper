# DFSHelper

A daily-fantasy football tool built around a three-part player ranking: what a
player's measurables predicted, what he did in college, and what he has done in
the NFL. Stats always outweigh the workout, and the blend slides toward NFL
production as a career progresses.

Milestone 1 (this build) delivers the ranking engine, the data pipeline, and the
ranked list UI. Player-vs-player matchups build on top of these scores next.

```
packages/
  shared/   scoring engine — pure TypeScript, no I/O, fully unit tested
  server/   Node.js ingest + Express API over Neon Postgres
  app/      Expo / React Native client
```

## The model

### Athletic score

Each combine drill becomes a percentile *within the player's own position*, so a
guard is measured against guards. Drills are then weighted by what the position
actually needs:

| Cohort | Positions | Weights |
|---|---|---|
| Offensive Line | OT, OG, C | 3-cone 40%, bench 30%, broad 30% |
| Defensive Line | DT, DE, EDGE | 3-cone 40%, bench 30%, broad 30% |
| Power / Hybrid | RB, FB, TE, LB | 40 25%, bench 20%, broad 20%, vertical 20%, shuttle 15% |
| Speed / Coverage | WR, CB, S | vertical 25%, shuttle 25%, 3-cone 25%, 40 25% |
| Quarterback | QB | 40 60%, broad 40% — held to a low overall weight |

### Missing drills are the hard part

Most players never run most drills. Since 2015, edge rushers ran the 3-cone only
**27%** of the time and corners **38%** — and the 3-cone is the single heaviest
drill for both cohorts.

An unmeasured drill is therefore neither treated as a zero nor quietly dropped.
Its weight is reassigned to the positional average, which pulls the score toward
the middle by exactly the share of evidence that is missing:

```
confidence = measured weight / total weight
score      = measuredScore × confidence + 50 × (1 − confidence)
```

A corner who ran a 99th-percentile 40 and nothing else has 25% confidence and
scores **62**, not 99. Every score ships with its `confidence` so the UI can show
how much of it is measurement versus assumption.

### Production score

Position-specific per-game rates (PPR points, EPA, target share for skill
players; tackles, sacks, TFL, passes defended for defenders), percentiled the
same way against the same positional baselines.

### College production

Position-appropriate college stats, percentiled against college baselines —
never against NFL ones, because a 100-yard college game and a 100-yard NFL game
are not the same event.

Counting stats use a player's **best college season** rather than a career
average: the feed has no games-played field, so a true per-game rate isn't
derivable, and averaging would punish a redshirt or injury year that says
nothing about how good the player is. Ratio stats use career totals.

### The blend

Two rules govern it, and both are hard constraints rather than tendencies:

**Stats always outweigh measurables.** At every experience level the combined
college + NFL weight exceeds the athletic weight. A drill time is a prediction;
a stat line is a result, and a result beats a forecast of it.

**College stops counting after year three.** From the fourth season on, a player
is their NFL production and nothing else — no college, no combine.

| Years in NFL | Athletic | College | NFL |
|---|---|---|---|
| 0 (rookie) | 0.30 | 0.70 | — |
| 1 | 0.20 | 0.40 | 0.40 |
| 2 | 0.12 | 0.22 | 0.66 |
| 3 | 0.06 | 0.09 | 0.85 |
| 4+ | — | — | 1.00 |

When a component is missing the remaining weights renormalize, keeping their
intended ratios rather than dragging the score toward zero.

### Sample and role

Two things gate a production score before it reaches the board.

**Opportunity, not attendance.** Sample confidence is measured in the unit that
separates a starter from a reserve — pass attempts for quarterbacks, touches for
backs, targets for receivers — never games played. A backup who appears in ten
blowouts has ten games and eighty attempts; counting that as a full season of
evidence is what lets reserves outrank starters. Below 25% of a full sample a
player is marked unqualified and sorts beneath every graded player, because a
dozen attempts is unmeasured, not bad.

**Quarterbacks are additionally gated on holding the job.** There are 32 starting
jobs, one ball, and no rotation, so a backup listed above a starter is never
useful information — the worst starting quarterback in the league is still a
starting quarterback. Quarterbacks sort into full-time starters (8+ starts), spot
starters, then backups, and only within a tier does the score decide. No other
position works this way: backs split carries and receivers rotate by package, so
a committee player is legitimately comparable to a nominal starter and is never
tiered beneath one.

Two further guards keep the weight table honest:

- **Quarterbacks** carry an athletic-signal cap of 0.3. The public combine record
  holds no throwing data, so a QB's 40 time describes mobility and nothing about
  whether he can play. Without the cap, an unproven but fast quarterback outranks
  every established starter.
- **A veteran with no NFL production is anchored at 25**, not scored on his
  workout. After four years the league's own usage is the verdict; absence of
  production at that stage is itself the result. Without this, a career backup's
  combine numbers resurface at full weight and beat actual starters.

## Setup

```bash
npm install
cp .env.example .env          # then put your real Neon URL in .env
npm test                      # verify the engine
npm run db:migrate            # create tables
npm run db:ingest             # first full load (~90s)
npm run rank -w @dfs/server   # compute baselines + rankings
npm run api                   # API on :4000

cd packages/app && npm install && npm start
```

The app is not an npm workspace — Metro and workspace hoisting fight each other,
so it installs separately.

On a physical device, `localhost` is the phone, not your Mac:

```bash
EXPO_PUBLIC_API_URL=http://192.168.1.x:4000 npm start
```

## Weekly refresh

nflverse publishes updated stats early in the week. Wednesday at 9am:

```cron
0 9 * * 3 cd /path/to/DFSHelper && npm run db:refresh >> refresh.log 2>&1
```

The refresh re-pulls only the current season, then recomputes every ranking —
a new week shifts every percentile, so partial recomputation would be wrong.
Runs are logged to the `ingest_runs` table.

## Data notes

Real quirks in the upstream data that the pipeline handles deliberately:

- **The combine file has no pro-day results.** nflverse carries combine only.
  The `measurables` table keys on `(measurable_key, source)` so pro-day or manual
  numbers can be layered in later; the ranker prefers combine when both exist,
  since pro-day timings run systematically fast.
- **nflverse reuses some `pfr_id` values across different people.** Two different
  2000 combine entrants named Mike Green share `GreeMi00`. Measurables key on
  name+season+school instead, and the 15 ambiguous ids are left unlinked rather
  than risk attaching one player's workout to another.
- **`player_stats.csv` is frozen at 2024.** The live source is
  `stats_player/stats_player_week_{season}.csv`, which merges offense and defense
  into one file. Using the older asset silently costs you the current season.
- **There is no `def_tackles` column** in the current release. Combined tackles
  are derived as `def_tackles_solo + def_tackles_with_assist`, which reproduces
  the legacy column on 95.9% of 2024 rows (the obvious alternative matches 30.6%).
- **Traded players are credited under both teams** in the week of the move.
  Those rows are merged: counting stats sum, rate stats take the max.
- **Offensive linemen have no individual stats anywhere public.** Their production
  figure is snap share, which measures availability and coaching trust, not
  blocking. The app labels it as such rather than implying otherwise.

## College data

College stats come from the [CollegeFootballData API](https://collegefootballdata.com),
which needs a free key:

```bash
# 1. Register at https://collegefootballdata.com/key (email, ~2 minutes)
# 2. Put the key in .env
CFBD_API_KEY=your_key_here

# 3. Load it
npm run db:ingest:college
npm run rank -w @dfs/server
```

Until the key is set, the college component stays empty and the remaining
weights renormalize — rookies fall back to their workout alone, which is exactly
the weighting the model exists to avoid. Everything from year four on is
unaffected, since college never counts there.

Four things about this feed shaped the implementation:

- **The stats endpoint returns long format** — one row per
  `(player, category, statType)` — so a season is scattered across a dozen rows
  that get pivoted back into columns.
- **Category matters when pivoting.** `passing/INT` is an interception *thrown*;
  `interceptions/INT` is one *caught*. Keying on statType alone would credit
  quarterbacks with takeaways.
- **There is no games-played field**, so per-game rates aren't derivable without
  a request per week of every season. Counting stats therefore use a player's
  **best college season** rather than an average — which also matches how scouts
  evaluate, and avoids punishing a redshirt or injury year. Ratio stats
  (completion %, yards per carry) use career totals, where the larger
  denominator is more stable.
- **CFBD player ids are its own numeric ids**, unrelated to the slug-style
  `cfb_id` in nflverse, so there is no shared key. Linking is by normalized name,
  and any name that isn't unique on both sides is left unlinked rather than
  guessed at.

## Next

Player-vs-player matchups: pair opposing players by alignment and diff their
percentile profiles to surface where one has a physical edge — the reason the
scores are stored per-metric rather than only as a single composite.
