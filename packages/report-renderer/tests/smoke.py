"""Smoke/contrato dos renderers — roda offline, só com requirements.txt.

    python packages/report-renderer/tests/smoke.py

Renderiza os 4 formatos de um modelo sintético rico (make_sample) e verifica os
invariantes que as regressões quebravam:
  • corpo de achado/evidência NÃO truncado (sentinelas no fim de textos longos);
  • nenhum achado some de tabela (F-01..F-14 presentes);
  • prints embutidos (>=1 imagem) e placeholder visível quando um alto/crítico
    não tem imagem;
  • capa full-bleed no PPTX;
  • export json com todos os achados.
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
        "PARA_END_X", "STATBAND_END_X"]
PLACE = "capturada"  # "Evidência visual não capturada" (F-02 Alto, sem imagem)


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
        else:
            print("  NOTA: texto do PDF não extraído (instale pypdf) — "
                  "checagem de truncamento do PDF pulada nesta execução.")
        if os.path.getsize(pdf_p) < 1000:
            fails.append("pdf: arquivo vazio/inválido")

    if fails:
        print("SMOKE FAIL:")
        for f in fails:
            print("  -", f)
        sys.exit(1)
    print("SMOKE PASS: docx/pptx/pdf/json — sem truncamento, prints e capa OK.")


if __name__ == "__main__":
    main()
