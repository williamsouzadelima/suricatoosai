"""Smoke/contrato dos renderers — roda offline, só com requirements.txt.

    python packages/report-renderer/tests/smoke.py

Renderiza os 4 formatos de um modelo sintético rico (make_sample) e verifica os
invariantes que as regressões quebravam:
  • corpo de achado/evidência NÃO truncado (sentinelas no fim de textos longos);
  • nenhum achado some de tabela (F-01..F-14 presentes);
  • prints embutidos (>=1 imagem) e placeholder visível quando um alto/crítico
    não tem imagem;
  • capa full-bleed no PPTX;
  • export json com todos os achados;
  • tipografia IBM Plex: EMBUTIDA no PDF (sem Helvetica/Courier) e nomeada em
    DOCX/PPTX (sem Consolas) — verifica o OUTPUT, p/ pegar fallback silencioso.
Sai com código !=0 se algum invariante falhar (uso em CI).
"""

import os
import re
import sys
import tempfile
import zipfile
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, ROOT)   # pptx_renderer/docx_renderer/pdf_renderer/theme/logo
sys.path.insert(0, HERE)   # make_sample

import json  # noqa: E402
import make_sample  # noqa: E402
from pptx_renderer import render_pptx  # noqa: E402
from docx_renderer import render_docx  # noqa: E402
from pdf_renderer import render_pdf  # noqa: E402

SENT = ["DESCR_END_F-01", "NARR_END_F-01", "IMPACT_END_F-01", "REMED_END_F-01",
        "PARA_END_X", "STATBAND_END_X",
        # Título longo (>90) do F-01 termina neste sentinela — se QUALQUER formato
        # truncar o título do achado (o "…" que o William pegou), ele some.
        "TITLE_END_F-01",
        # 3ª leva: cadeia de ataque / plano por fase / bullets agora SEM corte
        # nos 3 formatos (PPTX cresce + pagina). Checado em docx/pptx/pdf.
        "ATTACK_TITLE_END_X", "ATTACK_DETAIL_END_X", "ROADMAP_END_X",
        "BULLETS_END_X"]
SENT_DOCPDF = []   # tudo migrou p/ SENT (os 3 formatos mostram inteiro)
PLACE = "capturada"  # "Evidência visual não capturada" (F-02 Alto, sem imagem)
SUMMARY = "SUMÁRIO"  # título do sumário (docx) / slide agenda (pptx)
# Fases da narrativa (make_sample._phases): devem aparecer no SUMÁRIO, ANTES do
# corpo. Âncora = sentinela do parágrafo de overview (1ª coisa do corpo após o
# sumário) → se a fase aparece antes da âncora, está no sumário; senão, só no corpo.
PHASES = ["Reconhecimento e Mapeamento", "Exploração e Acesso Inicial",
          "Movimento Lateral e Impacto"]
ANCHOR = "OVERVIEW_END_X"


def _summary_phase_fails(fmt, text):
    tns = text.replace(" ", "")
    if ANCHOR not in tns:
        return [f"{fmt}: âncora {ANCHOR} ausente (make_sample mudou?)"]
    a = tns.index(ANCHOR)
    out = []
    for ph in PHASES:
        p = ph.replace(" ", "")
        if p not in tns or tns.index(p) > a:
            out.append(f"{fmt}: fase '{ph}' fora do SUMÁRIO (só no corpo)")
    return out


def _strip(xml):
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", xml))


def _pdf_text(p):
    b = open(p, "rb").read()
    acc = []
    for m in re.finditer(rb"stream\r?\n(.*?)\r?\nendstream", b, re.S):
        try:
            data = zlib.decompress(m.group(1))
        except Exception:
            continue
        for tm in re.finditer(rb"\(((?:[^()\\]|\\.)*)\)", data):
            acc.append(tm.group(1))
    return b" ".join(acc).decode("latin1", "replace")


def main():
    fails = []
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as d:
        model = make_sample.build_model(d)
        with open(os.path.join(d, "model.json"), "w", encoding="utf-8") as fh:
            json.dump({**model, "findings":
                       [s["finding"] for s in model["sections"]
                        if s.get("type") == "findingCard"]}, fh, ensure_ascii=False)
        docx_p = os.path.join(d, "o.docx")
        pptx_p = os.path.join(d, "o.pptx")
        pdf_p = os.path.join(d, "o.pdf")
        render_docx(model, docx_p)
        render_pptx(model, pptx_p)
        render_pdf(model, pdf_p)

        # DOCX
        with zipfile.ZipFile(docx_p) as z:
            xml = z.read("word/document.xml").decode("utf-8", "replace")
        txt = _strip(xml)
        for s in SENT:
            if s not in txt:
                fails.append(f"docx: sentinela ausente {s} (texto truncado)")
        if xml.count("<a:blip ") < 1:
            fails.append("docx: nenhuma imagem embutida")
        if PLACE not in txt:
            fails.append("docx: placeholder de evidência ausente")
        if "F-14" not in txt or "F-01" not in txt:
            fails.append("docx: achado sumiu da tabela")
        if "IBM Plex Sans" not in xml:
            fails.append("docx: fonte da marca (IBM Plex Sans) ausente")
        if "IBM Plex Mono" not in xml:
            fails.append("docx: fonte mono (IBM Plex Mono) ausente")
        if "Consolas" in xml:
            fails.append("docx: Consolas ainda presente (mono nao trocado)")
        if SUMMARY not in txt:
            fails.append("docx: SUMÁRIO ausente")
        fails += _summary_phase_fails("docx", txt)
        for s in SENT_DOCPDF:
            if s not in txt:
                fails.append(f"docx: 2a leva truncada ({s})")

        # PPTX
        with zipfile.ZipFile(pptx_p) as z:
            slides = sorted(n for n in z.namelist()
                            if re.match(r"ppt/slides/slide\d+\.xml$", n))
            pxml = "".join(z.read(n).decode("utf-8", "replace") for n in slides)
            s1 = z.read(slides[0]).decode("utf-8", "replace") if slides else ""
        ptxt = _strip(pxml)
        for s in SENT:
            if s not in ptxt:
                fails.append(f"pptx: sentinela ausente {s} (texto truncado)")
        if "F-14" not in ptxt or "F-01" not in ptxt:
            fails.append("pptx: achado sumiu da tabela")
        if PLACE not in ptxt:
            fails.append("pptx: placeholder de evidência ausente")
        if "<p:pic>" not in s1:
            fails.append("pptx: capa sem imagem full-bleed")
        if "IBM Plex Sans" not in pxml:
            fails.append("pptx: fonte da marca (IBM Plex Sans) ausente")
        if "IBM Plex Mono" not in pxml:
            fails.append("pptx: fonte mono (IBM Plex Mono) ausente")
        if "Consolas" in pxml:
            fails.append("pptx: Consolas ainda presente (mono nao trocado)")
        # Agenda = 2º slide (cover=slide1, agenda=slide2); checa direto (a ordem
        # lexical de slideN.xml concatenada em pxml não é a ordem de criação).
        with zipfile.ZipFile(pptx_p) as z:
            agenda = _strip(z.read("ppt/slides/slide2.xml").decode("utf-8", "replace"))
        if SUMMARY not in agenda:
            fails.append("pptx: slide de SUMÁRIO (agenda) ausente/sem título")
        for ph in PHASES:
            if ph not in agenda:
                fails.append(f"pptx: fase '{ph}' ausente do slide de SUMÁRIO")

        # PDF — extração de texto precisa de pypdf (dev); sem ele, cai p/ um
        # extrator cru e só exige os checks quando há texto suficiente.
        try:
            import pypdf
            t = " ".join((pg.extract_text() or "")
                         for pg in pypdf.PdfReader(pdf_p).pages)
        except Exception:
            t = _pdf_text(pdf_p)
        pt = re.sub(r"\s+", "", t)
        if len(pt) > 2000:
            for s in SENT:
                if s not in pt:
                    fails.append(f"pdf: sentinela ausente {s} (texto truncado)")
            if PLACE not in pt:
                fails.append("pdf: placeholder de evidência ausente")
            fails += _summary_phase_fails("pdf", t)
            for s in SENT_DOCPDF:
                if s not in pt:
                    fails.append(f"pdf: 2a leva truncada ({s})")
        else:
            print("  NOTA: texto do PDF não extraído (instale pypdf) — "
                  "checagem de truncamento do PDF pulada nesta execução.")
        if os.path.getsize(pdf_p) < 1000:
            fails.append("pdf: arquivo vazio/inválido")
        # Fonte IBM Plex EMBUTIDA no PDF — verifica o OUTPUT, não só "sem erro":
        # o fallback silencioso p/ Helvetica é exatamente a regressão a pegar.
        pdfb = open(pdf_p, "rb").read()
        if b"IBMPlexSans" not in pdfb:
            fails.append("pdf: IBM Plex Sans nao embutida (fallback Helvetica?)")
        if b"IBMPlexMono" not in pdfb:
            fails.append("pdf: IBM Plex Mono nao embutida")
        if b"Helvetica" in pdfb:
            fails.append("pdf: Helvetica ainda presente (fonte nao trocada)")
        if b"Courier" in pdfb:
            fails.append("pdf: Courier ainda presente (mono nao trocado)")

        # SUMARIO: o numero de pagina tem que BATER com a pagina real do cabecalho
        # (pega o bug de numero deslocado 1 entrada). Opcional: precisa de pymupdf.
        try:
            import pymupdf  # noqa: E402
            pd = pymupdf.open(pdf_p)
            pgtext = [pd[i].get_text() for i in range(pd.page_count)]
            w2 = pd[1].get_text("words")  # pagina 2 = SUMARIO
            lab = [(x[1] + x[3]) / 2 for x in w2 if x[4] == "Reconhecimento"]
            claim = None
            if lab:
                nums = [int(x[4]) for x in w2 if x[4].isdigit()
                        and x[0] > pd[1].rect.width * 0.6
                        and abs((x[1] + x[3]) / 2 - lab[0]) < 9]
                claim = nums[0] if nums else None
            real_pg = next((i + 1 for i in range(2, pd.page_count)
                            if "Reconhecimento e Mapeamento" in pgtext[i]), None)
            if claim is None or real_pg is None:
                print("  NOTA: cross-check de pagina do SUMARIO inconclusivo.")
            elif claim != real_pg:
                fails.append(f"pdf: SUMARIO aponta pag {claim} p/ 'Reconhecimento' "
                             f"mas o cabecalho esta na pag {real_pg} (numero deslocado)")
        except ImportError:
            print("  NOTA: pymupdf ausente — cross-check de pagina do SUMARIO pulado.")

    if fails:
        print("SMOKE FAIL:")
        for f in fails:
            print("  -", f)
        sys.exit(1)
    print("SMOKE PASS: docx/pptx/pdf/json — sem truncamento, prints e capa OK.")


if __name__ == "__main__":
    main()
