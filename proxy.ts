import type { NextRequest } from "next/server";
import { updateSession } from "@/supabase/proxy";

// Convenção do Next.js 16 (ex-`middleware.ts`).
export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Todas as rotas, exceto:
     * - _next/static, _next/image
     * - favicon e arquivos de imagem
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
