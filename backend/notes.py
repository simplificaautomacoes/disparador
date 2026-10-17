"""Renderização de anotação (note) a partir de um template + colunas da planilha.

Reusado pelo disparo principal, pelo atípico e pelo leilão.
"""
import pandas as pd


def _limpa_valor_monetario(valor):
    try:
        if isinstance(valor, str):
            if "," in valor and "." not in valor:
                return float(valor.replace(",", "."))
            elif "," in valor and "." in valor:
                return float(valor.replace(".", "").replace(",", "."))
            return float(valor)
        return float(valor)
    except Exception:
        return 0.0


def _format_brl(value):
    v = _limpa_valor_monetario(value)
    return f"R$ {v:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")


def build_note_text(template, row, column_mapping):
    text = template or ""
    for placeholder, mapping in (column_mapping or {}).items():
        col_name = (mapping or {}).get("column", "")
        fmt = (mapping or {}).get("format", "text")
        raw_value = row.get(col_name, "") if col_name else ""
        if pd.isna(raw_value):
            raw_value = ""
        display_value = _format_brl(raw_value) if fmt == "money" else str(raw_value).strip()
        text = text.replace(f"{{{placeholder}}}", display_value)
    return text
