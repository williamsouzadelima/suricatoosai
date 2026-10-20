"""Embute as fontes IBM Plex (TrueType) no pacote OOXML do DOCX — formato
"obfuscated font" (.odttf) do ECMA-376 — para o Word do cliente renderizar a
tipografia da marca MESMO sem a fonte instalada. Sem isso, Word/LibreOffice
caem para uma serifa de substituição (o relatório sai com cara de papel
acadêmico, não de consultoria).

Chamado por docx_renderer.render_docx() ao final, de forma DEFENSIVA: qualquer
falha deixa o DOCX válido (só sem embed → nome da fonte) — nunca quebra a
geração. Os .ttf vêm de fonts/ (o job do trigger os escreve no sandbox E2B via
RENDERER_FONTS; em teste local ficam ao lado dos .py). Validado: o soffice usa
as fontes embutidas (IBM Plex aparece subsetada no PDF)."""

import os
import re
import uuid
import zipfile

import theme as T

# (família OOXML, variante theme) — só as presentes são embutidas.
_EMBED = [
    ("IBM Plex Sans", "normal", "embedRegular"),
    ("IBM Plex Sans", "bold", "embedBold"),
    ("IBM Plex Mono", "normal", "embedRegular"),
]
_REL_FONT = ("http://schemas.openxmlformats.org/officeDocument/2006/"
             "relationships/font")
_CT_ODTTF = "application/vnd.openxmlformats-officedocument.obfuscatedFont"


def _obfuscate(data, guid_hex):
    """XOR dos 32 primeiros bytes com os 16 bytes do GUID invertidos (ECMA-376).
    É a sua própria inversa (o Word desofusca com o mesmo XOR)."""
    key = bytes.fromhex(guid_hex)[::-1]
    b = bytearray(data)
    for i in range(32):
        b[i] ^= key[i % 16]
    return bytes(b)


def embed_fonts(docx_path):
    """Embute IBM Plex no .docx in-place. Defensivo: no-op se não houver .ttf;
    reescreve o zip atomicamente (nunca deixa o arquivo corrompido)."""
    # agrupa variantes presentes por família
    byfam = {}
    for family, variant, tag in _EMBED:
        path = T.font_path(family, variant)
        if path and os.path.exists(path):
            byfam.setdefault(family, []).append((tag, path))
    if not byfam:
        return False

    with zipfile.ZipFile(docx_path) as z:
        files = {n: z.read(n) for n in z.namelist()}
    if "word/fontTable.xml" not in files or "word/settings.xml" not in files:
        return False

    odttf, rels, fontxml, ridn = {}, [], [], 100
    for family, variants in byfam.items():
        embeds = []
        for tag, path in variants:
            with open(path, "rb") as fh:
                data = fh.read()
            guid = uuid.uuid4()
            ridn += 1
            rid, fname = f"rIdFe{ridn}", f"fontFe{ridn}.odttf"
            odttf["word/fonts/" + fname] = _obfuscate(data, guid.hex)
            rels.append((rid, fname))
            embeds.append(
                f'<w:{tag} r:id="{rid}" '
                f'w:fontKey="{{{str(guid).upper()}}}" w:subsetted="0"/>')
        fontxml.append(f'<w:font w:name="{family}">{"".join(embeds)}</w:font>')

    ft = files["word/fontTable.xml"].decode("utf-8")
    if "</w:fonts>" not in ft:
        return False
    files["word/fontTable.xml"] = ft.replace(
        "</w:fonts>", "".join(fontxml) + "</w:fonts>").encode("utf-8")

    relpath = "word/_rels/fontTable.xml.rels"
    rx = files.get(relpath, (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/'
        'package/2006/relationships"></Relationships>').encode()).decode("utf-8")
    entries = "".join(
        f'<Relationship Id="{rid}" Type="{_REL_FONT}" Target="fonts/{fn}"/>'
        for rid, fn in rels)
    files[relpath] = rx.replace(
        "</Relationships>", entries + "</Relationships>").encode("utf-8")

    ct = files["[Content_Types].xml"].decode("utf-8")
    if "obfuscatedFont" not in ct:
        ct = ct.replace(
            "</Types>",
            f'<Default Extension="odttf" ContentType="{_CT_ODTTF}"/></Types>')
    files["[Content_Types].xml"] = ct.encode("utf-8")

    st = files["word/settings.xml"].decode("utf-8")
    if "embedTrueTypeFonts" not in st:
        st = re.sub(r"(<w:settings\b[^>]*>)", r"\1<w:embedTrueTypeFonts/>",
                    st, count=1)
    files["word/settings.xml"] = st.encode("utf-8")

    files.update(odttf)
    tmp = docx_path + ".fe.tmp"
    with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as z:
        for n, d in files.items():
            z.writestr(n, d)
    os.replace(tmp, docx_path)
    return True
