"""Tokens de marca do relatorio (espelham lib/reports/theme.ts / app globals.css).

Hex SEM '#'. Fontes: usa-se Calibri (presente em Word/PowerPoint) para body e
titulos por seguranca de renderizacao no cliente; a marca vem sobretudo da
PALETA (azul/coral) e do layout. Fontes proprias (Archivo/Geist) podem ser
embutidas depois.
"""

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

FONT_DISPLAY = "Calibri"
FONT_BODY = "Calibri"

WORDMARK = "Suricatoos"
