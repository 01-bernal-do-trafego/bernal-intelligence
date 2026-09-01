import Link from "next/link";

export default function ClientNotFound() {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4 py-16 text-center">
      <h1 className="text-lg font-semibold text-foreground">
        Cliente não encontrado
      </h1>
      <p className="text-sm text-muted">
        O cliente que você tentou abrir não existe ou foi removido.
      </p>
      <Link
        href="/clients"
        className="text-sm font-medium text-accent hover:text-accent-hover"
      >
        Voltar para clientes
      </Link>
    </div>
  );
}
