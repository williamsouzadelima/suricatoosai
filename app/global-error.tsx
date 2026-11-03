"use client";

/* eslint-disable @next/next/no-html-link-for-pages -- esta página não pode importar next/link; o <a href="/"> faz um reload completo de propósito após um crash do root layout. */

// Último recurso: só dispara quando o próprio root layout quebra (bundle/chunk
// ruim, provider que lançou). Por isso NÃO importa globals.css, fontes nem o
// SVG do logo — tudo que a página cujo trabalho é sobreviver não pode depender.
// Estilos inline, wordmark em texto, zero imports além do React. pt-BR fixo
// (roda fora do NextIntlClientProvider).
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="pt-BR">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "1.25rem",
          padding: "1.5rem",
          textAlign: "center",
          background: "#0b1626",
          color: "#e8edf5",
          fontFamily:
            "system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
        }}
      >
        <div style={{ fontSize: "1.5rem", fontWeight: 800, letterSpacing: "-0.01em" }}>
          Suricatoos
        </div>
        <h1 style={{ fontSize: "1.25rem", fontWeight: 700, margin: 0 }}>
          Algo deu errado
        </h1>
        <p
          style={{
            maxWidth: "28rem",
            margin: 0,
            fontSize: "0.875rem",
            lineHeight: 1.6,
            color: "#9fb0c8",
          }}
        >
          Ocorreu um erro inesperado ao carregar o aplicativo. Você pode tentar
          novamente ou voltar ao início.
        </p>
        {error?.digest && (
          <p
            style={{
              margin: 0,
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
              fontSize: "0.75rem",
              color: "#6b7a92",
            }}
          >
            ID: {error.digest}
          </p>
        )}
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", justifyContent: "center" }}>
          <button
            onClick={() => reset()}
            style={{
              height: "2.5rem",
              padding: "0 1.25rem",
              borderRadius: "0.375rem",
              border: "none",
              background: "#ff7678",
              color: "#0b1626",
              fontSize: "0.875rem",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Tentar novamente
          </button>
          <a
            href="/"
            style={{
              display: "inline-flex",
              alignItems: "center",
              height: "2.5rem",
              padding: "0 1.25rem",
              borderRadius: "0.375rem",
              border: "1px solid #2a3a52",
              background: "transparent",
              color: "#e8edf5",
              fontSize: "0.875rem",
              fontWeight: 600,
              textDecoration: "none",
            }}
          >
            Ir para o início
          </a>
        </div>
      </body>
    </html>
  );
}
