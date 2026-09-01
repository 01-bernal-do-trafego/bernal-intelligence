/**
 * Placeholder temporário. Nas etapas seguintes esta rota passa a renderizar
 * a Home administrativa ("Visão geral") dentro do shell autenticado.
 */
export default function Page() {
  return (
    <main className="mx-auto flex min-h-full max-w-md flex-col justify-center gap-3 px-6">
      <p className="text-sm font-medium uppercase tracking-[0.2em] text-accent">
        Bernal Intelligence
      </p>
      <h1 className="text-2xl font-semibold text-foreground">
        Fundação em construção
      </h1>
      <p className="text-sm text-muted">
        Design system, shell autenticado e dashboards mockados serão montados nas
        próximas etapas.
      </p>
    </main>
  );
}
