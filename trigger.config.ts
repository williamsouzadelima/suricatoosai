import { config } from "dotenv";
import { defineConfig } from "@trigger.dev/sdk";
import {
  additionalPackages,
  syncEnvVars,
} from "@trigger.dev/build/extensions/core";

if (process.env.NODE_ENV !== "production") {
  config({ path: ".env.local" });
}

export default defineConfig({
  project: process.env.TRIGGER_PROJECT_ID!,
  // centrifuge-js relies on globalThis.WebSocket, which is only stable on
  // Node 22+. The default "node" runtime is older and would throw
  // "WebSocket constructor not found" when CentrifugoSandbox connects.
  runtime: "node-22",
  logLevel: "log",
  // Up to four hours per agent-long run. The task stops active work slightly
  // earlier so cleanup can finish before Trigger.dev enforces this ceiling.
  maxDuration: 4 * 60 * 60,
  retries: {
    enabledInDev: false,
    default: {
      maxAttempts: 3,
      minTimeoutInMs: 1000,
      maxTimeoutInMs: 10000,
      factor: 2,
      randomize: true,
    },
  },
  dirs: ["./trigger"],
  build: {
    autoDetectExternal: true,
    keepNames: true,
    minify: false,
    // Native modules that must be installed at deploy time, not bundled.
    // @e2b/code-interpreter is pure JS and intentionally NOT listed here —
    // bundling it lets esbuild convert chalk's ESM to CJS inline, avoiding
    // the ERR_REQUIRE_ESM crash that occurs when Docker installs it via npm.
    external: ["node-pty", "sharp"],
    extensions: [
      additionalPackages({
        packages: ["node-pty", "sharp"],
      }),
      // Sincroniza as env vars das tasks (Agent Long) do .env.local para o
      // ambiente do Trigger.dev, tanto em `trigger dev` quanto em deploy.
      syncEnvVars(() => {
        const KEYS = [
          "WORKOS_API_KEY",
          "WORKOS_CLIENT_ID",
          "WORKOS_AUTH_DOMAIN",
          "WORKOS_COOKIE_PASSWORD",
          "NEXT_PUBLIC_WORKOS_REDIRECT_URI",
          "ACCOUNT_IDENTITY_HMAC_SECRET",
          "CONVEX_DEPLOYMENT",
          "NEXT_PUBLIC_CONVEX_URL",
          "CONVEX_SERVICE_ROLE_KEY",
          "CONVEX_USER_RESEARCH_SERVICE_KEY",
          "OPENROUTER_API_KEY",
          "OPENAI_API_KEY",
          "E2B_API_KEY",
          "E2B_TEMPLATE",
          "NEXT_PUBLIC_BASE_URL",
          "CENTRIFUGO_TOKEN_SECRET",
          "CENTRIFUGO_WS_URL",
          "AWS_S3_REGION",
          "AWS_S3_ACCESS_KEY_ID",
          "AWS_S3_SECRET_ACCESS_KEY",
          "AWS_S3_BUCKET_NAME",
          "AWS_S3_ENDPOINT",
          "PERPLEXITY_API_KEY",
          "JINA_API_KEY",
          "REDIS_URL",
          "UPSTASH_REDIS_REST_URL",
          "UPSTASH_REDIS_REST_TOKEN",
        ];
        return KEYS.filter((k) => process.env[k]).map((name) => ({
          name,
          value: process.env[name] as string,
        }));
      }),
    ],
  },
});
