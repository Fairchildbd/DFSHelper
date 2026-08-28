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

## Getting started

### Prerequisites

- **Node 22.6 or newer.** The server runs TypeScript directly through
  `node --experimental-strip-types`, which does not exist in earlier versions.
  Check with `node -v`.
- A **[Neon](https://neon.tech)** account. The free plan runs the whole
  pipeline; the retention setting below is what keeps it inside the cap.
- Optionally **Expo Go** on a phone, to run the client on hardware instead of a
  simulator.

### 1. Install

```bash
git clone https://github.com/Fairchildbd/DFSHelper.git
cd DFSHelper
npm install                    # shared + server
npm --prefix packages/app install
```

The app installs separately because it is deliberately not an npm workspace —
Metro's resolver and workspace hoisting fight each other.

### 2. Create the Neon database

1. Sign up and create a project. Any name works; pick the region closest to
   you, since every ingest batch is a network round trip.
2. Neon provisions a database named `neondb` and an owner role automatically.
   Nothing else needs setting up there — `db:migrate` creates all 22 tables in
   step 4.
3. On the project dashboard, open **Connect** and copy the connection string.
   Pooled or direct both work; the pooled endpoint (host contains `-pooler`) is
   the better default. It looks like:

   ```
   postgresql://neondb_owner:PASSWORD@ep-still-frost-12345678-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require
   ```

   Copy the whole string now — Neon shows the password in full only at
   creation time. If you lose it, reset the role's password from the dashboard.

### 3. Configure the environment

```bash
cp .env.example .env
```

Paste the Neon string into `DATABASE_URL`. It is the only required variable;
everything else has a working default.

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `DATABASE_URL` | **yes** | — | Neon connection string |
| `PORT` | no | `4000` | Port the API listens on |
| `INGEST_SEASON_START` | no | `2015` | Earliest season of weekly stats to pull |
| `RETENTION_SEASONS` | no | `4` | Seasons of weekly stats kept in the database |
| `CFBD_API_KEY` | no | empty | College stats — see [College data](#college-data) |
| `COLLEGE_SEASON_START` | no | `2015` | Earliest college season to pull |

Two things about this file:

- There is **one `.env`, at the repo root** — not one per workspace. The server
  resolves it by path, so `packages/server/.env` is silently ignored.
- TLS is required by the client regardless of the URL, so a string without
  `?sslmode=require` still connects.

`RETENTION_SEASONS` is the one worth understanding on the free plan. The weekly
tables only ever grow; without a ceiling the storage cap arrives as failed
writes in the middle of an ingest, which reads as a broken pipeline rather than
a full disk.

### 4. Build and load the data

```bash
npm run build                  # shared/dist — the server imports the compiled package
npm test                       # 149 tests, no database needed
npm run db:migrate             # create the tables in Neon
npm run db:ingest              # first full load from nflverse (~90s)
npm run rank -w @dfs/server    # baselines + rankings
```

Both data steps are safe to re-run: every table is `CREATE TABLE IF NOT EXISTS`
and every loader upserts on a natural key, so a run interrupted halfway just
needs starting again.

For the matchup, This Week, and lineup screens, continue with:

```bash
npm run db:ingest:matchups     # schedule, depth charts, play-by-play tendencies, DVOA
npm run db:matchups            # materialize the weekly matchup grades
```

Order matters here — matchups consume the composite scores that the ranking
pass produces, so `rank` has to have run first.

The lineup screen additionally needs a DraftKings slate. Unlike every other
input, a slate cannot be fetched: it is exported by hand from the contest
lobby's draft screen, and the lobby only ever offers the current week, so a past
slate becomes unobtainable once its contests close. Two are committed in
`packages/server/slates/` for that reason — a 12-game classic slate and a
NE@SEA showdown — so a fresh clone reaches the lineup screen without needing a
DraftKings account:

```bash
npm run ingest:dk -w @dfs/server -- --file "$PWD/packages/server/slates/2026-09-13-classic.csv"
npm run ingest:dk -w @dfs/server -- --file "$PWD/packages/server/slates/2026-09-09-showdown-ne-sea.csv"
```

The path has to be absolute, since the script runs with `packages/server` as its
working directory. Season, week, and contest type are all read off the export —
the importer matches its `Game Info` teams and dates against the `games` table,
so `db:ingest:matchups` needs to have loaded that week's schedule first. When
that lookup finds nothing it says so, and `--season 2026 --week 1` overrides it.

To add your own week, export `DKSalaries.csv`, drop it in the same directory,
and rename it for the slate it holds — DK names every export the same thing.
Committing it keeps that week reproducible after the lobby drops it.
Re-importing is safe: a slate replaces any previous rows for the same season,
week, and contest rather than adding to them.

### 5. Run it

```bash
npm run api        # http://localhost:4000
```

Verify with `curl localhost:4000/health`, then
`curl "localhost:4000/rankings?limit=5"`.

In a second terminal:

```bash
npm run app        # Expo dev server — press i for iOS, a for Android, w for web
```

The client defaults to `localhost:4000` on an iOS simulator and `10.0.2.2:4000`
on an Android emulator. On a **physical device** `localhost` is the phone
itself, so it needs your machine's LAN address:

```bash
cp packages/app/.env.example packages/app/.env
# then set EXPO_PUBLIC_API_URL=http://<LAN IP>:4000    (ipconfig getifaddr en0)
```

### Troubleshooting

| Symptom | Cause |
|---|---|
| `Missing DATABASE_URL` | No `.env` at the repo root, or the placeholder is still in it |
| `Cannot find module '@dfs/shared'` | `npm run build` hasn't run — the server imports `dist`, not source |
| `bad option: --experimental-strip-types` | Node is older than 22.6 |
| First query after a pause takes several seconds | Neon suspends a free-plan compute after ~5 minutes idle; it wakes on connect |
| App loads but every list is empty | API is reachable but `rank` (or `db:matchups`, or the DK import) hasn't run |
| `ECONNREFUSED` from the app on a device | `EXPO_PUBLIC_API_URL` still points at `localhost` |

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
