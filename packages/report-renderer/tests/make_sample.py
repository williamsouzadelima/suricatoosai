"""Gera um ReportModel de amostra RICO para smoke/contrato dos renderers.

Uso: python make_sample.py <out_dir>
Escreve <out_dir>/model.json e <out_dir>/evidence.png (imagePath absoluto).

Exercita todos os Section.type, textos longos (com SENTINELAS no fim p/ provar
que nada é truncado), >12 achados (tabelas), e um achado com >20 evidências +
imagem. Honesto: dados sintéticos, sem cliente real.
"""

import json
import os
import sys

SEVS = ["critical", "high", "medium", "low", "info"]

# Parágrafo longo (~1.8k chars) terminando numa SENTINELA única por campo.
LOREM = (
    "A superfície de ataque foi mapeada a partir do perímetro externo, com "
    "enumeração de subdomínios, varredura de portas e fingerprinting de "
    "serviços. O vetor crítico encadeia uma falha de autenticação com uma "
    "escalada de privilégios no painel administrativo, permitindo acesso "
    "irrestrito ao banco de produção. A exploração foi validada de ponta a "
    "ponta, com captura de credenciais em texto claro e pivô lateral para a "
    "rede interna. "
) * 4


def long(field, ref):
    return f"{LOREM}\n\nLinha final com quebra preservada. [{field}_END_{ref}]"


def make_png(path):
    from PIL import Image, ImageDraw

    img = Image.new("RGB", (1280, 633), (14, 27, 46))
    d = ImageDraw.Draw(img)
    d.rectangle([40, 40, 1240, 120], fill=(36, 86, 230))
    d.text((60, 70), "EVIDENCIA VISUAL — amostra (PoC)", fill=(255, 255, 255))
    for i in range(6):
        d.text((60, 180 + i * 48), f"$ linha de saida de ferramenta {i}", fill=(159, 226, 255))
    img.save(path, "PNG")


def make_cover(path):
    """Arte de capa portrait (1700x2200) p/ testar o caminho full-bleed (WS5)."""
    from PIL import Image, ImageDraw

    img = Image.new("RGB", (1700, 2200), (14, 27, 46))
    d = ImageDraw.Draw(img)
    d.rectangle([0, 0, 1700, 24], fill=(36, 86, 230))
    d.rectangle([120, 900, 420, 912], fill=(255, 118, 120))
    img.save(path, "PNG")


def finding(i, img_path=None, many_evidence=False):
    sev = SEVS[i % len(SEVS)]
    ref = f"F-{i+1:02d}"
    ev = []
    n_ev = 25 if many_evidence else 3
    for k in range(n_ev):
        item = {
            "sourceType": "tool_output",
            "label": f"passo {k+1}",
            "stepIndex": k + 1,
            "toolName": ["nmap", "ffuf", "sqlmap", "burp", "nuclei"][k % 5],
            "command": f"ferramenta --alvo exemplo.com --flag-{k} " + ("A" * 220),
            "snippet": (f"saida da ferramenta passo {k+1}\n" + ("x" * 120) + "\n") * 2,
            "resultSummary": f"prova objetiva do passo {k+1}",
        }
        ev.append(item)
    if img_path:
        ev.append({
            "sourceType": "file",
            "label": "Screenshot do painel comprometido",
            "stepIndex": n_ev + 1,
            "imagePath": img_path,
        })
    return {
        "ref": ref,
        "title": f"Achado {ref}: {['SQLi','IDOR','RCE','XSS','SSRF'][i%5]} em endpoint crítico de exemplo",
        "severity": sev,
        "affectedAsset": f"https://app{i}.exemplo.com/api/v1/recurso",
        "weaknessClass": ["SQL Injection", "IDOR", "RCE", "XSS", "SSRF"][i % 5],
        "cwe": ["CWE-89", "CWE-639", "CWE-94", "CWE-79", "CWE-918"][i % 5],
        "cvssVector": "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H",
        "cvssScore": [9.8, 8.1, 9.1, 6.1, 7.5][i % 5],
        "description": long("DESCR", ref),
        "impact": long("IMPACT", ref),
        "remediation": long("REMED", ref),
        "narrative": long("NARR", ref),
        "reproductionSteps": [f"Passo {s+1}: ação detalhada de reprodução " + ("y" * 80) for s in range(8)],
        "evidence": ev,
    }


def build_model(out_dir):
    img_path = os.path.join(out_dir, "evidence.png")
    make_png(img_path)
    cover_path = os.path.join(out_dir, "cover.png")
    make_cover(cover_path)
    findings = [finding(i, img_path if i == 0 else None, many_evidence=(i == 0)) for i in range(14)]
    by = {s: sum(1 for f in findings if f["severity"] == s) for s in SEVS}
    stats = [
        {"value": str(len(findings)), "label": "ACHADOS"},
        {"value": str(by["critical"]), "label": "CRÍTICOS"},
        {"value": "9.8", "label": "MAIOR CVSS"},
        {"value": "14", "label": "ATIVOS AFETADOS"},
    ]
    kpis = {"total": len(findings), "bySeverity": by, "avgCvss": 8.1, "riskScore": 82}
    charts = {
        "severityDistribution": [{"severity": s, "count": by[s]} for s in SEVS],
        "riskMatrix": [{"likelihood": 5, "impact": 5, "count": by["critical"]},
                       {"likelihood": 4, "impact": 4, "count": by["high"]},
                       {"likelihood": 3, "impact": 3, "count": by["medium"]}],
    }
    meta = {
        "client": "Cliente Exemplo S.A.",
        "engagement": "Pentest Externo — Amostra",
        "audience": "technical",
        "author": "Will — Offensive Sec",
        "generatedAt": 1760000000000,
        "version": 1,
        "classification": "CONFIDENCIAL · USO RESTRITO",
        "brand": {
            "name": "Suricatoos", "wordmark": "Suricatoos",
            "tagline": "Offensive Security · Pentest · MSSP",
            "docCodePrefix": "SCT", "primary": "2456E6", "accent": "FF7678",
            "classification": "CONFIDENCIAL · USO RESTRITO",
            "coverImagePath": cover_path,
        },
        "docCode": "SCT-PTI-2026-0001",
        "volume": "DOSSIÊ · VOL. I",
    }
    sections = [
        {"type": "cover", "title": "Relatório Técnico de Teste de Intrusão",
         "subtitle": "Cliente Exemplo S.A. — Pentest Externo", "stats": stats},
        {"type": "partDivider", "part": "PARTE I", "title": "Sumário Executivo"},
        {"type": "statBand", "headline": "Postura de risco CRÍTICA: ação imediata.",
         "body": long("STATBAND", "X"), "stats": stats},
        {"type": "kpis", "kpis": kpis},
        {"type": "severityChart", "data": charts},
        {"type": "heading", "text": "Escopo & Metodologia", "level": 1},
        {"type": "bullets", "items": ["Em escopo: *.exemplo.com", "Fora de escopo: produção crítica",
                                       "Metodologia PTES/OWASP " + ("z" * 200)]},
        {"type": "paragraph", "text": long("PARA", "X")},
        {"type": "partDivider", "part": "PANORAMA", "title": f"Os {len(findings)} achados, num relance"},
        {"type": "findingsTable", "findings": findings},
        {"type": "partDivider", "part": "PARTE II", "title": "Cadeias de Ataque"},
        {"type": "attackChain", "lanes": [
            {"title": f"{findings[0]['ref']} · cadeia crítica",
             "steps": [{"label": "recon", "detail": "nmap"}, {"label": "exploit", "detail": "sqlmap"},
                       {"label": "privesc", "detail": "painel"}, {"label": "pivot", "detail": "interna"}]}]},
        {"type": "partDivider", "part": "PARTE III", "title": "Achados Detalhados"},
    ]
    for f in findings:
        sections.append({"type": "findingCard", "finding": f, "showPoc": True})
    sections += [
        {"type": "partDivider", "part": "REMEDIAÇÃO", "title": "Plano por fase"},
        {"type": "roadmap", "phases": [
            {"window": "0-7 dias", "label": "Contenção", "actions": ["Corrigir SQLi " + ("w" * 80)]},
            {"window": "8-30 dias", "label": "Fechar vetores", "actions": ["Revisar IDOR"]},
            {"window": "31-90 dias", "label": "Hardening", "actions": ["WAF"]},
            {"window": "91-180 dias", "label": "Maturidade", "actions": ["Reteste"]}]},
        {"type": "heading", "text": "Matriz de Remediação Priorizada", "level": 1},
        {"type": "remediationMatrix", "findings": findings},
        {"type": "callout", "tone": "critical", "text": "5 riscos críticos/altos exigem ação imediata. " + ("q" * 120)},
        {"type": "divider"},
    ]
    return {"meta": meta, "kpis": kpis, "charts": charts, "sections": sections}


def main():
    out_dir = sys.argv[1] if len(sys.argv) > 1 else "."
    os.makedirs(out_dir, exist_ok=True)
    model = build_model(out_dir)
    with open(os.path.join(out_dir, "model.json"), "w", encoding="utf-8") as fh:
        json.dump(model, fh, ensure_ascii=False)
    print("model.json + evidence.png ->", out_dir)


if __name__ == "__main__":
    main()
