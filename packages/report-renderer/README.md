# report-renderer

Renderiza um `ReportModel` (ver `lib/reports/report-model.ts`) em `.docx`, `.pptx`
e `.pdf`, aplicando a identidade da marca Suricatoos (`theme.py`, espelha
`lib/reports/theme.ts`). Executado num container controlado (E2B dedicado na v1
do trigger, ou `@trigger.dev/python` na v2) — NUNCA no sandbox de pentest do
cliente.

Uso: `python render_report.py <model.json> <docx|pptx|pdf> <out_path>`

Cada `Section.type` do ReportModel tem um handler em cada renderer; um teste de
contrato (a fazer) garante paridade entre os três formatos.
