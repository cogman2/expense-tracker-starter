// Preloaded by `bun test` (see bunfig.toml). Registers a DOM so React can
// render and tells React it's an act() environment. Specs keep themselves off
// the network with the axios adapter fake in src/testHttp.ts.
import { GlobalRegistrator } from "@happy-dom/global-registrator";

GlobalRegistrator.register();

// @ts-expect-error -- React reads this global to enable act() support.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
