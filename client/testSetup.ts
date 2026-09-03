// Preloaded by `bun test` (see bunfig.toml). Registers a DOM so React can
// render, tells React it's an act() environment, and stubs the health fetch
// HomePage fires on mount so tests don't hit the network.
import { GlobalRegistrator } from "@happy-dom/global-registrator";

GlobalRegistrator.register();

// @ts-expect-error -- React reads this global to enable act() support.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

globalThis.fetch = (async () => ({
  ok: true,
  json: async () => ({ status: "ok", service: "test", timestamp: "" }),
})) as unknown as typeof fetch;
