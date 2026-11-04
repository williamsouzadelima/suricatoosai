import { toast, type ExternalToast } from "sonner";

// Helpers de toast — padronizam as formas que já aparecem espalhadas no app
// (~293 chamadas a `toast.*`), SEM varrer tudo de uma vez: use estes em código
// novo e ao tocar um arquivo. São a semente + o padrão a seguir, não uma
// migração em massa (que seria risco alto por ganho marginal).

/**
 * Erro padronizado. Reproduz EXATAMENTE o padrão dominante já no código:
 * mostra `err.message` quando é um Error com mensagem, senão o `fallback`; e
 * loga o erro cru no console para depuração.
 *
 * Não normaliza a feiura de ConvexError ("Uncaught ConvexError: …") — isso é
 * mudança de UX visível e merece commit próprio, não carona num refactor.
 */
export function toastError(err: unknown, fallback = "Algo deu errado."): void {
  const msg = err instanceof Error && err.message ? err.message : fallback;
  toast.error(msg);
  console.error(err);
}

/** Sucesso padronizado (passa opções do sonner adiante, ex.: description). */
export function toastOk(message: string, opts?: ExternalToast): void {
  toast.success(message, opts);
}

/** Informativo padronizado. */
export function toastInfo(message: string, opts?: ExternalToast): void {
  toast.info(message, opts);
}
