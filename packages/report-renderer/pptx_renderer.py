"""Renderer PPTX (python-pptx) do ReportModel. Cada secao de conteudo vira um
slide (o ultimo 'heading' define o titulo); cover/divider tem slide proprio."""

from pptx import Presentation
from pptx.util import Inches, Pt, Emu
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
from pptx.enum.shapes import MSO_SHAPE

import theme as T

EMU_IN = 914400
SW = Inches(13.333)
SH = Inches(7.5)
ML = Inches(0.6)
CW = Inches(12.13)


def _rgb(hexstr):
    return RGBColor.from_string(hexstr)


def _blank(prs):
    return prs.slides.add_slide(prs.slide_layouts[6])


def _text(slide, l, t, w, h, text, size=14, bold=False, color=T.INK,
          align=PP_ALIGN.LEFT, font=T.FONT_BODY, anchor=MSO_ANCHOR.TOP):
    tb = slide.shapes.add_textbox(l, t, w, h)
    tf = tb.text_frame
    tf.word_wrap = True
    tf.vertical_anchor = anchor
    lines = str(text).split("\n")
    for i, ln in enumerate(lines):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        p.alignment = align
        r = p.add_run()
        r.text = ln
        r.font.size = Pt(size)
        r.font.bold = bold
        r.font.name = font
        r.font.color.rgb = _rgb(color)
    return tb


def _rect(slide, l, t, w, h, fill, line=None):
    sp = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, l, t, w, h)
    sp.fill.solid()
    sp.fill.fore_color.rgb = _rgb(fill)
    if line:
        sp.line.color.rgb = _rgb(line)
        sp.line.width = Pt(0.75)
    else:
        sp.line.fill.background()
    sp.shadow.inherit = False
    return sp


def _clip(s, n):
    s = str(s or "")
    return s if len(s) <= n else s[: n - 1] + "…"


def _title_slide(prs, title):
    slide = _blank(prs)
    _rect(slide, 0, 0, SW, Inches(0.12), T.PRIMARY)
    _text(slide, ML, Inches(0.35), CW, Inches(0.7), title, size=24, bold=True,
          color=T.INK, font=T.FONT_DISPLAY)
    _rect(slide, ML, Inches(1.05), Inches(1.2), Emu(int(0.045 * EMU_IN)), T.CORAL)
    return slide, Inches(1.35)


def _cover(prs, sec, meta):
    slide = _blank(prs)
    _rect(slide, 0, 0, SW, SH, T.INK)
    _rect(slide, 0, Inches(3.15), SW, Emu(int(0.06 * EMU_IN)), T.CORAL)
    _text(slide, ML, Inches(0.5), CW, Inches(0.5), T.WORDMARK, size=20,
          bold=True, color=T.CORAL, font=T.FONT_DISPLAY)
    _text(slide, ML, Inches(2.4), CW, Inches(1.0), sec.get("title", ""), size=40,
          bold=True, color="FFFFFF", font=T.FONT_DISPLAY)
    if sec.get("subtitle"):
        _text(slide, ML, Inches(3.5), CW, Inches(0.6), sec["subtitle"], size=18,
              color="C9D3E6")
    _text(slide, ML, Inches(6.6), CW, Inches(0.5),
          meta.get("classification", ""), size=11, color="8FA0BC")


def _divider(prs, meta):
    slide = _blank(prs)
    _rect(slide, 0, 0, SW, SH, T.SURFACE_ALT)
    _rect(slide, ML, Inches(3.4), Inches(1.6), Emu(int(0.06 * EMU_IN)), T.CORAL)
    _text(slide, ML, Inches(3.6), CW, Inches(0.6), T.WORDMARK, size=22,
          bold=True, color=T.PRIMARY, font=T.FONT_DISPLAY)


def _kpis(prs, kpis):
    slide, y = _title_slide(prs, "Indicadores")
    tiles = [
        ("Total de achados", str(kpis.get("total", 0)), T.PRIMARY),
        ("Risco (0-100)", str(kpis.get("riskScore", 0)), T.DESTRUCTIVE
         if kpis.get("riskScore", 0) >= 55 else T.WARNING),
        ("CVSS medio", str(kpis.get("avgCvss") if kpis.get("avgCvss") is not None else "-"), T.INK),
        ("Criticos+Altos",
         str(kpis.get("bySeverity", {}).get("critical", 0) + kpis.get("bySeverity", {}).get("high", 0)),
         T.CORAL),
    ]
    tw = Inches(2.85)
    gap = Inches(0.13)
    for i, (label, val, col) in enumerate(tiles):
        x = ML + (tw + gap) * i
        _rect(slide, x, y, tw, Inches(1.7), T.SURFACE_ALT, line=T.BORDER)
        _rect(slide, x, y, Emu(int(0.06 * EMU_IN)), Inches(1.7), col)
        _text(slide, x + Inches(0.2), y + Inches(0.2), tw - Inches(0.3), Inches(0.4),
              label.upper(), size=10, bold=True, color=T.MUTED)
        _text(slide, x + Inches(0.2), y + Inches(0.6), tw - Inches(0.3), Inches(0.9),
              val, size=40, bold=True, color=col, font=T.FONT_DISPLAY)


def _severity_chart(prs, data):
    slide, y = _title_slide(prs, "Distribuicao por severidade")
    dist = data.get("severityDistribution", [])
    maxc = max([d.get("count", 0) for d in dist] + [1])
    barmax = Inches(9.0)
    row_h = Inches(0.62)
    for i, d in enumerate(dist):
        sev = d.get("severity")
        c = d.get("count", 0)
        yy = y + row_h * i
        _text(slide, ML, yy, Inches(2.0), Inches(0.5),
              T.SEVERITY_LABEL.get(sev, sev), size=13, bold=True, color=T.INK,
              anchor=MSO_ANCHOR.MIDDLE)
        w = Emu(int(max(0.04, c / maxc) * barmax)) if c > 0 else Emu(int(0.04 * EMU_IN))
        _rect(slide, ML + Inches(2.2), yy + Inches(0.08), w, Inches(0.42),
              T.SEVERITY_COLOR.get(sev, T.MUTED))
        _text(slide, ML + Inches(2.2) + w + Inches(0.1), yy, Inches(1.0), Inches(0.5),
              str(c), size=13, bold=True, color=T.INK, anchor=MSO_ANCHOR.MIDDLE)


def _risk_matrix(prs, data):
    slide, y = _title_slide(prs, "Matriz de risco (probabilidade x impacto)")
    cells = {(c["likelihood"], c["impact"]): c.get("count", 0)
             for c in data.get("riskMatrix", [])}
    n = 5
    cell = Inches(1.0)
    x0 = ML + Inches(1.0)
    y0 = y + Inches(0.1)

    def band(score):
        if score >= 8:
            return T.DESTRUCTIVE
        if score >= 5:
            return T.WARNING
        if score >= 3:
            return "6F9BF5"
        return T.SUCCESS
    for li in range(n, 0, -1):
        for im in range(1, n + 1):
            row = n - li
            col = im - 1
            x = x0 + cell * col
            yy = y0 + cell * row
            score = li + im
            _rect(slide, x, yy, cell - Inches(0.05), cell - Inches(0.05), band(score))
            cnt = cells.get((li, im), 0)
            if cnt:
                _text(slide, x, yy, cell - Inches(0.05), cell - Inches(0.05),
                      str(cnt), size=20, bold=True, color="FFFFFF",
                      align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)
    _text(slide, x0, y0 + cell * n + Inches(0.05), cell * n, Inches(0.4),
          "Probabilidade →", size=11, color=T.MUTED)


def _finding_card(prs, sec):
    f = sec["finding"]
    sev = f.get("severity", "info")
    slide, y = _title_slide(prs, _clip(f.get("title", "Achado"), 70))
    _rect(slide, ML, y, CW, Inches(0.5), T.SEVERITY_COLOR.get(sev, T.MUTED))
    _text(slide, ML + Inches(0.15), y + Inches(0.05), CW, Inches(0.4),
          f"{T.SEVERITY_LABEL.get(sev, sev).upper()}  ·  {f.get('ref','')}  ·  {_clip(f.get('affectedAsset',''),60)}",
          size=13, bold=True, color="FFFFFF", anchor=MSO_ANCHOR.MIDDLE)
    yy = y + Inches(0.7)
    meta = []
    if f.get("weaknessClass"):
        meta.append(f"Classe: {f['weaknessClass']}")
    if f.get("cvssVector"):
        meta.append(f"CVSS: {f['cvssVector']}")
    if f.get("cwe"):
        meta.append(f"CWE: {f['cwe']}")
    if meta:
        _text(slide, ML, yy, CW, Inches(0.4), "   ".join(meta), size=11, color=T.MUTED)
        yy += Inches(0.45)
    for label, key in [("Descricao", "description"), ("Impacto", "impact"),
                       ("Remediacao", "remediation")]:
        if f.get(key):
            _text(slide, ML, yy, CW, Inches(0.3), label.upper(), size=10, bold=True, color=T.PRIMARY)
            yy += Inches(0.28)
            _text(slide, ML, yy, CW, Inches(0.8), _clip(f[key], 500), size=12, color=T.INK)
            yy += Inches(0.85)
    if sec.get("showPoc") and f.get("reproductionSteps"):
        steps = "\n".join(f"{i+1}. {_clip(s,140)}" for i, s in enumerate(f["reproductionSteps"][:6]))
        _text(slide, ML, yy, CW, Inches(0.3), "REPRODUCAO", size=10, bold=True, color=T.PRIMARY)
        _text(slide, ML, yy + Inches(0.28), CW, Inches(1.4), steps, size=11, color=T.INK)


def _table(prs, findings, title, remediation=False):
    slide, y = _title_slide(prs, title)
    rows = min(len(findings), 12) + 1
    if remediation:
        headers = ["Ref", "Sev", "Ativo", "Remediacao"]
        widths = [Inches(1.2), Inches(1.4), Inches(3.5), Inches(6.0)]
    else:
        headers = ["Ref", "Sev", "Titulo", "Ativo"]
        widths = [Inches(1.2), Inches(1.4), Inches(5.5), Inches(4.0)]
    gt = slide.shapes.add_table(rows, len(headers), ML, y, CW, Inches(0.4) * rows).table
    for j, hd in enumerate(headers):
        gt.columns[j].width = widths[j]
        cell = gt.cell(0, j)
        cell.text = hd
        cell.fill.solid()
        cell.fill.fore_color.rgb = _rgb(T.PRIMARY)
        pr = cell.text_frame.paragraphs[0].runs[0]
        pr.font.size = Pt(11)
        pr.font.bold = True
        pr.font.color.rgb = _rgb("FFFFFF")
    for i, f in enumerate(findings[:12], start=1):
        sev = f.get("severity", "info")
        vals = ([f.get("ref", ""), T.SEVERITY_LABEL.get(sev, sev), _clip(f.get("affectedAsset", ""), 40), _clip(f.get("remediation", ""), 90)]
                if remediation else
                [f.get("ref", ""), T.SEVERITY_LABEL.get(sev, sev), _clip(f.get("title", ""), 70), _clip(f.get("affectedAsset", ""), 40)])
        for j, v in enumerate(vals):
            cell = gt.cell(i, j)
            cell.text = str(v)
            r = cell.text_frame.paragraphs[0].runs[0]
            r.font.size = Pt(10)
            r.font.color.rgb = _rgb(T.SEVERITY_COLOR.get(sev, T.INK) if j == 1 else T.INK)
            if j == 1:
                r.font.bold = True


def _bullets(prs, items, title):
    slide, y = _title_slide(prs, title or "Itens")
    tb = slide.shapes.add_textbox(ML, y, CW, Inches(5.0))
    tf = tb.text_frame
    tf.word_wrap = True
    for i, it in enumerate(items[:16]):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        r = p.add_run()
        r.text = "•  " + _clip(it, 130)
        r.font.size = Pt(14)
        r.font.name = T.FONT_BODY
        r.font.color.rgb = _rgb(T.INK)
        p.space_after = Pt(6)


def _paragraph(prs, text, title):
    slide, y = _title_slide(prs, title or "")
    _text(slide, ML, y, CW, Inches(5.0), _clip(text, 1200), size=15, color=T.INK)


def _callout(prs, sec, title):
    slide, y = _title_slide(prs, title or "")
    col = T.CALLOUT_COLOR.get(sec.get("tone", "info"), T.PRIMARY)
    _rect(slide, ML, y, CW, Inches(1.2), T.SURFACE_ALT, line=T.BORDER)
    _rect(slide, ML, y, Emu(int(0.08 * EMU_IN)), Inches(1.2), col)
    _text(slide, ML + Inches(0.3), y + Inches(0.15), CW - Inches(0.5), Inches(0.9),
          _clip(sec.get("text", ""), 400), size=16, bold=True, color=col,
          anchor=MSO_ANCHOR.MIDDLE)


def render_pptx(model, out_path):
    prs = Presentation()
    prs.slide_width = SW
    prs.slide_height = SH
    meta = model.get("meta", {})
    title = None
    for sec in model.get("sections", []):
        t = sec.get("type")
        if t == "cover":
            _cover(prs, sec, meta)
        elif t == "divider":
            _divider(prs, meta)
        elif t == "heading":
            title = sec.get("text")
        elif t == "kpis":
            _kpis(prs, sec.get("kpis", {}))
        elif t == "severityChart":
            _severity_chart(prs, sec.get("data", {}))
        elif t == "riskMatrix":
            _risk_matrix(prs, sec.get("data", {}))
        elif t == "findingCard":
            _finding_card(prs, sec)
        elif t == "findingsTable":
            _table(prs, sec.get("findings", []), title or "Sumario de Achados")
        elif t == "remediationMatrix":
            _table(prs, sec.get("findings", []), title or "Matriz de Remediacao", remediation=True)
        elif t == "bullets":
            _bullets(prs, sec.get("items", []), title)
        elif t == "paragraph":
            _paragraph(prs, sec.get("text", ""), title)
        elif t == "callout":
            _callout(prs, sec, title)
    prs.save(out_path)
