// AGENT_v789_STAFF_SCOPE - silo and role for every staff tool come from the verified
// X-Maya-Context, never from the model. dispatchTool runs each staff tool inside this
// scope and callBFServer stamps silo and role onto every /api/maya/ request body made
// within it, overriding anything the model put there. One place, so a new staff tool
// cannot forget it.
import { AsyncLocalStorage } from "node:async_hooks";

// KS_AGENT_v1 - Keystone is lending only: every staff call is scoped to the lending data (silo code "BF" on the
// licensee's server), whatever silo the portal or the model names.
export const LENDING_SILO = "BF";

// KS_AGENT_v2_ACTING_STAFF - and the acting staff member: callBFServer sends their id (staff_user_id) on every staff
// call, plus the X-Maya-Context token KS-server signed for this request, so KS-server can check that id against its own
// signature and show the assistant only the records that person may see (teams and record visibility).
export type StaffScope = { silo: string; role: string | null; staffUserId?: string | null; context?: string | null };

const als = new AsyncLocalStorage<StaffScope>();

export function runInStaffScope<T>(scope: StaffScope, fn: () => Promise<T>): Promise<T> {
  return als.run(scope, fn);
}

export function currentStaffScope(): StaffScope | undefined {
  return als.getStore();
}
