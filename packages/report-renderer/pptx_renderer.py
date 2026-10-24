"""Renderer PPTX (python-pptx) do ReportModel — estilo "dossie".

Casca de dossie: capa com codigo de documento + selo + faixa de KPIs, rodape
numerado (CONFIDENCIAL · docCode · NN), divisorias de PARTE. Marca configuravel
por MSSP (meta.brand sobrescreve a paleta/wordmark). Cada secao de conteudo
vira um slide."""

from pptx import Presentation
from pptx.util import Inches, Pt, Emu
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR, MSO_AUTO_SIZE
from pptx.enum.shapes import MSO_SHAPE
import os
import re

import theme as T
import logo

EMU_IN = 914400
# Retrato CARTA (8,5 x 11 pol) — estilo "documento", igual ao modelo netdeep.
SW = Inches(8.5)
SH = Inches(11.0)
ML = Inches(0.6)
CW = Inches(7.3)       # = SW - 2*ML

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


_EV_FILE_RE = re.compile(
    r'^\s*[\w.\-/]+\.(?:png|jpe?g|gif|webp|bmp|svg|tiff?)\s*(?:[—–:\-]\s*)?', re.I)
_STEP_NUM_RE = re.compile(r'^\s*\d{1,3}[.)\]]\s+')
_EVL_OUT = "334155"   # saída/terminal em cinza-ardósia (painel CLARO, não escuro)


def _clean_ev_label(label, toolname=None):
    """Rótulo de evidência legível ao cliente: remove o nome de ARQUIVO cru
    ('radar.png — ...'); se era só o nome do arquivo, retorna ''."""
    s = str(label or "").strip()
    if not s:
        return ""
    s2 = _EV_FILE_RE.sub("", s).strip()
    if not s2:
        return ""
    if toolname and s2 == str(toolname):
        return ""
    return s2


def _strip_step_num(s):
    """Remove numeração que o passo já traz ('1. ...'); o renderer renumera."""
    return _STEP_NUM_RE.sub("", str(s or "").strip())


# ───────────────────────────────────────────────────────────────────────────
# Motor de layout com paginação (WS2): PPTX não mede texto, então estimamos
# linhas por caixa e quebramos conteúdo longo em slides "(cont.)" — NUNCA
# truncamos corpo de achado/evidência. Unidades em EMU (int).
# ───────────────────────────────────────────────────────────────────────────
_CONTENT_BOTTOM = int(SH) - int(Inches(0.55))   # acima do rodapé
_LINE_FACTOR = 1.3                      # entrelinha aproximada

# Painel CLARO de evidência (espelha o DOCX/PDF): cada linha é um retângulo
# preenchido (SURFACE_ALT) encostado no próximo → o painel é a UNIÃO dos
# retângulos (contínuo, pagina por palavra, nunca estoura o slide); barra de
# acento PRIMARY à esquerda. Medir SEMPRE com a largura ÚTIL (descontado
# acento+respiros), nunca com CW — senão o texto quebra mais do que o medido e
# corta embaixo. Linhas ENCOSTAM (y += altura exata em EMU int, sem round-trip).
_PANEL_ACCENT_W = int(Inches(0.05))
_PANEL_GAP = int(Inches(0.12))     # vão entre o acento e o texto
_PANEL_PAD_R = int(Inches(0.14))   # respiro à direita
_PANEL_VPAD = int(Inches(0.04))    # respiro vertical DENTRO de cada linha


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


def _text_h(text, w_emu, pt, bold=False, font=T.FONT_BODY, pad_in=0.0):
    """Altura (EMU) que um texto ocupa numa caixa de largura w_emu, fonte pt.
    PPTX NÃO mede texto → subestimar gera sobreposição. cwf GENEROSO (cobre
    caracteres largos tipo W/M/w) + 12% de folga: a caixa nunca fica curta."""
    cwf = (0.70 if font == T.FONT_MONO else 0.64) + (0.05 if bold else 0.0)
    cpl = max(4, int((int(w_emu) / EMU_IN) * 72 / (pt * cwf)))
    n = max(1, len(_wrap(str(text or ""), cpl)))
    return int((n * pt * _LINE_FACTOR / 72.0 * 1.12 + pad_in) * EMU_IN)


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
        self.slide, y = _title_slide(self.prs, self.title + " (cont.)")
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
             indent=0.0, after=0.08, align=PP_ALIGN.JUSTIFY):
        left = int(ML) + int(Inches(indent))
        width = int(CW) - int(Inches(indent))
        # cwf conservador (em "em") só p/ DIMENSIONAR a caixa (superestimar =
        # folga). O texto vai INTEIRO com word_wrap=True → o PowerPoint quebra na
        # largura (NUNCA passa da margem) e JUSTIFICA. Paginamos por PALAVRA p/
        # não corromper token longo (juntar linhas quebraria uma URL no meio).
        cwf = (0.70 if font == T.FONT_MONO else 0.64) + (0.05 if bold else 0.0)
        cpl = max(8, int((width / EMU_IN) * 72 / (size * cwf)))
        lh = int(size * _LINE_FACTOR / 72.0 * EMU_IN)

        def _nl(s):
            return max(1, len(_wrap(s, cpl)))

        def _emit(s):
            n = _nl(s)
            self.ensure(n * lh)   # a caixa INTEIRA tem de caber (não só 1 linha)
            tb = self.slide.shapes.add_textbox(Emu(left), Emu(self.y),
                                               Emu(width), Emu(n * lh))
            tf = tb.text_frame
            tf.word_wrap = True
            try:
                tf.auto_size = MSO_AUTO_SIZE.NONE
            except Exception:
                pass
            p = tf.paragraphs[0]
            p.alignment = align if n > 1 else PP_ALIGN.LEFT
            r = p.add_run()
            r.text = s
            r.font.size = Pt(size)
            r.font.bold = bold
            r.font.name = font
            r.font.color.rgb = _rgb(color)
            self.y += n * lh

        for seg in str(text or "").split("\n"):
            if not seg.strip():
                self.y += lh // 2
                continue
            words = seg.split(" ")
            idx = 0
            while idx < len(words):
                self.ensure(lh)
                cap = max(1, (_CONTENT_BOTTOM - self.y) // lh)
                take = idx + 1
                while take < len(words) and \
                        _nl(" ".join(words[idx:take + 1])) <= cap:
                    take += 1
                _emit(" ".join(words[idx:take]))
                idx = take
        self.y += int(Inches(after))

    def image(self, path, caption=None):
        """Print EMOLDURADO (exibit): moldura branca c/ borda fina ATRÁS da
        imagem (desenhada antes → fica atrás) em vez de imagem solta "tímida" no
        branco; legenda '◆ <rótulo limpo>' (sem nome de arquivo cru). Escala à
        coluna e pagina. Retorna True se embutiu (alimenta o contador `rendered`
        que decide a nota neutra — NÃO mudar o contrato booleano)."""
        sz = _img_size(path)
        if not sz or not path or not os.path.exists(path):
            return False
        iw, ih = sz
        pad = int(Inches(0.08))
        maxw, maxh = int(CW) - 2 * pad, int(Inches(4.3))
        scale = min(maxw / iw, maxh / ih)
        w, h = int(iw * scale), int(ih * scale)
        fw, fh = w + 2 * pad, h + 2 * pad
        self.ensure(fh + int(Inches(0.1)))
        fx = int(ML) + (int(CW) - fw) // 2
        _rect(self.slide, Emu(fx), Emu(self.y), Emu(fw), Emu(fh),
              T.SURFACE, line=T.BORDER)
        try:
            self.slide.shapes.add_picture(path, Emu(fx + pad), Emu(self.y + pad),
                                          width=Emu(w), height=Emu(h))
        except Exception:
            return False
        self.y += fh + int(Inches(0.06))
        lbl = _clean_ev_label(caption)
        cap = "◆ " + (lbl or "Evidência visual")
        ch = _text_h(cap, int(CW), 10)      # para() força esq. em 1 linha → _text
        self.ensure(ch + int(Inches(0.06)))
        _text(self.slide, ML, Emu(self.y), CW, Emu(ch), cap, size=10,
              color=T.MUTED, align=PP_ALIGN.CENTER)
        self.y += ch + int(Inches(0.14))
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

    def panel_line(self, text, size=11, color=None, bold=False, font=None,
                   lead=None):
        """Uma linha do PAINEL CLARO de evidência: retângulo preenchido
        (SURFACE_ALT) contendo o texto, com barra de acento azul à esquerda.
        Linhas consecutivas ENCOSTAM (y += altura exata, EMU int) → o painel é a
        união dos retângulos. Pagina por PALAVRA e nunca deixa uma linha maior que
        o espaço restante (análogo do LayoutError do PDF — overflow silencioso).
        `lead` = (texto, cor, bold?) opcional, run destacado só na 1ª linha
        (ex. '$ ' verde) — espelha o DOCX."""
        color = T.INK if color is None else color
        font = font or T.FONT_BODY
        inset_l = _PANEL_ACCENT_W + _PANEL_GAP
        inner_w = int(CW) - inset_l - _PANEL_PAD_R   # largura ÚTIL do texto
        cwf = (0.70 if font == T.FONT_MONO else 0.64) + (0.05 if bold else 0.0)
        cpl = max(8, int((inner_w / EMU_IN) * 72 / (size * cwf)))
        lh = int(size * _LINE_FACTOR / 72.0 * EMU_IN)
        lead_txt = str(lead[0]) if lead else ""

        def _nl(s):
            return max(1, len(_wrap(s, cpl)))

        def _emit(s, with_lead):
            n = _nl((lead_txt + s) if with_lead else s)
            h = n * lh + 2 * _PANEL_VPAD          # EMU int → linhas encostam exato
            bg = self.slide.shapes.add_shape(
                MSO_SHAPE.RECTANGLE, ML, Emu(self.y), CW, Emu(h))
            bg.fill.solid()
            bg.fill.fore_color.rgb = _rgb(T.SURFACE_ALT)
            bg.line.fill.background()
            bg.shadow.inherit = False
            tf = bg.text_frame
            tf.word_wrap = True
            try:
                tf.auto_size = MSO_AUTO_SIZE.NONE
            except Exception:
                pass
            tf.margin_left = Emu(inset_l)        # texto passa do acento
            tf.margin_right = Emu(_PANEL_PAD_R)
            tf.margin_top = Emu(_PANEL_VPAD)
            tf.margin_bottom = Emu(_PANEL_VPAD)
            tf.vertical_anchor = MSO_ANCHOR.TOP
            p = tf.paragraphs[0]
            p.alignment = PP_ALIGN.LEFT
            if with_lead and lead_txt:
                lr = p.add_run()
                lr.text = lead_txt
                lr.font.size = Pt(size)
                lr.font.bold = (lead[2] if len(lead) > 2 else True)
                lr.font.name = font
                lr.font.color.rgb = _rgb(lead[1])
            r = p.add_run()
            r.text = s
            r.font.size = Pt(size)
            r.font.bold = bold
            r.font.name = font
            r.font.color.rgb = _rgb(color)
            ac = self.slide.shapes.add_shape(      # barra de acento (sobre a faixa
                MSO_SHAPE.RECTANGLE, ML, Emu(self.y),   # esquerda, à esq. do texto)
                Emu(_PANEL_ACCENT_W), Emu(h))
            ac.fill.solid()
            ac.fill.fore_color.rgb = _rgb(T.PRIMARY)
            ac.line.fill.background()
            ac.shadow.inherit = False
            self.y += h

        lead_used = False
        for seg in str(text or "").split("\n"):
            if not seg.strip():
                continue
            words = seg.split(" ")
            idx = 0
            while idx < len(words):
                self.ensure(lh + 2 * _PANEL_VPAD)       # garante ≥1 linha na página
                cap = max(1, (int(_CONTENT_BOTTOM) - self.y - 2 * _PANEL_VPAD) // lh)
                wl = bool(lead) and not lead_used
                take = idx + 1
                while take < len(words):
                    cand = " ".join(words[idx:take + 1])
                    if _nl((lead_txt + cand) if wl else cand) > cap:
                        break
                    take += 1
                _emit(" ".join(words[idx:take]), wl)
                if wl:
                    lead_used = True
                idx = take


def _footer(slide, dark=False):
    """Rodape numerado em todo slide de conteudo (cover nao chama)."""
    m = _STATE["meta"]
    _STATE["page"] += 1
    n = _STATE["page"]
    col = "8FA0BC" if dark else T.MUTED
    fy = SH - Inches(0.42)
    half = Emu(int(CW) // 2)
    _text(slide, ML, fy, half, Inches(0.3),
          m.get("classification", ""), size=8, color=col)
    _text(slide, Emu(int(ML) + int(CW) // 2), fy, half, Inches(0.3),
          f"{m.get('docCode', '')} · {n:02d}", size=8, color=col,
          align=PP_ALIGN.RIGHT)


def _title_slide(prs, title):
    slide = _blank(prs)
    _rect(slide, 0, 0, SW, Inches(0.12), T.PRIMARY)
    title = str(title or "")
    # Título longo encolhe (24→18pt). NÃO é truncado: a caixa cresce pelo nº de
    # linhas estimado (cpl conservador) e o traço coral + o conteúdo descem junto.
    # _text quebra o texto (word_wrap); a estimativa só dimensiona a altura
    # (superestimar = só folga; nunca corta).
    tsize = 24 if len(title) <= 56 else 18
    cpl = max(10, int((int(CW) / EMU_IN) * 72 / (tsize * 0.66)))
    nlines = max(1, len(_wrap(title, cpl)))
    box_h = max(0.68, nlines * (tsize * _LINE_FACTOR / 72.0) + 0.06)
    _text(slide, ML, Inches(0.33), CW, Inches(box_h), title, size=tsize, bold=True,
          color=T.INK, font=T.FONT_DISPLAY)
    accent_y = 0.33 + box_h + 0.07
    _rect(slide, ML, Inches(accent_y), Inches(1.2), Emu(int(0.045 * EMU_IN)),
          _accent())
    _footer(slide)
    return slide, Inches(accent_y + 0.30)


def _cover(prs, sec, meta):
    slide = _blank(prs)
    brand = meta.get("brand", {})
    accent = brand.get("accent") or T.CORAL
    # Capa full-bleed: arte da marca (coverImagePath) ao fundo; senão, navy sólido.
    cover = brand.get("coverImagePath")
    # Retrato: a arte default é PAISAGEM; esticada aqui, o traço coral dela brigava
    # com o nosso (as "duas barras"). Sem imagem de marca → navy sólido + nossos
    # elementos (traço único desenhado abaixo).
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
        _text(slide, ML, Inches(0.5), Inches(3.2), Inches(0.5),
              brand.get("wordmark", T.WORDMARK), size=20, bold=True,
              color=accent, font=T.FONT_DISPLAY)
    # Topo-dir: selo + codigo do documento (dentro da largura retrato).
    _text(slide, Inches(4.0), Inches(0.5), Inches(3.9), Inches(0.3),
          meta.get("classification", ""), size=10, bold=True, color=accent,
          align=PP_ALIGN.RIGHT)
    _text(slide, Inches(4.0), Inches(0.85), Inches(3.9), Inches(0.3),
          meta.get("docCode", ""), size=10, color="8FA0BC", align=PP_ALIGN.RIGHT)
    # Titulo (meio-superior da pagina retrato).
    _rect(slide, ML, Inches(4.3), Inches(1.4), Emu(int(0.06 * EMU_IN)), accent)
    _text(slide, ML, Inches(4.5), CW, Inches(0.35), meta.get("volume", ""),
          size=12, bold=True, color=accent)
    _text(slide, ML, Inches(4.95), CW, Inches(2.0), sec.get("title", ""),
          size=34, bold=True, color="FFFFFF", font=T.FONT_DISPLAY)
    if sec.get("subtitle"):
        _text(slide, ML, Inches(7.0), CW, Inches(0.8), sec["subtitle"], size=16,
              color="C9D3E6")
    # Faixa de KPIs em 2x2 (cabe na largura retrato).
    stats = sec.get("stats") or []
    if stats:
        gap = int(Inches(0.2))
        tw = (int(CW) - gap) // 2
        yv = int(Inches(7.9))
        for i, s in enumerate(stats[:4]):
            cx = int(ML) + (tw + gap) * (i % 2)
            cy = yv + int(Inches(1.25)) * (i // 2)
            _text(slide, Emu(cx), Emu(cy), Emu(tw), Inches(0.8),
                  str(s.get("value", "")), size=34, bold=True, color=accent,
                  font=T.FONT_DISPLAY)
            _text(slide, Emu(cx), Emu(cy + int(Inches(0.8))), Emu(tw), Inches(0.4),
                  str(s.get("label", "")), size=10, bold=True, color="8FA0BC")
    # Rodape da capa.
    _text(slide, ML, Inches(10.4), CW, Inches(0.4),
          f"{meta.get('client', '')}  ·  {_month_year(meta.get('generatedAt', 0))}  ·  {brand.get('name', '')}",
          size=12, color="C9D3E6")
    _STATE["page"] = 1


def _part_divider(prs, sec):
    slide = _blank(prs)
    _rect(slide, 0, 0, SW, SH, T.INK)
    accent = _accent()
    _rect(slide, ML, Inches(5.0), Inches(1.6), Emu(int(0.06 * EMU_IN)), accent)
    _text(slide, ML, Inches(4.35), CW, Inches(0.4), sec.get("part", ""),
          size=14, bold=True, color=accent)
    _text(slide, ML, Inches(5.2), CW, Inches(1.5), sec.get("title", ""),
          size=34, bold=True, color="FFFFFF", font=T.FONT_DISPLAY)
    if sec.get("subtitle"):
        _text(slide, ML, Inches(6.8), CW, Inches(0.8), sec["subtitle"],
              size=16, color="C9D3E6")
    _footer(slide, dark=True)


def _divider(prs, meta):
    slide = _blank(prs)
    _rect(slide, 0, 0, SW, SH, T.SURFACE_ALT)
    _rect(slide, ML, Inches(4.9), Inches(1.6), Emu(int(0.06 * EMU_IN)), _accent())
    _text(slide, ML, Inches(5.1), CW, Inches(0.6),
          meta.get("brand", {}).get("wordmark", T.WORDMARK), size=22,
          bold=True, color=T.PRIMARY, font=T.FONT_DISPLAY)
    _footer(slide)


def _agenda(prs, entries, meta):
    """Slide SUMÁRIO: partes (nível 0, negrito) + seções/fases (níveis 1-2,
    recuadas). entries = [(title, level)]. Duas colunas quando longo (evita
    overflow — ver histórico de estouro no PPTX)."""
    lines = [(str(t), lv) for (t, lv) in (entries or []) if t]
    if not lines:
        return
    slide = _blank(prs)
    _rect(slide, 0, 0, SW, Inches(0.12), T.PRIMARY)
    _text(slide, ML, Inches(0.5), CW, Inches(0.8), "SUMÁRIO", size=28, bold=True,
          color=T.INK, font=T.FONT_DISPLAY)
    # Retrato é alto → coluna única (cabe muito item na vertical).
    tb = slide.shapes.add_textbox(ML, Inches(1.55), CW, Inches(8.6))
    tf = tb.text_frame
    tf.word_wrap = True
    for i, (txt, lv) in enumerate(lines):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        p.space_after = Pt(4)
        p.level = min(lv, 2)
        r = p.add_run()
        r.text = txt
        r.font.size = Pt(14 if lv == 0 else 11)
        r.font.bold = (lv == 0)
        r.font.name = T.FONT_DISPLAY if lv == 0 else T.FONT_BODY
        r.font.color.rgb = _rgb(T.INK if lv <= 1 else T.MUTED)
    _footer(slide)


def _stat_band(prs, sec):
    slide = _blank(prs)
    _rect(slide, 0, 0, SW, Inches(0.12), T.PRIMARY)
    y = Inches(0.5)
    if sec.get("headline"):
        hh = _text_h(sec["headline"], int(CW), 24, bold=True,
                     font=T.FONT_DISPLAY, pad_in=0.12)
        _text(slide, ML, y, CW, Emu(hh), sec["headline"],
              size=24, bold=True, color=T.INK, font=T.FONT_DISPLAY)
        y = int(y) + hh + int(Inches(0.25))
    stats = sec.get("stats") or []
    y = int(y)
    if stats:
        gap = int(Inches(0.13))
        tw = (int(CW) - gap) // 2
        bh = int(Inches(1.6))
        for i, s in enumerate(stats[:4]):
            cx = int(ML) + (tw + gap) * (i % 2)
            cy = y + (bh + gap) * (i // 2)
            _rect(slide, Emu(cx), Emu(cy), Emu(tw), Emu(bh), T.SURFACE_ALT,
                  line=T.BORDER)
            _rect(slide, Emu(cx), Emu(cy), Emu(int(0.06 * EMU_IN)), Emu(bh),
                  _accent())
            _text(slide, Emu(cx + int(Inches(0.2))), Emu(cy + int(Inches(0.2))),
                  Emu(tw - int(Inches(0.3))), Inches(0.85),
                  str(s.get("value", "")), size=40, bold=True, color=T.PRIMARY,
                  font=T.FONT_DISPLAY)
            _text(slide, Emu(cx + int(Inches(0.2))), Emu(cy + int(Inches(1.1))),
                  Emu(tw - int(Inches(0.3))), Inches(0.4),
                  str(s.get("label", "")), size=10, bold=True, color=T.MUTED)
        rows = (min(len(stats), 4) + 1) // 2
        y = y + rows * (bh + gap) + int(Inches(0.2))
    if sec.get("body"):
        _text(slide, ML, Emu(y), CW, Inches(2.4), _clip(sec["body"], 2000),
              size=14, color=T.INK, align=PP_ALIGN.JUSTIFY)
    _footer(slide)


def _attack_chain(prs, sec):
    # Diagrama que CRESCE e pagina (sem corte, sem cap): título da raia quebra
    # inteiro; passos quebram em LINHAS de ~5 caixas (nunca saem do slide); cada
    # caixa cresce p/ o texto; _Flow abre "(cont.)" quando enche.
    fl = _Flow(prs, "Cadeia de Ataque")
    box_w = int(Inches(2.0))
    arrow_w = int(Inches(0.35))
    stepw = box_w + arrow_w
    per_row = max(1, int(CW) // stepw)
    inner = box_w - int(Inches(0.2))
    for lane in (sec.get("lanes") or []):
        th = _text_h(lane.get("title", ""), int(CW), 12, bold=True, pad_in=0.06)
        fl.ensure(th + int(Inches(0.6)))
        _text(fl.slide, ML, Emu(fl.y), CW, Emu(th), lane.get("title", ""),
              size=12, bold=True, color=T.INK)
        fl.y += th + int(Inches(0.08))
        steps = lane.get("steps") or []
        for r0 in range(0, len(steps), per_row):
            rowsteps = steps[r0:r0 + per_row]
            hs = []
            for st in rowsteps:
                lh = _text_h(st.get("label", ""), inner, 11, bold=True)
                dh = _text_h(st.get("detail", ""), inner, 8) if st.get("detail") else 0
                hs.append(lh + dh + int(Inches(0.2)))
            rowh = max(hs) if hs else int(Inches(0.5))
            fl.ensure(rowh + int(Inches(0.12)))
            by = fl.y
            for si, st in enumerate(rowsteps):
                x = int(ML) + stepw * si
                _rect(fl.slide, Emu(x), Emu(by), Emu(box_w), Emu(rowh),
                      T.SURFACE_ALT, line=T.BORDER)
                _rect(fl.slide, Emu(x), Emu(by), Emu(box_w),
                      Emu(int(0.05 * EMU_IN)), T.PRIMARY)
                lh = _text_h(st.get("label", ""), inner, 11, bold=True)
                _text(fl.slide, Emu(x + int(Inches(0.1))),
                      Emu(by + int(Inches(0.1))), Emu(inner), Emu(lh),
                      st.get("label", ""), size=11, bold=True, color=T.PRIMARY)
                if st.get("detail"):
                    _text(fl.slide, Emu(x + int(Inches(0.1))),
                          Emu(by + int(Inches(0.1)) + lh), Emu(inner),
                          Emu(max(int(Inches(0.2)), rowh - lh - int(Inches(0.2)))),
                          st.get("detail", ""), size=8, color=T.MUTED)
                last_overall = (r0 + si == len(steps) - 1)
                if si < len(rowsteps) - 1 and not last_overall:
                    _text(fl.slide, Emu(x + box_w),
                          Emu(by + rowh // 2 - int(Inches(0.2))),
                          Emu(arrow_w), Emu(int(Inches(0.4))), "→",
                          size=18, bold=True, color=_accent(),
                          align=PP_ALIGN.CENTER)
            fl.y += rowh + int(Inches(0.12))
        fl.y += int(Inches(0.2))


def _roadmap(prs, sec):
    # Retrato: fases EMPILHADAS em largura total (não colunas estreitas). As
    # colunas de 1,7" achatavam o rótulo da fase e, numa ação longa (remediação
    # multipasso real), estouravam o slide — uma tabela/coluna não pagina UMA
    # linha alta. Agora cada fase = faixa de cabeçalho + ações em bullets fluídos
    # via _Flow, que pagina sozinho (orçamento derivado do cursor real, limitado
    # por _CONTENT_BOTTOM) → nada cortado, nada achatado, sem estouro.
    phases = sec.get("phases") or []
    fl = _Flow(prs, "Plano de Remediação por Fase")
    for ph in phases:
        window = str(ph.get("window", "")).strip()
        label = str(ph.get("label", "")).strip()
        header = window + ("  —  " + label if (window and label) else label)
        # Cabeçalho da fase + início da 1ª ação cabem juntos (sem título órfão).
        fl.ensure(Inches(1.1))
        _rect(fl.slide, ML, Emu(fl.y), CW, Inches(0.5), T.PRIMARY)
        _text(fl.slide, ML + Inches(0.15), Emu(fl.y), CW - Inches(0.3),
              Inches(0.5), header, size=12, bold=True, color="FFFFFF",
              anchor=MSO_ANCHOR.MIDDLE)
        fl.y += int(Inches(0.6))
        acts = ph.get("actions") or []
        if not acts:
            fl.para("—", size=11, color=T.MUTED, after=0.12)
        for a in acts:
            fl.para("▸  " + str(a), size=11, color=T.INK, after=0.1)
        fl.space(Inches(0.12))


def _cost_incident(prs, sec):
    # 2 colunas (remediação × incidente) que crescem e paginam por LINHA —
    # texto inteiro, sem cap/clip, sem estouro.
    gap = int(Inches(0.33))
    colw = (int(CW) - gap) // 2
    head_h = int(Inches(0.75))
    pad = int(Inches(0.2))
    iw = colw - int(Inches(0.4))
    mlx = int(ML)
    x2 = mlx + colw + gap
    rem = sec.get("remediation") or []
    inc = sec.get("incident") or []

    def _ih(it):
        h = _text_h("◆ " + str(it.get("label", "")), iw, 12, bold=True, pad_in=0.04)
        if it.get("detail"):
            h += _text_h(str(it.get("detail", "")), colw - int(Inches(0.6)), 10,
                         pad_in=0.08)
        return h + int(Inches(0.06))
    maxrows = max(len(rem), len(inc))
    rowh = [max(_text_h("◆ " + str(rem[i]), iw, 11, pad_in=0.08) if i < len(rem) else 0,
                _ih(inc[i]) if i < len(inc) else 0,
                int(Inches(0.3))) for i in range(maxrows)]
    avail = int(_CONTENT_BOTTOM) - int(Inches(1.5)) - head_h
    chunks, cur, acc = [], [], 0
    for i in range(maxrows):
        if cur and acc + rowh[i] > avail:
            chunks.append(cur)
            cur, acc = [], 0
        cur.append(i)
        acc += rowh[i]
    if cur:
        chunks.append(cur)
    if not chunks:
        chunks = [[]]
    for ci, rows in enumerate(chunks):
        slide, y = _title_slide(
            prs, "Custo da Remediação × Custo do Incidente"
            + (" (cont.)" if ci else ""))
        y = int(y)
        colh = head_h + sum(rowh[i] for i in rows) + int(Inches(0.1))
        _rect(slide, Emu(mlx), Emu(y), Emu(colw), Emu(colh), T.SURFACE_ALT,
              line=T.BORDER)
        _rect(slide, Emu(mlx), Emu(y), Emu(colw), Emu(int(Inches(0.55))), T.SUCCESS)
        _text(slide, Emu(mlx + pad), Emu(y + int(Inches(0.1))),
              Emu(colw - int(Inches(0.3))), Emu(int(Inches(0.35))),
              "REMEDIAÇÃO — INVESTIMENTO", size=12, bold=True, color="FFFFFF")
        _rect(slide, Emu(x2), Emu(y), Emu(colw), Emu(colh), T.SURFACE_ALT,
              line=T.BORDER)
        _rect(slide, Emu(x2), Emu(y), Emu(colw), Emu(int(Inches(0.55))),
              T.DESTRUCTIVE)
        _text(slide, Emu(x2 + pad), Emu(y + int(Inches(0.1))),
              Emu(colw - int(Inches(0.3))), Emu(int(Inches(0.35))),
              "INCIDENTE NÃO REMEDIADO — RISCO", size=12, bold=True, color="FFFFFF")
        yr = y + head_h
        yi = y + head_h
        for i in rows:
            if i < len(rem):
                _text(slide, Emu(mlx + pad), Emu(yr), Emu(iw), Emu(rowh[i]),
                      "◆ " + str(rem[i]), size=11, color=T.INK)
            yr += rowh[i]
            if i < len(inc):
                it = inc[i]
                lh = _text_h("◆ " + str(it.get("label", "")), iw, 12, bold=True,
                             pad_in=0.04)
                _text(slide, Emu(x2 + pad), Emu(yi), Emu(iw), Emu(lh),
                      "◆ " + str(it.get("label", "")), size=12, bold=True,
                      color=T.DESTRUCTIVE)
                if it.get("detail"):
                    _text(slide, Emu(x2 + int(Inches(0.45))), Emu(yi + lh),
                          Emu(colw - int(Inches(0.6))),
                          Emu(max(int(Inches(0.2)), rowh[i] - lh)),
                          str(it.get("detail", "")), size=10, color=T.MUTED)
            yi += rowh[i]


def _partner_value(prs, sec):
    slide, y = _title_slide(prs, sec.get("title", "Parceria"))
    pts = sec.get("points") or []
    gapx = int(Inches(0.33))
    gapy = int(Inches(0.3))
    cw = (int(CW) - gapx) // 2
    ch = int(Inches(2.2))
    y = int(y)
    for i, p in enumerate(pts[:4]):
        x = int(ML) + (cw + gapx) * (i % 2)
        yy = y + (ch + gapy) * (i // 2)
        _rect(slide, Emu(x), Emu(yy), Emu(cw), Emu(ch), T.SURFACE_ALT,
              line=T.BORDER)
        _rect(slide, Emu(x), Emu(yy), Emu(int(0.06 * EMU_IN)), Emu(ch), _accent())
        _text(slide, Emu(x + int(Inches(0.25))), Emu(yy + int(Inches(0.15))),
              Emu(cw - int(Inches(0.4))), Inches(0.4), p.get("title", ""),
              size=15, bold=True, color=T.PRIMARY, font=T.FONT_DISPLAY)
        _text(slide, Emu(x + int(Inches(0.25))), Emu(yy + int(Inches(0.6))),
              Emu(cw - int(Inches(0.4))), Inches(1.5), p.get("body", ""),
              size=11, color=T.INK)


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
              Inches(0.5), s, size=15, color=T.INK, anchor=MSO_ANCHOR.MIDDLE)
        yy += Inches(0.75)
    brand = _STATE["meta"].get("brand", {})
    contact = " · ".join(
        [x for x in [brand.get("name", ""), brand.get("contact", ""),
                     brand.get("tagline", "")] if x])
    _text(slide, ML, Inches(10.0), CW, Inches(0.4), contact, size=11,
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
    gap = int(Inches(0.13))
    tw = (int(CW) - gap) // 2
    bh = int(Inches(1.7))
    y = int(y)
    for i, (label, val, col) in enumerate(tiles):
        cx = int(ML) + (tw + gap) * (i % 2)
        cy = y + (bh + gap) * (i // 2)
        _rect(slide, Emu(cx), Emu(cy), Emu(tw), Emu(bh), T.SURFACE_ALT,
              line=T.BORDER)
        _rect(slide, Emu(cx), Emu(cy), Emu(int(0.06 * EMU_IN)), Emu(bh), col)
        _text(slide, Emu(cx + int(Inches(0.2))), Emu(cy + int(Inches(0.2))),
              Emu(tw - int(Inches(0.3))), Inches(0.4), label.upper(), size=10,
              bold=True, color=T.MUTED)
        _text(slide, Emu(cx + int(Inches(0.2))), Emu(cy + int(Inches(0.6))),
              Emu(tw - int(Inches(0.3))), Inches(0.9), val, size=40, bold=True,
              color=col, font=T.FONT_DISPLAY)


def _severity_chart(prs, data):
    slide, y = _title_slide(prs, "Distribuição por severidade")
    dist = data.get("severityDistribution", [])
    maxc = max([d.get("count", 0) for d in dist] + [1])
    barmax = Inches(4.0)
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
    fl = _Flow(prs, f.get("title") or "Achado")
    # Faixa de severidade — CRESCE p/ caber ref + ativo longo (quebra em 2-3
    # linhas) sem espremer nem cortar a última linha. Altura estimada (mín 0,5").
    band = (f"{T.SEVERITY_LABEL.get(sev, sev).upper()}  ·  {f.get('ref','')}"
            f"  ·  {f.get('affectedAsset','')}")
    bh = max(int(Inches(0.5)),
             _text_h(band, int(CW) - int(Inches(0.3)), 13, bold=True, pad_in=0.16))
    fl.ensure(bh + int(Inches(0.12)))
    _rect(fl.slide, ML, Emu(fl.y), CW, Emu(bh), T.SEVERITY_COLOR.get(sev, T.MUTED))
    _text(fl.slide, ML + Inches(0.15), Emu(fl.y), CW - Inches(0.3), Emu(bh),
          band, size=13, bold=True, color="FFFFFF", anchor=MSO_ANCHOR.MIDDLE)
    fl.y += bh + int(Inches(0.16))
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
            fl.para(f"{i}. {_strip_step_num(s)}", size=11, color=T.INK,
                    indent=0.1, after=0.04)
        if len(_steps) > 6:
            fl.para(
                f"(+{len(_steps) - 6} passos — detalhe completo no relatório técnico DOCX/PDF)",
                size=10, color=T.MUTED, indent=0.1, after=0.04)
    if sec.get("showPoc"):
        _evidence_flow(fl, f)


def _evidence_flow(fl, f):
    """Cadeia de evidência + prints INLINE no fluxo do achado (sem cap). NÃO
    anuncia "sem screenshot" quando o achado já tem prova textual (comando/saída)
    — isso seria falso e passaria impressão de evidência perdida. Aviso neutro só
    p/ achado de fato não-verificável (sem cadeia E sem imagem)."""
    ev = sorted(
        f.get("evidence") or [],
        key=lambda e: e.get("stepIndex") if e.get("stepIndex") is not None else 1_000_000,
    )
    chain = [e for e in ev
             if e.get("snippet") or e.get("command") or e.get("resultSummary")]
    imgs = [e for e in ev if e.get("imagePath")]
    if chain:
        # PAINEL CLARO (espelha DOCX/PDF): cabeçalho + passos sobre fundo tingido
        # com barra de acento azul, em vez de texto solto no branco. Rótulo sem
        # nome de arquivo cru; '$' e '→ prova' destacados em verde.
        fl.panel_line("CADEIA DE EVIDÊNCIA", size=11, color=T.PRIMARY, bold=True)
        for i, e in enumerate(chain[:6], 1):
            n = e.get("stepIndex") or i
            head = f"{n}."
            if e.get("toolName"):
                head += f"  [{e['toolName']}]"
            lbl = _clean_ev_label(e.get("label"), e.get("toolName"))
            if lbl:
                head += f"  {lbl}"
            fl.panel_line(head, size=11, color=T.PRIMARY, bold=True)
            if e.get("command"):
                fl.panel_line(str(e["command"]), size=9, color=T.INK,
                              font=T.FONT_MONO, lead=("$ ", T.SUCCESS, True))
            if e.get("snippet"):
                fl.panel_line(str(e["snippet"]), size=9, color=_EVL_OUT,
                              font=T.FONT_MONO)
            if e.get("resultSummary"):
                fl.panel_line(str(e["resultSummary"]), size=10, color=T.INK,
                              lead=("→ prova: ", T.SUCCESS, True))
        if len(chain) > 6:
            fl.panel_line(
                f"(+{len(chain) - 6} passos de evidência — cadeia completa no "
                "relatório técnico DOCX/PDF)", size=10, color=T.MUTED)
        fl.space(int(Inches(0.16)))
    rendered = 0
    # Só anuncia imagem que REALMENTE existe no pacote (arquivo no disco). Chave
    # S3 não baixada / print ainda não enviado (relatório defasado) => cai fora
    # SEM aviso; a cadeia textual sustenta o achado.
    existing = [e for e in imgs
                if e.get("imagePath") and os.path.exists(e.get("imagePath"))]
    if existing:
        fl.heading("EVIDÊNCIA VISUAL", size=11)
        for e in existing[:4]:
            if fl.image(e.get("imagePath"), e.get("label")):
                rendered += 1
        if len(existing) > 4:
            fl.para(
                f"(+{len(existing) - 4} imagens — veja o relatório técnico completo)",
                size=10, color=T.MUTED, after=0.08)
    # Aviso APENAS p/ achado de fato NÃO-verificável: sem imagem renderizada E
    # sem cadeia técnica. Dizer "não capturada" sob um achado com prova textual
    # seria FALSO. O estado "capturada porém indisponível" é sinal INTERNO (fica
    # no chip da tela de achados) — nunca vai ao cliente neste relatório.
    if rendered == 0 and not chain and f.get("severity") in ("critical", "high"):
        fl.placeholder("Evidência complementar não anexada a este achado.",
                       tone=T.MUTED)


def _table(prs, findings, title, remediation=False):
    # Célula NUNCA truncada (regra do dossiê): título/ativo/remediação quebram em
    # várias linhas → a linha fica mais alta → paginamos por ALTURA acumulada (não
    # por contagem fixa de linhas), senão o conteúdo quebrado estouraria o slide.
    if remediation:
        headers = ["Ref", "Sev", "Ativo", "Remediacao"]
        widths = [Inches(0.75), Inches(0.9), Inches(1.9), Inches(3.75)]
    else:
        headers = ["Ref", "Sev", "Titulo", "Ativo"]
        widths = [Inches(0.75), Inches(0.9), Inches(3.25), Inches(2.4)]
    CELL_PT = 10
    line_in = CELL_PT * _LINE_FACTOR / 72.0

    def _vals(f):
        sev = f.get("severity", "info")
        if remediation:
            return [f.get("ref", ""), T.SEVERITY_LABEL.get(sev, sev),
                    f.get("affectedAsset", ""), f.get("remediation", "")]
        return [f.get("ref", ""), T.SEVERITY_LABEL.get(sev, sev),
                f.get("title", ""), f.get("affectedAsset", "")]

    def _row_h(vals):
        n = 1
        for j, w in enumerate(widths):
            cpl = max(6, int((int(w) / EMU_IN) * 72 / (CELL_PT * 0.64)))
            n = max(n, len(_wrap(str(vals[j]), cpl)))
        return n * line_in + 0.14   # + margens verticais da célula

    header_h = line_in + 0.16
    avail = int(_CONTENT_BOTTOM) / EMU_IN - 2.0 - header_h   # título + folga margens
    chunks, cur, acc = [], [], 0.0
    for f in findings:
        h = _row_h(_vals(f))
        if cur and acc + h > avail:
            chunks.append(cur)
            cur, acc = [], 0.0
        cur.append(f)
        acc += h
    if cur:
        chunks.append(cur)
    if not chunks:
        chunks = [[]]
    for ci, chunk in enumerate(chunks):
        slide, y = _title_slide(prs, title if ci == 0 else title + " (cont.)")
        rows = len(chunk) + 1
        heights = [header_h] + [_row_h(_vals(f)) for f in chunk]
        gt = slide.shapes.add_table(
            rows, len(headers), ML, y, CW,
            Emu(int(sum(heights) * EMU_IN))).table
        for j, hd in enumerate(headers):
            gt.columns[j].width = widths[j]
            cell = gt.cell(0, j)
            cell.margin_top = Pt(1)
            cell.margin_bottom = Pt(1)
            cell.margin_left = Pt(4)
            cell.margin_right = Pt(4)
            cell.fill.solid()
            cell.fill.fore_color.rgb = _rgb(T.PRIMARY)
            # add_run() sempre cria um run — ao contrário de `cell.text = ""`,
            # que deixa o parágrafo SEM run e faz runs[0] estourar IndexError.
            pr = cell.text_frame.paragraphs[0].add_run()
            pr.text = str(hd)
            pr.font.size = Pt(11)
            pr.font.bold = True
            pr.font.color.rgb = _rgb("FFFFFF")
        gt.rows[0].height = Emu(int(header_h * EMU_IN))
        for i, f in enumerate(chunk, start=1):
            sev = f.get("severity", "info")
            gt.rows[i].height = Emu(int(heights[i] * EMU_IN))
            for j, v in enumerate(_vals(f)):
                cell = gt.cell(i, j)
                cell.margin_top = Pt(1)
                cell.margin_bottom = Pt(1)
                cell.margin_left = Pt(4)
                cell.margin_right = Pt(4)
                cell.text_frame.word_wrap = True   # célula quebra, não corta
                r = cell.text_frame.paragraphs[0].add_run()
                r.text = str(v)
                r.font.size = Pt(CELL_PT)
                r.font.color.rgb = _rgb(
                    T.SEVERITY_COLOR.get(sev, T.INK) if j == 1 else T.INK)
                if j == 1:
                    r.font.bold = True


def _remediation_matrix(prs, findings, title):
    # Lista FLUÍDA (não tabela): remediação pode ser longa e a tabela do PPTX não
    # pagina uma linha (estouraria o slide). Cada achado = cabeçalho Ref·Sev·Ativo
    # + remediação inteira justificada, paginando normalmente.
    fl = _Flow(prs, title or "Matriz de Remediação")
    for f in findings:
        sev = f.get("severity", "info")
        head = (f"{f.get('ref','')}  ·  "
                f"{T.SEVERITY_LABEL.get(sev, sev).upper()}  ·  "
                f"{f.get('affectedAsset','')}")
        fl.para(head, size=11, bold=True,
                color=T.SEVERITY_COLOR.get(sev, T.PRIMARY), after=0.02,
                align=PP_ALIGN.LEFT)
        rem = (f.get("remediation") or "").strip()
        fl.para(rem if rem else "—", size=11, color=T.INK, after=0.18)


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
          sec.get("text", ""), size=16, bold=True, color=col,
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
    _agenda_entries = []
    for s in model.get("sections", []):
        _st = s.get("type")
        if _st == "partDivider":
            _agenda_entries.append((s.get("title", ""), 0))
        elif _st == "heading" and s.get("level", 1) in (1, 2):
            _agenda_entries.append((s.get("text", ""), s.get("level", 1)))
    for sec in model.get("sections", []):
        t = sec.get("type")
        if t == "cover":
            _cover(prs, sec, meta)
            _agenda(prs, _agenda_entries, meta)
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
            _remediation_matrix(prs, sec.get("findings", []),
                                title or "Matriz de Remediação")
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
