"""Renderer PDF (reportlab Platypus) do ReportModel. Vetorial, sem chromium."""

from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT, TA_CENTER
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import (
    SimpleDocTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
    PageBreak,
    HRFlowable,
    Image,
)
from reportlab.lib.utils import ImageReader
import os

import theme as T


def C(h):
    return colors.HexColor("#" + h)


def _clip(s, n):
    s = str(s or "")
    return s if len(s) <= n else s[: n - 1] + "…"


def _styles():
    ss = getSampleStyleSheet()
    ss.add(ParagraphStyle("Cover", parent=ss["Title"], fontName="Helvetica-Bold",
                          fontSize=30, textColor=C(T.INK), spaceAfter=8, leading=34))
    ss.add(ParagraphStyle("Wordmark", parent=ss["Normal"], fontName="Helvetica-Bold",
                          fontSize=18, textColor=C(T.CORAL)))
    ss.add(ParagraphStyle("H1", parent=ss["Heading1"], fontName="Helvetica-Bold",
                          fontSize=15, textColor=C(T.PRIMARY), spaceBefore=12, spaceAfter=4))
    ss.add(ParagraphStyle("Body2", parent=ss["Normal"], fontName="Helvetica",
                          fontSize=10.5, textColor=C(T.INK), leading=15, spaceAfter=5))
    ss.add(ParagraphStyle("Small", parent=ss["Normal"], fontName="Helvetica",
                          fontSize=8.5, textColor=C(T.MUTED)))
    ss.add(ParagraphStyle("CardTitle", parent=ss["Normal"], fontName="Helvetica-Bold",
                          fontSize=12, textColor=C(T.INK), spaceBefore=8, spaceAfter=2))
    ss.add(ParagraphStyle("KpiVal", parent=ss["Normal"], fontName="Helvetica-Bold",
                          fontSize=22, textColor=C(T.PRIMARY), alignment=TA_CENTER))
    ss.add(ParagraphStyle("KpiLabel", parent=ss["Normal"], fontName="Helvetica-Bold",
                          fontSize=7.5, textColor=C(T.MUTED), alignment=TA_CENTER))
    return ss


def _band(score):
    if score >= 8:
        return T.DESTRUCTIVE
    if score >= 5:
        return T.WARNING
    if score >= 3:
        return "6F9BF5"
    return T.SUCCESS


def _append_image_pdf(S, ss, path, caption=None):
    if not path or not os.path.exists(path):
        return
    try:
        iw, ih = ImageReader(path).getSize()
        maxw, maxh = 160 * mm, 120 * mm
        scale = min(maxw / iw, maxh / ih, 1.0)
        img = Image(path, width=iw * scale, height=ih * scale)
        img.hAlign = "CENTER"
        S.append(Spacer(1, 2 * mm))
        S.append(img)
        if caption:
            safe = (_clip(caption, 120).replace("&", "&amp;")
                    .replace("<", "&lt;").replace(">", "&gt;"))
            S.append(Paragraph(safe, ss["Small"]))
        S.append(Spacer(1, 3 * mm))
    except Exception:
        return


def render_pdf(model, out_path):
    ss = _styles()
    S = []
    meta = model.get("meta", {})
    title = None

    def esc(s):
        return (str(s or "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;"))

    for sec in model.get("sections", []):
        t = sec.get("type")
        if t == "cover":
            S.append(Spacer(1, 60 * mm))
            S.append(Paragraph(esc(T.WORDMARK), ss["Wordmark"]))
            S.append(Spacer(1, 8 * mm))
            S.append(Paragraph(esc(sec.get("title", "")), ss["Cover"]))
            if sec.get("subtitle"):
                S.append(Paragraph(esc(sec["subtitle"]),
                                   ParagraphStyle("sub", parent=ss["Body2"], fontSize=13, textColor=C(T.MUTED))))
            S.append(Spacer(1, 70 * mm))
            S.append(Paragraph(esc(meta.get("classification", "")), ss["Small"]))
            S.append(PageBreak())
        elif t == "divider":
            S.append(PageBreak())
        elif t == "heading":
            title = sec.get("text")
            S.append(Paragraph(esc(sec.get("text", "")), ss["H1"]))
            S.append(HRFlowable(width="18%", thickness=2, color=C(T.CORAL), spaceAfter=6))
        elif t == "paragraph":
            S.append(Paragraph(esc(_clip(sec.get("text", ""), 2000)), ss["Body2"]))
        elif t == "bullets":
            for it in sec.get("items", []):
                S.append(Paragraph("• " + esc(_clip(it, 300)), ss["Body2"]))
        elif t == "kpis":
            k = sec.get("kpis", {})
            bysev = k.get("bySeverity", {})
            data = [
                [Paragraph("TOTAL", ss["KpiLabel"]), Paragraph("RISCO", ss["KpiLabel"]),
                 Paragraph("CVSS MEDIO", ss["KpiLabel"]), Paragraph("CRIT+ALTO", ss["KpiLabel"])],
                [Paragraph(str(k.get("total", 0)), ss["KpiVal"]),
                 Paragraph(str(k.get("riskScore", 0)), ss["KpiVal"]),
                 Paragraph(str(k.get("avgCvss") if k.get("avgCvss") is not None else "-"), ss["KpiVal"]),
                 Paragraph(str(bysev.get("critical", 0) + bysev.get("high", 0)), ss["KpiVal"])],
            ]
            tbl = Table(data, colWidths=[42 * mm] * 4)
            tbl.setStyle(TableStyle([
                ("BACKGROUND", (0, 0), (-1, -1), C(T.SURFACE_ALT)),
                ("BOX", (0, 0), (-1, -1), 0.5, C(T.BORDER)),
                ("INNERGRID", (0, 0), (-1, -1), 0.5, C(T.SURFACE)),
                ("TOPPADDING", (0, 0), (-1, -1), 8),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
            ]))
            S.append(tbl)
            S.append(Spacer(1, 6 * mm))
        elif t == "severityChart":
            dist = sec.get("data", {}).get("severityDistribution", [])
            maxc = max([d.get("count", 0) for d in dist] + [1])
            rows = []
            style = [("BOX", (0, 0), (-1, -1), 0, C(T.SURFACE))]
            for i, d in enumerate(dist):
                sev = d.get("severity")
                c = d.get("count", 0)
                bar = "█" * int(round((c / maxc) * 24)) if c > 0 else ""
                rows.append([Paragraph(T.SEVERITY_LABEL.get(sev, sev), ss["Body2"]),
                             Paragraph(f'<font color="#{T.SEVERITY_COLOR.get(sev, T.MUTED)}">{bar}</font> {c}', ss["Body2"])])
            tbl = Table(rows, colWidths=[35 * mm, 130 * mm])
            tbl.setStyle(TableStyle(style))
            S.append(tbl)
            S.append(Spacer(1, 5 * mm))
        elif t == "riskMatrix":
            cells = {(c["likelihood"], c["impact"]): c.get("count", 0)
                     for c in sec.get("data", {}).get("riskMatrix", [])}
            data = []
            stylecmds = [("ALIGN", (0, 0), (-1, -1), "CENTER"),
                         ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                         ("TEXTCOLOR", (0, 0), (-1, -1), colors.white),
                         ("FONTSIZE", (0, 0), (-1, -1), 11)]
            for r in range(5):
                li = 5 - r
                row = []
                for col in range(5):
                    im = col + 1
                    cnt = cells.get((li, im), 0)
                    row.append(str(cnt) if cnt else "")
                    stylecmds.append(("BACKGROUND", (col, r), (col, r), C(_band(li + im))))
                data.append(row)
            tbl = Table(data, colWidths=[22 * mm] * 5, rowHeights=[16 * mm] * 5)
            tbl.setStyle(TableStyle(stylecmds))
            S.append(tbl)
            S.append(Paragraph("Probabilidade (linhas) × Impacto (colunas)", ss["Small"]))
            S.append(Spacer(1, 5 * mm))
        elif t == "findingCard":
            f = sec["finding"]
            sev = f.get("severity", "info")
            S.append(Paragraph(
                f'<font color="#{T.SEVERITY_COLOR.get(sev, T.MUTED)}"><b>[{T.SEVERITY_LABEL.get(sev, sev).upper()}]</b></font> '
                f'{esc(f.get("ref",""))} · {esc(_clip(f.get("title",""),110))}', ss["CardTitle"]))
            meta_bits = []
            if f.get("affectedAsset"):
                meta_bits.append(f"Ativo: {esc(f['affectedAsset'])}")
            if f.get("weaknessClass"):
                meta_bits.append(f"Classe: {esc(f['weaknessClass'])}")
            if f.get("cvssVector"):
                meta_bits.append(f"CVSS: {esc(f['cvssVector'])}")
            if f.get("cwe"):
                meta_bits.append(f"CWE: {esc(f['cwe'])}")
            if meta_bits:
                S.append(Paragraph("   ".join(meta_bits), ss["Small"]))
            if f.get("narrative"):
                S.append(Paragraph(f'<b><font color="#{T.PRIMARY}">Narrativa:</font></b> {esc(_clip(f["narrative"],3000))}', ss["Body2"]))
            for label, key in [("Descrição", "description"), ("Impacto", "impact"), ("Remediação", "remediation")]:
                if f.get(key):
                    S.append(Paragraph(f'<b><font color="#{T.PRIMARY}">{label}:</font></b> {esc(_clip(f[key],2000))}', ss["Body2"]))
            if sec.get("showPoc") and f.get("reproductionSteps"):
                S.append(Paragraph(f'<b><font color="#{T.PRIMARY}">Reprodução:</font></b>', ss["Body2"]))
                for i, s in enumerate(f["reproductionSteps"][:12], 1):
                    S.append(Paragraph(f"{i}. {esc(_clip(s,400))}", ss["Body2"]))
            if sec.get("showPoc"):
                ev = sorted(
                    f.get("evidence") or [],
                    key=lambda e: e.get("stepIndex") if e.get("stepIndex") is not None else 1_000_000,
                )
                if any(e.get("snippet") or e.get("imagePath") or e.get("command") for e in ev):
                    S.append(Paragraph(f'<b><font color="#{T.PRIMARY}">Cadeia de evidência:</font></b>', ss["Body2"]))
                for i, e in enumerate(ev[:20], 1):
                    n = e.get("stepIndex") or i
                    head = f"<b>{n}.</b>"
                    if e.get("toolName"):
                        head += f' <font face="Courier">[{esc(e["toolName"])}]</font>'
                    if e.get("label") and e.get("label") != e.get("toolName"):
                        head += f' {esc(_clip(e["label"],80))}'
                    S.append(Paragraph(head, ss["Small"]))
                    if e.get("command"):
                        S.append(Paragraph(f'<font face="Courier" size="8">$ {esc(_clip(e["command"],600))}</font>', ss["Small"]))
                    if e.get("snippet"):
                        S.append(Paragraph(f'<font face="Courier" size="8">{esc(_clip(e["snippet"],1500))}</font>', ss["Small"]))
                    if e.get("resultSummary"):
                        S.append(Paragraph(f'<font color="#{T.SUCCESS}"><b>&#8594; prova:</b></font> {esc(_clip(e["resultSummary"],400))}', ss["Small"]))
                    if e.get("imagePath"):
                        _append_image_pdf(S, ss, e["imagePath"], e.get("label"))
        elif t in ("findingsTable", "remediationMatrix"):
            findings = sec.get("findings", [])
            rem = t == "remediationMatrix"
            headers = (["Ref", "Sev", "Ativo", "Remediação"] if rem
                       else ["Ref", "Sev", "Título", "Ativo"])
            data = [headers]
            for f in findings:
                sev = f.get("severity", "info")
                data.append(
                    [f.get("ref", ""), T.SEVERITY_LABEL.get(sev, sev),
                     _clip(f.get("affectedAsset", ""), 40), _clip(f.get("remediation", ""), 110)]
                    if rem else
                    [f.get("ref", ""), T.SEVERITY_LABEL.get(sev, sev),
                     _clip(f.get("title", ""), 60), _clip(f.get("affectedAsset", ""), 40)])
            widths = ([16 * mm, 18 * mm, 45 * mm, 86 * mm] if rem
                      else [16 * mm, 18 * mm, 75 * mm, 56 * mm])
            tbl = Table(data, colWidths=widths, repeatRows=1)
            tbl.setStyle(TableStyle([
                ("BACKGROUND", (0, 0), (-1, 0), C(T.PRIMARY)),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                ("FONTSIZE", (0, 0), (-1, -1), 8.5),
                ("GRID", (0, 0), (-1, -1), 0.4, C(T.BORDER)),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("TOPPADDING", (0, 0), (-1, -1), 3),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
            ]))
            S.append(tbl)
            S.append(Spacer(1, 5 * mm))
        elif t == "callout":
            col = T.CALLOUT_COLOR.get(sec.get("tone", "info"), T.PRIMARY)
            tbl = Table([[Paragraph(f'<font color="#{col}"><b>{esc(_clip(sec.get("text",""),600))}</b></font>', ss["Body2"])]],
                        colWidths=[165 * mm])
            tbl.setStyle(TableStyle([
                ("BACKGROUND", (0, 0), (-1, -1), C(T.SURFACE_ALT)),
                ("LINEBEFORE", (0, 0), (0, -1), 3, C(col)),
                ("LEFTPADDING", (0, 0), (-1, -1), 8),
                ("TOPPADDING", (0, 0), (-1, -1), 6),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
            ]))
            S.append(tbl)
            S.append(Spacer(1, 5 * mm))

    doc = SimpleDocTemplate(out_path, pagesize=A4, leftMargin=18 * mm,
                            rightMargin=18 * mm, topMargin=16 * mm, bottomMargin=16 * mm,
                            title="Relatório")
    doc.build(S)
