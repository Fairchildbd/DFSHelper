# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v54.0.0/ before writing any code.

# Type scale

`fontSize` and `lineHeight` are ALWAYS wrapped in `getPixels()` from `src/theme.ts`.
Never write a raw number for either property — `fontSize: 13` is a bug, `fontSize:
getPixels(13)` is correct. Keep the unscaled design number as the argument, so the
scale stays readable and there is a single place to retune density.

`getPixels` multiplies by pixel density band: <2x unchanged, 2x ×1.15, 3x ×1.25,
3.5x and up ×1.3. It applies to text metrics only — padding, margins, gaps, border
radii and fixed widths stay in raw points.
