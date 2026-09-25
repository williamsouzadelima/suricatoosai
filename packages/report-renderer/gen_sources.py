"""Gera sources.ts a partir dos .py deste diretorio.

O job do trigger escreve esses .py num sandbox E2B em runtime (evita rebuild de
template), lendo-os de RENDERER_SOURCES. Regenerar sempre que um .py mudar:

    python gen_sources.py
"""

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


if __name__ == "__main__":
    main()
