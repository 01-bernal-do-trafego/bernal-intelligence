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
  const body = (await res.json().catch(() => null)) as
    | Record<string, unknown>
    | null;

  if (!res.ok || !body || typeof body.access_token !== "string") {
    const detail =
      body && typeof body.error === "object" && body.error
        ? JSON.stringify(body.error)
        : `HTTP ${res.status}`;
    throw new Error(`Falha na troca do code: ${detail}`);
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

export class GraphApiError extends Error {
  kind: GraphErrorKind;
  constructor(kind: GraphErrorKind) {
    super(`graph_error:${kind}`);
    this.kind = kind;
  }
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
      throw new GraphApiError(classifyGraphError(body));
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
  const endpoint = `${input.graphBase.replace(/\/+$/, "")}/${input.version}/${input.path.replace(/^\/+/, "")}`;
  const limit = String(input.pageLimit ?? 100);
  const maxPages = input.maxPages ?? 200;

  const rows: unknown[] = [];
  let after: string | null = null;
  let pages = 0;

  do {
    pages += 1;
    const url = new URL(endpoint);
    url.searchParams.set("fields", input.fields);
    url.searchParams.set("limit", limit);
    for (const [k, v] of Object.entries(input.params ?? {})) {
      url.searchParams.set(k, v);
    }
    if (after) url.searchParams.set("after", after);

    const res = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${input.token}` },
    });
    const body = (await res.json().catch(() => null)) as
      | { data?: unknown; paging?: { next?: unknown; cursors?: { after?: unknown } } }
      | null;

    if (!res.ok || !body) {
      throw new GraphApiError(classifyGraphError(body));
    }
    if (Array.isArray(body.data)) rows.push(...body.data);

    const hasNext = Boolean(body.paging && typeof body.paging.next === "string");
    const nextAfter =
      body.paging?.cursors && typeof body.paging.cursors.after === "string"
        ? body.paging.cursors.after
        : null;
    after = hasNext ? nextAfter : null;

    if (after && pages >= maxPages) {
      throw new GraphPaginationOverflow(input.path, pages);
    }
  } while (after);

  return { rows, pages };
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
