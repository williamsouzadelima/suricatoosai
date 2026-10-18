"""Gera sources.ts a partir dos .py deste diretorio.

O job do trigger escreve esses .py num sandbox E2B em runtime (evita rebuild de
template), lendo-os de RENDERER_SOURCES. Regenerar sempre que um .py mudar:

    python gen_sources.py
"""

import base64
import json
import os
import glob

HERE = os.path.dirname(os.path.abspath(__file__))
SKIP = {"gen_sources.py"}


def main():
    files = sorted(glob.glob(os.path.join(HERE, "*.py")))
    files = [f for f in files if os.path.basename(f) not in SKIP]
    parts = []
    for f in files:
        name = os.path.basename(f)
        with open(f, encoding="utf-8") as fh:
            src = fh.read()
        parts.append(f"  {json.dumps(name)}: {json.dumps(src)},")
    out = (
        "// GERADO por packages/report-renderer/gen_sources.py (não editar à mão).\n"
        "// Fonte do renderer Python embutido como strings para o job do trigger\n"
        "// escrever num sandbox E2B em runtime (evita rebuild de template).\n"
        "// Regenerar: python gen_sources.py\n\n"
        "export const RENDERER_SOURCES: Record<string, string> = {\n"
        + "\n".join(parts)
        + "\n};\n"
    )
    with open(os.path.join(HERE, "sources.ts"), "w", encoding="utf-8") as fh:
        fh.write(out)
    print(f"sources.ts: {len(files)} arquivos -> {len(out)} bytes")
    for f in files:
        print("  •", os.path.basename(f))
    _gen_fonts()


def _gen_fonts():
    """Gera fonts.ts: os .ttf de fonts/ em base64, que o job do trigger escreve
    no sandbox E2B (${base}/fonts/) para o renderer PDF embutir (IBM Plex)."""
    ttfs = sorted(glob.glob(os.path.join(HERE, "fonts", "*.ttf")))
    parts = []
    for f in ttfs:
        name = os.path.basename(f)
        with open(f, "rb") as fh:
            b64 = base64.b64encode(fh.read()).decode("ascii")
        parts.append(f"  {json.dumps(name)}: {json.dumps(b64)},")
    out = (
        "// GERADO por packages/report-renderer/gen_sources.py (nao editar a mao).\n"
        "// Fontes IBM Plex (OFL) em base64; o job do trigger as escreve no\n"
        "// sandbox E2B (${base}/fonts/) p/ o renderer PDF embutir os glifos.\n"
        "// Esta em .prettierignore (blob grande). Regenerar: python gen_sources.py\n\n"
        "export const RENDERER_FONTS: Record<string, string> = {\n"
        + "\n".join(parts)
        + "\n};\n"
    )
    with open(os.path.join(HERE, "fonts.ts"), "w", encoding="utf-8") as fh:
        fh.write(out)
    print(f"fonts.ts: {len(ttfs)} fontes -> {len(out)} bytes")
    for f in ttfs:
        print("  •", os.path.basename(f))


if __name__ == "__main__":
    main()
