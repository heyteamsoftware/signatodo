"""Utilidades de texto compartidas por el banco de signos y el procesador de vídeo."""
import re
import unicodedata


def normalizar(texto):
    """MAYÚSCULAS, sin tildes (conserva la Ñ) y sin signos de puntuación."""
    texto = texto.upper().replace("Ñ", "\0")
    texto = "".join(c for c in unicodedata.normalize("NFD", texto) if unicodedata.category(c) != "Mn")
    texto = texto.replace("\0", "Ñ")
    texto = re.sub(r"[^A-ZÑ0-9 ]+", " ", texto)
    return re.sub(r"\s+", " ", texto).strip()
