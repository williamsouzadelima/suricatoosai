/**
 * CVSS 3.1 Base Score — re-export da implementação CANÔNICA em `convex/lib/cvss`.
 *
 * A lógica foi movida para `convex/lib/cvss` para ser importável também do runtime
 * do Convex (o merge de recaptura deriva o score do vetor lá). Mantemos este
 * caminho de import estável para os callers existentes (trigger/report-generation,
 * trigger/extract-findings, trigger/ingest-bundle) e garantimos UMA fonte da
 * verdade — qualquer caller que DERIVE um score de um vetor usa a mesma
 * implementação (o relatório, por ex.). O portal mostra o score ARMAZENADO (não
 * deriva), então aqui não se afirma paridade portal↔relatório.
 */

export { cvssBaseScore } from "@/convex/lib/cvss";
