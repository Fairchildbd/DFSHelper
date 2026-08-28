-- DFSHelper schema.
--
-- unaccent is needed to match college and NFL player names, which arrive from
-- different feeds with inconsistent diacritics.
CREATE EXTENSION IF NOT EXISTS unaccent;

--
-- Identity note: nflverse uses two different player keys. Weekly stats key on
-- gsis_id; combine and snap-count data key on pfr_id. players.csv is the only
-- table carrying both, so it is the join hub and gsis_id is our primary key.
-- Combine rows that never map to a gsis_id are players who never reached the
-- league; they are still loaded, because they belong in the baseline sample.

CREATE TABLE IF NOT EXISTS players (
  gsis_id           TEXT PRIMARY KEY,
  pfr_id            TEXT,
  display_name      TEXT NOT NULL,
  first_name        TEXT,
  last_name         TEXT,
  position_raw      TEXT,
  position          TEXT,
  cohort            TEXT,
  team              TEXT,
  jersey_number     INTEGER,
  birth_date        DATE,
  height_inches     NUMERIC(4,1),
  weight_lbs        INTEGER,
  college           TEXT,
  headshot_url      TEXT,
  rookie_season     INTEGER,
  last_season       INTEGER,
  years_experience  INTEGER,
  status            TEXT,
  draft_year        INTEGER,
  draft_round       INTEGER,
  draft_pick        INTEGER,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS players_pfr_idx ON players (pfr_id);
CREATE INDEX IF NOT EXISTS players_position_idx ON players (position);
CREATE INDEX IF NOT EXISTS players_last_season_idx ON players (last_season);

-- Combine and pro-day results. `source` is part of the key so a pro-day number
-- can sit alongside a combine number for the same player without overwriting
-- it; the ranking layer prefers combine and falls back to pro day.
CREATE TABLE IF NOT EXISTS measurables (
  -- Stable identity for a measurable row. Prefers pfr_id; falls back to a
  -- normalized name+season slug for the many combine entrants who never
  -- appeared in an NFL game and so have no league id at all.
  measurable_key TEXT NOT NULL,
  gsis_id     TEXT,
  pfr_id      TEXT,
  player_name TEXT NOT NULL,
  source      TEXT NOT NULL CHECK (source IN ('combine', 'pro_day', 'manual')),
  season      INTEGER,
  position_raw TEXT,
  position    TEXT,
  school      TEXT,
  height_inches NUMERIC(4,1),
  weight_lbs  INTEGER,
  forty       NUMERIC(4,2),
  bench       INTEGER,
  vertical    NUMERIC(4,1),
  broad       INTEGER,
  cone        NUMERIC(4,2),
  shuttle     NUMERIC(4,2),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (measurable_key, source)
);

CREATE INDEX IF NOT EXISTS measurables_gsis_idx ON measurables (gsis_id);
CREATE INDEX IF NOT EXISTS measurables_position_idx ON measurables (position);

CREATE TABLE IF NOT EXISTS player_week_offense (
  gsis_id      TEXT NOT NULL,
  season       INTEGER NOT NULL,
  week         INTEGER NOT NULL,
  season_type  TEXT NOT NULL,
  team         TEXT,
  opponent     TEXT,
  position     TEXT,
  completions  INTEGER, attempts INTEGER,
  passing_yards NUMERIC, passing_tds INTEGER, interceptions INTEGER,
  passing_epa  NUMERIC, passing_first_downs NUMERIC,
  carries      INTEGER, rushing_yards NUMERIC, rushing_tds INTEGER, rushing_epa NUMERIC,
  receptions   INTEGER, targets INTEGER, receiving_yards NUMERIC, receiving_tds INTEGER,
  receiving_epa NUMERIC, target_share NUMERIC, air_yards_share NUMERIC, wopr NUMERIC,
  fantasy_points NUMERIC, fantasy_points_ppr NUMERIC,
  PRIMARY KEY (gsis_id, season, week, season_type)
);

CREATE INDEX IF NOT EXISTS pwo_season_idx ON player_week_offense (season, season_type);

CREATE TABLE IF NOT EXISTS player_week_defense (
  gsis_id      TEXT NOT NULL,
  season       INTEGER NOT NULL,
  week         INTEGER NOT NULL,
  season_type  TEXT NOT NULL,
  team         TEXT,
  position     TEXT,
  def_tackles  NUMERIC, def_tackles_solo NUMERIC, def_tackles_for_loss NUMERIC,
  def_sacks    NUMERIC, def_qb_hits NUMERIC, def_interceptions NUMERIC,
  def_pass_defended NUMERIC, def_fumbles_forced NUMERIC, def_tds NUMERIC,
  PRIMARY KEY (gsis_id, season, week, season_type)
);

CREATE INDEX IF NOT EXISTS pwd_season_idx ON player_week_defense (season, season_type);

-- Snap share is the only production signal available for offensive linemen.
CREATE TABLE IF NOT EXISTS snap_counts (
  pfr_id       TEXT NOT NULL,
  season       INTEGER NOT NULL,
  week         INTEGER NOT NULL,
  game_type    TEXT NOT NULL,
  team         TEXT,
  position     TEXT,
  offense_snaps INTEGER, offense_pct NUMERIC,
  defense_snaps INTEGER, defense_pct NUMERIC,
  st_snaps     INTEGER, st_pct NUMERIC,
  PRIMARY KEY (pfr_id, season, week, game_type)
);

CREATE INDEX IF NOT EXISTS snaps_season_idx ON snap_counts (season);

-- Precomputed mean/sd per (scope, metric). The scoring engine is pure
-- arithmetic on top of this, so it runs identically on the server and on device.
CREATE TABLE IF NOT EXISTS baselines (
  scope       TEXT NOT NULL,
  metric      TEXT NOT NULL,
  mean        NUMERIC NOT NULL,
  sd          NUMERIC NOT NULL,
  n           INTEGER NOT NULL,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (scope, metric)
);

CREATE TABLE IF NOT EXISTS rankings (
  gsis_id              TEXT PRIMARY KEY,
  display_name         TEXT NOT NULL,
  position             TEXT NOT NULL,
  cohort               TEXT NOT NULL,
  team                 TEXT,
  age                  NUMERIC(4,1),
  years_experience     INTEGER,
  composite            NUMERIC(5,2) NOT NULL,
  athletic_score       NUMERIC(5,2),
  athletic_confidence  NUMERIC(4,3),
  production_score     NUMERIC(5,2),
  production_confidence NUMERIC(4,3),
  production_weight    NUMERIC(4,3),
  position_rank        INTEGER,
  overall_rank         INTEGER,
  detail               JSONB NOT NULL,
  computed_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS rankings_position_idx ON rankings (position, composite DESC);
CREATE INDEX IF NOT EXISTS rankings_composite_idx ON rankings (composite DESC);

-- Additive migrations. CREATE TABLE IF NOT EXISTS will not touch a table that
-- already exists, so new columns are added explicitly and idempotently.
ALTER TABLE rankings ADD COLUMN IF NOT EXISTS college_score NUMERIC(5,2);
ALTER TABLE rankings ADD COLUMN IF NOT EXISTS college_confidence NUMERIC(4,3);
ALTER TABLE rankings ADD COLUMN IF NOT EXISTS weight_athletic NUMERIC(4,3);
ALTER TABLE rankings ADD COLUMN IF NOT EXISTS weight_college NUMERIC(4,3);
ALTER TABLE rankings ADD COLUMN IF NOT EXISTS weight_nfl NUMERIC(4,3);
ALTER TABLE rankings ADD COLUMN IF NOT EXISTS opportunities INTEGER;
ALTER TABLE rankings ADD COLUMN IF NOT EXISTS qualified BOOLEAN;
ALTER TABLE rankings ADD COLUMN IF NOT EXISTS starts INTEGER;
-- Sort tier applied before composite. 0 everywhere except quarterback, where a
-- backup sorts below every starter no matter how efficient he looked.
ALTER TABLE rankings ADD COLUMN IF NOT EXISTS rank_tier INTEGER DEFAULT 0;

-- Per-season college production, one row per player-season. Keyed on a college
-- player id because gsis_id does not exist until a player reaches the NFL;
-- the link to `players` is resolved after ingest.
CREATE TABLE IF NOT EXISTS college_player_season (
  cfb_player_id TEXT NOT NULL,
  season        INTEGER NOT NULL,
  gsis_id       TEXT,
  player_name   TEXT NOT NULL,
  team          TEXT,
  position      TEXT,
  games         INTEGER,
  passing_yards NUMERIC, passing_tds NUMERIC, passing_interceptions NUMERIC,
  completions   NUMERIC, attempts NUMERIC,
  rushing_yards NUMERIC, rushing_tds NUMERIC, carries NUMERIC,
  receiving_yards NUMERIC, receiving_tds NUMERIC, receptions NUMERIC,
  tackles       NUMERIC, tackles_for_loss NUMERIC, sacks NUMERIC,
  pass_defended NUMERIC, interceptions_def NUMERIC,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (cfb_player_id, season)
);

CREATE INDEX IF NOT EXISTS cfb_gsis_idx ON college_player_season (gsis_id);

CREATE TABLE IF NOT EXISTS ingest_runs (
  id          SERIAL PRIMARY KEY,
  started_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  status      TEXT NOT NULL,
  detail      JSONB
);

--
-- ============================================================================
-- Matchup layer: schedule, coaching tendencies, and weekly mismatch grades.
-- ============================================================================
--
-- The rankings above answer "how good is this player". Everything below answers
-- "how good is this player *this week, against this opponent, in this scheme*".

-- The NFL schedule, straight from the nflverse schedules release. Carries the
-- head coach for each side, which is what makes coach-keyed tendencies possible
-- at all: coaches move, and several 2026 staffs are new to their franchise.
CREATE TABLE IF NOT EXISTS games (
  game_id      TEXT PRIMARY KEY,
  season       INTEGER NOT NULL,
  week         INTEGER NOT NULL,
  game_type    TEXT NOT NULL,
  gameday      DATE,
  weekday      TEXT,
  gametime     TEXT,
  home_team    TEXT NOT NULL,
  away_team    TEXT NOT NULL,
  home_coach   TEXT,
  away_coach   TEXT,
  home_score   INTEGER,
  away_score   INTEGER,
  -- Vegas lines exist only for the next handful of weeks; NULL is the normal
  -- state for late-season games, not a data error.
  spread_line  NUMERIC(4,1),
  total_line   NUMERIC(4,1),
  roof         TEXT,
  surface      TEXT,
  div_game     BOOLEAN,
  home_rest    INTEGER,
  away_rest    INTEGER,
  stadium      TEXT,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS games_season_week_idx ON games (season, week);
CREATE INDEX IF NOT EXISTS games_coach_idx ON games (season, home_coach, away_coach);

-- Current depth chart. The upstream file is re-snapshotted continuously and
-- carries every snapshot, so ingest keeps only the newest `dt` per team.
-- `pos_rank` is the role weight: DFS cares enormously about WR1 vs WR4.
CREATE TABLE IF NOT EXISTS depth_chart (
  season    INTEGER NOT NULL,
  team      TEXT NOT NULL,
  gsis_id   TEXT NOT NULL,
  pos_abb   TEXT,
  pos_name  TEXT,
  pos_grp   TEXT,
  pos_rank  INTEGER,
  position  TEXT,
  -- A depth chart is a grid of lineup slots, not a list of positions: three
  -- receivers share pos_abb 'WR' but sit in three different slots, so the
  -- starter of a *slot* is what a starting lineup is made of. `unit` separates
  -- the three charts a team publishes.
  pos_slot  INTEGER,
  unit      TEXT,
  snapshot  TIMESTAMPTZ,
  PRIMARY KEY (season, team, gsis_id, pos_abb)
);

CREATE INDEX IF NOT EXISTS depth_chart_team_idx ON depth_chart (season, team, position);

ALTER TABLE depth_chart ADD COLUMN IF NOT EXISTS pos_slot INTEGER;
ALTER TABLE depth_chart ADD COLUMN IF NOT EXISTS unit TEXT;

-- Coaching tendencies in long format, one row per metric, mirroring `baselines`.
-- `side` separates what a staff does with the ball from what it does without it.
-- `n_plays` is the sample the value rests on and gates whether it is trusted.
CREATE TABLE IF NOT EXISTS coach_tendencies (
  coach       TEXT NOT NULL,
  side        TEXT NOT NULL CHECK (side IN ('offense', 'defense')),
  metric      TEXT NOT NULL,
  value       NUMERIC NOT NULL,
  n_plays     INTEGER NOT NULL,
  n_games     INTEGER NOT NULL,
  seasons     TEXT,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (coach, side, metric)
);

-- Same shape keyed on franchise. This is the fallback when a coach has too
-- little head-coaching history to profile — a first-time hire, or one who moved
-- from a coordinator job where no per-coach play attribution exists.
CREATE TABLE IF NOT EXISTS team_tendencies (
  team        TEXT NOT NULL,
  side        TEXT NOT NULL CHECK (side IN ('offense', 'defense')),
  metric      TEXT NOT NULL,
  value       NUMERIC NOT NULL,
  n_plays     INTEGER NOT NULL,
  n_games     INTEGER NOT NULL,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (team, side, metric)
);

-- How each defense actually performs against each offensive position — the
-- classic DFS "defense vs position", and the backbone of the player view.
CREATE TABLE IF NOT EXISTS def_vs_position (
  team        TEXT NOT NULL,
  position    TEXT NOT NULL,
  metric      TEXT NOT NULL,
  value       NUMERIC NOT NULL,
  n_games     INTEGER NOT NULL,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (team, position, metric)
);

-- Per-defender coverage and pass-rush production, from PFR advanced stats.
-- Keyed on pfr_id because that is what the source carries; linked to gsis_id
-- through players, with the same ambiguity guard used for combine measurables.
CREATE TABLE IF NOT EXISTS defender_coverage (
  pfr_id                 TEXT NOT NULL,
  season                 INTEGER NOT NULL,
  gsis_id                TEXT,
  player_name            TEXT,
  team                   TEXT,
  games                  INTEGER NOT NULL,
  targets                NUMERIC,
  completions_allowed    NUMERIC,
  yards_allowed          NUMERIC,
  yards_per_target       NUMERIC,
  passer_rating_allowed  NUMERIC,
  adot                   NUMERIC,
  tds_allowed            NUMERIC,
  interceptions          NUMERIC,
  tackles                NUMERIC,
  missed_tackles         NUMERIC,
  missed_tackle_pct      NUMERIC,
  pressures              NUMERIC,
  sacks                  NUMERIC,
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (pfr_id, season)
);

-- CREATE TABLE IF NOT EXISTS above is a no-op once the table exists, so any
-- column added to that definition later never reaches a database created
-- before it -- the table drifts from this file with nothing reporting it, and
-- the first query naming the new column fails at runtime. Add such columns
-- explicitly as well; IF NOT EXISTS keeps this safe to re-run.
ALTER TABLE defender_coverage ADD COLUMN IF NOT EXISTS tackles NUMERIC;
ALTER TABLE defender_coverage ADD COLUMN IF NOT EXISTS missed_tackles NUMERIC;

CREATE INDEX IF NOT EXISTS defender_coverage_gsis_idx ON defender_coverage (gsis_id);

-- Tackle volume is what a linebacker is actually graded on; it was previously
-- summed only as the denominator of missed-tackle rate and thrown away.
ALTER TABLE defender_coverage ADD COLUMN IF NOT EXISTS tackles NUMERIC;
ALTER TABLE defender_coverage ADD COLUMN IF NOT EXISTS missed_tackles NUMERIC;

-- DraftKings salaries, imported from the CSV the contest lobby exports.
--
-- Not derived from anything: a salary is a price DraftKings set, and the only
-- honest source for it is DraftKings. One row per player per contest type,
-- because the same player carries a different price on the main slate and in a
-- showdown, and a captain row carries a third price again.
CREATE TABLE IF NOT EXISTS dk_salaries (
  season          INTEGER NOT NULL,
  week            INTEGER NOT NULL,
  contest         TEXT NOT NULL CHECK (contest IN ('classic', 'showdown')),
  dk_id           TEXT NOT NULL,
  roster_position TEXT NOT NULL,
  name            TEXT NOT NULL,
  position        TEXT NOT NULL,
  team            TEXT NOT NULL,
  opponent        TEXT,
  game_id         TEXT,
  salary          INTEGER NOT NULL,
  avg_points      NUMERIC,
  -- DraftKings' own injury flag: 'Q', 'D', 'OUT', 'IR', or empty. The export is
  -- the only feed here that carries availability at all, and a lineup built
  -- with a player who is out is not a lineup.
  status          TEXT,
  -- Null for a name the roster could not be matched to, and for every DST,
  -- which is a team rather than a person.
  gsis_id         TEXT,
  imported_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (season, week, contest, dk_id, roster_position)
);

CREATE INDEX IF NOT EXISTS dk_salaries_slate_idx
  ON dk_salaries (season, week, contest);
CREATE INDEX IF NOT EXISTS dk_salaries_gsis_idx ON dk_salaries (gsis_id);
ALTER TABLE dk_salaries ADD COLUMN IF NOT EXISTS status TEXT;

-- Materialized weekly matchup grades. Recomputed wholesale like `rankings`,
-- because a new week of data shifts every percentile underneath them.
CREATE TABLE IF NOT EXISTS matchups (
  game_id             TEXT PRIMARY KEY,
  season              INTEGER NOT NULL,
  week                INTEGER NOT NULL,
  gameday             DATE,
  gametime            TEXT,
  home_team           TEXT NOT NULL,
  away_team           TEXT NOT NULL,
  home_coach          TEXT,
  away_coach          TEXT,
  -- 0-100 after the environment multiplier is applied. This is the sort key.
  mismatch_score      NUMERIC(5,2) NOT NULL,
  -- Before the multiplier, so the UI can show what Vegas actually changed.
  edge_score          NUMERIC(5,2) NOT NULL,
  edge_count          INTEGER NOT NULL,
  total_line          NUMERIC(4,1),
  spread_line         NUMERIC(4,1),
  -- Worst lane in the game, precomputed for the list row headline.
  top_edge_label      TEXT,
  top_edge_value      NUMERIC(5,2),
  detail              JSONB NOT NULL,
  computed_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS matchups_week_idx ON matchups (season, week, mismatch_score DESC);

CREATE TABLE IF NOT EXISTS player_matchups (
  game_id         TEXT NOT NULL,
  gsis_id         TEXT NOT NULL,
  season          INTEGER NOT NULL,
  week            INTEGER NOT NULL,
  team            TEXT NOT NULL,
  opponent        TEXT NOT NULL,
  display_name    TEXT NOT NULL,
  position        TEXT NOT NULL,
  pos_rank        INTEGER,
  lane            TEXT,
  matchup_score   NUMERIC(5,2) NOT NULL,
  confidence      NUMERIC(4,3) NOT NULL,
  composite       NUMERIC(5,2),
  lane_edge       NUMERIC(5,2),
  volume_score    NUMERIC(5,2),
  detail          JSONB NOT NULL,
  computed_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (game_id, gsis_id)
);

CREATE INDEX IF NOT EXISTS player_matchups_game_idx
  ON player_matchups (game_id, matchup_score DESC);

-- Prediction bookkeeping.
--
-- A matchup row is a forecast, and a forecast is only worth showing next to a
-- result if it was fixed before the result existed. These columns make that
-- explicit: `locked` marks a prediction as frozen, and the compute pass refuses
-- to touch a locked row. Without this, re-running after a Sunday would rebuild
-- week 1's "prediction" from a tendency window that already contains week 1,
-- and the accuracy display would be measuring the model against itself.
ALTER TABLE matchups ADD COLUMN IF NOT EXISTS game_type TEXT NOT NULL DEFAULT 'REG';
ALTER TABLE matchups ADD COLUMN IF NOT EXISTS predicted_at TIMESTAMPTZ;
ALTER TABLE matchups ADD COLUMN IF NOT EXISTS locked BOOLEAN NOT NULL DEFAULT FALSE;
-- True when a prediction was generated after the game was already final. Such a
-- row is a demonstration of the model, not a forecast it actually made, and the
-- UI must say so rather than quietly presenting it as a hit.
ALTER TABLE matchups ADD COLUMN IF NOT EXISTS backfilled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE matchups ADD COLUMN IF NOT EXISTS home_score INTEGER;
ALTER TABLE matchups ADD COLUMN IF NOT EXISTS away_score INTEGER;
ALTER TABLE matchups ADD COLUMN IF NOT EXISTS result_at TIMESTAMPTZ;
-- How many of the ten highest-graded skill players actually finished in the
-- game's real top ten by PPR. The honest headline for a completed game.
ALTER TABLE matchups ADD COLUMN IF NOT EXISTS top10_hits INTEGER;

ALTER TABLE player_matchups ADD COLUMN IF NOT EXISTS actual_points NUMERIC(6,2);
ALTER TABLE player_matchups ADD COLUMN IF NOT EXISTS actual_rank INTEGER;
ALTER TABLE player_matchups ADD COLUMN IF NOT EXISTS predicted_rank INTEGER;
ALTER TABLE player_matchups ADD COLUMN IF NOT EXISTS actual_line JSONB;

-- The scoring-environment read, alongside the talent-gap read. Nullable
-- because rows written before this existed have no answer, and a game with no
-- gradeable lanes still has no answer now.
ALTER TABLE matchups ADD COLUMN IF NOT EXISTS shootout_score NUMERIC(5,2);
ALTER TABLE matchups ADD COLUMN IF NOT EXISTS shootout_applied BOOLEAN;
ALTER TABLE matchups ADD COLUMN IF NOT EXISTS lean_team TEXT;
ALTER TABLE matchups ADD COLUMN IF NOT EXISTS lean_margin NUMERIC(5,2);

-- Which of the four shapes the game is, so the weekly list can group rather
-- than rank. Stored rather than derived in the client because the ordering of
-- the sections is part of the query, not part of the rendering.
ALTER TABLE matchups ADD COLUMN IF NOT EXISTS game_shape TEXT;

CREATE INDEX IF NOT EXISTS matchups_shootout_idx
  ON matchups (season, week, shootout_score DESC);

-- The mismatch score was once scaled by a capped game-environment multiplier.
-- That made one number a blend of talent gap and scoring projection and a clean
-- answer to neither, and it left games with no published line ranked by a
-- different formula from the rest of their own slate. Scoring projection is now
-- its own column, uncapped, and the multiplier is gone.
--
-- Dropped rather than kept and nulled. A column that is null on every current
-- row is not a record of anything, it is a question every future reader has to
-- answer before they can ignore it. Nothing is lost: the multiplier a frozen
-- prediction was scored with is exactly mismatch_score / edge_score, and both
-- of its inputs — total_line, and pacePercentile inside detail — are still on
-- the row.
ALTER TABLE matchups DROP COLUMN IF EXISTS env_multiplier;
ALTER TABLE matchups DROP COLUMN IF EXISTS environment_applied;

CREATE INDEX IF NOT EXISTS matchups_final_idx ON matchups (season, week, result_at);

--
-- ============================================================================
-- DVOA layer: opponent-adjusted efficiency and situational success.
-- ============================================================================
--
-- Every efficiency figure above this point is raw. Two quarterbacks at the same
-- EPA per attempt are scored identically even when one faced the league's best
-- secondaries all year, and a defense that drew a soft slate of offenses grades
-- as elite in `def_vs_position`. These tables carry the schedule-corrected
-- versions, fitted by the two-way model in shared/src/dvoa.ts.
--
-- Both keep the raw number beside the adjusted one. The gap between them *is*
-- the strength of schedule, and it is worth being able to show.

-- Team efficiency and success rate, on both sides of the ball, as they would be
-- against a league-average opponent. Long format, mirroring `team_tendencies`.
--
-- Deliberately a separate table rather than more rows in `team_tendencies`.
-- A tendency is a disposition — what a staff chooses to do — and resolves
-- coach-first through `resolveTendencies`, which picks one source wholesale.
-- An opponent-adjusted result is neither: it belongs to a roster and a season,
-- not to a play-caller, and writing it alongside tendencies would make it
-- invisible on every team whose coach profile wins that resolution.
CREATE TABLE IF NOT EXISTS team_dvoa (
  team        TEXT NOT NULL,
  side        TEXT NOT NULL CHECK (side IN ('offense', 'defense')),
  metric      TEXT NOT NULL,
  value       NUMERIC NOT NULL,
  n_plays     INTEGER NOT NULL,
  seasons     TEXT,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (team, side, metric)
);

-- Per-player opponent-adjusted rates, in the per-opportunity units the ranking
-- engine already percentiles. Wide rather than long because `rankings.ts`
-- merges production as one row per player and this plugs straight into it.
--
-- A role's rate is NULL below the publication floor while its play count is
-- still recorded: the count is real evidence about sample size even when the
-- rate computed from it would be a coin flip.
CREATE TABLE IF NOT EXISTS player_dvoa (
  gsis_id                     TEXT PRIMARY KEY,
  games                       INTEGER NOT NULL,
  pass_plays                  INTEGER NOT NULL DEFAULT 0,
  rush_plays                  INTEGER NOT NULL DEFAULT 0,
  rec_plays                   INTEGER NOT NULL DEFAULT 0,
  adj_passing_epa_per_dropback     NUMERIC,
  raw_passing_epa_per_dropback     NUMERIC,
  adj_rushing_epa_per_carry   NUMERIC,
  raw_rushing_epa_per_carry   NUMERIC,
  adj_receiving_epa_per_tgt   NUMERIC,
  raw_receiving_epa_per_tgt   NUMERIC,
  adj_passing_success_rate    NUMERIC,
  raw_passing_success_rate    NUMERIC,
  adj_rushing_success_rate    NUMERIC,
  raw_rushing_success_rate    NUMERIC,
  adj_receiving_success_rate  NUMERIC,
  raw_receiving_success_rate  NUMERIC,
  -- Strength of schedule faced in each role, in EPA per play. Positive means
  -- tougher defenses than average, so the adjustment moved the player up.
  pass_defense_faced          NUMERIC,
  rush_defense_faced          NUMERIC,
  rec_defense_faced           NUMERIC,
  seasons                     TEXT,
  computed_at                 TIMESTAMPTZ NOT NULL DEFAULT now()
);
