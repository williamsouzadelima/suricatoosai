import sharp from "sharp";

/**
 * Converte um GIF (animado ou nao) no seu QUADRO-CHAVE como PNG estatico: o
 * ULTIMO frame. Numa sessao gravada (asciinema -> agg) o ultimo frame e o estado
 * final, onde costuma estar a prova; e documentos (pdf/docx/pptx) nao animam GIF,
 * entao o relatorio embute esse PNG em vez de um GIF quebrado/so-primeiro-frame.
 *
 * Le os metadados para achar o numero de frames (`pages`) e extrai o ultimo via
 * `sharp(gif, { page })`. Retorna `null` em QUALQUER erro (formato invalido,
 * sharp indisponivel): o chamador mantem o GIF original — nunca quebra o fluxo.
 */
export async function gifKeyFramePng(gif: Buffer): Promise<Buffer | null> {
  try {
    const pages = (await sharp(gif).metadata()).pages ?? 1;
    const page = pages > 1 ? pages - 1 : 0;
    return await sharp(gif, { page }).png().toBuffer();
  } catch {
    return null;
  }
}
