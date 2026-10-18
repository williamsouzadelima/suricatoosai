# report-renderer

Renderiza um `ReportModel` (ver `lib/reports/report-model.ts`) em `.docx`, `.pptx`
e `.pdf`, aplicando a identidade da marca Suricatoos (`theme.py`, espelha
`lib/reports/theme.ts`). Executado num container controlado (E2B dedicado na v1
do trigger, ou `@trigger.dev/python` na v2) — NUNCA no sandbox de pentest do
cliente.

Uso: `python render_report.py <model.json> <docx|pptx|pdf|json> <out_path>`
(`json` reemite o ReportModel estruturado — meta + kpis + charts + sections +
findings — para integração/export.)

Garantias: corpo de achado/evidência **nunca é truncado** (DOCX/PDF fluem; PPTX
pagina em slides "(cont.)"); prints embutidos **inline por achado**, com
**placeholder visível** quando um achado alto/crítico não tem imagem; **capa**
opcional por marca (`brand.coverImagePath`, resolvida do S3 pelo trigger):
full-bleed em PPTX e PDF; no DOCX, imagem de capa grande centralizada (dentro das
margens — evita o bug de página em branco de capa com seção 0-margin). Fallback
para a capa programática.

Tipografia: **IBM Plex** (OFL) — **embutida** no PDF (glifos; independe do
visualizador); em DOCX/PPTX o nome da família é aplicado (o embed real no pacote
OOXML é follow-up, com validação via Office/COM). Os `.ttf` ficam em `fonts/`,
são empacotados em `fonts.ts` (base64) e escritos no sandbox pelo job do trigger.
Sem os `.ttf`, cai para Calibri/Helvetica.

Testes (offline): `python tests/smoke.py` renderiza um modelo sintético rico
(`tests/make_sample.py`) nos 4 formatos e falha se houver truncamento, achado
perdido, print/capa faltando ou a tipografia IBM Plex ausente/trocada (verifica o
PDF embutido e os nomes em DOCX/PPTX). Deps de teste: `pip install -r
tests/requirements-dev.txt`.
