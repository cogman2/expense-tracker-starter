// Preloaded by `bun test` (see bunfig.toml). Registers a DOM so React can
// render and tells React it's an act() environment. Specs keep themselves off
// the network with the axios adapter fake in src/testHttp.ts.
import { expect } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

GlobalRegistrator.register();

// @ts-expect-error -- React reads this global to enable act() support.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// jest-dom's DOM matchers (toBeInTheDocument, toBeDisabled, …) for every spec.
// Imported dynamically, and only here: it pulls in @testing-library/dom, whose
// `screen` binds to document.body the moment that module evaluates. A static
// import is hoisted above the registration call, so screen would bind before
// there is a document and every query would throw. The matching type
// augmentation lives in src/jest-dom.d.ts — this file sits outside tsconfig's
// `include`, so it cannot carry it.
const matchers = await import("@testing-library/jest-dom/matchers");

expect.extend(matchers);
