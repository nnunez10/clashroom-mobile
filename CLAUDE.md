# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm start          # Start Expo dev server (opens QR code / tunnel)
npm run android    # Build and run on Android emulator
npm run ios        # Build and run on iOS simulator
npm run web        # Start web version
npm run lint       # Run ESLint via expo lint
```

There are no tests in this project. To run on a physical device use a development build (`expo-dev-client` is included) rather than Expo Go.

## Environment Setup

Create a `.env` file in the repo root (no `.env.example` exists — create it manually). All keys are loaded via `dotenv` in `app.config.js` and injected into `Constants.expoConfig.extra` at build time. Required for full functionality:

```
FACTCHECK_GOOGLE_API_KEY=...   # Google Fact Check Tools API
NEWS_API_KEY=...               # NewsAPI.org (fallback)
```

All feature flags and tuning knobs (`CR_*` env vars) have safe defaults and are optional.

## Architecture

### Routing

Expo Router (file-based). The only real screen is `app/(tabs)/index.tsx`. The tab bar is explicitly hidden (`tabBarStyle: { display: "none" }`), so this is effectively a single-screen app.

`app/_layout.tsx` is the root — it wraps everything in `GestureHandlerRootView` + `BottomSheetModalProvider`. Both wrappers are required at the root for the widget drag gesture and the bottom sheet to work.

Path alias `@/` resolves to the repo root (configured in `tsconfig.json`).

### UI Components

**`components/ClashBotWidget.tsx`** — The floating draggable bubble (positioned absolutely). Uses `react-native-gesture-handler` + `react-native-reanimated` for pan/snap-to-edge behavior and tap handling. The parent (`HomeScreen`) positions it via an absolute-positioned `style` prop. Accepts a `tone` prop (`"unverified" | "checking" | "verified" | "disputed"`) that drives gradient colors and pulse animation.

**`components/ClashBotSheet.tsx`** — A `@gorhom/bottom-sheet` `BottomSheetModal` that displays the list of claims. Snap points: `["22%", "55%", "80%"]`. Driven by `isOpen` prop; parent manages open/close state. Exports the `Claim` type used by the UI layer.

### Verification Engine (`lib/clashbot/`)

- **`types.ts`** — Core types: `VerificationResult`, `FactCheckMatch`.
- **`verify.ts`** — `verifyClaimText(text)`: tries Google Fact Check first, falls back to NewsAPI. Returns a `VerificationResult`.
- **`extractClaims.ts`** — NLP heuristics to extract claim-like sentences from a transcript line. Scores sentences by "claim-iness" (verbs, numbers, named entities, absolutes). Exports the engine-layer `Claim` type (distinct from the UI-layer `Claim` in `ClashBotSheet`).
- **`providers/googleFactCheck.ts`** — Calls `factchecktools.googleapis.com`. Returns `status: "matched"` with structured fact-check reviews.
- **`providers/newsapi.ts`** — Calls `newsapi.org/v2/everything` as a fallback. Returns `status: "matched"` with articles mapped to `FactCheckMatch` (these are coverage results, not verdicts).
- **`useMockClashBotEngine.ts`** — Full React hook wiring transcript → claim extraction → `verifyClaimText` pipeline. Includes dedup via fingerprint, demo-mode mock stream, and relevance gating (entity/number overlap check) to filter low-quality matches. **Not yet wired to `HomeScreen`** — the screen currently uses a manual `addClaim` stub.
- **`mockStream.ts`** — Simulated speech transcript for demo mode.

### Two `Claim` types

There are two distinct `Claim` types:
- `lib/clashbot/extractClaims.ts` → engine `Claim` (has `ts`, `status: ClaimStatus`, `verification: VerificationResult`)
- `components/ClashBotSheet.tsx` → UI `Claim` (has `createdAt`, `verdict: Verdict`, `verification: any`)

When wiring the engine to the UI, map between them.

### Styling conventions

- Dark-only app. Background: `#071117`. Sheet background: `#0B0F14`.
- Brand accent: `rgba(34,211,238,x)` (cyan).
- All styles use `StyleSheet.create`. No external style library.
- `StyleSheet.hairlineWidth` for borders.

### Babel

`babel.config.js` includes `react-native-reanimated/plugin`. This must remain the last plugin. Reanimated worklet functions require the `"worklet"` directive string at the top of the function body.

### Build config

`app.config.js` (not `app.json`) is the live Expo config. It applies a custom `withAppComponentFactoryFix` plugin to resolve an Android manifest merger conflict. Android package: `com.noe.clashroom`. EAS project ID: `0045f94b-6679-4195-87b3-abfbf6d3f45a`.
