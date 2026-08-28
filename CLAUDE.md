# CLAUDE.md

Two sets of rules: **TypeScript**, which applies across the monorepo, and **React
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

Adding a fifth requires a comment saying which library or inference limit forced it.
Reaching for `any` or `@ts-ignore` instead is not the alternative.

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
