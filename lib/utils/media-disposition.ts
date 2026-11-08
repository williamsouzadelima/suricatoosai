/**
 * Decide o Content-Disposition (e o tipo canônico a FIXAR) para servir um objeto
 * do S3 MESMO-ORIGEM.
 *
 * AWS_S3_ENDPOINT está no MESMO ORIGIN que o app, então um GET pré-assinado que
 * renderiza INLINE executa no nosso origin. Um SVG/HTML armazenado (upload de
 * usuário) vira XSS persistente se servido inline. Mitigação em DUAS partes:
 *  1) só uma ALLOWLIST de tipos que o browser renderiza SEM executar script vai
 *     inline; todo o resto (SVG/HTML/XML/octet-stream/desconhecido) → `attachment`.
 *  2) NECESSÁRIO: o caller que serve INLINE DEVE também FIXAR o Content-Type ao
 *     tipo canônico seguro (`inlineSafeContentType`) — o Content-Type do OBJETO no
 *     S3 é controlado pelo upload e pode MENTIR (ex. text/html salvo sob rótulo
 *     image/png). Disposição inline + Content-Type do objeto = XSS. Ver
 *     convex/s3Utils.ts::generateS3DownloadUrl.
 */

// Tipos que o browser renderiza sem executar script no nosso origin.
//  - raster: não tem script;
//  - pdf: renderizado no visualizador sandbox do browser, não como HTML da página.
// SVG (image/svg+xml) é PROPOSITALMENTE deixado de fora: carrega <script>.
const INLINE_SAFE_MEDIA_TYPES: ReadonlySet<string> = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "application/pdf",
]);

// Aliases → tipo canônico (image/jpg é alias de image/jpeg; o codebase normaliza
// em image-validation.ts). Map (não objeto) p/ não casar "__proto__"/"constructor".
// Normalizados ANTES do allowlist.
const MEDIA_TYPE_ALIASES = new Map<string, string>([["image/jpg", "image/jpeg"]]);

/** Normaliza: minúsculas, sem parâmetros (`;charset=…`), sem espaços, + aliases. */
function normalizeMediaType(mediaType?: string | null): string {
  if (!mediaType) return "";
  const semi = mediaType.indexOf(";");
  const base = semi >= 0 ? mediaType.slice(0, semi) : mediaType;
  const trimmed = base.trim().toLowerCase();
  return MEDIA_TYPE_ALIASES.get(trimmed) ?? trimmed;
}

/** É seguro servir INLINE mesmo-origem? Só a allowlist; na dúvida → false. */
export function isInlineSafeMediaType(mediaType?: string | null): boolean {
  return INLINE_SAFE_MEDIA_TYPES.has(normalizeMediaType(mediaType));
}

/**
 * Tipo canônico seguro para FIXAR como Content-Type ao servir INLINE (parte 2 da
 * doc do módulo): retorna o tipo da allowlist (normalizado/aliased) ou undefined
 * quando não é inline-safe. O caller pina ESTE valor, nunca o Content-Type do
 * objeto no S3 — senão um objeto com Content-Type mentiroso executa.
 */
export function inlineSafeContentType(
  mediaType?: string | null,
): string | undefined {
  const canonical = normalizeMediaType(mediaType);
  return INLINE_SAFE_MEDIA_TYPES.has(canonical) ? canonical : undefined;
}

/**
 * Sanitiza um nome de arquivo para um header HTTP: remove CR/LF/aspas/barra
 * invertida e caracteres de controle (anti header-injection) e limita o tamanho.
 * Retorna undefined se nada seguro sobrar.
 */
export function sanitizeHeaderFilename(name?: string | null): string | undefined {
  if (!name) return undefined;
  let cleaned = "";
  for (const ch of name) {
    const code = ch.charCodeAt(0);
    // Remove controles (0x00–0x1f, 0x7f) — inclui CR/LF (anti header-injection).
    if (code < 0x20 || code === 0x7f) continue;
    // Remove aspas e barra invertida que quebrariam o filename="...".
    if (ch === '"' || ch === "\\") continue;
    cleaned += ch;
  }
  // Trunca por CODE POINTS, não unidades UTF-16: um slice direto partiria um par
  // substituto (emoji na borda dos 200 chars) deixando um surrogate solto, que
  // pode estourar na serialização da URL pré-assinada (N1).
  cleaned = Array.from(cleaned.trim()).slice(0, 200).join("");
  return cleaned.length > 0 ? cleaned : undefined;
}

/**
 * Valor de Content-Disposition para servir um objeto same-origin:
 *  - `inline` só para a allowlist de tipos seguros;
 *  - `attachment` (padrão seguro) para todo o resto — inclusive tipo ausente
 *    ou desconhecido.
 * Um filename opcional é sanitizado e anexado.
 */
export function contentDispositionFor(
  mediaType?: string | null,
  filename?: string | null,
): string {
  const disposition = isInlineSafeMediaType(mediaType) ? "inline" : "attachment";
  const safeName = sanitizeHeaderFilename(filename);
  return safeName ? `${disposition}; filename="${safeName}"` : disposition;
}
