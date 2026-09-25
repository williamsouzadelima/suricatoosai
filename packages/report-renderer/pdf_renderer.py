"""Renderer PDF (reportlab Platypus) do ReportModel — estilo "dossie".

Casca de dossie: capa com codigo de documento + faixa de KPIs, rodape (canvas)
com classificacao + docCode + numero de pagina, divisorias de PARTE. Marca
configuravel por MSSP (aplicada ANTES de montar os estilos). Vetorial, sem
chromium."""

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
import logo


def C(h):
    return colors.HexColor("#" + h)


def _clip(s, n):
    s = str(s or "")
    return s if len(s) <= n else s[: n - 1] + "…"


def _esc(s):
    return (str(s or "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;"))


def _apply_brand(meta):
    brand = meta.get("brand") or {}
    if brand.get("primary"):
        T.PRIMARY = brand["primary"]
    if brand.get("accent"):
        T.CORAL = brand["accent"]
    if brand.get("wordmark"):
        T.WORDMARK = brand["wordmark"]


def _styles():
    ss = getSampleStyleSheet()
    ss.add(ParagraphStyle("Cover", parent=ss["Title"], fontName="Helvetica-Bold",
                          fontSize=30, textColor=C(T.INK), spaceAfter=8, leading=34,
                          alignment=TA_LEFT))
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


def _footer_factory(meta):
    def draw(canvas, doc):
        if doc.page <= 1:
            return
        canvas.saveState()
        canvas.setFont("Helvetica", 7)
        canvas.setFillColor(C(T.MUTED))
        canvas.drawString(18 * mm, 8 * mm, _clip(meta.get("classification", ""), 80))
        canvas.drawRightString(A4[0] - 18 * mm, 8 * mm,
                               f'{meta.get("docCode", "")} · {doc.page}')
        canvas.restoreState()
    return draw


def _stat_table(ss, stats):
    stats = (stats or [])[:4]
    if not stats:
        return None
    lab = [Paragraph(_esc(s.get("label", "")).upper(), ss["KpiLabel"]) for s in stats]
    val = [Paragraph(_esc(s.get("value", "")), ss["KpiVal"]) for s in stats]
    w = (170.0 / len(stats)) * mm
    tbl = Table([lab, val], colWidths=[w] * len(stats))
    tbl.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), C(T.SURFACE_ALT)),
        ("BOX", (0, 0), (-1, -1), 0.5, C(T.BORDER)),
        ("INNERGRID", (0, 0), (-1, -1), 0.5, C(T.SURFACE)),
        ("TOPPADDING", (0, 0), (-1, -1), 7),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
    ]))
    return tbl


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
            S.append(Paragraph(_esc(_clip(caption, 120)), ss["Small"]))
        S.append(Spacer(1, 3 * mm))
    except Exception:
        return


def _part_divider(ss, sec):
    out = [PageBreak(), Spacer(1, 40 * mm)]
    out.append(Paragraph(_esc(sec.get("part", "")),
                         ParagraphStyle("pdpart", parent=ss["Small"],
                                        fontName="Helvetica-Bold", fontSize=12,
                                        textColor=C(T.CORAL))))
    out.append(Paragraph(_esc(sec.get("title", "")),
                         ParagraphStyle("pdtitle", parent=ss["Cover"], fontSize=26)))
    if sec.get("subtitle"):
        out.append(Paragraph(_esc(sec["subtitle"]),
                             ParagraphStyle("pdsub", parent=ss["Body2"],
                                            fontSize=13, textColor=C(T.MUTED))))
    return out


def _stat_band(ss, sec):
    out = []
    if sec.get("headline"):
        out.append(Paragraph(_esc(_clip(sec["headline"], 200)),
                             ParagraphStyle("sbh", parent=ss["Cover"], fontSize=18,
                                            spaceAfter=6)))
    st = _stat_table(ss, sec.get("stats"))
    if st:
        out += [st, Spacer(1, 5 * mm)]
    if sec.get("body"):
        out.append(Paragraph(_esc(_clip(sec["body"], 1500)), ss["Body2"]))
    return out


def _attack_chain(ss, sec):
    out = [Paragraph("Cadeia de Ataque", ss["H1"]),
           HRFlowable(width="18%", thickness=2, color=C(T.CORAL), spaceAfter=6)]
    boxstyle = ParagraphStyle("chainbox", parent=ss["Small"], fontSize=8,
                              textColor=C(T.INK), leading=10)
    arrstyle = ParagraphStyle("arr", parent=ss["Small"], alignment=TA_CENTER)
    for lane in (sec.get("lanes") or [])[:6]:
        out.append(Paragraph(_esc(_clip(lane.get("title", ""), 120)), ss["CardTitle"]))
        steps = (lane.get("steps") or [])[:5]
        cells = []
        widths = []
        for i, s in enumerate(steps):
            cells.append(Paragraph(
                f'<b><font color="#{T.PRIMARY}">{_esc(_clip(s.get("label", ""), 22))}</font></b>'
                f'<br/><font size="7" color="#{T.MUTED}">{_esc(_clip(s.get("detail", ""), 40))}</font>',
                boxstyle))
            widths.append(28 * mm)
            if i < len(steps) - 1:
                cells.append(Paragraph(f'<font color="#{T.CORAL}" size="14">&#8594;</font>',
                                       arrstyle))
                widths.append(6 * mm)
        if cells:
            tbl = Table([cells], colWidths=widths)
            sc = [("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                  ("TOPPADDING", (0, 0), (-1, -1), 5),
                  ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
                  ("LEFTPADDING", (0, 0), (-1, -1), 4),
                  ("RIGHTPADDING", (0, 0), (-1, -1), 4)]
            for ci in range(0, len(cells), 2):
                sc.append(("BACKGROUND", (ci, 0), (ci, 0), C(T.SURFACE_ALT)))
                sc.append(("LINEABOVE", (ci, 0), (ci, 0), 1.2, C(T.PRIMARY)))
            tbl.setStyle(TableStyle(sc))
            out.append(tbl)
        out.append(Spacer(1, 4 * mm))
    return out


def _roadmap(ss, sec):
    out = [Paragraph("Plano de Remediação por Fase", ss["H1"]),
           HRFlowable(width="18%", thickness=2, color=C(T.CORAL), spaceAfter=6)]
    data = [[Paragraph('<font color="white"><b>Janela</b></font>', ss["Body2"]),
             Paragraph('<font color="white"><b>Foco</b></font>', ss["Body2"]),
             Paragraph('<font color="white"><b>Ações</b></font>', ss["Body2"])]]
    for ph in (sec.get("phases") or [])[:4]:
        acts = "<br/>".join("• " + _esc(_clip(a, 90))
                            for a in (ph.get("actions") or [])[:6])
        data.append([Paragraph(f'<b>{_esc(ph.get("window", ""))}</b>', ss["Small"]),
                     Paragraph(_esc(ph.get("label", "")), ss["Small"]),
                     Paragraph(acts, ss["Small"])])
    tbl = Table(data, colWidths=[26 * mm, 34 * mm, 114 * mm], repeatRows=1)
    tbl.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), C(T.PRIMARY)),
        ("GRID", (0, 0), (-1, -1), 0.4, C(T.BORDER)),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    out += [tbl, Spacer(1, 5 * mm)]
    return out


def _cost_incident(ss, sec):
    out = [Paragraph("Custo da Remediação × Custo do Incidente", ss["H1"]),
           HRFlowable(width="18%", thickness=2, color=C(T.CORAL), spaceAfter=6)]
    remlist = "<br/>".join("• " + _esc(_clip(r, 90))
                           for r in (sec.get("remediation") or [])[:6])
    inc_parts = []
    for it in (sec.get("incident") or [])[:4]:
        line = f'<b><font color="#{T.DESTRUCTIVE}">• {_esc(_clip(it.get("label", ""), 60))}</font></b>'
        if it.get("detail"):
            line += f'<br/><font size="8" color="#{T.MUTED}">   {_esc(_clip(it["detail"], 90))}</font>'
        inc_parts.append(line)
    inclist = "<br/>".join(inc_parts)
    header = [Paragraph('<font color="white"><b>REMEDIAÇÃO — INVESTIMENTO</b></font>', ss["Body2"]),
              Paragraph('<font color="white"><b>INCIDENTE NÃO REMEDIADO — RISCO</b></font>', ss["Body2"])]
    body = [Paragraph(remlist, ss["Small"]), Paragraph(inclist, ss["Small"])]
    tbl = Table([header, body], colWidths=[87 * mm, 87 * mm])
    tbl.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (0, 0), C(T.SUCCESS)),
        ("BACKGROUND", (1, 0), (1, 0), C(T.DESTRUCTIVE)),
        ("BOX", (0, 0), (-1, -1), 0.5, C(T.BORDER)),
        ("INNERGRID", (0, 0), (-1, -1), 0.5, C(T.BORDER)),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
    ]))
    out += [tbl, Spacer(1, 5 * mm)]
    return out


def _partner_value(ss, sec):
    out = [Paragraph(_esc(_clip(sec.get("title", "Parceria"), 80)), ss["H1"]),
           HRFlowable(width="18%", thickness=2, color=C(T.CORAL), spaceAfter=6)]
    for p in (sec.get("points") or [])[:6]:
        out.append(Paragraph(
            f'<b><font color="#{T.PRIMARY}">{_esc(_clip(p.get("title", ""), 60))}</font></b>',
            ss["Body2"]))
        out.append(Paragraph(_esc(_clip(p.get("body", ""), 400)), ss["Body2"]))
    return out


def _next_steps(ss, sec, brand):
    out = [Paragraph("Próximos Passos", ss["H1"]),
           HRFlowable(width="18%", thickness=2, color=C(T.CORAL), spaceAfter=6)]
    for i, s in enumerate((sec.get("steps") or [])[:6], 1):
        out.append(Paragraph(f'<b>{i}.</b>  {_esc(_clip(s, 200))}',
                             ParagraphStyle("ns", parent=ss["Body2"], fontSize=12,
                                            spaceAfter=4)))
    contact = " · ".join([x for x in [brand.get("name", ""), brand.get("contact", ""),
                                      brand.get("tagline", "")] if x])
    if contact:
        out.append(Spacer(1, 4 * mm))
        out.append(Paragraph(_esc(contact), ss["Small"]))
    return out


def render_pdf(model, out_path):
    meta = model.get("meta", {})
    _apply_brand(meta)
    ss = _styles()
    S = []
    title = None
    brand = meta.get("brand", {})

    def esc(s):
        return _esc(s)

    for sec in model.get("sections", []):
        t = sec.get("type")
        if t == "cover":
            S.append(Spacer(1, 30 * mm))
            used_logo = False
            if brand.get("wordmark", "") == "Suricatoos":
                lp = logo.write_logo(dark=False)
                if lp and os.path.exists(lp):
                    try:
                        im = Image(lp, width=70 * mm, height=70 * mm * 155.0 / 900.0)
                        im.hAlign = "LEFT"
                        S.append(im)
                        used_logo = True
                    except Exception:
                        used_logo = False
            if not used_logo:
                S.append(Paragraph(esc(brand.get("wordmark", T.WORDMARK)), ss["Wordmark"]))
            S.append(Spacer(1, 4 * mm))
            S.append(Paragraph(
                f'<b><font color="#{T.CORAL}">{esc(meta.get("classification", ""))}   ·   {esc(meta.get("docCode", ""))}</font></b>',
                ss["Small"]))
            S.append(Paragraph(f'<b>{esc(meta.get("volume", ""))}</b>', ss["Small"]))
            S.append(Spacer(1, 8 * mm))
            S.append(Paragraph(esc(sec.get("title", "")), ss["Cover"]))
            if sec.get("subtitle"):
                S.append(Paragraph(esc(sec["subtitle"]),
                                   ParagraphStyle("sub", parent=ss["Body2"], fontSize=13,
                                                  textColor=C(T.MUTED))))
            S.append(Spacer(1, 14 * mm))
            st = _stat_table(ss, sec.get("stats"))
            if st:
                S.append(st)
            S.append(PageBreak())
        elif t == "partDivider":
            S += _part_divider(ss, sec)
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
        elif t == "statBand":
            S += _stat_band(ss, sec)
        elif t == "kpis":
            k = sec.get("kpis", {})
            bysev = k.get("bySeverity", {})
            data = [
                [Paragraph("TOTAL", ss["KpiLabel"]), Paragraph("RISCO", ss["KpiLabel"]),
                 Paragraph("CVSS MÉDIO", ss["KpiLabel"]), Paragraph("CRIT+ALTO", ss["KpiLabel"])],
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
        elif t == "attackChain":
            S += _attack_chain(ss, sec)
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
                       else ["Ref", "Sev", "Título", "Ativo", "CVSS"])
            data = [headers]
            for f in findings:
                sev = f.get("severity", "info")
                cvss = f.get("cvssScore")
                cvss_s = f"{cvss:.1f}" if isinstance(cvss, (int, float)) else "—"
                data.append(
                    [f.get("ref", ""), T.SEVERITY_LABEL.get(sev, sev),
                     _clip(f.get("affectedAsset", ""), 40), _clip(f.get("remediation", ""), 110)]
                    if rem else
                    [f.get("ref", ""), T.SEVERITY_LABEL.get(sev, sev),
                     _clip(f.get("title", ""), 58), _clip(f.get("affectedAsset", ""), 34), cvss_s])
            widths = ([16 * mm, 18 * mm, 45 * mm, 86 * mm] if rem
                      else [15 * mm, 17 * mm, 70 * mm, 42 * mm, 16 * mm])
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
        elif t == "roadmap":
            S += _roadmap(ss, sec)
        elif t == "costVsIncident":
            S += _cost_incident(ss, sec)
        elif t == "partnerValue":
            S += _partner_value(ss, sec)
        elif t == "nextSteps":
            S += _next_steps(ss, sec, brand)
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
    foot = _footer_factory(meta)
    doc.build(S, onFirstPage=foot, onLaterPages=foot)
