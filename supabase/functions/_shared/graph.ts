/**
 * Chamadas à Graph API da Meta feitas pela Edge Function (server-to-server).
 * Fronteira Deno — não importa de `lib/` do app Next.
 */

export interface GraphConfig {
  /** Ex.: "https://graph.facebook.com" */
  graphBase: string;
  /** Ex.: "v26.0" */
  version: string;
}

export interface ExchangeCodeInput extends GraphConfig {
  appId: string;
  appSecret: string;
  /** Idêntico ao redirect_uri usado no diálogo de autorização. */
  redirectUri: string;
  code: string;
}

export interface ExchangedToken {
  accessToken: string;
  tokenType: string | null;
  /** segundos até expirar; 0/ausente = não expira (system user). */
  expiresIn: number | null;
}

/**
 * Diagnóstico SANITIZADO da falha da troca. NUNCA carrega code/token/secret —
 * só status HTTP, `error.type` / `error.code` / `error.error_subcode` e a
 * `error.message` já redigida/truncada. Cópia mínima de
 * `lib/meta/oauth-exchange-error.ts` (fronteira Deno).
 */
export interface SanitizedExchangeError {
  meta_http_status: number;
  meta_error_type: string | null;
  meta_error_code: number | null;
  meta_error_subcode: number | null;
  meta_message: string | null;
  non_json: boolean;
}

const TOKENISH = /[A-Za-z0-9_-]{20,}/g;

function sanitizeMetaMessage(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw
    .replace(TOKENISH, "[redacted]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

function buildSanitizedExchangeError(
  httpStatus: number,
  body: unknown,
): SanitizedExchangeError {
  if (body == null || typeof body !== "object") {
    return {
      meta_http_status: httpStatus,
      meta_error_type: null,
      meta_error_code: null,
      meta_error_subcode: null,
      meta_message: null,
      non_json: true,
    };
  }
  const err = (body as Record<string, unknown>).error;
  const e =
    err && typeof err === "object" ? (err as Record<string, unknown>) : null;
  const message = e ? sanitizeMetaMessage(e.message) : "";
  return {
    meta_http_status: httpStatus,
    meta_error_type: e && typeof e.type === "string" ? e.type : null,
    meta_error_code: e && typeof e.code === "number" ? e.code : null,
    meta_error_subcode:
      e && typeof e.error_subcode === "number" ? e.error_subcode : null,
    meta_message: message.length > 0 ? message : null,
    non_json: false,
  };
}

/**
 * Falha da troca do `code`. Carrega SOMENTE o diagnóstico sanitizado — a
 * mensagem do `Error` é um rótulo curto sem detalhe sensível.
 */
export class MetaExchangeError extends Error {
  readonly sanitized: SanitizedExchangeError;
  constructor(sanitized: SanitizedExchangeError) {
    super(
      `meta_exchange_failed:${sanitized.meta_error_code ?? sanitized.meta_http_status}`,
    );
    this.name = "MetaExchangeError";
    this.sanitized = sanitized;
  }
}

/** Troca o `code` do callback por um access token. */
export async function exchangeCodeForToken(
  input: ExchangeCodeInput,
): Promise<ExchangedToken> {
  const url = new URL(
    `${input.graphBase.replace(/\/+$/, "")}/${input.version}/oauth/access_token`,
  );
  url.searchParams.set("client_id", input.appId);
  url.searchParams.set("client_secret", input.appSecret);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("code", input.code);

  const res = await fetch(url, { method: "GET" });
  const text = await res.text().catch(() => "");
  let body: Record<string, unknown> | null = null;
  try {
    body = text ? (JSON.parse(text) as Record<string, unknown>) : null;
  } catch {
    body = null;
  }

  if (!res.ok || !body || typeof body.access_token !== "string") {
    throw new MetaExchangeError(buildSanitizedExchangeError(res.status, body));
  }

  return {
    accessToken: body.access_token,
    tokenType: typeof body.token_type === "string" ? body.token_type : null,
    expiresIn:
      typeof body.expires_in === "number" ? body.expires_in : null,
  };
}

export interface DebugTokenInfo {
  scopes: string[];
  metaUserId: string | null;
  metaBusinessId: string | null;
  /** ISO ou null (null = não expira). */
  expiresAt: string | null;
  dataAccessExpiresAt: string | null;
  isSystemUser: boolean;
}

/** `GET /debug_token` usando o app access token (`{app_id}|{app_secret}`). */
export async function debugToken(
  input: GraphConfig & { appId: string; appSecret: string; token: string },
): Promise<DebugTokenInfo> {
  const url = new URL(
    `${input.graphBase.replace(/\/+$/, "")}/${input.version}/debug_token`,
  );
  url.searchParams.set("input_token", input.token);
  url.searchParams.set("access_token", `${input.appId}|${input.appSecret}`);

  const res = await fetch(url, { method: "GET" });
  const body = (await res.json().catch(() => null)) as
    | { data?: Record<string, unknown> }
    | null;
  const d = body?.data ?? {};

  const toIso = (v: unknown): string | null =>
    typeof v === "number" && v > 0 ? new Date(v * 1000).toISOString() : null;

  return {
    scopes: Array.isArray(d.scopes)
      ? (d.scopes.filter((s) => typeof s === "string") as string[])
      : [],
    metaUserId: d.user_id != null ? String(d.user_id) : null,
    metaBusinessId:
      typeof d.profile_id === "string"
        ? d.profile_id
        : d.profile_id != null
          ? String(d.profile_id)
          : null,
    expiresAt: toIso(d.expires_at),
    dataAccessExpiresAt: toIso(d.data_access_expires_at),
    isSystemUser: d.type === "SYSTEM_USER",
  };
}

// ---------------------------------------------------------------------------
// Contas de anúncio (META 3) — GET /me/adaccounts, paginação por cursor
// ---------------------------------------------------------------------------

export type GraphErrorKind =
  | "token_revoked"
  | "insufficient_permission"
  | "rate_limited"
  | "transient"
  | "unknown";

export function classifyGraphError(body: unknown): GraphErrorKind {
  if (typeof body !== "object" || body === null) return "unknown";
  const err = (body as Record<string, unknown>).error;
  if (typeof err !== "object" || err === null) return "unknown";
  const e = err as Record<string, unknown>;
  const code = typeof e.code === "number" ? e.code : null;
  const sub = typeof e.error_subcode === "number" ? e.error_subcode : null;
  if (code === 190) return "token_revoked";
  if (code === 102 && sub === 463) return "token_revoked";
  if (code != null && [10, 200, 294, 299, 272].includes(code)) {
    return "insufficient_permission";
  }
  if (code != null && [4, 17, 32, 613, 80000].includes(code)) return "rate_limited";
  if (code != null && [1, 2].includes(code)) return "transient";
  return "unknown";
}

/**
 * Campos CRUS do erro da Meta que a Graph API realmente devolve, ALÉM dos 2
 * que `classifyGraphError` já usa (`code`/`error_subcode`). `message`/
 * `userTitle`/`userMessage` são SANITIZADOS (mesma `sanitizeMetaMessage` já
 * usada em `buildSanitizedExchangeError` — trunca a 200 chars, redige
 * qualquer substring parecida com token) — nunca o texto bruto da Meta,
 * nunca token/request sensível.
 */
export interface GraphErrorDetails {
  code: number | null;
  subcode: number | null;
  type: string | null;
  message: string | null;
  userTitle: string | null;
  userMessage: string | null;
}

const EMPTY_GRAPH_ERROR_DETAILS: GraphErrorDetails = {
  code: null,
  subcode: null,
  type: null,
  message: null,
  userTitle: null,
  userMessage: null,
};

export class GraphApiError extends Error {
  kind: GraphErrorKind;
  /**
   * Detalhes CRUS (sanitizados) do erro da Meta, quando disponíveis. NÃO
   * amplia `GraphErrorKind` (o executor V2.2.3 e o Current Sync continuam
   * só lendo `.kind`, intocados) — existe só para diagnóstico fino de quem
   * precisar de mais granularidade que os 5 valores de `GraphErrorKind`
   * (hoje: só `meta-backfill-discovery`, DATA V2.3B, via
   * `isRangeRejectedGraphError` — nunca inventa uma 6ª categoria na
   * classificação compartilhada).
   */
  details: GraphErrorDetails;
  constructor(kind: GraphErrorKind, details: GraphErrorDetails = EMPTY_GRAPH_ERROR_DETAILS) {
    super(`graph_error:${kind}`);
    this.kind = kind;
    this.details = details;
  }
}

/** Extrai os campos crus (sanitizados) do erro da Meta. Mesmo parsing defensivo de `classifyGraphError` — nunca lança. Exportada para ser testável diretamente (ver `graph.test.ts`). */
export function extractGraphErrorDetails(body: unknown): GraphErrorDetails {
  if (typeof body !== "object" || body === null) return EMPTY_GRAPH_ERROR_DETAILS;
  const err = (body as Record<string, unknown>).error;
  if (typeof err !== "object" || err === null) return EMPTY_GRAPH_ERROR_DETAILS;
  const e = err as Record<string, unknown>;
  const msg = sanitizeMetaMessage(e.message);
  const title = sanitizeMetaMessage(e.error_user_title);
  const userMsg = sanitizeMetaMessage(e.error_user_msg);
  return {
    code: typeof e.code === "number" ? e.code : null,
    subcode: typeof e.error_subcode === "number" ? e.error_subcode : null,
    type: typeof e.type === "string" ? e.type : null,
    message: msg.length > 0 ? msg : null,
    userTitle: title.length > 0 ? title : null,
    userMessage: userMsg.length > 0 ? userMsg : null,
  };
}

/**
 * MICRO-AUDITORIA (V2.3B.1): `error.code === 100` ("Invalid parameter")
 * sozinho NÃO é suficiente para classificar `range_rejected` — é um código
 * GENÉRICO que a Meta usa para field inválido, level inválido, breakdown
 * inválido, parâmetro desconhecido, etc., nada relacionado a range de
 * datas. `code === 100` é NECESSÁRIO mas nunca SUFICIENTE aqui: também
 * exige evidência TEXTUAL nas mensagens (`message`/`error_user_title`/
 * `error_user_msg`, já sanitizadas) de que a rejeição é sobre
 * `time_range`/período — um vocabulário de palavras-chave ESPECÍFICO o
 * bastante para não confundir com "since"/"until" aparecendo por acaso em
 * mensagens sobre outra coisa (por isso não são keywords soltas, só frases
 * compostas). Nenhum `error_subcode` específico e confiável para isto é
 * documentado publicamente pela Meta hoje — se um for confirmado num piloto
 * real futuro, adicione aqui em vez de inventar um agora.
 *
 * SEM evidência textual -> `false` (nunca `range_rejected`) — "melhor
 * falhar como probe_error do que gerar fallback incorreto".
 */
const RANGE_REJECTION_CODE = 100;
const RANGE_REJECTION_KEYWORDS = [
  "time_range",
  "time range",
  "date range",
  "date_preset",
  "date window",
  "too many days",
  "too large",
  "too big",
  "exceeds the maximum",
  "invalid time range",
  "range is invalid",
  "range is too",
] as const;

export function isRangeRejectedGraphError(details: GraphErrorDetails): boolean {
  if (details.code !== RANGE_REJECTION_CODE) return false;
  const haystack = [details.message, details.userTitle, details.userMessage]
    .filter((s): s is string => typeof s === "string" && s.length > 0)
    .join(" ")
    .toLowerCase();
  if (haystack.length === 0) return false; // code 100 sem message/subcode útil -> sem evidência.
  return RANGE_REJECTION_KEYWORDS.some((kw) => haystack.includes(kw));
}

const AD_ACCOUNT_FIELDS =
  "account_id,name,account_status,currency,timezone_name,business{id,name}";

/**
 * Lista TODAS as contas de anúncio disponíveis no token (`/me/adaccounts`),
 * paginando pelo cursor `after`. Devolve as páginas cruas (`data[]`) — o
 * parsing/normalização é feito no app (lib/meta/ad-account.ts).
 *
 * O token vai SEMPRE no header Authorization; nunca montamos uma URL com o
 * token na query (não seguimos `paging.next`, que embute o token).
 */
export async function listAdAccounts(
  input: GraphConfig & { token: string; pageLimit?: number; maxPages?: number },
): Promise<unknown[][]> {
  const endpoint = `${input.graphBase.replace(/\/+$/, "")}/${input.version}/me/adaccounts`;
  const limit = String(input.pageLimit ?? 100);
  const maxPages = input.maxPages ?? 25;

  const pages: unknown[][] = [];
  let after: string | null = null;
  let guard = 0;

  do {
    guard += 1;
    const url = new URL(endpoint);
    url.searchParams.set("fields", AD_ACCOUNT_FIELDS);
    url.searchParams.set("limit", limit);
    if (after) url.searchParams.set("after", after);

    const res = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${input.token}` },
    });
    const body = (await res.json().catch(() => null)) as
      | {
          data?: unknown;
          paging?: { next?: unknown; cursors?: { after?: unknown } };
        }
      | null;

    if (!res.ok || !body) {
      throw new GraphApiError(classifyGraphError(body), extractGraphErrorDetails(body));
    }

    pages.push(Array.isArray(body.data) ? body.data : []);

    const hasNext = Boolean(body.paging && typeof body.paging.next === "string");
    const nextAfter =
      body.paging?.cursors && typeof body.paging.cursors.after === "string"
        ? body.paging.cursors.after
        : null;
    after = hasNext ? nextAfter : null;
  } while (after && guard < maxPages);

  return pages;
}

// ---------------------------------------------------------------------------
// Sincronização (META 5) — paginação genérica por cursor `after`
// ---------------------------------------------------------------------------

export class GraphPaginationOverflow extends Error {
  constructor(public endpoint: string, public pages: number) {
    super(`pagination_overflow:${endpoint}:${pages}`);
  }
}

/**
 * DATA V2.2.3 — 1 única página de um edge do nó da conta. Extraída de
 * `listEdge` (refactor MÍNIMO, comportamento idêntico — `listEdge` abaixo
 * agora delega para esta função dentro do MESMO loop `do/while`, byte a byte
 * equivalente ao que fazia inline antes). Existe para o Historical Backfill
 * poder pausar ENTRE páginas (heartbeat/ownership check) sem duplicar
 * construção de URL/headers/parsing — o MESMO (e único) cliente HTTP da
 * Graph API usado pelo Current Sync.
 */
async function fetchEdgePage(
  input: GraphConfig & {
    token: string;
    path: string;
    fields: string;
    params?: Record<string, string>;
    pageLimit?: number;
    /** cursor a usar (`after`); `null` = primeira página. */
    after: string | null;
  },
): Promise<{ rows: unknown[]; nextCursor: string | null }> {
  const endpoint = `${input.graphBase.replace(/\/+$/, "")}/${input.version}/${input.path.replace(/^\/+/, "")}`;
  const limit = String(input.pageLimit ?? 100);

  const url = new URL(endpoint);
  url.searchParams.set("fields", input.fields);
  url.searchParams.set("limit", limit);
  for (const [k, v] of Object.entries(input.params ?? {})) {
    url.searchParams.set(k, v);
  }
  if (input.after) url.searchParams.set("after", input.after);

  const res = await fetch(url, {
    method: "GET",
    headers: { Authorization: `Bearer ${input.token}` },
  });
  captureRateUsage(res.headers);
  const body = (await res.json().catch(() => null)) as
    | { data?: unknown; paging?: { next?: unknown; cursors?: { after?: unknown } } }
    | null;

  if (!res.ok || !body) {
    throw new GraphApiError(classifyGraphError(body), extractGraphErrorDetails(body));
  }
  const rows = Array.isArray(body.data) ? body.data : [];

  const hasNext = Boolean(body.paging && typeof body.paging.next === "string");
  const nextCursor =
    hasNext && body.paging?.cursors && typeof body.paging.cursors.after === "string"
      ? body.paging.cursors.after
      : null;

  return { rows, nextCursor };
}

/**
 * GET paginado de um edge do nó da conta (`/{act_id}/<edge>`), seguindo o
 * cursor `after`. Token sempre no header. Acumula TODAS as linhas — o chamador
 * só persiste quando o edge terminou 100%. Estoura `GraphPaginationOverflow`
 * se passar de `maxPages` (nunca roda sem fim).
 */
export async function listEdge(
  input: GraphConfig & {
    token: string;
    /** ex.: "act_123/campaigns" */
    path: string;
    fields: string;
    params?: Record<string, string>;
    pageLimit?: number;
    maxPages?: number;
  },
): Promise<{ rows: unknown[]; pages: number }> {
  const maxPages = input.maxPages ?? 200;

  const rows: unknown[] = [];
  let after: string | null = null;
  let pages = 0;

  do {
    pages += 1;
    const page = await fetchEdgePage({ ...input, after });
    rows.push(...page.rows);
    after = page.nextCursor;

    if (after && pages >= maxPages) {
      throw new GraphPaginationOverflow(input.path, pages);
    }
  } while (after);

  return { rows, pages };
}

// A busca EM CAMADAS de AdCreative (batch full -> batch mínimo -> por id) com
// telemetria vive em `_shared/creatives-fetch.ts` (não engole erro Graph).

/* ---- rate usage (best-effort, sanitizado) -------------------------------
 * Lê os headers oficiais de uso da Meta em cada resposta e guarda só os
 * PERCENTUAIS MÁXIMOS num acumulador de módulo (uma invocação da Edge Function
 * = um cliente). Nada de header/token bruto. Se o formato mudar, fica ausente.
 */
interface RateUsageSummary {
  app_max_pct: number;
  ad_account_max_pct: number;
  buc_max_pct: number;
  estimated_time_to_regain_access_max: number;
  throttled: boolean;
}
let rateAcc: RateUsageSummary = {
  app_max_pct: 0,
  ad_account_max_pct: 0,
  buc_max_pct: 0,
  estimated_time_to_regain_access_max: 0,
  throttled: false,
};

export function resetRateUsage(): void {
  rateAcc = {
    app_max_pct: 0,
    ad_account_max_pct: 0,
    buc_max_pct: 0,
    estimated_time_to_regain_access_max: 0,
    throttled: false,
  };
}
export function getRateUsage(): RateUsageSummary {
  return { ...rateAcc };
}

function maxPctFromObj(o: unknown): { pct: number; regain: number } {
  let pct = 0;
  let regain = 0;
  const scan = (v: unknown) => {
    if (!v || typeof v !== "object") return;
    const r = v as Record<string, unknown>;
    for (const k of ["call_count", "total_cputime", "total_time"]) {
      const n = typeof r[k] === "number" ? (r[k] as number) : Number(r[k]);
      if (Number.isFinite(n) && n > pct) pct = n;
    }
    const eg = typeof r.estimated_time_to_regain_access === "number"
      ? (r.estimated_time_to_regain_access as number)
      : Number(r.estimated_time_to_regain_access);
    if (Number.isFinite(eg) && eg > regain) regain = eg;
  };
  if (Array.isArray(o)) o.forEach(scan);
  else if (o && typeof o === "object") {
    // BUC: { "<act_id>": [ {...} ], ... }
    for (const v of Object.values(o as Record<string, unknown>)) {
      if (Array.isArray(v)) v.forEach(scan);
      else scan(v);
    }
    scan(o);
  }
  return { pct, regain };
}

function captureRateUsage(headers: Headers): void {
  try {
    const parse = (h: string) => {
      const raw = headers.get(h);
      if (!raw) return null;
      try {
        return JSON.parse(raw);
      } catch {
        return null;
      }
    };
    const app = maxPctFromObj(parse("x-app-usage"));
    const acct = maxPctFromObj(parse("x-ad-account-usage"));
    const buc = maxPctFromObj(parse("x-business-use-case-usage"));
    rateAcc.app_max_pct = Math.max(rateAcc.app_max_pct, app.pct);
    rateAcc.ad_account_max_pct = Math.max(rateAcc.ad_account_max_pct, acct.pct);
    rateAcc.buc_max_pct = Math.max(rateAcc.buc_max_pct, buc.pct);
    rateAcc.estimated_time_to_regain_access_max = Math.max(
      rateAcc.estimated_time_to_regain_access_max,
      app.regain,
      acct.regain,
      buc.regain,
    );
    if (
      rateAcc.app_max_pct >= 100 ||
      rateAcc.ad_account_max_pct >= 100 ||
      rateAcc.buc_max_pct >= 100 ||
      rateAcc.estimated_time_to_regain_access_max > 0
    ) {
      rateAcc.throttled = true;
    }
  } catch {
    // best-effort — nunca derruba o sync
  }
}

/**
 * Campos por nível: base + conversões (`actions`/`action_values`).
 *
 * ATRIBUIÇÃO: NÃO pedimos `action_attribution_windows` nem
 * `use_unified_attribution_setting`. Desde 10/06/2025 a Insights API
 * desconsidera esse flag e SEMPRE retorna `actions`/`action_values` na
 * configuração de atribuição UNIFICADA do conjunto de anúncios, espelhando o
 * Ads Manager. A linha é gravada com attribution_window = 'unified_attribution'.
 */
export function insightFields(level: "account" | "campaign" | "adset" | "ad"): string {
  const base =
    "spend,impressions,reach,clicks,inline_link_clicks,frequency,actions,action_values,date_start,date_stop,account_id";
  if (level === "campaign") return `${base},campaign_id`;
  if (level === "adset") return `${base},campaign_id,adset_id`;
  if (level === "ad") return `${base},campaign_id,adset_id,ad_id`;
  return base;
}

/**
 * GET /{act_id}/insights de um nível. `timeIncrement` = "1" p/ série diária,
 * omitido p/ o agregado de período (regras do Ads Manager em reach/frequency).
 *
 * Janela: `timeRange` (since/until, YYYY-MM-DD) OU `datePreset`. Para a série
 * diária usamos `timeRange` calculado (cobre todos os presets sem buracos);
 * para os agregados de período usamos `datePreset` (as datas que a Meta
 * devolve são gravadas por linha).
 */
export async function listInsights(
  input: GraphConfig & {
    token: string;
    adAccountId: string; // act_123
    level: "account" | "campaign" | "adset" | "ad";
    datePreset?: string; // "last_30d"
    timeRange?: { since: string; until: string };
    timeIncrement?: "1";
    pageLimit?: number;
    maxPages?: number;
  },
): Promise<{ rows: unknown[]; pages: number }> {
  const params: Record<string, string> = { level: input.level };
  if (input.timeRange) {
    params.time_range = JSON.stringify({
      since: input.timeRange.since,
      until: input.timeRange.until,
    });
  } else if (input.datePreset) {
    params.date_preset = input.datePreset;
  } else {
    throw new Error("listInsights: timeRange ou datePreset é obrigatório");
  }
  if (input.timeIncrement) params.time_increment = input.timeIncrement;

  return listEdge({
    graphBase: input.graphBase,
    version: input.version,
    token: input.token,
    path: `${input.adAccountId}/insights`,
    fields: insightFields(input.level),
    params,
    pageLimit: input.pageLimit,
    maxPages: input.maxPages,
  });
}

/**
 * DATA V2.2.3 — 1 única página de insights (`time_range` explícito, série
 * diária — SEM `datePreset`, que é exclusivo dos agregados periódicos do
 * Current Sync). Usa o MESMO `insightFields`/`fetchEdgePage` de `listInsights`
 * — zero cliente HTTP/campos duplicados. Quem pagina página a página é o
 * chamador (Historical Backfill) para poder confirmar ownership do segmento
 * ENTRE páginas — `listInsights` continua intocado (Current Sync).
 */
export async function listInsightsPage(
  input: GraphConfig & {
    token: string;
    adAccountId: string; // act_123
    level: "account" | "campaign" | "adset" | "ad";
    timeRange: { since: string; until: string };
    timeIncrement?: "1";
    /** cursor a usar (`after`); `null` = primeira página. */
    cursor: string | null;
    pageLimit?: number;
  },
): Promise<{ rows: unknown[]; nextCursor: string | null }> {
  const params: Record<string, string> = {
    level: input.level,
    time_range: JSON.stringify({ since: input.timeRange.since, until: input.timeRange.until }),
  };
  if (input.timeIncrement) params.time_increment = input.timeIncrement;

  return fetchEdgePage({
    graphBase: input.graphBase,
    version: input.version,
    token: input.token,
    path: `${input.adAccountId}/insights`,
    fields: insightFields(input.level),
    params,
    pageLimit: input.pageLimit,
    after: input.cursor,
  });
}

// ---------------------------------------------------------------------------
// DATA V2.3B — Earliest-Date Discovery: metadata da conta + probe de existência
// ---------------------------------------------------------------------------

const AD_ACCOUNT_META_FIELDS = "created_time,timezone_name";

export interface AdAccountMeta {
  /** ISO 8601 CRU da Meta (já no offset local da conta) — NÃO reprocessar via Date/UTC; usar a data como string. `null` se a Meta não devolver. */
  createdTime: string | null;
  /** IANA (ex.: "America/Sao_Paulo"). `null` se a Meta não devolver. */
  timezoneName: string | null;
}

/**
 * `GET /{act_id}?fields=created_time,timezone_name` — 1 único objeto, não
 * paginado. Usado só pelo Discovery (V2.3B) para resolver o limite inferior
 * (criação da conta) e o timezone sem inventar/assumir nada. Reaproveita
 * `classifyGraphError`/`captureRateUsage` — mesmo tratamento de erro/rate
 * usage do resto do arquivo.
 */
export async function getAdAccountMeta(
  input: GraphConfig & { token: string; adAccountId: string },
): Promise<AdAccountMeta> {
  const endpoint = `${input.graphBase.replace(/\/+$/, "")}/${input.version}/${input.adAccountId}`;
  const url = new URL(endpoint);
  url.searchParams.set("fields", AD_ACCOUNT_META_FIELDS);

  const res = await fetch(url, { method: "GET", headers: { Authorization: `Bearer ${input.token}` } });
  captureRateUsage(res.headers);
  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;

  if (!res.ok || !body) {
    throw new GraphApiError(classifyGraphError(body), extractGraphErrorDetails(body));
  }
  return {
    createdTime: typeof body.created_time === "string" ? body.created_time : null,
    timezoneName: typeof body.timezone_name === "string" ? body.timezone_name : null,
  };
}

/** Campo mínimo suficiente pra detectar EXISTÊNCIA de dado — não precisa do conjunto completo de `insightFields()`. */
const DISCOVERY_PROBE_FIELDS = "date_start";

/**
 * 1 probe de "existe ALGUM dado neste range?" em `level=account` — NUNCA
 * paginação (basta 1 linha pra responder sim). Reaproveita `fetchEdgePage`
 * (MESMO cliente HTTP de `listEdge`/`listInsightsPage`) — nenhum request
 * paralelo, nenhuma lógica de paginação duplicada.
 */
export async function probeAccountInsights(
  input: GraphConfig & { token: string; adAccountId: string; since: string; until: string },
): Promise<{ hasData: boolean }> {
  const page = await fetchEdgePage({
    graphBase: input.graphBase,
    version: input.version,
    token: input.token,
    path: `${input.adAccountId}/insights`,
    fields: DISCOVERY_PROBE_FIELDS,
    params: { level: "account", time_range: JSON.stringify({ since: input.since, until: input.until }) },
    pageLimit: 1,
    after: null,
  });
  return { hasData: page.rows.length > 0 };
}
