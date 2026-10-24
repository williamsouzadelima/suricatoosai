"""Renderer PDF (reportlab Platypus) do ReportModel — estilo "dossie".

Casca de dossie: capa com codigo de documento + faixa de KPIs, rodape (canvas)
com classificacao + docCode + numero de pagina, divisorias de PARTE. Marca
configuravel por MSSP (aplicada ANTES de montar os estilos). Vetorial, sem
chromium."""

from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_RIGHT
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import (
    SimpleDocTemplate,
    BaseDocTemplate,
    PageTemplate,
    Frame,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
    PageBreak,
    HRFlowable,
    Image,
)
from reportlab.platypus.tableofcontents import TableOfContents
from reportlab.lib.utils import ImageReader
import os

import theme as T
import logo


_FONTS_READY = False
FONT_SANS = "Helvetica"
FONT_SANS_BOLD = "Helvetica-Bold"
FONT_MONO = "Courier"


def _register_fonts():
    """Registra IBM Plex (reportlab EMBUTE os glifos no PDF). Idempotente;
    mantem o fallback Helvetica/Courier se os .ttf nao estiverem presentes."""
    global _FONTS_READY, FONT_SANS, FONT_SANS_BOLD, FONT_MONO
    if _FONTS_READY:
        return
    _FONTS_READY = True
    try:
        from reportlab.pdfbase import pdfmetrics
        from reportlab.pdfbase.ttfonts import TTFont

        reg = T.font_path("IBM Plex Sans", "normal")
        bold = T.font_path("IBM Plex Sans", "bold")
        mono = T.font_path("IBM Plex Mono", "normal")
        if reg and bold and mono:
            pdfmetrics.registerFont(TTFont("IBMPlexSans", reg))
            pdfmetrics.registerFont(TTFont("IBMPlexSans-Bold", bold))
            pdfmetrics.registerFont(TTFont("IBMPlexMono", mono))
            pdfmetrics.registerFontFamily(
                "IBMPlexSans", normal="IBMPlexSans",
                bold="IBMPlexSans-Bold", italic="IBMPlexSans",
                boldItalic="IBMPlexSans-Bold")
            # Fonte-base padrao do canvas (senao o reportlab emite um bloco
            # BT/ET vazio de init com /Helvetica em cada pagina — inofensivo,
            # mas deixaria "Helvetica" no PDF).
            from reportlab import rl_config

            rl_config.canvas_basefontname = "IBMPlexSans"
            FONT_SANS = "IBMPlexSans"
            FONT_SANS_BOLD = "IBMPlexSans-Bold"
            FONT_MONO = "IBMPlexMono"
    except Exception:
        pass


def C(h):
    return colors.HexColor("#" + h)


def _ts(cmds):
    """TableStyle com FONTNAME base em IBM Plex, p/ celulas string nao caírem no
    Helvetica padrao do reportlab. Comandos especificos (ex.: header bold) vem
    depois e sobrepoem."""
    return TableStyle([("FONTNAME", (0, 0), (-1, -1), FONT_SANS)] + list(cmds))


def _clip(s, n):
    s = str(s or "")
    return s if len(s) <= n else s[: n - 1] + "…"


def _esc(s):
    return (str(s or "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;"))


def _ml(s):
    """Escapa p/ Paragraph do reportlab e preserva quebras de linha. NÃO trunca —
    o Platypus pagina sozinho (corpo de achado/evidência nunca é cortado)."""
    return _esc(s).replace("\n", "<br/>")


def _apply_brand(meta):
    brand = meta.get("brand") or {}
    if brand.get("primary"):
        T.PRIMARY = brand["primary"]
    if brand.get("accent"):
        T.CORAL = brand["accent"]
    if brand.get("wordmark"):
        T.WORDMARK = brand["wordmark"]


def _styles():
    _register_fonts()
    ss = getSampleStyleSheet()
    # Estilos base herdados tambem em IBM Plex (evita vazar Helvetica/Times).
    ss["Normal"].fontName = FONT_SANS
    ss["Title"].fontName = FONT_SANS_BOLD
    ss["Heading1"].fontName = FONT_SANS_BOLD
    ss.add(ParagraphStyle("Cover", parent=ss["Title"], fontName=FONT_SANS_BOLD,
                          fontSize=30, textColor=C(T.INK), spaceAfter=8, leading=34,
                          alignment=TA_LEFT))
    ss.add(ParagraphStyle("Wordmark", parent=ss["Normal"], fontName=FONT_SANS_BOLD,
                          fontSize=18, textColor=C(T.CORAL)))
    ss.add(ParagraphStyle("H1", parent=ss["Heading1"], fontName=FONT_SANS_BOLD,
                          fontSize=15, textColor=C(T.PRIMARY), spaceBefore=12, spaceAfter=4))
    ss.add(ParagraphStyle("Body2", parent=ss["Normal"], fontName=FONT_SANS,
                          fontSize=10.5, textColor=C(T.INK), leading=15, spaceAfter=5))
    ss.add(ParagraphStyle("Small", parent=ss["Normal"], fontName=FONT_SANS,
                          fontSize=8.5, textColor=C(T.MUTED)))
    ss.add(ParagraphStyle("CardTitle", parent=ss["Normal"], fontName=FONT_SANS_BOLD,
                          fontSize=12, textColor=C(T.INK), spaceBefore=8, spaceAfter=2))
    ss.add(ParagraphStyle("KpiVal", parent=ss["Normal"], fontName=FONT_SANS_BOLD,
                          fontSize=22, textColor=C(T.PRIMARY), alignment=TA_CENTER))
    ss.add(ParagraphStyle("KpiLabel", parent=ss["Normal"], fontName=FONT_SANS_BOLD,
                          fontSize=7.5, textColor=C(T.MUTED), alignment=TA_CENTER))
    # Código/evidência: monoespaçada com quebra em qualquer ponto (wordWrap CJK)
    # p/ não estourar a largura do frame com tokens longos (comandos/saídas).
    ss.add(ParagraphStyle("Mono", parent=ss["Normal"], fontName=FONT_MONO,
                          fontSize=8, textColor=C(T.MUTED), leading=10,
                          wordWrap="CJK", spaceAfter=3))
    return ss


def _band(score):
    if score >= 8:
        return T.DESTRUCTIVE
    if score >= 5:
        return T.WARNING
    if score >= 3:
        return "6F9BF5"
    return T.SUCCESS


def _cover_canvas_factory(meta, cover):
    def draw(canvas, doc):
        if doc.page <= 1:
            # Capa: arte full-bleed da marca (o título é sobreposto por flowables).
            if cover and os.path.exists(cover):
                try:
                    fitted = T.cover_fit(cover, A4[0], A4[1])
                    canvas.drawImage(fitted, 0, 0, width=A4[0], height=A4[1],
                                     preserveAspectRatio=False, mask="auto")
                except Exception:
                    pass
            return
        canvas.saveState()
        canvas.setFont(FONT_SANS, 7)
        canvas.setFillColor(C(T.MUTED))
        canvas.drawString(18 * mm, 8 * mm, _clip(meta.get("classification", ""), 80))
        canvas.drawRightString(A4[0] - 18 * mm, 8 * mm,
                               f'{meta.get("docCode", "")} · {doc.page}')
        canvas.restoreState()
    return draw


class _TocDocTemplate(BaseDocTemplate):
    """Doc com SUMÁRIO paginado: afterFlowable notifica TOCEntry p/ as partes
    (estilo 'pdtitle') e os headings de seção/fase ('TOCH1'/'TOCH2'); multiBuild
    resolve os números de página em 2+ passagens. onPage=foot trata capa vs
    páginas internas (o próprio foot checa doc.page <= 1)."""

    def __init__(self, filename, foot, **kw):
        BaseDocTemplate.__init__(self, filename, **kw)
        fw = self.pagesize[0] - self.leftMargin - self.rightMargin
        fh = self.pagesize[1] - self.topMargin - self.bottomMargin
        frame = Frame(self.leftMargin, self.bottomMargin, fw, fh, id="normal")
        self.addPageTemplates([
            PageTemplate(id="main", frames=[frame], onPage=foot,
                         pagesize=self.pagesize),
        ])

    def afterFlowable(self, flowable):
        if not isinstance(flowable, Paragraph):
            return
        lvl = {"pdtitle": 0, "TOCH1": 1, "TOCH2": 2}.get(
            getattr(flowable.style, "name", ""))
        if lvl is None:
            return
        txt = flowable.getPlainText()
        if txt:
            self.notify("TOCEntry", (lvl, txt, self.page))


class _CleanTOC(TableOfContents):
    """TOC que renderiza o numero de pagina como COLUNA DIREITA de uma Table, em
    vez do onDraw do reportlab. O onDraw (`drawPageNumbers`) le o cursor de texto
    GLOBAL do canvas (`_curr_tx_info`), que — com rodape desenhado a cada pagina +
    capa + niveis mistos — fica "uma linha atras", jogando cada numero p/ a linha
    anterior (o 1o numero orfao sob o titulo, cada entrada mostrando a pagina da
    SEGUINTE). Aqui cada linha e [titulo | pagina] numa Table: posicao exata, sem
    cursor global. Mantem notify/beforeBuild/isSatisfied/addEntry da base, entao a
    convergencia do multiBuild segue igual. (Sem dot leaders por ora.)"""

    def wrap(self, availWidth, availHeight):
        entries = self._lastEntries or [(0, "Sumário", 0, None)]
        rows = []
        for i, (level, text, pageNum, key) in enumerate(entries):
            st = self.getLevelStyle(level)
            rst = ParagraphStyle(f"tocnum{i}", parent=st, alignment=TA_RIGHT,
                                 leftIndent=0, rightIndent=0)
            rows.append([Paragraph(text, st), Paragraph(str(pageNum), rst)])
        numw = 13 * mm
        self._table = Table(rows, colWidths=[availWidth - numw, numw])
        self._table.setStyle(TableStyle([
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING", (0, 0), (-1, -1), 0),
            ("RIGHTPADDING", (0, 0), (-1, -1), 0),
            ("TOPPADDING", (0, 0), (-1, -1), 0),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
            ("FONTNAME", (0, 0), (-1, -1), FONT_SANS),
        ]))
        self.width, self.height = self._table.wrapOn(self.canv, availWidth,
                                                     availHeight)
        return self.width, self.height

    def drawOn(self, canvas, x, y, _sW=0):
        self._table.drawOn(canvas, x, y, _sW)


def _summary_block(ss, toc):
    """Página de SUMÁRIO (após a capa): título + TOC paginado (preenchido pelo
    afterFlowable do _TocDocTemplate via multiBuild)."""
    return [
        Paragraph("SUMÁRIO", ParagraphStyle("sumh", parent=ss["Cover"],
                                             fontSize=22)),
        Spacer(1, 4 * mm),
        toc,
        PageBreak(),
    ]


def _stat_table(ss, stats):
    stats = (stats or [])[:4]
    if not stats:
        return None
    lab = [Paragraph(_esc(s.get("label", "")).upper(), ss["KpiLabel"]) for s in stats]
    val = [Paragraph(_esc(s.get("value", "")), ss["KpiVal"]) for s in stats]
    w = (170.0 / len(stats)) * mm
    tbl = Table([lab, val], colWidths=[w] * len(stats))
    tbl.setStyle(_ts([
        ("BACKGROUND", (0, 0), (-1, -1), C(T.SURFACE_ALT)),
        ("BOX", (0, 0), (-1, -1), 0.5, C(T.BORDER)),
        ("INNERGRID", (0, 0), (-1, -1), 0.5, C(T.SURFACE)),
        ("TOPPADDING", (0, 0), (-1, -1), 7),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
    ]))
    return tbl


def _stat_table_white(ss, stats):
    """KPIs da capa ESCURA (navy/foto): células transparentes + texto BRANCO —
    espelha o _cover_stats_white do DOCX (valor grande em cima, rótulo embaixo)."""
    stats = (stats or [])[:4]
    if not stats:
        return None
    valst = ParagraphStyle("KpiValW", parent=ss["KpiVal"], textColor=colors.white,
                           leading=24)
    labst = ParagraphStyle("KpiLabelW", parent=ss["KpiLabel"], textColor=colors.white,
                           leading=11)
    val = [Paragraph(_esc(s.get("value", "")), valst) for s in stats]
    lab = [Paragraph(_esc(s.get("label", "")).upper(), labst) for s in stats]
    w = (170.0 / len(stats)) * mm
    # Alturas de linha EXPLICITAS: valor (grande) em cima, rotulo embaixo, sem
    # sobreposicao (VALIGN TOP + padding 0).
    tbl = Table([val, lab], colWidths=[w] * len(stats), rowHeights=[12 * mm, 7 * mm])
    tbl.setStyle(_ts([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
    ]))
    return tbl


def _append_image_pdf(S, ss, path, caption=None):
    if not path or not os.path.exists(path):
        return False
    try:
        iw, ih = ImageReader(path).getSize()
        maxw, maxh = 160 * mm, 120 * mm
        scale = min(maxw / iw, maxh / ih, 1.0)
        img = Image(path, width=iw * scale, height=ih * scale)
        img.hAlign = "CENTER"
        S.append(Spacer(1, 2 * mm))
        S.append(img)
        if caption:
            S.append(Paragraph(_esc(caption), ss["Small"]))
        S.append(Spacer(1, 3 * mm))
        return True
    except Exception:
        return False


def _placeholder_pdf(S, ss, text, color=None):
    """Nota NEUTRA de evidência complementar (sem alarme). Só p/ achado de fato
    não-verificável (sem cadeia textual E sem imagem)."""
    color = color or T.MUTED
    tbl = Table(
        [[Paragraph(f'<font color="#{color}"><b>{_esc(text)}</b></font>',
                    ss["Body2"])]], colWidths=[165 * mm])
    tbl.setStyle(_ts([
        ("BACKGROUND", (0, 0), (-1, -1), C(T.SURFACE_ALT)),
        ("LINEBEFORE", (0, 0), (0, -1), 3, C(color)),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]))
    S.append(tbl)
    S.append(Spacer(1, 3 * mm))


def _part_divider(ss, sec):
    out = [PageBreak(), Spacer(1, 40 * mm)]
    out.append(Paragraph(_esc(sec.get("part", "")),
                         ParagraphStyle("pdpart", parent=ss["Small"],
                                        fontName=FONT_SANS_BOLD, fontSize=12,
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
        out.append(Paragraph(_esc(sec["headline"]),
                             ParagraphStyle("sbh", parent=ss["Cover"], fontSize=18,
                                            spaceAfter=6)))
    st = _stat_table(ss, sec.get("stats"))
    if st:
        out += [st, Spacer(1, 5 * mm)]
    if sec.get("body"):
        out.append(Paragraph(_ml(sec["body"]), ss["Body2"]))
    return out


def _attack_chain(ss, sec):
    out = [Paragraph("Cadeia de Ataque", ss["H1"]),
           HRFlowable(width="18%", thickness=2, color=C(T.CORAL), spaceAfter=6)]
    boxstyle = ParagraphStyle("chainbox", parent=ss["Small"], fontSize=8,
                              textColor=C(T.INK), leading=10)
    arrstyle = ParagraphStyle("arr", parent=ss["Small"], alignment=TA_CENTER)
    per_row = 5          # máx. de passos por linha (28mm*5 + 6mm*4 ~ 164mm)
    for lane in (sec.get("lanes") or []):      # SEM cap: todas as raias
        out.append(Paragraph(_esc(lane.get("title", "")), ss["CardTitle"]))
        steps = lane.get("steps") or []        # SEM cap: todos os passos
        for r0 in range(0, len(steps), per_row):
            rowsteps = steps[r0:r0 + per_row]
            cells, widths = [], []
            for i, s in enumerate(rowsteps):
                cells.append(Paragraph(
                    f'<b><font color="#{T.PRIMARY}">{_esc(s.get("label", ""))}</font></b>'
                    f'<br/><font size="7" color="#{T.MUTED}">{_esc(s.get("detail", ""))}</font>',
                    boxstyle))
                widths.append(28 * mm)
                last_overall = (r0 + i == len(steps) - 1)
                if i < len(rowsteps) - 1 and not last_overall:
                    cells.append(Paragraph(
                        f'<font color="#{T.CORAL}" size="14">&#8594;</font>', arrstyle))
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
                tbl.setStyle(_ts(sc))
                out.append(tbl)
                out.append(Spacer(1, 2 * mm))
        out.append(Spacer(1, 4 * mm))
    return out


def _roadmap(ss, sec):
    out = [Paragraph("Plano de Remediação por Fase", ss["H1"]),
           HRFlowable(width="18%", thickness=2, color=C(T.CORAL), spaceAfter=6)]
    data = [[Paragraph('<font color="white"><b>Janela</b></font>', ss["Body2"]),
             Paragraph('<font color="white"><b>Foco</b></font>', ss["Body2"]),
             Paragraph('<font color="white"><b>Ações</b></font>', ss["Body2"])]]
    for ph in (sec.get("phases") or [])[:4]:
        acts = "<br/>".join("• " + _esc(a)
                            for a in (ph.get("actions") or []))
        data.append([Paragraph(f'<b>{_esc(ph.get("window", ""))}</b>', ss["Small"]),
                     Paragraph(_esc(ph.get("label", "")), ss["Small"]),
                     Paragraph(acts, ss["Small"])])
    tbl = Table(data, colWidths=[26 * mm, 34 * mm, 114 * mm], repeatRows=1)
    tbl.setStyle(_ts([
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
    remlist = "<br/>".join("• " + _esc(r)
                           for r in (sec.get("remediation") or []))
    inc_parts = []
    for it in (sec.get("incident") or []):
        line = f'<b><font color="#{T.DESTRUCTIVE}">• {_esc(it.get("label", ""))}</font></b>'
        if it.get("detail"):
            line += f'<br/><font size="8" color="#{T.MUTED}">   {_esc(it["detail"])}</font>'
        inc_parts.append(line)
    inclist = "<br/>".join(inc_parts)
    header = [Paragraph('<font color="white"><b>REMEDIAÇÃO — INVESTIMENTO</b></font>', ss["Body2"]),
              Paragraph('<font color="white"><b>INCIDENTE NÃO REMEDIADO — RISCO</b></font>', ss["Body2"])]
    body = [Paragraph(remlist, ss["Small"]), Paragraph(inclist, ss["Small"])]
    tbl = Table([header, body], colWidths=[87 * mm, 87 * mm])
    tbl.setStyle(_ts([
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
    out = [Paragraph(_esc(sec.get("title", "Parceria")), ss["H1"]),
           HRFlowable(width="18%", thickness=2, color=C(T.CORAL), spaceAfter=6)]
    for p in (sec.get("points") or [])[:6]:
        out.append(Paragraph(
            f'<b><font color="#{T.PRIMARY}">{_esc(p.get("title", ""))}</font></b>',
            ss["Body2"]))
        out.append(Paragraph(_esc(p.get("body", "")), ss["Body2"]))
    return out


def _next_steps(ss, sec, brand):
    out = [Paragraph("Próximos Passos", ss["H1"]),
           HRFlowable(width="18%", thickness=2, color=C(T.CORAL), spaceAfter=6)]
    for i, s in enumerate((sec.get("steps") or [])[:6], 1):
        out.append(Paragraph(f'<b>{i}.</b>  {_esc(s)}',
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
    toc = _CleanTOC()
    # spaceBefore (nao leading) da o ritmo vertical; cada entrada e uma linha de
    # Table [titulo | pagina] no _CleanTOC, com o titulo recuado por nivel.
    toc.levelStyles = [
        ParagraphStyle("TOCl0", fontName=FONT_SANS_BOLD, fontSize=12, leading=15,
                       spaceBefore=9, textColor=C(T.INK)),
        ParagraphStyle("TOCl1", fontName=FONT_SANS, fontSize=10.5, leading=14,
                       spaceBefore=4, leftIndent=14, textColor=C(T.INK)),
        ParagraphStyle("TOCl2", fontName=FONT_SANS, fontSize=10, leading=14,
                       spaceBefore=3, leftIndent=28, textColor=C(T.MUTED)),
    ]
    S = []
    title = None
    brand = meta.get("brand", {})
    # Capa: arte da marca (coverImagePath) OU, na ausência, o navy PADRÃO (gold
    # SYN) — mesmo tratamento do DOCX. O fundo é desenhado no canvas (page 1);
    # _cover_navy_default avisa o bloco da capa p/ usar texto/logo/KPIs BRANCOS.
    _cover_bg = brand.get("coverImagePath")
    _cover_navy_default = False
    if not (_cover_bg and os.path.exists(_cover_bg)):
        try:
            _cover_bg = T.default_cover_bg()
            _cover_navy_default = bool(_cover_bg and os.path.exists(_cover_bg))
        except Exception:
            _cover_bg = None
            _cover_navy_default = False

    def esc(s):
        return _esc(s)

    for sec in model.get("sections", []):
        t = sec.get("type")
        if t == "cover" and brand.get("coverImagePath") and os.path.exists(brand["coverImagePath"]):
            # Arte full-bleed desenhada no canvas; sobrepomos o título em branco.
            S.append(Spacer(1, 150 * mm))
            S.append(Paragraph(
                f'<b><font color="#FFFFFF">{esc(meta.get("classification",""))}   ·   {esc(meta.get("docCode",""))}</font></b>',
                ss["Small"]))
            S.append(Paragraph(
                f'<font color="#FFFFFF"><b>{esc(meta.get("volume",""))}</b></font>',
                ss["Small"]))
            S.append(Spacer(1, 6 * mm))
            S.append(Paragraph(
                f'<font color="#FFFFFF">{esc(sec.get("title",""))}</font>',
                ss["Cover"]))
            if sec.get("subtitle"):
                S.append(Paragraph(
                    f'<font color="#FFFFFF">{esc(sec["subtitle"])}</font>',
                    ParagraphStyle("subl", parent=ss["Body2"], fontSize=13,
                                   textColor=colors.white)))
            S.append(PageBreak())
            S += _summary_block(ss, toc)
        elif t == "cover":
            # Sem arte da marca → capa NAVY padrão (gold SYN): texto/logo/KPIs em
            # BRANCO sobre o navy desenhado no canvas. Se o navy não pôde ser
            # gerado (_cover_navy_default=False), degrada p/ a capa clara (INK).
            _ctitle = "FFFFFF" if _cover_navy_default else T.INK
            _cmuted = "C9D3E6" if _cover_navy_default else T.MUTED
            S.append(Spacer(1, 30 * mm))
            used_logo = False
            logo_path = brand.get("logoPath")
            if logo_path and os.path.exists(logo_path):
                try:
                    iw, ih = ImageReader(logo_path).getSize()
                    w = 60 * mm
                    h = w * ih / iw
                    if h > 24 * mm:
                        h = 24 * mm
                        w = h * iw / ih
                    im = Image(logo_path, width=w, height=h)
                    im.hAlign = "LEFT"
                    S.append(im)
                    used_logo = True
                except Exception:
                    used_logo = False
            if not used_logo and brand.get("wordmark", "") == "Suricatoos":
                lp = logo.write_logo(dark=_cover_navy_default)  # branco no navy
                if lp and os.path.exists(lp):
                    try:
                        # Altura do ratio REAL do PNG (logo oficial 1600x274).
                        _iw, _ih = ImageReader(lp).getSize()
                        _w = 70 * mm
                        im = Image(lp, width=_w, height=_w * _ih / _iw)
                        im.hAlign = "LEFT"
                        S.append(im)
                        used_logo = True
                    except Exception:
                        used_logo = False
            if not used_logo:
                S.append(Paragraph(
                    f'<font color="#{_ctitle}">{esc(brand.get("wordmark", T.WORDMARK))}</font>',
                    ss["Wordmark"]))
            S.append(Spacer(1, 55 * mm))
            S.append(Paragraph(
                f'<b><font color="#{T.CORAL}">{esc(meta.get("classification", ""))}   ·   {esc(meta.get("docCode", ""))}</font></b>',
                ss["Small"]))
            S.append(Paragraph(
                f'<font color="#{_cmuted}"><b>{esc(meta.get("volume", ""))}</b></font>',
                ss["Small"]))
            S.append(Spacer(1, 8 * mm))
            S.append(Paragraph(
                f'<font color="#{_ctitle}">{esc(sec.get("title", ""))}</font>',
                ss["Cover"]))
            if sec.get("subtitle"):
                S.append(Paragraph(
                    f'<font color="#{_cmuted}">{esc(sec["subtitle"])}</font>',
                    ParagraphStyle("sub", parent=ss["Body2"], fontSize=13)))
            S.append(Spacer(1, 12 * mm))
            st = (_stat_table_white if _cover_navy_default else _stat_table)(
                ss, sec.get("stats"))
            if st:
                S.append(st)
            S.append(PageBreak())
            S += _summary_block(ss, toc)
        elif t == "partDivider":
            S += _part_divider(ss, sec)
        elif t == "divider":
            S.append(PageBreak())
        elif t == "heading":
            title = sec.get("text")
            _hname = "TOCH2" if sec.get("level", 1) == 2 else "TOCH1"
            S.append(Paragraph(esc(sec.get("text", "")),
                               ParagraphStyle(_hname, parent=ss["H1"])))
            S.append(HRFlowable(width="18%", thickness=2, color=C(T.CORAL), spaceAfter=6))
        elif t == "paragraph":
            S.append(Paragraph(_ml(sec.get("text", "")), ss["Body2"]))
        elif t == "bullets":
            for it in sec.get("items", []):
                S.append(Paragraph("• " + _ml(it), ss["Body2"]))
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
            tbl.setStyle(_ts([
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
            tbl.setStyle(_ts(style))
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
            tbl.setStyle(_ts(stylecmds))
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
                f'{esc(f.get("ref",""))} · {esc(f.get("title",""))}', ss["CardTitle"]))
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
                S.append(Paragraph(f'<b><font color="#{T.PRIMARY}">Narrativa:</font></b> {_ml(f["narrative"])}', ss["Body2"]))
            for label, key in [("Descrição", "description"), ("Impacto", "impact"), ("Remediação", "remediation")]:
                if f.get(key):
                    S.append(Paragraph(f'<b><font color="#{T.PRIMARY}">{label}:</font></b> {_ml(f[key])}', ss["Body2"]))
            if sec.get("showPoc") and f.get("reproductionSteps"):
                S.append(Paragraph(f'<b><font color="#{T.PRIMARY}">Reprodução:</font></b>', ss["Body2"]))
                for i, s in enumerate(f["reproductionSteps"], 1):
                    S.append(Paragraph(f"{i}. {_ml(s)}", ss["Body2"]))
            if sec.get("showPoc"):
                ev = sorted(
                    f.get("evidence") or [],
                    key=lambda e: e.get("stepIndex") if e.get("stepIndex") is not None else 1_000_000,
                )
                if any(e.get("snippet") or e.get("imagePath") or e.get("command") for e in ev):
                    S.append(Paragraph(f'<b><font color="#{T.PRIMARY}">Cadeia de evidência:</font></b>', ss["Body2"]))
                img_rendered = 0
                has_chain = any(
                    e.get("command") or e.get("snippet") or e.get("resultSummary")
                    for e in ev)
                for i, e in enumerate(ev, 1):
                    n = e.get("stepIndex") or i
                    head = f"<b>{n}.</b>"
                    if e.get("toolName"):
                        head += f' <font face="{FONT_MONO}">[{esc(e["toolName"])}]</font>'
                    if e.get("label") and e.get("label") != e.get("toolName"):
                        head += f' {esc(e["label"])}'
                    S.append(Paragraph(head, ss["Small"]))
                    if e.get("command"):
                        S.append(Paragraph("$ " + _ml(e["command"]), ss["Mono"]))
                    if e.get("snippet"):
                        S.append(Paragraph(_ml(e["snippet"]), ss["Mono"]))
                    if e.get("resultSummary"):
                        S.append(Paragraph(f'<font color="#{T.SUCCESS}"><b>&#8594; prova:</b></font> {_ml(e["resultSummary"])}', ss["Small"]))
                    # Só embute print que REALMENTE existe; ausente (ainda não
                    # enviado / relatório defasado) cai fora SEM aviso.
                    if e.get("imagePath") and os.path.exists(e["imagePath"]):
                        if _append_image_pdf(S, ss, e["imagePath"], e.get("label")):
                            img_rendered += 1
                # Nota neutra só p/ achado de fato não-verificável (sem imagem E
                # sem cadeia). Nunca "não capturada"/"removida" sob prova textual.
                if img_rendered == 0 and not has_chain and sev in ("critical", "high"):
                    _placeholder_pdf(S, ss, "Evidência complementar não anexada a este achado.")
        elif t in ("findingsTable", "remediationMatrix"):
            findings = sec.get("findings", [])
            rem = t == "remediationMatrix"
            headers = (["Ref", "Sev", "Ativo", "Remediação"] if rem
                       else ["Ref", "Sev", "Título", "Ativo", "CVSS"])
            # Texto longo como Paragraph → QUEBRA na largura da coluna (string
            # crua no reportlab não quebra: transbordaria). Nada é truncado.
            tcell = ParagraphStyle("tcell", parent=ss["Small"], spaceBefore=0,
                                   spaceAfter=0)

            def _cell(s):
                return Paragraph(esc(str(s or "")), tcell)

            data = [headers]
            for f in findings:
                sev = f.get("severity", "info")
                cvss = f.get("cvssScore")
                cvss_s = f"{cvss:.1f}" if isinstance(cvss, (int, float)) else "—"
                data.append(
                    [f.get("ref", ""), T.SEVERITY_LABEL.get(sev, sev),
                     _cell(f.get("affectedAsset", "")), _cell(f.get("remediation", ""))]
                    if rem else
                    [f.get("ref", ""), T.SEVERITY_LABEL.get(sev, sev),
                     _cell(f.get("title", "")), _cell(f.get("affectedAsset", "")),
                     cvss_s])
            widths = ([16 * mm, 18 * mm, 45 * mm, 86 * mm] if rem
                      else [15 * mm, 17 * mm, 70 * mm, 42 * mm, 16 * mm])
            tbl = Table(data, colWidths=widths, repeatRows=1)
            tbl.setStyle(_ts([
                ("BACKGROUND", (0, 0), (-1, 0), C(T.PRIMARY)),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("FONTNAME", (0, 0), (-1, 0), FONT_SANS_BOLD),
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
            tbl = Table([[Paragraph(f'<font color="#{col}"><b>{_ml(sec.get("text",""))}</b></font>', ss["Body2"])]],
                        colWidths=[165 * mm])
            tbl.setStyle(_ts([
                ("BACKGROUND", (0, 0), (-1, -1), C(T.SURFACE_ALT)),
                ("LINEBEFORE", (0, 0), (0, -1), 3, C(col)),
                ("LEFTPADDING", (0, 0), (-1, -1), 8),
                ("TOPPADDING", (0, 0), (-1, -1), 6),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
            ]))
            S.append(tbl)
            S.append(Spacer(1, 5 * mm))

    foot = _cover_canvas_factory(meta, _cover_bg)
    doc = _TocDocTemplate(out_path, foot, pagesize=A4, leftMargin=18 * mm,
                          rightMargin=18 * mm, topMargin=16 * mm,
                          bottomMargin=16 * mm, title="Relatório")
    doc.multiBuild(S)
