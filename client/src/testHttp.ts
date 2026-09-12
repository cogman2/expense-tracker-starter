// Fakes HTTP for the specs by swapping the axios instance's adapter, so the
// real lib/api module (and its error handling) stays under test.
//
// This is deliberately NOT mock.module("@/lib/api"): module mocks are global to
// the whole `bun test` process and leak across spec files — one file's partial
// stub becomes every other file's version of the module. The adapter is plain
// instance state, restorable in afterEach.
import type { AxiosAdapter, InternalAxiosRequestConfig } from "axios";
import { AxiosError } from "axios";
import { api } from "./lib/api";

export interface FakeResponse {
  status: number;
  data?: unknown;
  /** Never settle, to exercise a component's in-flight state. */
  pending?: boolean;
}

export type FakeHandler = (
  config: InternalAxiosRequestConfig,
) => FakeResponse | Promise<FakeResponse>;

const originalAdapter = api.defaults.adapter;
let seen: InternalAxiosRequestConfig[] = [];

/** Every request the adapter saw since the last fakeHttp/restoreHttp, in order. */
export function httpCalls(): InternalAxiosRequestConfig[] {
  return seen;
}

export function fakeHttp(handler: FakeHandler): void {
  seen = [];
  const adapter: AxiosAdapter = async (config) => {
    seen.push(config);
    const result = await handler(config);
    if (result.pending) {
      return new Promise(() => {});
    }
    const response = {
      data: result.data,
      status: result.status,
      statusText: String(result.status),
      headers: {},
      config,
      request: {},
    };
    // Mirrors axios's own settle (lib/core/settle.js) so non-2xx rejects with a
    // genuine AxiosError carrying the response — which is what apiErrorMessage
    // reads and what isAxiosError branches on.
    if (!config.validateStatus || config.validateStatus(result.status)) {
      return response;
    }
    throw new AxiosError(
      `Request failed with status code ${result.status}`,
      result.status >= 400 && result.status < 500
        ? AxiosError.ERR_BAD_REQUEST
        : AxiosError.ERR_BAD_RESPONSE,
      config,
      response.request,
      response,
    );
  };
  api.defaults.adapter = adapter;
}

/** Convenience for suites that only make one kind of request. */
export function respondWith(status: number, data?: unknown): void {
  fakeHttp(() => ({ status, data }));
}

export function restoreHttp(): void {
  api.defaults.adapter = originalAdapter;
  seen = [];
}
