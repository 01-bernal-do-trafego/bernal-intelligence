/**
 * Parse-guards do BUG A (origem atrás de reverse proxy) e do BUG B (log
 * sanitizado do exchange_failed). Estáticos, sem DB e sem runtime Deno.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../../", import.meta.url));
const read = (rel: string) => readFileSync(`${root}${rel}`, "utf8");

const callback = read("app/api/meta/oauth/callback/route.ts");
const start = read("app/api/meta/oauth/start/route.ts");
const proxy = read("supabase/proxy.ts");
const graph = read("supabase/functions/_shared/graph.ts");
const exchangeFn = read("supabase/functions/meta-oauth-exchange/index.ts");

describe("BUG A — redirects usam a origem autoritativa, não nextUrl.origin cru", () => {
  it("callback importa appOrigin de @/lib/app-url", () => {
    expect(callback).toMatch(/import\s*\{\s*appOrigin\s*\}\s*from\s*"@\/lib\/app-url"/);
  });
  it("start importa appOrigin de @/lib/app-url", () => {
    expect(start).toMatch(/import\s*\{\s*appOrigin\s*\}\s*from\s*"@\/lib\/app-url"/);
  });
  it("proxy importa appOrigin de @/lib/app-url", () => {
    expect(proxy).toMatch(/import\s*\{\s*appOrigin\s*\}\s*from\s*"@\/lib\/app-url"/);
  });

  it("callback: a origem dos redirects vem de appOrigin(request)", () => {
    expect(callback).toMatch(/const\s+origin\s*=\s*appOrigin\(request\)/);
  });
  it("nenhum dos três monta URL de redirect a partir de request.nextUrl.origin", () => {
    for (const src of [callback, start, proxy]) {
      expect(src).not.toMatch(/request\.nextUrl\.origin/);
    }
  });
  it("proxy não usa mais nextUrl.clone() para montar o Location", () => {
    expect(proxy).not.toMatch(/nextUrl\.clone\(\)/);
    expect(proxy).toMatch(/new URL\(pathname,\s*appOrigin\(request\)\)/);
  });
  it("não lê x-forwarded-* para derivar a origem", () => {
    for (const src of [callback, start, proxy, read("lib/app-url.ts")]) {
      expect(src).not.toMatch(/headers\s*\.\s*(get|has)\(\s*["'`]x-forwarded/i);
      expect(src).not.toMatch(/["'`]x-forwarded-(host|proto|port)["'`]\s*\]/i);
    }
  });
});

describe("BUG B — exchange_failed loga só o diagnóstico sanitizado", () => {
  it("graph.ts lança MetaExchangeError com o objeto sanitizado", () => {
    expect(graph).toMatch(/export class MetaExchangeError/);
    expect(graph).toMatch(/throw new MetaExchangeError\(buildSanitizedExchangeError\(res\.status,\s*body\)\)/);
  });
  it("graph.ts não coloca code/redirect_uri/secret na mensagem do erro", () => {
    // a message do Error é um rótulo curto, sem interpolar segredos
    expect(graph).toMatch(/meta_exchange_failed:\$\{sanitized\.meta_error_code/);
    expect(graph).not.toMatch(/Falha na troca do code: \$\{detail\}/);
    expect(graph).not.toMatch(/JSON\.stringify\(body\.error\)/);
  });
  it("a Edge Function loga só evt + clientId + campos sanitizados", () => {
    expect(exchangeFn).toMatch(/console\.error\(\s*\n?\s*JSON\.stringify\(\{\s*evt:\s*"meta_oauth_exchange_failed",\s*clientId,\s*\.\.\.err\.sanitized\s*\}\)/);
  });
  it("a Edge Function NUNCA loga code/token/secret/JWT/Authorization/corpo cru", () => {
    // recorta só o handler catch da troca (o `} catch (err) {` após a chamada)
    const afterCall = exchangeFn.indexOf("exchangeCodeForToken(");
    const catchStart = exchangeFn.indexOf("} catch (err) {", afterCall);
    const marker = 'return json({ error: "exchange_failed" }, 502);';
    const to = exchangeFn.indexOf(marker, catchStart) + marker.length;
    expect(afterCall).toBeGreaterThan(-1);
    expect(catchStart).toBeGreaterThan(afterCall);
    expect(to).toBeGreaterThan(catchStart);
    const block = exchangeFn.slice(catchStart, to);
    expect(block).not.toMatch(/\bcode\b(?!Id)/); // 'code' isolado (permite 'clientId')
    expect(block).not.toMatch(/accessToken|access_token/);
    expect(block).not.toMatch(/APP_SECRET|appSecret|client_secret/);
    expect(block).not.toMatch(/ENC_KEY|token_cipher|META_TOKEN_ENC_KEY/);
    expect(block).not.toMatch(/authHeader|Authorization|Bearer/);
    expect(block).not.toMatch(/req\.json|\bbody\b/);
    // e o que PODE aparecer: evt, clientId, campos sanitizados
    expect(block).toMatch(/evt:\s*"meta_oauth_exchange_failed"/);
    expect(block).toMatch(/\.\.\.err\.sanitized/);
  });
  it("exchange_failed continua HTTP 502", () => {
    expect(exchangeFn).toMatch(/return json\(\{\s*error:\s*"exchange_failed"\s*\},\s*502\)/);
  });
  it("o cabeçalho da função declara o logging sanitizado", () => {
    expect(exchangeFn).toMatch(/LOGGING:\s*só uma linha SANITIZADA/);
  });
});
