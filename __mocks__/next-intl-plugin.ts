// createNextIntlPlugin() returns a HOF that augments the Next config for i18n.
// In unit tests we don't need the build-time wiring, so pass the config through.
export default function createNextIntlPlugin(): (config: unknown) => unknown {
  return (config: unknown) => config;
}
