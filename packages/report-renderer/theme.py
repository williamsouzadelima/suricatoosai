"""Tokens de marca do relatorio (espelham lib/reports/theme.ts / app globals.css).

Hex SEM '#'. Fontes: usa-se Calibri (presente em Word/PowerPoint) para body e
titulos por seguranca de renderizacao no cliente; a marca vem sobretudo da
PALETA (azul/coral) e do layout. A tipografia da marca e IBM Plex (OFL),
embutida nos .ttf em fonts/ (ver FONT_* e font_path() abaixo).
"""

import os

PRIMARY = "2456E6"
CORAL = "FF7678"
INK = "0E1B2E"
MUTED = "5B6B84"
SURFACE = "FFFFFF"
SURFACE_ALT = "F4F7FC"
BORDER = "E2E8F5"
SUCCESS = "12996B"
WARNING = "C9820B"
DESTRUCTIVE = "DA2C3C"

# Bloco de evidencia estilo "terminal" (modelo-ouro SYN): fundo navy escuro +
# texto MONO colorido (cores claras p/ contraste no escuro).
EV_BG = "0B1424"   # fundo do bloco (navy quase preto)
EV_CMD = "9FE2FF"  # comando / request (ciano)
EV_OK = "5FD69A"   # resultado OK / prova (verde)
EV_CRIT = "FFD27A"  # valor critico / dado sensivel (ambar)
EV_OUT = "D6E2F0"  # output neutro
EV_META = "7C93A8"  # comentario / metadado (cabecalho do passo)

CHART = ["2456E6", "3F6EF0", "6F9BF5", "12996B", "C9820B"]

SEVERITY_COLOR = {
    "critical": "DA2C3C",
    "high": "E8590C",
    "medium": "C9820B",
    "low": "2456E6",
    "info": "5B6B84",
}
SEVERITY_LABEL = {
    "critical": "Critico",
    "high": "Alto",
    "medium": "Medio",
    "low": "Baixo",
    "info": "Informativo",
}
SEVERITY_ORDER = ["critical", "high", "medium", "low", "info"]

CALLOUT_COLOR = {
    "info": PRIMARY,
    "warning": WARNING,
    "critical": DESTRUCTIVE,
    "success": SUCCESS,
}

# Tipografia da marca: IBM Plex (OFL). O PDF (reportlab) EMBUTE os glifos dos
# .ttf em fonts/; DOCX/PPTX referenciam o NOME da familia (o embed real no
# pacote OOXML e follow-up, com validacao via Office/COM). Sem os .ttf
# presentes, os renderers caem para Calibri/Helvetica.
FONT_DISPLAY = "IBM Plex Sans"
FONT_BODY = "IBM Plex Sans"
FONT_MONO = "IBM Plex Mono"

_FONT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fonts")
_FONT_FILES = {
    ("IBM Plex Sans", "normal"): "IBMPlexSans-Regular.ttf",
    ("IBM Plex Sans", "bold"): "IBMPlexSans-Bold.ttf",
    ("IBM Plex Mono", "normal"): "IBMPlexMono-Regular.ttf",
}


def font_path(family, variant="normal"):
    """Caminho absoluto do .ttf (ou None se ausente). Resolve tanto no sandbox
    E2B (fonts/ ao lado dos .py) quanto nos testes locais."""
    fn = _FONT_FILES.get((family, variant))
    if not fn:
        return None
    p = os.path.join(_FONT_DIR, fn)
    return p if os.path.exists(p) else None

WORDMARK = "Suricatoos"


def cover_fit(src, tw, th):
    """Crop-to-fill: recorta a imagem (centro) ao aspecto tw:th, preenchendo o
    alvo SEM distorcer. Retorna um .png temporário; em falha, devolve `src`.
    Usado pela capa dos 3 renderers (antes esticavam a arte → distorção/estouro)."""
    try:
        from PIL import Image
        import tempfile
        im = Image.open(src).convert("RGB")
        iw, ih = im.size
        ta = float(tw) / float(th)
        ia = (iw / ih) if ih else ta
        if ia > ta:  # imagem mais larga → corta laterais
            nw = max(1, int(round(ih * ta)))
            x = (iw - nw) // 2
            im = im.crop((x, 0, x + nw, ih))
        elif ia < ta:  # imagem mais alta → corta topo/base
            nh = max(1, int(round(iw / ta)))
            y = (ih - nh) // 2
            im = im.crop((0, y, iw, y + nh))
        fd, out = tempfile.mkstemp(suffix=".png")
        os.close(fd)
        im.save(out, "PNG")
        return out
    except Exception:
        return src


def default_cover_bg():
    """Fundo navy PADRÃO da capa quando a marca NÃO tem arte própria — padrão-ouro
    SYN. Em vez de uma capa clara, a capa nasce navy: navy sólido (INK) + faixa
    fina azul (PRIMARY) no topo + traço coral (CORAL). Retrato ~US Letter (0.773),
    cacheado no tempdir; regenerado a cada chamada p/ refletir overrides de marca.
    Retorna o caminho do PNG; o chamador o trata como `coverImagePath` (full-bleed,
    título/logo/KPIs em branco)."""
    import tempfile
    from PIL import Image, ImageDraw

    def _t(h):
        return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16))

    out = os.path.join(tempfile.gettempdir(), "suricatoos_cover_default_navy.png")
    W, H = 1700, 2200
    img = Image.new("RGB", (W, H), _t(INK))
    d = ImageDraw.Draw(img)
    # Faixa fina azul no topo (sem texto por cima) — unico acento no fundo.
    # (Sem traco coral fixo no meio: a posicao do texto varia por renderer e o
    # traco cruzaria o titulo/classificacao em alguns; o acento coral ja vem da
    # linha de classificacao, que e CORAL.)
    d.rectangle([0, 0, W, 24], fill=_t(PRIMARY))
    img.save(out, "PNG")
    return out
