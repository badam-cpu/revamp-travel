/**
 * The ONLY module that talks to PayLink.am — a TypeScript port of the proven
 * rankr `paylink.mjs`. Everything provider-specific (auth, token cache/refresh,
 * register a payment link, poll status) lives here, so swapping processors
 * means replacing just this file. PayLink has NO webhook and NO auto-recurring:
 * callers POLL checkPayment() to confirm (see server/bookings.ts).
 *
 * Endpoints + payloads verified against the live OpenAPI spec at
 * https://api.paylink.am/swagger/v1/swagger.json — there is NO "/api/" prefix
 * on the production partner/payment routes, and Request/Register returns only
 * { requestId, redirectUrl } (no orderId until a payment is actually made).
 *
 * Secrets (set in Netlify env; never committed, never VITE_-prefixed):
 *   PAYLINK_PARTNER_ID, PAYLINK_PARTNER_KEY  — credentials
 *   PAYLINK_BASE_URL                          — API base, e.g. https://api.paylink.am
 *   PAYLINK_REQUEST_TYPE                      — requestType string on Request/Register
 *     (spec: non-empty string, no enum; defaults to "1" — if register 400s on
 *     this, set the value your partner account expects and redeploy)
 *   PAYLINK_CURRENCY                          — "AMD" or "USD" (see shared/bookings.ts)
 */
const BASE = (process.env.PAYLINK_BASE_URL || "").replace(/\/+$/, "");
const PARTNER_ID = process.env.PAYLINK_PARTNER_ID;
const PARTNER_KEY = process.env.PAYLINK_PARTNER_KEY;
const REQUEST_TYPE = process.env.PAYLINK_REQUEST_TYPE || "1";
// PayLink's hosted page language (RegisterRequest.language): en / hy / ru / fr.
// Defaults to English so the checkout isn't in Armenian; override via env.
const LANGUAGE = process.env.PAYLINK_LANGUAGE || "en";

// PayLink's integration/test host and production host expose DIFFERENT route
// schemes (each verified against its own /swagger/v1/swagger.json). Pick the
// scheme from the configured base host so the same code works in both.
const IS_INTEGRATION = /apitest|integration/i.test(BASE);
const ROUTES = IS_INTEGRATION
  ? {
      authorize: "/api/authorization/authorize",
      refresh: "/api/authorization/refresh-token",
      register: "/api/request/register",
      byOrder: (id: string) => "/api/payment/get-by-order-id?id=" + encodeURIComponent(id),
      byRequest: (rid: string) => "/api/payment/" + encodeURIComponent(rid),
      hasRedirectField: true, // RegisterRequest.paymentWebRedirectUrl exists here
      // Subscription (recurring) endpoints — see server/subscriptions.ts.
      subRegister: "/api/subscription/register",
      subUpdate: "/api/subscription",
      subSearch: "/api/subscription/search",
      personCreate: "/api/person",
      personSearch: "/api/person/search-person",
      subTerminate: "/api/subscriptionschedule/terminatesubscription",
    }
  : {
      authorize: "/Partner/Authorize",
      refresh: "/Partner/RefreshToken",
      register: "/Request/Register",
      byOrder: (id: string) => "/Payment/GetPaymentByOrderId?orderId=" + encodeURIComponent(id),
      byRequest: (rid: string) => "/Payment/" + encodeURIComponent(rid),
      hasRedirectField: false,
      subRegister: "/Subscription/Register",
      subUpdate: "/Subscription",
      subSearch: "/Subscription/Search",
      personCreate: "/Person",
      personSearch: "/Person/SearchPerson",
      subTerminate: "/SubscriptionSchedule/TerminateSubscription",
    };

export function paylinkConfigured(): boolean {
  return !!(BASE && PARTNER_ID && PARTNER_KEY);
}

// In-process token cache (per warm function instance).
const _auth: { access: string | null; accessExp: number; refresh: string | null; refreshExp: number } = {
  access: null,
  accessExp: 0,
  refresh: null,
  refreshExp: 0,
};

interface TokenPart {
  token?: string;
  expiration?: string;
}
function store(j: { accessToken?: TokenPart | string; refreshToken?: TokenPart | string }) {
  const at = j.accessToken;
  const rt = j.refreshToken;
  _auth.access = (at && typeof at === "object" && at.token) || (typeof at === "string" ? at : null);
  _auth.accessExp = at && typeof at === "object" && at.expiration ? new Date(at.expiration).getTime() : Date.now() + 9 * 60 * 1000;
  _auth.refresh = (rt && typeof rt === "object" && rt.token) || (typeof rt === "string" ? rt : null);
  _auth.refreshExp = rt && typeof rt === "object" && rt.expiration ? new Date(rt.expiration).getTime() : 0;
}

async function authorize(): Promise<void> {
  const res = await fetch(BASE + ROUTES.authorize, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ partnerId: PARTNER_ID, partnerKey: PARTNER_KEY }),
  });
  if (!res.ok) throw new Error("paylink authorize " + res.status + " " + (await res.text()).slice(0, 200));
  store(await res.json());
}

async function refresh(): Promise<void> {
  if (!_auth.refresh) return authorize();
  try {
    // Integration takes { refreshToken }; production takes the raw token string.
    // Either failure falls back to authorize(), so a mismatch is self-healing.
    const body = IS_INTEGRATION ? { refreshToken: _auth.refresh } : _auth.refresh;
    const res = await fetch(BASE + ROUTES.refresh, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error("refresh " + res.status);
    store(await res.json());
  } catch {
    await authorize();
  }
}

async function accessToken(): Promise<string | null> {
  const skew = 60 * 1000;
  if (_auth.access && Date.now() < _auth.accessExp - skew) return _auth.access;
  if (_auth.refresh && Date.now() < _auth.refreshExp - skew) {
    await refresh();
    return _auth.access;
  }
  await authorize();
  return _auth.access;
}

// Authenticated request with one automatic re-auth on 401.
async function api(path: string, { method = "GET", body }: { method?: string; body?: unknown } = {}): Promise<Response> {
  const doFetch = (tok: string | null) =>
    fetch(BASE + path, {
      method,
      headers: { authorization: "Bearer " + tok, "content-type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
  let res = await doFetch(await accessToken());
  if (res.status === 401) {
    await authorize();
    res = await doFetch(await accessToken());
  }
  return res;
}

export interface RegisterResult {
  requestId: string | null;
  redirectUrl: string | null;
  orderId: string | null;
  raw: unknown;
}

/**
 * Register a one-off payment link. Spec response is { requestId, redirectUrl }
 * only — orderId is NOT assigned until the customer actually pays, so it's null
 * here and backfilled on the first successful poll. `returnUrl` is the single
 * post-payment return URL PayLink supports (no separate success/cancel).
 */
export async function registerPayment({
  amount,
  currency,
  returnUrl,
  info,
  allowAnonymous = false,
}: {
  amount: number;
  currency: string;
  returnUrl: string;
  info: string;
  allowAnonymous?: boolean;
}): Promise<RegisterResult> {
  const body: Record<string, unknown> = {
    requestType: REQUEST_TYPE,
    amount,
    currency,
    language: LANGUAGE,
    isActive: true,
    isFlexible: false, // payer can't change the amount (spec)
    maxCount: 1, // single-use link, one payment only — also suppresses PayLink's
                 // hosted-page quantity/count stepper (spec: "maximum number of
                 // payments allowed"). Each booking gets its own link.
    allowAnonymous,
    backUrl: returnUrl,
    requestInfo: info,
  };
  if (ROUTES.hasRedirectField) body.paymentWebRedirectUrl = returnUrl;
  const res = await api(ROUTES.register, { method: "POST", body });
  if (!res.ok) throw new Error("paylink register " + res.status + " " + (await res.text()).slice(0, 200));
  const j = (await res.json()) as { requestId?: string; redirectUrl?: string };
  return {
    requestId: j.requestId ?? null,
    redirectUrl: j.redirectUrl ?? null,
    orderId: null, // assigned by PayLink only once a payment is made
    raw: j,
  };
}

export interface PaymentStatus {
  ok: boolean;
  approved: boolean;
  status: string;
  orderId?: string | null;
  httpStatus?: number;
  raw?: unknown;
}

interface PaymentRecord {
  paymentApproved?: boolean;
  paymentStatus?: string;
  orderId?: string;
}
function readPayment(p: PaymentRecord, fallbackOrderId: string | null): PaymentStatus {
  return {
    ok: true,
    approved: p.paymentApproved === true,
    status: p.paymentStatus ?? (p.paymentApproved ? "approved" : "pending"),
    orderId: p.orderId ?? fallbackOrderId ?? null,
    raw: p,
  };
}

/**
 * Poll a payment's status. Once we know the orderId, GetPaymentByOrderId
 * returns a single record; before that (register gives no orderId),
 * Payment/{requestId} returns an ARRAY of attempts — pick an approved one if
 * present, else the most recent, so we can backfill the orderId and keep going.
 */
export async function checkPayment({ requestId, orderId }: { requestId: string | null; orderId: string | null }): Promise<PaymentStatus> {
  if (orderId != null && orderId !== "") {
    const res = await api(ROUTES.byOrder(orderId));
    if (!res.ok) return { ok: false, approved: false, status: "unknown", httpStatus: res.status };
    return readPayment((await res.json()) as PaymentRecord, orderId);
  }
  if (!requestId) return { ok: false, approved: false, status: "unknown" };
  const res = await api(ROUTES.byRequest(requestId));
  if (!res.ok) return { ok: false, approved: false, status: "unknown", httpStatus: res.status };
  const arr = await res.json();
  const list: PaymentRecord[] = Array.isArray(arr) ? arr : arr ? [arr] : [];
  if (!list.length) return { ok: true, approved: false, status: "pending", orderId: null };
  const approved = list.find((p) => p.paymentApproved === true);
  return readPayment(approved || list[list.length - 1], null);
}

/* ------------------------------------------------------------------ *
 * Subscriptions (recurring billing) — used to collect operators' monthly
 * platform fees. Same auth/token machinery as above. A PayLink *Subscription*
 * is the plan (amount + interval); a *Person* is a subscriber who enrolls via
 * a hosted payment link and is then charged automatically. No webhook, so we
 * poll Subscription/Search to confirm — see server/subscriptions.ts.
 * ------------------------------------------------------------------ */

export interface SubscriptionRegisterResult {
  subscriptionId: number | null;
  requestId: string | null;
  requestUrl: string | null;
  raw: unknown;
}

/**
 * Register a subscription *plan* with PayLink. `amount` is in major currency
 * units (whole drams for AMD). `monthsQuantity` is how many monthly charges the
 * subscription runs for; `firstPaymentDay` is an ISO date-time. Returns the
 * PayLink subscription id + a hosted subscribe URL.
 */
export async function registerSubscription({
  name,
  info,
  amount,
  currency,
  monthsQuantity,
  firstPaymentDay,
  returnUrl,
}: {
  name: string;
  info?: string;
  amount: number;
  currency: string;
  monthsQuantity: number;
  firstPaymentDay: string; // ISO date-time
  returnUrl?: string;
}): Promise<SubscriptionRegisterResult> {
  const body: Record<string, unknown> = {
    subscriptionName: name,
    subscriptionInfo: info ?? "",
    amount,
    currency,
    language: LANGUAGE,
    monthsQuantity,
    firstPaymentDay,
    isActive: true,
    ...(returnUrl ? { additionalInfo: { url: returnUrl } } : {}),
  };
  const res = await api(ROUTES.subRegister, { method: "POST", body });
  if (!res.ok) throw new Error("paylink subscription register " + res.status + " " + (await res.text()).slice(0, 200));
  const j = (await res.json()) as { id?: number; requestId?: string; requestUrl?: string };
  return {
    subscriptionId: typeof j.id === "number" ? j.id : null,
    requestId: j.requestId ?? null,
    requestUrl: j.requestUrl ?? null,
    raw: j,
  };
}

interface PersonRecord {
  id?: number;
  email?: string;
  mobile?: string;
}

/**
 * Find a PayLink Person by email, creating one if none exists. PayLink requires
 * a mobile on create. Returns the person id (or null if we couldn't resolve it).
 * Idempotent — safe to call on every subscribe attempt.
 */
export async function ensurePerson({
  email,
  mobile,
  firstName,
  lastName,
}: {
  email: string;
  mobile: string;
  firstName?: string;
  lastName?: string;
}): Promise<number | null> {
  const find = async (): Promise<number | null> => {
    const res = await api(ROUTES.personSearch, { method: "POST", body: { email } });
    if (!res.ok) return null;
    const arr = (await res.json()) as PersonRecord[];
    const match = Array.isArray(arr) ? arr.find((p) => (p.email || "").toLowerCase() === email.toLowerCase()) || arr[0] : null;
    return match && typeof match.id === "number" ? match.id : null;
  };
  const existing = await find();
  if (existing != null) return existing;
  // Create, then look it up again (create returns 201 with no body).
  const res = await api(ROUTES.personCreate, { method: "POST", body: { email, mobile, firstName: firstName ?? "", lastName: lastName ?? "" } });
  if (!res.ok && res.status !== 409) {
    throw new Error("paylink person create " + res.status + " " + (await res.text()).slice(0, 200));
  }
  return find();
}

export interface PersonSubscriptionState {
  isSubscribed: boolean;
  paymentLink: string | null;
  raw: unknown;
}

/**
 * Look up a person's state for a specific subscription: whether they're already
 * subscribed, and the hosted payment link to enroll them if not. Searches the
 * person's subscriptions and matches on the PayLink subscription id.
 */
export async function getPersonSubscription({
  personId,
  subscriptionId,
}: {
  personId: number;
  subscriptionId: number;
}): Promise<PersonSubscriptionState> {
  const res = await api(ROUTES.subSearch, { method: "POST", body: { personId } });
  if (!res.ok) throw new Error("paylink subscription search " + res.status + " " + (await res.text()).slice(0, 200));
  const arr = (await res.json()) as { subscription?: { id?: number }; paymentLink?: string; isSubscribed?: boolean }[];
  const list = Array.isArray(arr) ? arr : [];
  const match = list.find((s) => s.subscription?.id === subscriptionId) ?? null;
  return {
    isSubscribed: match?.isSubscribed === true,
    paymentLink: match?.paymentLink ?? null,
    raw: arr,
  };
}

/**
 * Update a subscription's amount (PayLink SubscriptionPatch / PUT). Used to apply
 * a per-listing plan's recomputed monthly amount so the NEXT scheduled charge
 * bills the new total. Passes the full patch shape PayLink expects.
 */
export async function updateSubscriptionAmount({
  subscriptionId,
  name,
  info,
  amount,
  currency,
  monthsQuantity,
  firstPaymentDay,
}: {
  subscriptionId: number;
  name: string;
  info?: string;
  amount: number;
  currency: string;
  monthsQuantity: number;
  firstPaymentDay: string;
}): Promise<boolean> {
  const body: Record<string, unknown> = {
    id: subscriptionId,
    subscriptionName: name,
    subscriptionInfo: info ?? "",
    amount,
    currency,
    language: LANGUAGE,
    monthsQuantity,
    firstPaymentDay,
    isActive: true,
  };
  const res = await api(ROUTES.subUpdate, { method: "PUT", body });
  return res.ok;
}

/** Terminate a person's enrollment in a subscription (cancel their recurring charge). */
export async function terminatePersonSubscription({
  personId,
  subscriptionId,
}: {
  personId: number;
  subscriptionId: number;
}): Promise<boolean> {
  const res = await api(ROUTES.subTerminate, {
    method: "POST",
    body: { personId, subscriptionId, terminationDate: new Date().toISOString() },
  });
  return res.ok;
}
