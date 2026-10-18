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
