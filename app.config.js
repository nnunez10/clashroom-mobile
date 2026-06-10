// app.config.js

require("dotenv").config();

function env(name, fallback = "") {
  const v = process.env[name];
  return typeof v === "string" ? v.trim() : fallback;
}

function envBool(name, fallback = false) {
  const v = env(name, "");
  if (!v) return fallback;
  return ["1", "true", "yes", "y", "on"].includes(v.toLowerCase());
}

function envNum(name, fallback) {
  const raw = env(name, "");
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

module.exports = ({ config }) => {
  /**
   * Core App Identity
   */
  config.name = "ClashRoom";
  config.slug = "clashroom-mobile";
  config.version = "1.0.0";

  config.orientation = "portrait";
  config.userInterfaceStyle = "dark";
  config.scheme = "clashroom";

  /**
   * MAIN APP ICON (Launcher Icon)
   */
  config.icon = "./assets/images/clashroom-icon-main.png";

  /**
   * Splash Screen
   */
  config.splash = {
    image: "./assets/images/splash-icon.png",
    resizeMode: "contain",
    backgroundColor: "#000000",
  };

  /**
   * iOS
   */
  config.ios = {
    supportsTablet: true,
  };

  /**
   * Android Configuration
   */
  config.android = {
    package: "com.noe.clashroom",
    softwareKeyboardLayoutMode: "resize",
    adaptiveIcon: {
      foregroundImage: "./assets/images/clashroom-adaptive-foreground.png",
      backgroundColor: "#0B0F14",
    },
  };

  /**
   * Expo Plugins
   */
  config.plugins = [
    [
      "expo-build-properties",
      {
        android: {
          usesCleartextTraffic: true,
        },
      },
    ],
    [
      "expo-speech-recognition",
      {
        microphonePermission:
          "Allow ClashRoom to use the microphone for push-to-claim drafts.",
        speechRecognitionPermission:
          "Allow ClashRoom to turn speech into claim drafts.",
      },
    ],
  ];

  /**
   * Extra config (EAS + API keys + feature flags)
   * Accessible in app via:
   *   Constants.expoConfig?.extra
   */
  const appEnv = env("APP_ENV", "development");

  config.extra = {
    ...(config.extra || {}),

    // Environment
    APP_ENV: appEnv,

    // ---- API Keys (current + future) ----
    // Current:
    FACTCHECK_GOOGLE_API_KEY: env("FACTCHECK_GOOGLE_API_KEY"),
    NEWS_API_KEY: env("NEWS_API_KEY"),

    // Future options (safe to leave blank until needed):
    BING_NEWS_API_KEY: env("BING_NEWS_API_KEY"),
    TAVILY_API_KEY: env("TAVILY_API_KEY"),
    SERPAPI_KEY: env("SERPAPI_KEY"),
    BRAVE_SEARCH_API_KEY: env("BRAVE_SEARCH_API_KEY"),
    EXA_API_KEY: env("EXA_API_KEY"),

    // Optional future backend / analytics:
    SUPABASE_URL: env("SUPABASE_URL"),
    SUPABASE_ANON_KEY: env("SUPABASE_ANON_KEY"),
    SENTRY_DSN: env("SENTRY_DSN"),

    // ---- Verification Behavior (future-proof controls) ----
    // You can read this in code and decide fallback order.
    // Example: "google_factcheck,newsapi,brave,serpapi"
    CR_PROVIDER_ORDER: env("CR_PROVIDER_ORDER", "google_factcheck,newsapi"),

    // Feature flags
    CR_ENABLE_NEWS_FALLBACK: envBool("CR_ENABLE_NEWS_FALLBACK", true),
    CR_ENABLE_CACHE: envBool("CR_ENABLE_CACHE", true),
    CR_ENABLE_AUTOSCROLL: envBool("CR_ENABLE_AUTOSCROLL", true),
    CR_ENABLE_PULSE_ANIMATION: envBool("CR_ENABLE_PULSE_ANIMATION", true),

    // Engine tuning knobs (so you can tweak without code edits)
    CR_CLAIM_COOLDOWN_SECONDS: envNum("CR_CLAIM_COOLDOWN_SECONDS", 6),
    CR_MAX_TRANSCRIPT_LINES: envNum("CR_MAX_TRANSCRIPT_LINES", 10),
    CR_MAX_CLAIMS: envNum("CR_MAX_CLAIMS", 20),

    // EAS
    eas: {
      projectId: "0045f94b-6679-4195-87b3-abfbf6d3f45a",
    },
  };

  return config;
};
