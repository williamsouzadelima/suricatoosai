"""Renderer PPTX (python-pptx) do ReportModel — estilo "dossie".

Casca de dossie: capa com codigo de documento + selo + faixa de KPIs, rodape
numerado (CONFIDENCIAL · docCode · NN), divisorias de PARTE. Marca configuravel
por MSSP (meta.brand sobrescreve a paleta/wordmark). Cada secao de conteudo
vira um slide."""

from pptx import Presentation
from pptx.util import Inches, Pt, Emu
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
from pptx.enum.shapes import MSO_SHAPE
import os

import theme as T
import logo

EMU_IN = 914400
SW = Inches(13.333)
SH = Inches(7.5)
ML = Inches(0.6)
CW = Inches(12.13)

MONTHS = ["JANEIRO", "FEVEREIRO", "MARÇO", "ABRIL", "MAIO", "JUNHO", "JULHO",
          "AGOSTO", "SETEMBRO", "OUTUBRO", "NOVEMBRO", "DEZEMBRO"]

# Estado por render (um modelo por processo): meta p/ rodape + contador de pagina.
_STATE = {"meta": {}, "page": 0}


def _rgb(hexstr):
    return RGBColor.from_string(hexstr)


def _blank(prs):
    return prs.slides.add_slide(prs.slide_layouts[6])


def _accent():
    return _STATE["meta"].get("brand", {}).get("accent") or T.CORAL


def _month_year(ms):
    try:
        import datetime
        d = datetime.datetime.utcfromtimestamp(int(ms) / 1000)
        return f"{MONTHS[d.month - 1]} · {d.year}"
    except Exception:
        return ""


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


# ───────────────────────────────────────────────────────────────────────────
# Motor de layout com paginação (WS2): PPTX não mede texto, então estimamos
# linhas por caixa e quebramos conteúdo longo em slides "(cont.)" — NUNCA
# truncamos corpo de achado/evidência. Unidades em EMU (int).
# ───────────────────────────────────────────────────────────────────────────
_CONTENT_BOTTOM = int(Inches(6.95))   # acima do rodapé (7.08)
_LINE_FACTOR = 1.3                      # entrelinha aproximada


def _wrap(text, cpl):
    """Quebra texto em linhas de ~cpl chars, respeitando \\n e palavras longas."""
    out = []
    for raw in str(text or "").split("\n"):
        if not raw:
            out.append("")
            continue
        line = ""
        for w in raw.split(" "):
            while len(w) > cpl:               # token gigante → quebra forçada
                if line:
                    out.append(line)
                    line = ""
                out.append(w[:cpl])
                w = w[cpl:]
            cand = w if not line else line + " " + w
            if len(cand) <= cpl:
                line = cand
            else:
                out.append(line)
                line = w
        out.append(line)
    return out


def _img_size(path):
    try:
        from PIL import Image
        with Image.open(path) as im:
            return im.size
    except Exception:
        return None


class _Flow:
    """Cursor de conteúdo que flui slide a slide, abrindo continuações."""

    def __init__(self, prs, title):
        self.prs = prs
        self.title = title
        self.slide, y = _title_slide(prs, title)
        self.y = int(y)

    def _newslide(self):
        self.slide, y = _title_slide(self.prs, _clip(self.title, 58) + " (cont.)")
        self.y = int(y)

    def space(self, emu):
        self.y += int(emu)

    def ensure(self, emu):
        if self.y + int(emu) > _CONTENT_BOTTOM:
            self._newslide()

    def heading(self, text, size=12, color=None):
        color = color or T.PRIMARY
        self.ensure(Inches(0.5))
        _text(self.slide, ML, Emu(self.y), CW, Inches(0.32), text, size=size,
              bold=True, color=color)
        self.y += int(Inches(0.42))

    def para(self, text, size=11, color=T.INK, bold=False, font=T.FONT_BODY,
             indent=0.0, after=0.08):
        left = int(ML) + int(Inches(indent))
        width = int(CW) - int(Inches(indent))
        cpl = max(12, int((width / EMU_IN) * 72 / (size * 0.5)))
        lines = _wrap(text, cpl)
        lh = int(size * _LINE_FACTOR / 72.0 * EMU_IN)
        i = 0
        while i < len(lines):
            self.ensure(lh)
            cap = max(1, (_CONTENT_BOTTOM - self.y) // lh)
            take = lines[i:i + cap]
            i += len(take)
            h = len(take) * lh
            tb = self.slide.shapes.add_textbox(Emu(left), Emu(self.y),
                                               Emu(width), Emu(h))
            tf = tb.text_frame
            tf.word_wrap = True
            for j, ln in enumerate(take):
                p = tf.paragraphs[0] if j == 0 else tf.add_paragraph()
                r = p.add_run()
                r.text = ln
                r.font.size = Pt(size)
                r.font.bold = bold
                r.font.name = font
                r.font.color.rgb = _rgb(color)
            self.y += h
        self.y += int(Inches(after))

    def image(self, path, caption=None):
        """Embute imagem escalada à coluna; paginando. Retorna True se embutiu."""
        sz = _img_size(path)
        if not sz or not path or not os.path.exists(path):
            return False
        iw, ih = sz
        maxw, maxh = int(CW), int(Inches(4.6))
        scale = min(maxw / iw, maxh / ih)
        w, h = int(iw * scale), int(ih * scale)
        self.ensure(h + int(Inches(0.1)))
        left = int(ML) + (int(CW) - w) // 2
        try:
            self.slide.shapes.add_picture(path, Emu(left), Emu(self.y),
                                          width=Emu(w), height=Emu(h))
        except Exception:
            return False
        self.y += h + int(Inches(0.08))
        if caption:
            self.para("▲ " + str(caption), size=10, color=T.MUTED, after=0.14)
        return True

    def placeholder(self, text, tone=None):
        tone = tone or T.WARNING
        self.ensure(Inches(0.6))
        _rect(self.slide, ML, Emu(self.y), CW, Inches(0.5), T.SURFACE_ALT,
              line=tone)
        _text(self.slide, ML + Inches(0.15), Emu(self.y), CW - Inches(0.3),
              Inches(0.5), text, size=11, bold=True, color=tone,
              anchor=MSO_ANCHOR.MIDDLE)
        self.y += int(Inches(0.62))


def _footer(slide, dark=False):
    """Rodape numerado em todo slide de conteudo (cover nao chama)."""
    m = _STATE["meta"]
    _STATE["page"] += 1
    n = _STATE["page"]
    col = "8FA0BC" if dark else T.MUTED
    _text(slide, ML, Inches(7.08), Inches(6.0), Inches(0.3),
          m.get("classification", ""), size=8, color=col)
    _text(slide, Inches(9.0), Inches(7.08), Inches(3.73), Inches(0.3),
          f"{m.get('docCode', '')} · {n:02d}", size=8, color=col,
          align=PP_ALIGN.RIGHT)


def _title_slide(prs, title):
    slide = _blank(prs)
    _rect(slide, 0, 0, SW, Inches(0.12), T.PRIMARY)
    _text(slide, ML, Inches(0.35), CW, Inches(0.7), title, size=24, bold=True,
          color=T.INK, font=T.FONT_DISPLAY)
    _rect(slide, ML, Inches(1.05), Inches(1.2), Emu(int(0.045 * EMU_IN)), _accent())
    _footer(slide)
    return slide, Inches(1.35)


def _cover(prs, sec, meta):
    slide = _blank(prs)
    brand = meta.get("brand", {})
    accent = brand.get("accent") or T.CORAL
    # Capa full-bleed: arte da marca (coverImagePath) ao fundo; senão, navy sólido.
    cover = brand.get("coverImagePath")
    if not (cover and os.path.exists(cover)):
        # Sem arte da marca → navy PADRÃO (gold SYN): mesma arte do DOCX/PDF
        # (navy INK + faixa azul + traço coral), em vez do retângulo sólido.
        try:
            cover = T.default_cover_bg()
        except Exception:
            cover = None
    if cover and os.path.exists(cover):
        try:
            fitted = T.cover_fit(cover, int(SW), int(SH))
            slide.shapes.add_picture(fitted, 0, 0, width=SW, height=SH)
        except Exception:
            _rect(slide, 0, 0, SW, SH, T.INK)
    else:
        _rect(slide, 0, 0, SW, SH, T.INK)
    # Wordmark (topo-esq): logo custom da marca > logo Suricatoos embutido > texto.
    used_logo = False
    logo_path = brand.get("logoPath")
    if logo_path and os.path.exists(logo_path):
        try:
            slide.shapes.add_picture(logo_path, ML, Inches(0.5), height=Inches(0.6))
            used_logo = True
        except Exception:
            used_logo = False
    if not used_logo and brand.get("wordmark", "") == "Suricatoos":
        lp = logo.write_logo(dark=True)
        if lp and os.path.exists(lp):
            try:
                slide.shapes.add_picture(lp, ML, Inches(0.5), height=Inches(0.5))
                used_logo = True
            except Exception:
                used_logo = False
    if not used_logo:
        _text(slide, ML, Inches(0.5), Inches(7.0), Inches(0.5),
              brand.get("wordmark", T.WORDMARK), size=22, bold=True,
              color=accent, font=T.FONT_DISPLAY)
    # Topo-dir: selo + codigo do documento.
    _text(slide, Inches(7.9), Inches(0.5), Inches(4.83), Inches(0.3),
          meta.get("classification", ""), size=10, bold=True, color=accent,
          align=PP_ALIGN.RIGHT)
    _text(slide, Inches(7.9), Inches(0.85), Inches(4.83), Inches(0.3),
          meta.get("docCode", ""), size=10, color="8FA0BC", align=PP_ALIGN.RIGHT)
    # Titulo.
    _rect(slide, ML, Inches(2.2), Inches(1.4), Emu(int(0.06 * EMU_IN)), accent)
    _text(slide, ML, Inches(2.35), CW, Inches(0.35), meta.get("volume", ""),
          size=12, bold=True, color=accent)
    _text(slide, ML, Inches(2.75), CW, Inches(1.3), sec.get("title", ""),
          size=40, bold=True, color="FFFFFF", font=T.FONT_DISPLAY)
    if sec.get("subtitle"):
        _text(slide, ML, Inches(4.1), CW, Inches(0.6), sec["subtitle"], size=18,
              color="C9D3E6")
    # Faixa de KPIs.
    stats = sec.get("stats") or []
    if stats:
        tw = Inches(2.7)
        gap = Inches(0.2)
        yv = Inches(5.15)
        for i, s in enumerate(stats[:4]):
            x = ML + (tw + gap) * i
            _text(slide, x, yv, tw, Inches(0.8), str(s.get("value", "")),
                  size=40, bold=True, color=accent, font=T.FONT_DISPLAY)
            _text(slide, x, yv + Inches(0.85), tw, Inches(0.5),
                  str(s.get("label", "")), size=10, bold=True, color="8FA0BC")
    # Rodape da capa.
    _text(slide, ML, Inches(6.85), CW, Inches(0.4),
          f"{meta.get('client', '')}  ·  {_month_year(meta.get('generatedAt', 0))}  ·  {brand.get('name', '')}",
          size=12, color="C9D3E6")
    _STATE["page"] = 1


def _part_divider(prs, sec):
    slide = _blank(prs)
    _rect(slide, 0, 0, SW, SH, T.INK)
    accent = _accent()
    _rect(slide, ML, Inches(3.0), Inches(1.6), Emu(int(0.06 * EMU_IN)), accent)
    _text(slide, ML, Inches(2.35), CW, Inches(0.4), sec.get("part", ""),
          size=14, bold=True, color=accent)
    _text(slide, ML, Inches(3.2), CW, Inches(1.2), sec.get("title", ""),
          size=34, bold=True, color="FFFFFF", font=T.FONT_DISPLAY)
    if sec.get("subtitle"):
        _text(slide, ML, Inches(4.5), CW, Inches(0.6), sec["subtitle"],
              size=16, color="C9D3E6")
    _footer(slide, dark=True)


def _divider(prs, meta):
    slide = _blank(prs)
    _rect(slide, 0, 0, SW, SH, T.SURFACE_ALT)
    _rect(slide, ML, Inches(3.4), Inches(1.6), Emu(int(0.06 * EMU_IN)), _accent())
    _text(slide, ML, Inches(3.6), CW, Inches(0.6),
          meta.get("brand", {}).get("wordmark", T.WORDMARK), size=22,
          bold=True, color=T.PRIMARY, font=T.FONT_DISPLAY)
    _footer(slide)


def _stat_band(prs, sec):
    slide = _blank(prs)
    _rect(slide, 0, 0, SW, Inches(0.12), T.PRIMARY)
    y = Inches(0.5)
    if sec.get("headline"):
        _text(slide, ML, y, CW, Inches(0.9), _clip(sec["headline"], 160),
              size=24, bold=True, color=T.INK, font=T.FONT_DISPLAY)
        y = Inches(1.55)
    stats = sec.get("stats") or []
    if stats:
        tw = Inches(2.85)
        gap = Inches(0.13)
        for i, s in enumerate(stats[:4]):
            x = ML + (tw + gap) * i
            _rect(slide, x, y, tw, Inches(1.6), T.SURFACE_ALT, line=T.BORDER)
            _rect(slide, x, y, Emu(int(0.06 * EMU_IN)), Inches(1.6), _accent())
            _text(slide, x + Inches(0.2), y + Inches(0.2), tw - Inches(0.3),
                  Inches(0.85), str(s.get("value", "")), size=40, bold=True,
                  color=T.PRIMARY, font=T.FONT_DISPLAY)
            _text(slide, x + Inches(0.2), y + Inches(1.1), tw - Inches(0.3),
                  Inches(0.4), str(s.get("label", "")), size=10, bold=True,
                  color=T.MUTED)
        y = y + Inches(1.95)
    if sec.get("body"):
        _text(slide, ML, y, CW, Inches(2.4), _clip(sec["body"], 2000), size=14,
              color=T.INK)
    _footer(slide)


def _attack_chain(prs, sec):
    slide, y = _title_slide(prs, "Cadeia de Ataque")
    lanes = sec.get("lanes") or []
    lane_h = Inches(1.7)
    box_w = Inches(2.0)
    arrow_w = Inches(0.35)
    step = box_w + arrow_w
    for li, lane in enumerate(lanes[:3]):
        ly = y + lane_h * li
        _text(slide, ML, ly, CW, Inches(0.35), _clip(lane.get("title", ""), 80),
              size=12, bold=True, color=T.INK)
        steps = (lane.get("steps") or [])[:5]
        for si, st in enumerate(steps):
            x = ML + step * si
            by = ly + Inches(0.42)
            _rect(slide, x, by, box_w, Inches(0.9), T.SURFACE_ALT, line=T.BORDER)
            _rect(slide, x, by, box_w, Emu(int(0.05 * EMU_IN)), T.PRIMARY)
            _text(slide, x + Inches(0.1), by + Inches(0.1), box_w - Inches(0.2),
                  Inches(0.35), _clip(st.get("label", ""), 22), size=11,
                  bold=True, color=T.PRIMARY)
            if st.get("detail"):
                _text(slide, x + Inches(0.1), by + Inches(0.45),
                      box_w - Inches(0.2), Inches(0.42),
                      _clip(st.get("detail", ""), 44), size=8, color=T.MUTED)
            if si < len(steps) - 1:
                _text(slide, x + box_w, by + Inches(0.28), arrow_w, Inches(0.4),
                      "→", size=18, bold=True, color=_accent(),
                      align=PP_ALIGN.CENTER)


def _roadmap(prs, sec):
    slide, y = _title_slide(prs, "Plano de Remediação por Fase")
    phases = sec.get("phases") or []
    cw = Inches(2.85)
    gap = Inches(0.13)
    for i, ph in enumerate(phases[:4]):
        x = ML + (cw + gap) * i
        _rect(slide, x, y, cw, Inches(5.0), T.SURFACE_ALT, line=T.BORDER)
        _rect(slide, x, y, cw, Inches(0.7), T.PRIMARY)
        _text(slide, x + Inches(0.15), y + Inches(0.08), cw - Inches(0.25),
              Inches(0.3), ph.get("window", ""), size=11, bold=True,
              color="FFFFFF")
        _text(slide, x + Inches(0.15), y + Inches(0.38), cw - Inches(0.25),
              Inches(0.3), ph.get("label", ""), size=10, color="C9D3E6")
        yy = y + Inches(0.9)
        for a in (ph.get("actions") or [])[:6]:
            _text(slide, x + Inches(0.15), yy, cw - Inches(0.3), Inches(0.6),
                  "▸ " + _clip(a, 62), size=9, color=T.INK)
            yy += Inches(0.62)


def _cost_incident(prs, sec):
    slide, y = _title_slide(prs, "Custo da Remediação × Custo do Incidente")
    colw = Inches(5.9)
    gap = Inches(0.33)
    _rect(slide, ML, y, colw, Inches(5.0), T.SURFACE_ALT, line=T.BORDER)
    _rect(slide, ML, y, colw, Inches(0.55), T.SUCCESS)
    _text(slide, ML + Inches(0.2), y + Inches(0.1), colw - Inches(0.3),
          Inches(0.35), "REMEDIAÇÃO — INVESTIMENTO", size=12, bold=True,
          color="FFFFFF")
    yy = y + Inches(0.75)
    for r in (sec.get("remediation") or [])[:6]:
        _text(slide, ML + Inches(0.2), yy, colw - Inches(0.4), Inches(0.5),
              "◆ " + _clip(r, 72), size=11, color=T.INK)
        yy += Inches(0.55)
    x2 = ML + colw + gap
    _rect(slide, x2, y, colw, Inches(5.0), T.SURFACE_ALT, line=T.BORDER)
    _rect(slide, x2, y, colw, Inches(0.55), T.DESTRUCTIVE)
    _text(slide, x2 + Inches(0.2), y + Inches(0.1), colw - Inches(0.3),
          Inches(0.35), "INCIDENTE NÃO REMEDIADO — RISCO", size=12, bold=True,
          color="FFFFFF")
    yy = y + Inches(0.75)
    for it in (sec.get("incident") or [])[:4]:
        _text(slide, x2 + Inches(0.2), yy, colw - Inches(0.4), Inches(0.35),
              "◆ " + _clip(it.get("label", ""), 60), size=12, bold=True,
              color=T.DESTRUCTIVE)
        yy += Inches(0.38)
        if it.get("detail"):
            _text(slide, x2 + Inches(0.45), yy, colw - Inches(0.6), Inches(0.4),
                  _clip(it.get("detail", ""), 72), size=10, color=T.MUTED)
            yy += Inches(0.55)
        else:
            yy += Inches(0.2)


def _partner_value(prs, sec):
    slide, y = _title_slide(prs, _clip(sec.get("title", "Parceria"), 60))
    pts = sec.get("points") or []
    cw = Inches(5.9)
    ch = Inches(2.2)
    gapx = Inches(0.33)
    gapy = Inches(0.3)
    for i, p in enumerate(pts[:4]):
        col = i % 2
        row = i // 2
        x = ML + (cw + gapx) * col
        yy = y + (ch + gapy) * row
        _rect(slide, x, yy, cw, ch, T.SURFACE_ALT, line=T.BORDER)
        _rect(slide, x, yy, Emu(int(0.06 * EMU_IN)), ch, _accent())
        _text(slide, x + Inches(0.25), yy + Inches(0.15), cw - Inches(0.4),
              Inches(0.4), _clip(p.get("title", ""), 40), size=15, bold=True,
              color=T.PRIMARY, font=T.FONT_DISPLAY)
        _text(slide, x + Inches(0.25), yy + Inches(0.6), cw - Inches(0.4),
              Inches(1.5), _clip(p.get("body", ""), 260), size=11, color=T.INK)


def _next_steps(prs, sec):
    slide, y = _title_slide(prs, "Próximos Passos")
    steps = sec.get("steps") or []
    yy = y
    for i, s in enumerate(steps[:6], 1):
        _rect(slide, ML, yy, Inches(0.55), Inches(0.55), T.PRIMARY)
        _text(slide, ML, yy, Inches(0.55), Inches(0.55), str(i), size=20,
              bold=True, color="FFFFFF", align=PP_ALIGN.CENTER,
              anchor=MSO_ANCHOR.MIDDLE)
        _text(slide, ML + Inches(0.75), yy + Inches(0.05), CW - Inches(1.0),
              Inches(0.5), _clip(s, 110), size=15, color=T.INK,
              anchor=MSO_ANCHOR.MIDDLE)
        yy += Inches(0.75)
    brand = _STATE["meta"].get("brand", {})
    contact = " · ".join(
        [x for x in [brand.get("name", ""), brand.get("contact", ""),
                     brand.get("tagline", "")] if x])
    _text(slide, ML, Inches(6.4), CW, Inches(0.4), contact, size=11,
          color=T.MUTED)


def _kpis(prs, kpis):
    slide, y = _title_slide(prs, "Indicadores")
    tiles = [
        ("Total de achados", str(kpis.get("total", 0)), T.PRIMARY),
        ("Risco (0-100)", str(kpis.get("riskScore", 0)), T.DESTRUCTIVE
         if kpis.get("riskScore", 0) >= 55 else T.WARNING),
        ("CVSS medio", str(kpis.get("avgCvss") if kpis.get("avgCvss") is not None else "-"), T.INK),
        ("Criticos+Altos",
         str(kpis.get("bySeverity", {}).get("critical", 0) + kpis.get("bySeverity", {}).get("high", 0)),
         _accent()),
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
    slide, y = _title_slide(prs, "Distribuição por severidade")
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
    slide, y = _title_slide(prs, "Matriz de risco (probabilidade × impacto)")
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
    # Deck de apresentação: só crít/alto ganham slide dedicado; os demais constam
    # na tabela de achados (que pagina TODOS). Mantém o PPTX enxuto — DOCX/PDF
    # seguem detalhando todos os achados.
    if sev not in ("critical", "high"):
        return
    fl = _Flow(prs, _clip(f.get("title", "Achado"), 70))
    # Faixa de severidade
    fl.ensure(Inches(0.6))
    _rect(fl.slide, ML, Emu(fl.y), CW, Inches(0.5),
          T.SEVERITY_COLOR.get(sev, T.MUTED))
    _text(fl.slide, ML + Inches(0.15), Emu(fl.y + int(Inches(0.05))), CW,
          Inches(0.4),
          f"{T.SEVERITY_LABEL.get(sev, sev).upper()}  ·  {f.get('ref','')}  ·  {_clip(f.get('affectedAsset',''),70)}",
          size=13, bold=True, color="FFFFFF", anchor=MSO_ANCHOR.MIDDLE)
    fl.space(Inches(0.66))
    meta = []
    if f.get("weaknessClass"):
        meta.append(f"Classe: {f['weaknessClass']}")
    if f.get("cvssVector"):
        meta.append(f"CVSS: {f['cvssVector']}")
    if f.get("cwe"):
        meta.append(f"CWE: {f['cwe']}")
    if meta:
        fl.para("   ".join(meta), size=11, color=T.MUTED, after=0.12)
    for label, key in [("Descrição", "description"), ("Impacto", "impact"),
                       ("Remediação", "remediation")]:
        if f.get(key):
            fl.heading(label.upper(), size=11)
            fl.para(f[key], size=12, color=T.INK, after=0.14)
    if f.get("narrative"):
        fl.heading("NARRATIVA", size=11)
        fl.para(f["narrative"], size=12, color=T.INK, after=0.14)
    if sec.get("showPoc") and f.get("reproductionSteps"):
        fl.heading("REPRODUÇÃO", size=11)
        _steps = f["reproductionSteps"]
        for i, s in enumerate(_steps[:6], 1):
            fl.para(f"{i}. {s}", size=11, color=T.INK, indent=0.1, after=0.04)
        if len(_steps) > 6:
            fl.para(
                f"(+{len(_steps) - 6} passos — detalhe completo no relatório técnico DOCX/PDF)",
                size=10, color=T.MUTED, indent=0.1, after=0.04)
    if sec.get("showPoc"):
        _evidence_flow(fl, f)


def _evidence_flow(fl, f):
    """Cadeia de evidência + prints INLINE no fluxo do achado (sem cap). Mostra
    placeholder visível quando um achado alto/crítico não tem imagem."""
    ev = sorted(
        f.get("evidence") or [],
        key=lambda e: e.get("stepIndex") if e.get("stepIndex") is not None else 1_000_000,
    )
    chain = [e for e in ev
             if e.get("snippet") or e.get("command") or e.get("resultSummary")]
    imgs = [e for e in ev if e.get("imagePath")]
    if chain:
        fl.heading("CADEIA DE EVIDÊNCIA", size=11)
        for i, e in enumerate(chain[:6], 1):
            n = e.get("stepIndex") or i
            head = f"{n}."
            if e.get("toolName"):
                head += f"  [{e['toolName']}]"
            if e.get("label") and e.get("label") != e.get("toolName"):
                head += f"  {e['label']}"
            fl.para(head, size=11, bold=True, color=T.PRIMARY, after=0.02)
            if e.get("command"):
                fl.para("$ " + str(e["command"]), size=9, color=T.MUTED,
                        font=T.FONT_MONO, indent=0.12, after=0.02)
            if e.get("snippet"):
                fl.para(str(e["snippet"]), size=9, color=T.MUTED,
                        font=T.FONT_MONO, indent=0.12, after=0.02)
            if e.get("resultSummary"):
                fl.para("→ prova: " + str(e["resultSummary"]), size=10,
                        color=T.SUCCESS, indent=0.12, after=0.08)
    if len(chain) > 6:
        fl.para(
            f"(+{len(chain) - 6} passos de evidência — cadeia completa no relatório técnico DOCX/PDF)",
            size=10, color=T.MUTED, after=0.08)
    rendered = 0
    if imgs:
        fl.heading("EVIDÊNCIA VISUAL", size=11)
        for e in imgs[:4]:
            if fl.image(e.get("imagePath"), e.get("label")):
                rendered += 1
            elif f.get("severity") in ("critical", "high"):
                fl.placeholder(
                    "⚠ Evidência visual referenciada não disponível no pacote.")
        if len(imgs) > 4:
            fl.para(
                f"(+{len(imgs) - 4} imagens — veja o relatório técnico completo)",
                size=10, color=T.MUTED, after=0.08)
    if rendered == 0 and not imgs and f.get("severity") in ("critical", "high"):
        fl.placeholder("⚠ Evidência visual não capturada para este achado.")


def _table(prs, findings, title, remediation=False):
    # Pagina as linhas em slides "(cont.)" — nenhum achado some (antes: [:12]).
    ROWS_PER = 13
    chunks = [findings[i:i + ROWS_PER]
              for i in range(0, len(findings), ROWS_PER)] or [[]]
    if remediation:
        headers = ["Ref", "Sev", "Ativo", "Remediacao"]
        widths = [Inches(1.2), Inches(1.4), Inches(3.5), Inches(6.0)]
    else:
        headers = ["Ref", "Sev", "Titulo", "Ativo"]
        widths = [Inches(1.2), Inches(1.4), Inches(5.5), Inches(4.0)]
    for ci, chunk in enumerate(chunks):
        slide, y = _title_slide(
            prs, title if ci == 0 else _clip(title, 58) + " (cont.)")
        rows = len(chunk) + 1
        gt = slide.shapes.add_table(rows, len(headers), ML, y, CW,
                                    Inches(0.4) * rows).table
        for j, hd in enumerate(headers):
            gt.columns[j].width = widths[j]
            cell = gt.cell(0, j)
            cell.fill.solid()
            cell.fill.fore_color.rgb = _rgb(T.PRIMARY)
            # add_run() sempre cria um run — ao contrário de `cell.text = ""`,
            # que deixa o parágrafo SEM run e faz runs[0] estourar IndexError.
            pr = cell.text_frame.paragraphs[0].add_run()
            pr.text = str(hd)
            pr.font.size = Pt(11)
            pr.font.bold = True
            pr.font.color.rgb = _rgb("FFFFFF")
        for i, f in enumerate(chunk, start=1):
            sev = f.get("severity", "info")
            vals = ([f.get("ref", ""), T.SEVERITY_LABEL.get(sev, sev),
                     _clip(f.get("affectedAsset", ""), 44),
                     _clip(f.get("remediation", ""), 140)]
                    if remediation else
                    [f.get("ref", ""), T.SEVERITY_LABEL.get(sev, sev),
                     _clip(f.get("title", ""), 80),
                     _clip(f.get("affectedAsset", ""), 44)])
            for j, v in enumerate(vals):
                cell = gt.cell(i, j)
                # add_run() tolera valor vazio (achado sem remediation/ref/ativo).
                r = cell.text_frame.paragraphs[0].add_run()
                r.text = str(v)
                r.font.size = Pt(10)
                r.font.color.rgb = _rgb(
                    T.SEVERITY_COLOR.get(sev, T.INK) if j == 1 else T.INK)
                if j == 1:
                    r.font.bold = True


def _bullets(prs, items, title):
    fl = _Flow(prs, title or "Itens")
    for it in items:
        fl.para("•  " + str(it), size=14, color=T.INK, after=0.09)


def _paragraph(prs, text, title):
    fl = _Flow(prs, title or "")
    fl.para(text, size=15, color=T.INK)


def _callout(prs, sec, title):
    slide, y = _title_slide(prs, title or "")
    col = T.CALLOUT_COLOR.get(sec.get("tone", "info"), T.PRIMARY)
    _rect(slide, ML, y, CW, Inches(1.2), T.SURFACE_ALT, line=T.BORDER)
    _rect(slide, ML, y, Emu(int(0.08 * EMU_IN)), Inches(1.2), col)
    _text(slide, ML + Inches(0.3), y + Inches(0.15), CW - Inches(0.5), Inches(0.9),
          _clip(sec.get("text", ""), 400), size=16, bold=True, color=col,
          anchor=MSO_ANCHOR.MIDDLE)


def _apply_brand(meta):
    brand = meta.get("brand") or {}
    if brand.get("primary"):
        T.PRIMARY = brand["primary"]
    if brand.get("accent"):
        T.CORAL = brand["accent"]
    if brand.get("wordmark"):
        T.WORDMARK = brand["wordmark"]


def render_pptx(model, out_path):
    prs = Presentation()
    prs.slide_width = SW
    prs.slide_height = SH
    meta = model.get("meta", {})
    _STATE["meta"] = meta
    _STATE["page"] = 0
    _apply_brand(meta)
    title = None
    for sec in model.get("sections", []):
        t = sec.get("type")
        if t == "cover":
            _cover(prs, sec, meta)
        elif t == "partDivider":
            _part_divider(prs, sec)
        elif t == "divider":
            _divider(prs, meta)
        elif t == "heading":
            title = sec.get("text")
        elif t == "statBand":
            _stat_band(prs, sec)
        elif t == "kpis":
            _kpis(prs, sec.get("kpis", {}))
        elif t == "severityChart":
            _severity_chart(prs, sec.get("data", {}))
        elif t == "riskMatrix":
            _risk_matrix(prs, sec.get("data", {}))
        elif t == "attackChain":
            _attack_chain(prs, sec)
        elif t == "findingCard":
            _finding_card(prs, sec)
        elif t == "findingsTable":
            _table(prs, sec.get("findings", []), title or "Sumário de Achados")
        elif t == "remediationMatrix":
            _table(prs, sec.get("findings", []), title or "Matriz de Remediação", remediation=True)
        elif t == "roadmap":
            _roadmap(prs, sec)
        elif t == "costVsIncident":
            _cost_incident(prs, sec)
        elif t == "partnerValue":
            _partner_value(prs, sec)
        elif t == "nextSteps":
            _next_steps(prs, sec)
        elif t == "bullets":
            _bullets(prs, sec.get("items", []), title)
        elif t == "paragraph":
            _paragraph(prs, sec.get("text", ""), title)
        elif t == "callout":
            _callout(prs, sec, title)
    prs.save(out_path)
