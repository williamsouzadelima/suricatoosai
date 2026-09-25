"""Renderer DOCX (python-docx) do ReportModel."""

from docx import Document
from docx.shared import Pt, RGBColor, Inches
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.oxml.ns import qn
from docx.oxml import OxmlElement
import os

import theme as T
import logo


def _rgb(h):
    return RGBColor.from_string(h)


def _shade(cell, hexfill):
    tcPr = cell._tc.get_or_add_tcPr()
    shd = OxmlElement("w:shd")
    shd.set(qn("w:val"), "clear")
    shd.set(qn("w:fill"), hexfill)
    tcPr.append(shd)


def _run(p, text, size=11, bold=False, color=T.INK, font=T.FONT_BODY):
    r = p.add_run(str(text))
    r.font.size = Pt(size)
    r.font.bold = bold
    r.font.name = font
    r.font.color.rgb = _rgb(color)
    return r


def _para(doc, text, size=11, bold=False, color=T.INK, after=6, align=None):
    p = doc.add_paragraph()
    if align is not None:
        p.alignment = align
    p.paragraph_format.space_after = Pt(after)
    _run(p, text, size, bold, color)
    return p


def _heading(doc, text, level=1):
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(14)
    p.paragraph_format.space_after = Pt(6)
    _run(p, text, size=17 if level == 1 else 14, bold=True, color=T.PRIMARY,
         font=T.FONT_DISPLAY)
    # regra fina coral
    pPr = p._p.get_or_add_pPr()
    bdr = OxmlElement("w:pBdr")
    bottom = OxmlElement("w:bottom")
    bottom.set(qn("w:val"), "single")
    bottom.set(qn("w:sz"), "12")
    bottom.set(qn("w:space"), "4")
    bottom.set(qn("w:color"), T.CORAL)
    bdr.append(bottom)
    pPr.append(bdr)


def _clip(s, n):
    s = str(s or "")
    return s if len(s) <= n else s[: n - 1] + "…"


def _cover(doc, sec, meta):
    for _ in range(3):
        doc.add_paragraph()
    _lp = logo.write_logo(dark=False)
    if _lp and os.path.exists(_lp):
        try:
            doc.add_picture(_lp, width=Inches(2.6))
        except Exception:
            _para(doc, T.WORDMARK, size=22, bold=True, color=T.CORAL,
                  align=WD_ALIGN_PARAGRAPH.LEFT)
    else:
        _para(doc, T.WORDMARK, size=22, bold=True, color=T.CORAL,
              align=WD_ALIGN_PARAGRAPH.LEFT)
    _para(doc, sec.get("title", ""), size=34, bold=True, color=T.INK, after=4)
    if sec.get("subtitle"):
        _para(doc, sec["subtitle"], size=16, color=T.MUTED)
    for _ in range(8):
        doc.add_paragraph()
    _para(doc, meta.get("classification", ""), size=10, color=T.MUTED)
    doc.add_page_break()


def _kpis(doc, kpis):
    tiles = [
        ("Total de achados", str(kpis.get("total", 0))),
        ("Risco (0-100)", str(kpis.get("riskScore", 0))),
        ("CVSS medio", str(kpis.get("avgCvss") if kpis.get("avgCvss") is not None else "-")),
        ("Criticos+Altos", str(kpis.get("bySeverity", {}).get("critical", 0)
                               + kpis.get("bySeverity", {}).get("high", 0))),
    ]
    t = doc.add_table(rows=2, cols=4)
    t.alignment = WD_TABLE_ALIGNMENT.CENTER
    for j, (label, val) in enumerate(tiles):
        c0 = t.cell(0, j)
        c0.text = ""
        _shade(c0, T.SURFACE_ALT)
        _run(c0.paragraphs[0], label.upper(), size=9, bold=True, color=T.MUTED)
        c1 = t.cell(1, j)
        c1.text = ""
        _shade(c1, T.SURFACE_ALT)
        _run(c1.paragraphs[0], val, size=26, bold=True, color=T.PRIMARY,
             font=T.FONT_DISPLAY)
    doc.add_paragraph()


def _severity_chart(doc, data):
    dist = data.get("severityDistribution", [])
    maxc = max([d.get("count", 0) for d in dist] + [1])
    for d in dist:
        sev = d.get("severity")
        c = d.get("count", 0)
        p = doc.add_paragraph()
        p.paragraph_format.space_after = Pt(2)
        _run(p, f"{T.SEVERITY_LABEL.get(sev, sev):<12} ", size=11, bold=True,
             color=T.SEVERITY_COLOR.get(sev, T.INK), font="Consolas")
        blocks = int(round((c / maxc) * 30)) if c > 0 else 0
        _run(p, "█" * blocks + f"  {c}", size=11,
             color=T.SEVERITY_COLOR.get(sev, T.MUTED), font="Consolas")
    doc.add_paragraph()


def _risk_matrix(doc, data):
    cells = {(c["likelihood"], c["impact"]): c.get("count", 0)
             for c in data.get("riskMatrix", [])}

    def band(score):
        if score >= 8:
            return T.DESTRUCTIVE
        if score >= 5:
            return T.WARNING
        if score >= 3:
            return "6F9BF5"
        return T.SUCCESS
    t = doc.add_table(rows=5, cols=5)
    t.alignment = WD_TABLE_ALIGNMENT.CENTER
    for r in range(5):
        li = 5 - r
        for col in range(5):
            im = col + 1
            cell = t.cell(r, col)
            cell.text = ""
            _shade(cell, band(li + im))
            cnt = cells.get((li, im), 0)
            run = _run(cell.paragraphs[0], str(cnt) if cnt else "", size=12,
                       bold=True, color="FFFFFF")
            cell.paragraphs[0].alignment = WD_ALIGN_PARAGRAPH.CENTER
    doc.add_paragraph()


def _finding_card(doc, sec):
    f = sec["finding"]
    sev = f.get("severity", "info")
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(10)
    _run(p, f"[{T.SEVERITY_LABEL.get(sev, sev).upper()}] ", size=13, bold=True,
         color=T.SEVERITY_COLOR.get(sev, T.MUTED))
    _run(p, f"{f.get('ref','')} · {_clip(f.get('title',''),90)}", size=13,
         bold=True, color=T.INK)
    meta = []
    if f.get("affectedAsset"):
        meta.append(f"Ativo: {f['affectedAsset']}")
    if f.get("weaknessClass"):
        meta.append(f"Classe: {f['weaknessClass']}")
    if f.get("cvssVector"):
        meta.append(f"CVSS: {f['cvssVector']}")
    if f.get("cwe"):
        meta.append(f"CWE: {f['cwe']}")
    if meta:
        _para(doc, "   ".join(meta), size=10, color=T.MUTED, after=4)
    if f.get("narrative"):
        _para(doc, "NARRATIVA:", size=10, bold=True, color=T.PRIMARY, after=1)
        _para(doc, _clip(f["narrative"], 3000), size=10, color=T.INK, after=4)
    for label, key in [("Descricao", "description"), ("Impacto", "impact"),
                       ("Remediacao", "remediation")]:
        if f.get(key):
            pp = doc.add_paragraph()
            pp.paragraph_format.space_after = Pt(2)
            _run(pp, label.upper() + ": ", size=10, bold=True, color=T.PRIMARY)
            _run(pp, _clip(f[key], 1500), size=11, color=T.INK)
    if sec.get("showPoc") and f.get("reproductionSteps"):
        _para(doc, "REPRODUCAO:", size=10, bold=True, color=T.PRIMARY, after=2)
        for i, s in enumerate(f["reproductionSteps"][:12], 1):
            _para(doc, f"{i}. {_clip(s,300)}", size=10, color=T.INK, after=1)
    if sec.get("showPoc"):
        _evidence_docx(doc, f)


def _embed_image_docx(doc, path, caption=None):
    if not path or not os.path.exists(path):
        return
    try:
        doc.add_picture(path, width=Inches(6.0))
        doc.paragraphs[-1].alignment = WD_ALIGN_PARAGRAPH.CENTER
    except Exception:
        return
    if caption:
        _para(doc, _clip(caption, 120), size=8, color=T.MUTED, after=4)


def _ev_sorted(f):
    ev = f.get("evidence") or []
    return sorted(
        ev,
        key=lambda e: e.get("stepIndex") if e.get("stepIndex") is not None else 1_000_000,
    )


def _evidence_docx(doc, f):
    ev = _ev_sorted(f)
    if not any(
        e.get("snippet") or e.get("imagePath") or e.get("command") for e in ev
    ):
        return
    _para(doc, "CADEIA DE EVIDENCIA:", size=10, bold=True, color=T.PRIMARY, after=2)
    for i, e in enumerate(ev[:20], 1):
        n = e.get("stepIndex") or i
        head = f"{n}."
        if e.get("toolName"):
            head += f"  [{e['toolName']}]"
        if e.get("label") and e.get("label") != e.get("toolName"):
            head += f"  {_clip(e['label'], 80)}"
        _para(doc, head, size=10, bold=True, color=T.INK, after=1)
        if e.get("command"):
            p = doc.add_paragraph()
            p.paragraph_format.space_after = Pt(1)
            _run(p, "$ " + _clip(e["command"], 600), size=9, color=T.MUTED,
                 font="Consolas")
        if e.get("snippet"):
            p = doc.add_paragraph()
            p.paragraph_format.space_after = Pt(1)
            _run(p, _clip(e["snippet"], 1500), size=9, color=T.MUTED,
                 font="Consolas")
        if e.get("resultSummary"):
            pp = doc.add_paragraph()
            pp.paragraph_format.space_after = Pt(3)
            _run(pp, "-> prova: ", size=9, bold=True, color=T.SUCCESS)
            _run(pp, _clip(e["resultSummary"], 400), size=9, color=T.INK)
        if e.get("imagePath"):
            _embed_image_docx(doc, e["imagePath"], e.get("label"))


def _table(doc, findings, remediation=False):
    if remediation:
        headers = ["Ref", "Sev", "Ativo", "Remediacao"]
    else:
        headers = ["Ref", "Sev", "Titulo", "Ativo"]
    t = doc.add_table(rows=1, cols=len(headers))
    t.style = "Table Grid"
    for j, hd in enumerate(headers):
        c = t.cell(0, j)
        c.text = ""
        _shade(c, T.PRIMARY)
        _run(c.paragraphs[0], hd, size=10, bold=True, color="FFFFFF")
    for f in findings:
        sev = f.get("severity", "info")
        row = t.add_row()
        vals = ([f.get("ref", ""), T.SEVERITY_LABEL.get(sev, sev),
                 _clip(f.get("affectedAsset", ""), 50), _clip(f.get("remediation", ""), 160)]
                if remediation else
                [f.get("ref", ""), T.SEVERITY_LABEL.get(sev, sev),
                 _clip(f.get("title", ""), 90), _clip(f.get("affectedAsset", ""), 50)])
        for j, v in enumerate(vals):
            cell = row.cells[j]
            cell.text = ""
            _run(cell.paragraphs[0], v, size=9,
                 bold=(j == 1),
                 color=(T.SEVERITY_COLOR.get(sev, T.INK) if j == 1 else T.INK))
    doc.add_paragraph()


def _callout(doc, sec):
    col = T.CALLOUT_COLOR.get(sec.get("tone", "info"), T.PRIMARY)
    t = doc.add_table(rows=1, cols=1)
    cell = t.cell(0, 0)
    cell.text = ""
    _shade(cell, T.SURFACE_ALT)
    _run(cell.paragraphs[0], _clip(sec.get("text", ""), 600), size=12, bold=True,
         color=col)
    doc.add_paragraph()


def render_docx(model, out_path):
    doc = Document()
    style = doc.styles["Normal"]
    style.font.name = T.FONT_BODY
    style.font.size = Pt(11)
    meta = model.get("meta", {})
    for sec in model.get("sections", []):
        t = sec.get("type")
        if t == "cover":
            _cover(doc, sec, meta)
        elif t == "divider":
            doc.add_page_break()
        elif t == "heading":
            _heading(doc, sec.get("text", ""), sec.get("level", 1))
        elif t == "paragraph":
            _para(doc, sec.get("text", ""), size=11, color=T.INK)
        elif t == "bullets":
            for it in sec.get("items", []):
                p = doc.add_paragraph(style="List Bullet")
                _run(p, _clip(it, 300), size=11, color=T.INK)
        elif t == "kpis":
            _kpis(doc, sec.get("kpis", {}))
        elif t == "severityChart":
            _severity_chart(doc, sec.get("data", {}))
        elif t == "riskMatrix":
            _risk_matrix(doc, sec.get("data", {}))
        elif t == "findingCard":
            _finding_card(doc, sec)
        elif t == "findingsTable":
            _table(doc, sec.get("findings", []))
        elif t == "remediationMatrix":
            _table(doc, sec.get("findings", []), remediation=True)
        elif t == "callout":
            _callout(doc, sec)
    doc.save(out_path)
