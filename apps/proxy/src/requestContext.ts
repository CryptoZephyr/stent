import { AsyncLocalStorage } from "node:async_hooks";
import type { Request } from "express";
import type { EndpointConfig } from "./supabaseClient";
import type { ForwardResult } from "./upstream";

/**
 * Per-request data the gateway settle-hooks need but the SDK's hook context does
 * not provide. `onBeforeSettle` only receives `{ paymentPayload, requirements }`,
 * so we thread the live Express request in via AsyncLocalStorage.
 *
 * The hook reads `req` from the store, performs the single upstream fetch, and
 * stashes the result back onto the request object (`req.stentUpstream`) — a
 * stable reference that the later `forward` middleware can read even though it
 * runs outside this ALS scope (Express schedules it after `requirePayment`
 * returns).
 */
export interface ProxyRequest extends Request {
  endpoint?: EndpointConfig;
  /** Upstream response captured during onBeforeSettle; relayed by forward(). */
  stentUpstream?: ForwardResult;
}

export interface RequestContext {
  req: ProxyRequest;
}

const storage = new AsyncLocalStorage<RequestContext>();

export function runWithRequestContext<T>(ctx: RequestContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

export function getRequestContext(): RequestContext | undefined {
  return storage.getStore();
}
