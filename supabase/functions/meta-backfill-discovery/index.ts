/**
 * Edge Function: meta-backfill-discovery (DATA V2.3B — Earliest-Date Discovery)
 * ---------------------------------------------------------------------------
 * Responsabilidade ÚNICA: descobrir o intervalo histórico REAL disponível
 * para uma conta na Meta Insights API. NÃO cria job, NÃO cria segment, NÃO
 * escreve insight, NÃO executa backfill, NÃO altera Current Sync — em nada
 * disto (nenhuma tabela de backfill/insights é tocada por este arquivo).
 *
 *   POST { clientId, adAccountRef }
 *   header: x-meta-backfill-discovery-secret: <META_BACKFILL_DISCOVERY_SECRET>
 *
 * `verify_jwt = false` — MESMO padrão de `meta-sync-scheduled`/
 * `meta-backfill-executor`/`meta-backfill-orchestrator`: NENHUM usuário
 * chama isto diretamente; autorização = secret DEDICADO
 * (`META_BACKFILL_DISCOVERY_SECRET`, não reaproveita nenhum outro secret),
 * tempo constante. O DEPLOY DEVE USAR `--no-verify-jwt` (mesma
 * frase/mecanismo das demais; este projeto NÃO usa `supabase/config.toml`
 * para nenhuma Edge Function).
 *
 * FONTE DE VERDADE: a Meta Ads Insights API — NUNCA a primeira data no
 * nosso banco, NUNCA a primeira campanha/ad criado, NUNCA uma constante
 * fixa ("37 meses" ou qualquer retenção hardcoded). O limite inferior é a
 * DATA DE CRIAÇÃO DA CONTA (`created_time`, obtido ao vivo da Meta —
 * `meta_ad_accounts` não guarda essa coluna localmente, e não é criada
 * nesta etapa). O limite superior é o ÚLTIMO DIA FECHADO no timezone DA
 * CONTA (`timezone_name`, preferencialmente o que a própria Meta devolve
 * agora — nunca o timezone do host, nunca UTC assumido, nunca um timezone
 * fixo tipo America/Sao_Paulo).
 *
 * ALGORITMO — `./../_shared/discovery-algorithm.ts` (bounded/logarítmico no
 * caso feliz; fallback em blocos amplos se a Graph rejeitar o range
 * inteiro; confirmação do dia exato; guarda `MAX_DISCOVERY_PROBES`). Este
 * arquivo só resolve os limites (created_time/timezone) e fornece o `probe`
 * real — o algoritmo em si vive só lá.
 *
 * REUSO (nenhum cliente HTTP/normalizador/classificação de erro
 * duplicado):
 *   - `resolveEligibleAccount` (`_shared/backfill-eligibility.ts`) — mesma
 *     regra de conta elegível já usada no executor/orchestrator.
 *   - `getAdAccountMeta`/`probeAccountInsights` (`_shared/graph.ts`) — MESMO
 *     cliente HTTP (`fetchEdgePage`) do Current Sync/Backfill.
 *   - `classifyGraphError`/`GraphApiError` (`_shared/graph.ts`) — mesma
 *     classificação de erro, nenhuma heurística nova (a única exceção é
 *     `isRangeRejectedGraphError` — ver "RANGE REJECTION" abaixo).
 *   - `openToken` (`_shared/crypto.ts`) — mesma descriptografia.
 *   - `accountToday`/`addDays` (`_shared/date-util.ts`, extraído de
 *     `sync-core.ts` nesta etapa) — mesmo cálculo de "hoje"/"ontem" no
 *     timezone da conta que o Current Sync já usa.
 *
 * RANGE REJECTION (MICRO-AUDITORIA V2.3B.1): o fallback chunked do
 * algoritmo (`discoverEarliestDate`) só é acionado quando o probe do range
 * inteiro devolve `errorKind: "range_rejected"` — SÓ este arquivo decide
 * quando isso é verdade, via `isRangeRejectedGraphError` (`_shared/
 * graph.ts`). `error.code === 100` ("Invalid parameter") sozinho NÃO
 * basta — é genérico demais (field/level/breakdown inválido também usam
 * esse código); também exige evidência TEXTUAL nas mensagens da Meta
 * (`message`/`error_user_title`/`error_user_msg`, já sanitizadas) de que a
 * rejeição é sobre `time_range`/período. Sem essa evidência: `false`,
 * nunca `range_rejected`. `GraphErrorKind`/`classifyGraphError` continuam
 * com os MESMOS 5 valores de sempre (o executor V2.2.3 não muda) —
 * `GraphErrorDetails` é um campo NOVO e opcional de `GraphApiError`, só
 * lido aqui. Qualquer outro erro (auth, permissão, rate limit, transient,
 * resposta malformada, OU code 100 sem evidência de range) NUNCA vira
 * `range_rejected` — passa como está (`err.kind`), o algoritmo falha
 * explicitamente com esse motivo, sem tentar blocos.
 *
 * RATE PRESSURE: além de capturar `x-app-usage`/`x-ad-account-usage`
 * (`captureRateUsage`, dentro de `fetchEdgePage`, automático), o `probe`
 * abaixo CHECA a pressão ANTES de cada chamada real (`canRunDiscoveryNow`,
 * MESMO limiar conservador de `lib/backfill/rate-limit.ts#canRunBackfill` —
 * mirror local, Deno não importa de `lib/`, mesmo padrão já usado no
 * executor `canRunBackfillNow` — NÃO alterado). Sob pressão alta, o probe
 * devolve `errorKind: "rate_limited"` SEM fazer a chamada HTTP — o
 * algoritmo trata isso como qualquer outro erro (nunca fallback, nunca
 * `no_history` forjado) e ainda conta contra `MAX_DISCOVERY_PROBES`
 * (nunca dispara probes sem limite mesmo sob pressão sustentada).
 *
 * READ-ONLY: nenhuma escrita nesta função — nem em `meta_connections`
 * (mesmo em erro de secret/decrypt, diferente do executor: aqui é só uma
 * consulta exploratória, sem efeito colateral algum).
 *
 * TOKEN/SECRET: token descriptografado só em memória da invocação; NUNCA
 * retornado, NUNCA logado. Resultado HTTP e logs contêm SOMENTE
 * identificadores operacionais e datas — nunca token/secret.
 */

import { createClient } from "npm:@supabase/supabase-js@2";
import { json, requireEnv } from "../_shared/http.ts";
import { resolveSecretKey } from "../_shared/supabase.ts";
import { openToken } from "../_shared/crypto.ts";
import {
  GraphApiError,
  getAdAccountMeta,
  getRateUsage,
  isRangeRejectedGraphError,
  probeAccountInsights,
  resetRateUsage,
} from "../_shared/graph.ts";
import { accountToday, addDays } from "../_shared/date-util.ts";
import { resolveEligibleAccount } from "../_shared/backfill-eligibility.ts";
import { discoverEarliestDate, DEFAULT_MAX_DISCOVERY_PROBES, type ProbeFn } from "../_shared/discovery-algorithm.ts";

// deno-lint-ignore no-explicit-any
type AnyClient = any;

const GRAPH_BASE = Deno.env.get("META_GRAPH_BASE") ?? "https://graph.facebook.com";
const GRAPH_VERSION = Deno.env.get("META_GRAPH_VERSION") ?? "v26.0";

/**
 * Mesmo limiar conservador de `lib/backfill/rate-limit.ts#canRunBackfill` /
 * `meta-backfill-executor#canRunBackfillNow` (Deno não importa de `lib/`;
 * mantenha os três em sync se um mudar). NÃO altera o executor.
 */
function canRunDiscoveryNow(): boolean {
  const usage = getRateUsage();
  if (usage.throttled) return false;
  return usage.app_max_pct < 60 && usage.ad_account_max_pct < 60;
}

/** compara duas strings em tempo constante (mesmo padrão das demais Edge Functions de backfill). */
function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ba = enc.encode(a);
  const bb = enc.encode(b);
  let diff = ba.length ^ bb.length;
  const n = Math.max(ba.length, bb.length);
  for (let i = 0; i < n; i++) diff |= (ba[i] ?? 0) ^ (bb[i] ?? 0);
  return diff === 0;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  let SUPABASE_URL: string;
  let SECRET_KEY: string;
  let ENC_KEY: string;
  let DISCOVERY_SECRET: string;
  try {
    SUPABASE_URL = requireEnv("SUPABASE_URL");
    SECRET_KEY = resolveSecretKey();
    ENC_KEY = requireEnv("META_TOKEN_ENC_KEY");
    DISCOVERY_SECRET = requireEnv("META_BACKFILL_DISCOVERY_SECRET");
  } catch (err) {
    return json({ error: "misconfigured", detail: String(err) }, 500);
  }

  const provided = req.headers.get("x-meta-backfill-discovery-secret") ?? "";
  if (!provided || !timingSafeEqual(provided, DISCOVERY_SECRET)) {
    return json({ error: "unauthorized" }, 401);
  }

  const body = (await req.json().catch(() => null)) as { clientId?: unknown; adAccountRef?: unknown } | null;
  const clientId = typeof body?.clientId === "string" ? body.clientId.trim() : "";
  const adAccountRef = typeof body?.adAccountRef === "string" ? body.adAccountRef.trim() : "";
  if (!clientId || !adAccountRef) {
    return json({ error: "bad_request", detail: "clientId e adAccountRef são obrigatórios" }, 400);
  }

  const admin: AnyClient = createClient(SUPABASE_URL, SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const eligibility = await resolveEligibleAccount(admin, clientId, adAccountRef);
  if (!eligibility.ok) {
    const statusByReason: Record<string, number> = {
      client_not_found: 404,
      account_not_found_for_client: 404,
      account_not_linked: 409,
      no_connection: 409,
      connection_not_found: 409,
      connection_not_eligible: 409,
    };
    return json({ error: eligibility.reason }, statusByReason[eligibility.reason] ?? 409);
  }
  const { account } = eligibility;

  // token só em memória, nunca retornado/logado. Discovery é READ-ONLY —
  // nenhuma escrita em meta_connections mesmo se o secret faltar/for inválido.
  const { data: secretRow } = await admin
    .from("meta_connection_secrets")
    .select("token_cipher, token_iv, token_tag")
    .eq("connection_id", account.connection_id)
    .maybeSingle();
  const sec = secretRow as { token_cipher: string; token_iv: string; token_tag: string } | null;
  if (!sec) return json({ error: "no_connection_secret" }, 409);

  let token: string;
  try {
    token = await openToken({ cipher: sec.token_cipher, iv: sec.token_iv, tag: sec.token_tag }, ENC_KEY);
  } catch {
    return json({ error: "decrypt_failed" }, 409);
  }

  const graph = { graphBase: GRAPH_BASE, version: GRAPH_VERSION, token };

  let meta: { createdTime: string | null; timezoneName: string | null };
  try {
    meta = await getAdAccountMeta({ ...graph, adAccountId: account.ad_account_id });
  } catch (err) {
    const kind = err instanceof GraphApiError ? err.kind : "unknown";
    return json({ error: "account_meta_failed", errorClass: kind }, 502);
  }

  // limite inferior: created_time da Meta, AO VIVO — nunca inventado, nunca
  // derivado do nosso banco (não temos essa coluna localmente, de propósito).
  const accountCreatedDate = meta.createdTime ? meta.createdTime.slice(0, 10) : null;
  if (!accountCreatedDate) {
    return json({ error: "created_time_unavailable" }, 502);
  }
  // timezone: preferência pela resposta AO VIVO da Meta; fallback pro valor
  // local já conhecido (meta_ad_accounts.timezone_name); nunca UTC assumido
  // silenciosamente, nunca timezone do host.
  const accountTimezone = meta.timezoneName ?? account.timezone_name ?? "UTC";
  const latestClosedDate = addDays(accountToday(accountTimezone), -1);

  // reseta o acumulador de rate usage ANTES dos probes — isolamento desta
  // invocação (mesma defesa contra isolate "morno" já aplicada no executor).
  resetRateUsage();

  const probe: ProbeFn = async (range) => {
    // pressão de rate ALTA -> recusa ANTES de gastar a chamada HTTP. Isto
    // conta como 1 probe (o algoritmo já incrementa probesPerformed antes
    // de chamar esta função) — nunca dispara probes sem limite mesmo sob
    // pressão sustentada (MAX_DISCOVERY_PROBES continua valendo).
    if (!canRunDiscoveryNow()) {
      return { hasData: false, errorKind: "rate_limited" };
    }
    try {
      const r = await probeAccountInsights({ ...graph, adAccountId: account.ad_account_id, since: range.since, until: range.until });
      return { hasData: r.hasData };
    } catch (err) {
      if (err instanceof GraphApiError) {
        // MICRO-AUDITORIA (V2.3B.1): code 100 sozinho NÃO é suficiente —
        // isRangeRejectedGraphError exige TAMBÉM evidência textual de que a
        // rejeição é sobre time_range/período (ver graph.ts). Sem essa
        // evidência, cai no `err.kind` normal (quase sempre "unknown" para
        // code 100 genérico) -> probe_error, NUNCA fallback incorreto.
        if (isRangeRejectedGraphError(err.details)) {
          return { hasData: false, errorKind: "range_rejected" };
        }
        return { hasData: false, errorKind: err.kind };
      }
      return { hasData: false, errorKind: "unknown" };
    }
  };

  const outcome = await discoverEarliestDate({
    accountCreatedDate,
    latestClosedDate,
    probe,
    maxProbes: DEFAULT_MAX_DISCOVERY_PROBES,
  });

  console.log(
    JSON.stringify({
      event: "discovery_done",
      clientId,
      adAccountRef,
      status: outcome.status,
      probesPerformed: outcome.probesPerformed,
    }),
  );

  if (outcome.status === "probe_limit_exceeded") {
    return json({ error: "probe_limit_exceeded", probesPerformed: outcome.probesPerformed }, 503);
  }
  if (outcome.status === "confirmation_failed") {
    return json(
      { error: "confirmation_failed", candidateDate: outcome.candidateDate, probesPerformed: outcome.probesPerformed },
      502,
    );
  }
  if (outcome.status === "probe_error") {
    return json({ error: "probe_error", errorClass: outcome.errorKind, probesPerformed: outcome.probesPerformed }, 502);
  }

  return json({
    status: outcome.status, // "found" | "no_history"
    clientId,
    adAccountRef,
    metaAccountId: account.ad_account_id,
    accountTimezone,
    accountCreatedDate,
    earliestDate: outcome.status === "found" ? outcome.earliestDate : null,
    latestClosedDate,
    probesPerformed: outcome.probesPerformed,
    strategy: outcome.strategy,
  });
});
