# CLAUDE.md

`PROJECT.md` outranks this file — see the first section.

Five sets of rules follow: **comments**, **TypeScript** and **code smells**, which
apply across the monorepo; **SQL**, which applies to `packages/server`; and **React
Native performance**, which applies to `packages/app`.

The React Native half is distilled from the official docs —
[Performance](https://reactnative.dev/docs/performance),
[Optimizing FlatList](https://reactnative.dev/docs/optimizing-flatlist-configuration),
[Optimizing JS loading](https://reactnative.dev/docs/optimizing-javascript-loading),
[Profiling](https://reactnative.dev/docs/profiling),
[Build speed](https://reactnative.dev/docs/build-speed) — and narrowed to what this
app actually does.

The type-scale rule (`getPixels` on every `fontSize`/`lineHeight`) lives in
`packages/app/AGENTS.md` and is not repeated here.

## PROJECT.md is authoritative

`PROJECT.md` holds the project's direction and its standing decisions, each tagged
**[settled]** or **[open]**. It outranks everything below.

- **Never break logic marked [settled].** Those rules have reasoning and tests behind
  them, and several encode failure modes that were found the expensive way — a ranking
  that looked plausible and was wrong. Changing one is a deliberate product decision, so
  it needs the user to ask for it by name. It is never a refactor, a cleanup, or a
  side effect of a change made for another reason.
- **If a rule below conflicts with PROJECT.md, PROJECT.md wins.** A code smell, a style
  rule, or a performance optimization does not justify altering documented behaviour.
  Report the conflict instead.
- **Read it before changing the engine.** Anything touching `packages/shared`,
  `rankings.ts`, `matchups.ts`, `lineups.ts`, or the ingest is in its scope.
- **[open] items are genuinely undecided** — raise them, don't resolve them unilaterally.
- **It is gitignored and local to this working copy.** If it is not present, say so and
  ask rather than assuming what it said; do not reconstruct it from the code, and do not
  commit it.

## Comments

**SQL comments the why.** SQL is not readable on its own, so the reasoning behind a
clause has nowhere else to live. This holds inside `` sql`` `` templates exactly as it
does in `schema.sql`.

**JavaScript and TypeScript carry none**, outside the two exceptions below. They are
readable, so a comment only adds a second thing to keep true: if a line needs
explaining, the name or the shape is wrong, and that is what to fix.

**Two exceptions, both cases where no name can carry the information:**

- **A complicated regex.** Put a worked example above it — what goes in, what comes out.
- **A type escape hatch.** Every `as unknown as` names the library or inference limit
  that forced it, in a comment above the cast. The cast says what the type is; only the
  comment says why the compiler had to be overruled, and without it the next reader
  cannot tell a library gap from a shortcut.

Nothing else. Not a section header, not a summary of the function below, not a note
about why a change was made. That last one belongs in the commit message.

## TypeScript

Applies to the whole monorepo. From the handbook's
[declaration do's and don'ts](https://www.typescriptlang.org/docs/handbook/declaration-files/do-s-and-don-ts.html).
All three packages compile `strict: true`, and `packages/shared` also sets
`declaration: true` — its `.d.ts` output is the surface `server` and `app` compile
against, so these rules apply to it literally rather than by analogy.

**As of this commit the codebase violates none of them**: no `any`, no boxed types,
no `@ts-ignore`, across 44 files. That is the state to preserve — these are far
cheaper to hold than to restore.

### General types

- **Lowercase primitives only.** `string`, `number`, `boolean`, `symbol` — never
  `String`, `Number`, `Boolean`, `Symbol`. Those are boxed wrapper objects and are
  almost never what JavaScript code means. Never `Object` either; if you genuinely
  mean "any non-primitive", the type is lowercase `object`.
- **`unknown`, never `any`.** `any` switches type checking off for everything it
  touches and everything downstream. `unknown` accepts the same values but forces a
  narrowing before use, which is the actual goal. `any` is defensible only mid-migration
  from JavaScript, and there is no such migration here.
- **A generic that never uses its type parameter is not generic.** It is an unchecked
  assertion wearing a type parameter's clothes, and inference fails silently.

### Callbacks

- **Callback return types are `void`, not `any`.** `void` is what stops a caller from
  quietly consuming a return value the callback was never meant to produce.
- **Never mark a callback's parameters optional.** Write
  `(data: T, elapsed: number) => void`, not `elapsed?: number`. Passing a function that
  accepts fewer arguments is always legal, so `?` buys nothing — what it actually
  communicates is "this callback is sometimes invoked with fewer arguments", which is a
  different claim and usually a false one.
- **Don't add an overload just to drop a callback parameter.** One signature taking the
  fuller callback covers both; the shorter overload only lets wrongly-typed functions
  match.

### Overloads

- **Prefer optional parameters to multiple overloads.** One
  `diff(one: string, two?: string, three?: boolean)` beats three signatures. Overloads
  hide argument-count bugs that optional parameters surface.
- **Prefer union parameters to one overload per type.** `utcOffset(b: number | string)`
  beats separate `number` and `string` overloads, because a union forwards correctly
  when a caller passes a value straight through — separate overloads produce spurious
  errors there.
- **When overloads are genuinely necessary, order them most-specific first.**
  TypeScript picks the first match, so a general signature placed above a specific one
  makes the specific one unreachable.

### Escape hatches

`as unknown as` is the only type escape in the codebase and there are exactly four.
Treat every one as a debt, not a pattern:

- `api.ts:278` and `api.ts:383` widen the `as const` tuple `SHAPE_ORDER` to `string[]`
  for a query parameter. `[...SHAPE_ORDER]` does the same widening and type-checks —
  prefer it.
- `rankings.ts:300` casts a postgres.js query to `Promise<MeasurableRow[]>`. A library
  typing gap; leave it, and keep the row type honest.
- `lineups.ts:586` reads `note` off a `LineupPick`, which does not declare it. The
  property does survive at runtime — the solver builds picks with `...player`, so the
  server's richer pool object keeps its fields — but the type has lost it. This one is
  a real modelling gap: the fix is to make the solver generic over its candidate type
  so extra fields survive in the types too, not to add another cast.

Every one carries a comment naming the library or inference limit that forced it — one
of the two cases where a comment belongs in TypeScript. Reaching for `any` or
`@ts-ignore` instead is not the alternative.

## Code smells

A smell is an indicator, not a verdict. It says a value may be under threat —
evolvability, correctness, production efficiency, continuous improvement — and it earns
action when it makes code unchangeable. None of these is a dogma. A smell you can name
and justify is not a defect; a smell nobody noticed is.

Read this list as a lookup for naming what's wrong, A to Z.

**A note on framing.** Much of this vocabulary is class-oriented, and this codebase has
two classes total (`Book` in `ingest/pbp.ts`, `MissingSeasonError` in `nflverse.ts`)
against 112 exported functions and 93 interfaces. The unit of encapsulation here is the
**module**, and secondarily the React component. Entries below are written against that
unit — "class" reads as "module, component, or exported type" unless it says otherwise.
Three entries have no purchase at all on a codebase with no inheritance and are marked
*n/a here*: keep them in the list, because the day someone adds a hierarchy is exactly
the day they matter.

- **Afraid To Fail** — Guard checks piled outside a function's scope to dodge an
  exception. A function that can fail should fail explicitly.
- **Alternative Classes with Different Interfaces** — Two modules exposing different
  signatures for the same action. Merge them, or extract the shared one.
- **Base Class Depends on Subclass** — A parent that must change when a child does.
  Parents don't know their children. *n/a here* — no inheritance.
- **Binary Operator in Name** — `fetchAndParse`, `loadOrCreate`. The "and" is the
  function admitting it does two things. Split it.
- **Boolean Blindness** — At the call site, `true` says nothing about what it selects.
  Don't take boolean parameters; take a named option or two functions.
- **Callback Hell** — Callbacks are fine; chaining them isn't. Sequence small
  interchangeable steps instead.
- **Clever Code** — Showing off ends in code you can't read either. Optimize for the
  reader.
- **Combinatorial Explosion** — Large if/else arms doing almost the same thing.
  Separate and delegate.
- **Complicated Boolean Expression** — Conditions welded together behind a
  function-shaped name. Prefer `shouldBeConsumed(bottle)` to `bottle.consumed()`.
- **Complicated Regex Expression** — A pattern nobody can read. The one place a
  comment is warranted: put a worked example above it.
- **Conditional Complexity** — Nested branching that turns reading into a memory game.
  Split the paths.
- **Data Clump** — The same few values travelling together everywhere. They are a type
  that hasn't been declared yet.
- **Dead Code** — Unreachable or unused. Git remembers it; delete it now.
- **Divergent Change** — One module changing for several unrelated reasons. It holds
  several responsibilities. Divide it.
- **Dubious Abstraction** — A name pitched at the wrong level. Each function should
  descend exactly one level of abstraction below its own name.
- **Duplicated Code** — Second worst thing in the file, after dead code.
- **Fallacious Comment** — A comment explaining WHAT becomes a lie as the code moves.
  In SQL, rewrite it to the why; in JavaScript, delete it. See *Comments*.
- **Fallacious Method Name** — `getBeer()` returning soda water. The name is a promise;
  keep it or change it.
- **Fate over Action** — Assuming nothing else mutates the object you're holding. Don't
  depend on state you don't own.
- **Feature Envy** — A function more interested in another module's data than its own.
  Move it to the data.
- **Flag Argument** — A parameter that selects between whole behaviours. That's two
  functions wearing one name.
- **Global Data** — Global scope available to everyone makes the whole app one scope.
  Encapsulate, and link only where needed.
- **Hidden Dependencies** — A call that quietly resolves what it needs. Invert it: let
  the caller supply the goods.
- **Imperative Loops** — Index-walking loops are error-prone and harder to read.
  Prefer array pipelines *where the data is already in memory* — see the exception below.
- **Inappropriate Static** — Fixing behaviour that should vary. Reserve statics for what
  will never change.
- **Incomplete Library Class** — A library that covers 90% is not a reason to rewrite
  it. Extend it for the rest.
- **Inconsistent Names** — car / vehicle / automobile for one concept. Pick one word and
  hold the line.
- **Inconsistent Style** — Per-author formatting. Agree a convention and stick to it.
- **Indecent Exposure** — Internals visible to the outside. Export only what callers
  genuinely need; the rest stays module-private.
- **Insider Trading** — Modules that know too much about each other. Narrow the contact
  surface to the minimum that works.
- **Large Class** — Logic appended to an existing module because it was open, adding a
  second responsibility. Start a new one.
- **Lazy Element** — Over-separation: an element too thin to justify existing. Fold it
  back in. Small is good, granular past usefulness is not.
- **Long Method** — Harder to understand, change, and extend; you read far more than
  you write. Keep them short and precise.
- **Long Parameter List** — 0–2 fine, 3 questionable, 4+ a problem. Bundle into an
  options object.
- **Magic Number** — A bare `1000` or `99` in a condition. Name it — the constant is
  the explanation.
- **Message Chain** — `a.b().c().d()` to reach one value. Don't ask through a chain;
  give a command with everything it needs.
- **Middle Man** — A module that only forwards to another. Remove the hop.
- **Mutable Data** — Shared mutable state causes bugs that only appear rarely. Freeze,
  copy, or avoid the reference.
- **Null Check** — Null and undefined checks scattered everywhere. Handle absence in
  one place rather than at every use — but see the exception below.
- **Obscured Intent** — Compressed code that reads as clever to you and opaque to
  everyone else. Fewer lines is not the goal.
- **Oddball Solution** — The same problem solved two different ways in two places.
  Unify behind one interface.
- **Parallel Inheritance Hierarchies** — Subclassing one tree forces a subclass in
  another. Collapse them. *n/a here* — no inheritance.
- **Primitive Obsession** — A `string` or `number` standing in for a concept. Give the
  concept a type.
- **Refused Bequest** — Inheriting everything and using a subset. Prefer composition.
  *n/a here* — no inheritance.
- **Required Setup or Teardown Code** — A value that isn't usable until you finish
  initializing it by hand. Construct it complete.
- **Shotgun Surgery** — One change forcing edits across many files. One reason to
  change should mean one place to change.
- **Side Effects** — Work a function does beyond what its name promises. One
  responsibility, one thing at a time.
- **Special Case** — An elaborate condition guarding the real work. Handle the case
  properly or supply a default.
- **Speculative Generality** — Machinery built for a future that never arrives. Solve
  today's problem.
- **Status Variable** — A variable holding "what's happening", switched on later. Use
  an enum or a proper method.
- **Temporary Field** — Fields populated only in certain situations — day, month, year,
  plus combinations. Derive instead of storing.
- **Tramp Data** — Data threaded through a long call chain that no intermediate
  actually uses. Keep behaviour near its data.
- **Type Embedded in Name** — `playerArray`, `nameStr`. The type annotation already
  says it; don't say it twice.
- **Uncommunicative Name** — Misleading or meaningless names. The bar is meaningful,
  not merely short.
- **Vertical Separation** — Declaration far above use. Introduce variables where they
  are used.
- **"What" Comment** — A comment narrating the code below it is usually hiding another
  smell. Be suspicious of what follows one. See *Comments*.

### Two exceptions this codebase has already decided

Both are deliberate. Don't "fix" them without reading the reasoning first.

- **Imperative loops in the ingest are correct.** `for await (const r of streamCsv(...))`
  exists so a season of play-by-play never lands in memory at once, and
  `insertBatched` chunks writes because a single multi-megabyte statement will not fly.
  Array pipelines there would mean materializing the whole file. The smell applies to
  in-memory collections, not to streams.
- **Nullable domain values are the model, not missing null-object handling.**
  `matchupScore: number | null`, `athletic_score`, `qualified` — null means *unmeasured*,
  and that is a distinct, documented state from zero or false. The engine's whole
  confidence mechanism exists to carry it. Collapsing these to a default would destroy
  the distinction the ranking model is built on. The Null Check smell still applies to
  incidental defensive checks; it does not apply to these.

### Verified today

Checked, not assumed, against the current tree:

- **No flag arguments and no boolean parameters** anywhere in `src`. Keep it that way.
- **Long Method, two real cases.** `loadDvoa` (`ingest/dvoa.ts:131`) runs about 490
  lines; `computeRankings` (`rankings.ts:274`) about 240. Both are pipelines with
  genuine sequential stages, so the fix is extracting named stages, not splitting for a
  line count.
- **`createApp` (`api.ts:99`) is long but is a route table** — its length is structural,
  and each handler is short. Not a smell; noted so it doesn't get "fixed".

## SQL

Applies to `packages/server`, which is where all SQL lives: `src/schema.sql` plus tagged
templates in `api.ts`, `rankings.ts`, `matchups.ts`, `lineups.ts`, `prune.ts` and the
`ingest/` modules. From
[Metabase's SQL best practices](https://www.metabase.com/learn/sql/working-with-sql/sql-best-practices).

**The order is the rule.** Correctness, then readability, then optimization. A query
that is fast and wrong is worthless, and a query nobody can read cannot be shown to be
either. Do not reorder these under time pressure.

### Comments

Comment the **why** — the one place in this repo where comments belong. A query's
*what* is already in the SQL; what the reader cannot recover is the reasoning. `api.ts:119` is the model
to copy — it explains that `gsis_id` is in the `ORDER BY` to force a total order,
because without it a row can appear on two consecutive pages.

### SELECT

- **Name the columns. Never `SELECT *` in committed code.** `SELECT *` is for
  exploration at a psql prompt; in the repo it is a promise to break the moment a column
  is added. There is currently none.

### FROM and JOIN

- **Explicit `JOIN ... ON`, never joins implied through `WHERE`.** It keeps join
  conditions visually distinct from filters.
- **Alias tables once the query has more than one**, and reference every column through
  its alias. The reader should never have to work out which table a bare column came
  from.

### WHERE

- **No functions on a filtered column.** `WHERE lower(name) = 'x'` is non-sargable — it
  forbids the index. Filter on the raw column, or build a functional index deliberately.
- **`=` over `LIKE`** whenever the comparison is exact.
- **Never lead a `LIKE`/`ILIKE` pattern with a wildcard.** `'foo%'` can use an index;
  `'%foo%'` forces a full scan. See *Verified today* — this repo has two.
- **`EXISTS` over `IN` for existence checks.** `EXISTS` stops at the first match; `IN`
  scans.
- **Filter before aggregating.** `WHERE` narrows the rows going into the aggregate;
  `HAVING` is only for conditions on the aggregate itself. Using `HAVING` to do a
  `WHERE`'s job means aggregating rows you were about to discard.

### GROUP BY, UNION, ORDER BY

- **Group by descending cardinality** — the most distinct column first.
- **`UNION ALL` unless you actually need deduplication.** Plain `UNION` pays to sort and
  discard duplicates whether or not any exist.
- **Sorting is expensive; don't sort where it doesn't show.** Especially inside a
  subquery, where the outer query is free to discard the order anyway. An `ORDER BY` in
  the outermost query that feeds pagination is not this — that one is correctness.

### CTEs

Use `WITH` to lift complex logic out of the main query. A long subquery inlined in the
middle of a statement interrupts the sentence; a named CTE reads as a step. Name the CTE
for what it produces.

### Injection defense

Matters more here than anything above. From
[DataCamp's SQL injection tutorial](https://www.datacamp.com/tutorial/sql-injection).
The attack classes it names — error-based, union-based, boolean-blind, time-based,
out-of-band, and stored (second-order) — all depend on the same root cause, and one
defense closes all of them.

**Never build a query by gluing strings together.** Parameterization is the cornerstone;
everything else on this list is depth behind it.

- **The `sql` tagged template parameterizes automatically — stay inside it.** In
  `` sql`... WHERE position = ${position}` ``, `position` is sent as a bind parameter.
  The database is told the query structure and the data separately and never mixes them,
  so a value containing `' OR 1=1--` is compared as a string, not parsed as SQL. This is
  the default, and it is the whole defense.
- **`sql.unsafe` does raw substitution.** It is the only injection surface in the
  repo. Anything reaching it is SQL, not data.
- **Identifiers can't be parameterized, so allowlist them.** A table or column name
  cannot be a bind parameter. When one must be dynamic, it comes from a hardcoded map or
  `as const` array and unmapped input is *skipped*, never passed through.
  `ingest/college.ts:108` is the pattern to copy: external API values index into the
  hardcoded `STAT_COLUMNS` map and `if (!column) continue` drops anything unrecognized,
  so only literal column names from that map ever reach SQL.
- **A request value must never reach `sql.unsafe`** — not `req.query`, `req.body`, or
  `req.params`, not after escaping, not after a regex check. Escaping is not a substitute
  for parameterization.
- **Second-order counts.** Data that arrives from nflverse, CFBD, or a DraftKings CSV is
  untrusted the *second* time too — being in the database already does not launder it.
  The allowlist rule above is what protects the ingest path.
- **Validate and narrow at the boundary, as a second layer.** Coerce with `Number()`,
  clamp ranges, narrow strings to unions. `api.ts` already does this: `limit` is capped
  at 200, `contest` collapses to `'showdown' | 'classic'`, and every free string is
  `typeof`-checked. This is defense in depth, not the primary defense.
- **Never return a database error to a client.** Driver messages carry table names,
  column names, and constraint names — the reconnaissance that error-based injection
  runs on. Log the real error server-side, return something generic.
- **Least privilege.** The API only reads. A role that cannot write cannot be made to
  write, whatever gets through.

Stored procedures, ORMs, and a WAF are the tutorial's other recommendations; none
applies here. postgres.js tagged templates already give what an ORM would, and a WAF is
perimeter defense for a service that is not yet exposed.

### Schema

Follow what `schema.sql` already establishes: `snake_case` tables and columns,
`CREATE TABLE IF NOT EXISTS` so migration stays idempotent, explicit composite primary
keys on the natural key, and indexes named `<table>_<columns>_idx`. Every index costs
write throughput on an ingest that writes in bulk, so add one for a query you can name.

### Verified today

Checked against the current tree, not assumed.

**Injection audit — clean on every path:**

- **Every request value is parameterized.** All of `req.query`, `req.params`, and
  `req.body` in `api.ts` reaches SQL only through tagged-template interpolation, i.e.
  as bind parameters. No string concatenation into a query anywhere.
- **All eight `sql.unsafe` call sites take hardcoded input.** `PRUNABLE` is an
  `as const` array of three literal table names; `normalizeSql` is called with literal
  column names; `migrate.ts` executes the schema file; and `prune.ts:68`'s one varying
  value, the season cutoff, is correctly bound as `$1`. No request value reaches any of
  them.
- **`insertBatched`'s identifiers are hardcoded.** It builds its column list from
  `Object.keys(rows[0])` and interpolates it through `sql.unsafe`, which would be a
  second-order path if any ingest built row objects with externally-derived keys. None
  does: every ingest writes literal keys, and the one dynamic case
  (`ingest/college.ts:108`) resolves through the `STAT_COLUMNS` allowlist and skips
  unmapped input. The table name and values go through postgres.js's `sql()` helper,
  which escapes identifiers.
- **Input is narrowed at the boundary** — type checks, `Number()` coercion, a clamped
  `limit`, and union-narrowed `contest`.

**Two gaps, both hardening rather than live vulnerabilities:**

1. **`api.ts:564` returns the raw error message to the client** —
   `res.status(500).json({ error: err.message })`. For a Postgres failure that is the
   driver's text, which names tables, columns, and constraints. Nothing today can
   inject, but this is exactly the reconnaissance surface error-based injection needs,
   and it leaks schema shape to anyone who can trigger a 500. `console.error(err)` on
   the line above already keeps the real error server-side, so the fix is to return a
   generic message and, if a correlation id is wanted, log one.
2. **The API connects as the Neon owner role.** `DATABASE_URL` is one connection string
   shared by the API and the ingest, so the read-only API process holds full DDL rights.
   `api.ts` contains no `INSERT`, `UPDATE`, `DELETE`, or DDL — it is entirely reads — so
   a second role with `SELECT`-only grants, used by the API while ingest keeps the owner
   string, would cost one environment variable and bound the blast radius of anything
   that ever does get through.

**SQL style, also verified:**

- **No `SELECT *` anywhere.** Keyword case and `snake_case` naming are consistent, and
  the schema's `<table>_<columns>_idx` index convention holds without exception.
- **Two leading-wildcard searches.** `api.ts:158` and `api.ts:173` run
  `display_name ILIKE '%' + search + '%'` against `rankings`, indexed only on
  `(position, composite)` and `(composite)` — so player search is a sequential scan.
  Safe (the pattern is a bound parameter), just unindexed. A few thousand rows makes it
  cheap today; if search gets slow the fix is a `pg_trgm` GIN index, not a rewrite.
- **`normalizeSql` deliberately breaks the sargability rule.**
  `regexp_replace(lower(unaccent(col)), ...)` wraps a column in three functions to link
  college names to NFL names. A knowing trade: it runs once per college ingest, not per
  request. If it ever moves onto a request path, the answer is a functional index or a
  stored `name_key` column.

## The budget everything else follows from

60fps means **16.67ms per frame**. Work that overruns it drops frames.

Two threads, and knowing which one is stalled determines the fix:

- **JS thread** — business logic, React rendering, API calls, touch handling. When it
  stalls, animations freeze and taps feel late.
- **UI thread** — native view rendering, scrolling, native navigation transitions. It
  runs independently, so a stalled JS thread does not necessarily stall scrolling.

## Never judge performance in a dev build

`dev=true` slows the JS thread enough to hide and invent problems in equal measure.
Any claim about this app being fast or slow — and any profiling trace — must come from
a release build. This is the first question to ask about a performance report, before
changing a line.

## Lists

Both list screens (`RankingsScreen`, `BestBallScreen`) render `FlatList`. Rules, in
rough order of payoff:

- **`renderItem` is never an inline arrow in JSX.** Define it above the return and wrap
  it in `useCallback`, so a new function identity doesn't invalidate every row on each
  parent render. Both current lists violate this; see *Known gaps*.
- **`keyExtractor` is required** — already correct in both lists (`gsis_id`, `game_id`).
  It is what lets the list cache and re-order rows instead of re-rendering them.
- **`getItemLayout` only when rows are genuinely a fixed height.** It removes async
  layout measurement and is the single biggest list win, but it is a promise about
  geometry: supply it and every row must actually be `ITEM_HEIGHT`. `PlayerRow` renders
  a conditional role note, so it is variable-height today — either drop that line into a
  fixed-height slot first, or leave `getItemLayout` off. A wrong `getItemLayout` is
  worse than none.
- **`initialNumToRender`** (default 10) should cover the viewport and no more. Rows here
  are tall and dense; if fewer than 10 fill a screen, lower it — it is pure startup cost.
- **`windowSize`** (default 21 viewports) trades memory against blank space while
  scrolling. Raise it only to fix observed blanking, lower it only to fix observed
  memory pressure. Do not tune it speculatively.
- **`maxToRenderPerBatch`** (default 10) and **`updateCellsBatchingPeriod`** (default
  50ms) trade fill rate against responsiveness: bigger or more frequent batches mean
  less blank space but longer JS blocks. Change them as a pair, and only against a trace.
- **`removeClippedSubviews`** is already `true` on Android and `false` elsewhere. Leave
  it. It has known bugs on iOS (content going missing) and detaches views without
  deallocating them, so the memory win is smaller than it sounds.

## List items

`PlayerRow` and `MatchupRow` are list items and are held to a stricter standard than
other components:

- **Wrap them in `memo()`.** A list item that re-renders when its props are unchanged is
  the default cause of scroll jank. Neither is memoized today.
- **Keep them structurally simple.** Shallow nesting, minimal branching, no expensive
  derivation in the render path. Detail belongs in `PlayerDetailScreen` /
  `MatchupDetailScreen`, which is already the shape here.
- **No heavy images.** If rows ever show headshots (`headshot_url` is already on
  `RankedPlayer`), use a thumbnail-sized source and a caching image component — every
  row is a fresh image instance, and slow decodes land on the JS thread.
- **Expensive `onPress` work goes inside `requestAnimationFrame`**, so the pressed-state
  feedback paints before the work starts. Current handlers just call `setState` on the
  parent, which is fine as is.

## Startup and JS loading

- Hermes is the engine (Expo default). It ships bytecode compiled ahead of time, so
  **RAM bundles do not apply** — they are mutually exclusive with Hermes and offer
  nothing over it.
- **Nothing runs at module scope.** No `global.x = ...`, no client construction, no
  event subscriptions at import time. Module side effects break lazy loading and cause
  order-dependent crashes once inlining is on. `src/api.ts` currently reads
  `process.env.EXPO_PUBLIC_API_URL` into a constant, which is fine — a pure read is not
  a side effect.
- **Screen-level `React.lazy` + `Suspense` is the right granularity** if startup needs
  work. `App.tsx` eagerly imports all six screens, including `AboutScreen` (758 lines)
  and `MatchupDetailScreen` (807), on a tab that may never open. Do not lazy-load below
  screen level — the overhead stops paying.
- The RN docs state that Expo disables Metro's automatic inline requires and that a
  `metro.config.js` with `transform.inlineRequires` re-enables it. Verify that against
  the installed `expo/metro-config` before adding one; recent Expo versions may already
  enable it, and the config would be noise.
- Keep `console.*` out of shipped code — it is a real JS-thread cost, not a rounding
  error. The app has none today. If logging is ever added, strip it in production with
  `babel-plugin-transform-remove-console` rather than by hand.

## Animation and moving views

None of this is in the app yet; it applies the moment it is.

- **`Animated` with `useNativeDriver: true`** for anything interruptible;
  **`LayoutAnimation`** for fire-and-forget transitions, which run on Core Animation and
  survive JS-thread stalls.
- **Animate `transform: [{ scale }]`, never `width`/`height`.** Size animation re-crops
  and rescales from the original every frame.
- If a complex static subtree is being moved, `renderToHardwareTextureAndroid` (iOS
  rasterizes by default) — then turn it off when the animation ends, because it costs
  memory. Never enable `needsOffscreenAlphaCompositing`.
- Do not create new views mid-animation. Defer construction until the interaction ends.

## Profiling

- Development mode **off**, always.
- Android: Android Studio Profiler → *Capture System Activities*, run the interaction,
  stop, and read it there or export to Perfetto. Standalone `systrace` is deprecated.
  iOS: Instruments.
- Enable VSync highlighting to see the 16ms boundaries, then read the threads:
  `mqt_js` (`JSCall`) is the JS thread, the UI thread carries `Choreographer` and
  `traversals`, and `DrawFrame`/`queueBuffer` is the render thread.
- **JS thread work crossing frame boundaries** → cut re-renders and state-update
  frequency. **UI/render thread crossing them** → too much GPU work or views being
  created during the animation.
- For native hotspots use *Find CPU Hotspots (Java/Kotlin Method Recording)*. It
  distorts absolute timings, so read it proportionally.

## Build speed

Mostly inapplicable while this stays a managed Expo app — there is no `android/` or
`ios/` directory, and both are gitignored. After an `expo prebuild`, these matter:

- **Build one ABI in development.** Android builds all four by default; restricting it
  cuts native build time by roughly 75%. `--active-arch-only`, or
  `reactNativeArchitectures=` in `android/gradle.properties`. **Remove it for release
  builds** — a one-ABI release ships broken to most devices.
- **`org.gradle.configuration-cache=true`** in `android/gradle.properties` (RN 0.79+).
- **ccache** for native compiles: `brew install ccache`, and uncomment `ccache_enabled`
  in `ios/Podfile`. Check it is working with `ccache -s`.

## Known gaps — React Native

The TypeScript debts are listed under *Escape hatches* above. These are the React
Native ones: real, verified, and unfixed as of this commit. Fix them when
touching the surrounding code; do not treat the list as done work.

1. `RankingsScreen.tsx:169` and `BestBallScreen.tsx:175` pass inline arrow functions as
   `renderItem`.
2. `PlayerRow` and `MatchupRow` are not wrapped in `memo()`.
3. Neither list sets `initialNumToRender` or `windowSize`; both run on defaults tuned
   for shorter rows than these.
4. `App.tsx` imports all six screens eagerly.

None has been profiled. Measure in a release build before changing any of them — the
point of this file is to make the fix obvious once a trace says which one matters, not
to authorize a speculative rewrite.
