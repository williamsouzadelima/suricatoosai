"""Entry do renderer de relatorio.

Uso: python render_report.py <model.json> <docx|pptx|pdf|json> <out_path>

Le um ReportModel (JSON, ver lib/reports/report-model.ts) e gera o arquivo no
formato pedido. `json` reemite o proprio ReportModel (estruturado, legivel por
maquina) — nenhuma dependencia de terceiros. Sem dependencia de rede; roda num
container controlado (E2B dedicado na v1 do trigger, ou @trigger.dev/python na
v2)."""

import sys
import os
import json

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))


def main():
    if len(sys.argv) < 4:
        raise SystemExit(
            "uso: render_report.py <model.json> <docx|pptx|pdf|json> <out>"
        )
    model_path, fmt, out_path = sys.argv[1], sys.argv[2], sys.argv[3]
    with open(model_path, encoding="utf-8") as f:
        model = json.load(f)
    if fmt == "pptx":
        from pptx_renderer import render_pptx

        render_pptx(model, out_path)
    elif fmt == "docx":
        from docx_renderer import render_docx

        render_docx(model, out_path)
    elif fmt == "pdf":
        from pdf_renderer import render_pdf

        render_pdf(model, out_path)
    elif fmt == "json":
        # Exportacao estruturada: o proprio ReportModel (meta + kpis + charts +
        # sections, com os achados/evidencias embutidos). Sem truncar.
        with open(out_path, "w", encoding="utf-8") as fh:
            json.dump(model, fh, ensure_ascii=False, indent=2)
    else:
        raise SystemExit(f"formato invalido: {fmt}")
    print(f"OK {fmt} -> {out_path}")


if __name__ == "__main__":
    main()
