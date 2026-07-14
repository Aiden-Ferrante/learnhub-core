"""Normalize mathematical notation in PDF-derived Markdown for KaTeX / MathJax."""

from __future__ import annotations

import re

# Common PDF text-layer replacements (U+FFFD) when fonts lack Unicode cmap.
_REPLACEMENT_CHAR = "\ufffd"

# Unicode superscript / subscript digits and signs → LaTeX exponents/subscripts.
_SUPER_CHARS = "⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁼⁽⁾ⁿⁱ"
_SUPER_TO_ASCII = "0123456789+-=()ni"
_SUB_CHARS = "₀₁₂₃₄₅₆₇₈₉₊₋₌₍₎"
_SUB_TO_ASCII = "0123456789+-=()"

# Greek and common math symbols → LaTeX command (no leading backslash in value).
_MATH_SYMBOL_MAP: dict[str, str] = {
    "α": r"\alpha",
    "β": r"\beta",
    "γ": r"\gamma",
    "δ": r"\delta",
    "ε": r"\epsilon",
    "ζ": r"\zeta",
    "η": r"\eta",
    "θ": r"\theta",
    "ι": r"\iota",
    "κ": r"\kappa",
    "λ": r"\lambda",
    "μ": r"\mu",
    "ν": r"\nu",
    "ξ": r"\xi",
    "π": r"\pi",
    "ρ": r"\rho",
    "σ": r"\sigma",
    "τ": r"\tau",
    "υ": r"\upsilon",
    "φ": r"\phi",
    "χ": r"\chi",
    "ψ": r"\psi",
    "ω": r"\omega",
    "Γ": r"\Gamma",
    "Δ": r"\Delta",
    "Θ": r"\Theta",
    "Λ": r"\Lambda",
    "Ξ": r"\Xi",
    "Π": r"\Pi",
    "Σ": r"\Sigma",
    "Υ": r"\Upsilon",
    "Φ": r"\Phi",
    "Ψ": r"\Psi",
    "Ω": r"\Omega",
    "∞": r"\infty",
    "±": r"\pm",
    "∓": r"\mp",
    "×": r"\times",
    "÷": r"\div",
    "·": r"\cdot",
    "∘": r"\circ",
    "∙": r"\bullet",
    "√": r"\sqrt",
    "∑": r"\sum",
    "∏": r"\prod",
    "∫": r"\int",
    "∂": r"\partial",
    "∇": r"\nabla",
    "≤": r"\leq",
    "≥": r"\geq",
    "≠": r"\neq",
    "≈": r"\approx",
    "≡": r"\equiv",
    "≪": r"\ll",
    "≫": r"\gg",
    "∈": r"\in",
    "∉": r"\notin",
    "⊂": r"\subset",
    "⊃": r"\supset",
    "⊆": r"\subseteq",
    "⊇": r"\supseteq",
    "∪": r"\cup",
    "∩": r"\cap",
    "∧": r"\land",
    "∨": r"\lor",
    "¬": r"\neg",
    "∀": r"\forall",
    "∃": r"\exists",
    "∅": r"\emptyset",
    "→": r"\rightarrow",
    "←": r"\leftarrow",
    "↔": r"\leftrightarrow",
    "⇒": r"\Rightarrow",
    "⇐": r"\Leftarrow",
    "⇔": r"\Leftrightarrow",
    "ℝ": r"\mathbb{R}",
    "ℤ": r"\mathbb{Z}",
    "ℕ": r"\mathbb{N}",
    "ℚ": r"\mathbb{Q}",
    "ℂ": r"\mathbb{C}",
    "½": r"\frac{1}{2}",
    "⅓": r"\frac{1}{3}",
    "¼": r"\frac{1}{4}",
    "¾": r"\frac{3}{4}",
    "°": r"^{\circ}",
    "′": r"'",
    "″": r"''",
    "…": r"\ldots",
    "−": r"-",  # unicode minus
    "―": r"-",
    "‖": r"\|",
    "⟨": r"\langle",
    "⟩": r"\rangle",
    "⌊": r"\lfloor",
    "⌋": r"\rfloor",
    "⌈": r"\lceil",
    "⌉": r"\rceil",
}

# Mathematical alphanumeric symbols (italic/bold Unicode) → ASCII for LaTeX math mode.
_MATH_ALPHABET_RANGES: list[tuple[int, int, str]] = [
    (0x1D434, 0x1D467, "A"),  # italic capitals
    (0x1D468, 0x1D49B, "a"),  # italic small
    (0x1D49C, 0x1D4CF, "A"),  # script capitals (approximate)
    (0x1D4D0, 0x1D503, "a"),
    (0x1D5A0, 0x1D5D3, "A"),  # sans-serif bold capitals
    (0x1D5D4, 0x1D607, "a"),
    (0x1D608, 0x1D63B, "A"),  # sans-serif italic capitals
    (0x1D63C, 0x1D66F, "a"),
]

_FENCE_RE = re.compile(r"^```[\w-]*$")

# A protected-code placeholder: NUL + index + NUL. NUL never appears in markdown,
# is matched by no math heuristic, and is easy to restore.
_CODE_PLACEHOLDER = re.compile("\x00(\\d+)\x00")

# Signals that an `ident = expr` span is actually math, not prose (e.g. "the = symbol").
# `=` itself doesn't count — it's always present in the candidate.
_INLINE_MATH_SIGNAL = re.compile(r"[0-9^_\\+\-*/<>]")


def _protect_code(text: str) -> tuple[str, "re.Pattern | object"]:
    """Mask fenced and inline code so no math heuristic can touch it.

    Returns ``(masked_text, restore)`` where ``restore(s)`` re-inserts the
    original code segments verbatim.
    """
    store: list[str] = []

    def stash(m: re.Match[str]) -> str:
        store.append(m.group(0))
        return f"\x00{len(store) - 1}\x00"

    masked = re.sub(r"```.*?```", stash, text, flags=re.DOTALL)
    masked = re.sub(r"`[^`\n]+`", stash, masked)

    def restore(s: str) -> str:
        return _CODE_PLACEHOLDER.sub(lambda m: store[int(m.group(1))], s)

    return masked, restore


def _super_to_ascii(chunk: str) -> str:
    table = str.maketrans(_SUPER_CHARS, _SUPER_TO_ASCII)
    return chunk.translate(table)


def _sub_to_ascii(chunk: str) -> str:
    table = str.maketrans(_SUB_CHARS, _SUB_TO_ASCII)
    return chunk.translate(table)


def _convert_super_sub_scripts(text: str) -> str:
    """Turn unicode super/sub scripts into LaTeX ^{} / _{} on adjacent identifiers."""

    def repl_super(m: re.Match[str]) -> str:
        base, sup = m.group(1), m.group(2)
        return f"{base}^{{{_super_to_ascii(sup)}}}"

    def repl_sub(m: re.Match[str]) -> str:
        base, sub = m.group(1), m.group(2)
        return f"{base}_{{{_sub_to_ascii(sub)}}}"

    text = re.sub(
        rf"([A-Za-z0-9])\s*([{_SUPER_CHARS}]+)",
        repl_super,
        text,
    )
    text = re.sub(
        rf"([A-Za-z0-9])\s*([{_SUB_CHARS}]+)",
        repl_sub,
        text,
    )
    return text


def _normalize_math_alphabet(text: str) -> str:
    out: list[str] = []
    for ch in text:
        o = ord(ch)
        mapped = None
        for start, end, base in _MATH_ALPHABET_RANGES:
            if start <= o <= end:
                mapped = base[o - start] if o - start < len(base) else ch
                break
        out.append(mapped if mapped is not None else ch)
    return "".join(out)


def _replace_math_symbols(text: str) -> str:
    """Replace unicode math glyphs with LaTeX commands (outside existing $...$)."""
    parts = re.split(r"(\$\$[\s\S]*?\$\$|\$[^$\n]+\$)", text)
    for i in range(0, len(parts), 2):
        chunk = parts[i]
        for sym, latex in sorted(_MATH_SYMBOL_MAP.items(), key=lambda x: -len(x[0])):
            chunk = chunk.replace(sym, latex)
        parts[i] = chunk
    return "".join(parts)


def _wrap_display_equation_lines(text: str) -> str:
    lines = text.split("\n")
    out: list[str] = []
    in_fence = False

    for line in lines:
        stripped = line.strip()
        if _FENCE_RE.match(stripped):
            in_fence = not in_fence
            out.append(line)
            continue
        if in_fence or not stripped:
            out.append(line)
            continue
        if "\x00" in stripped:  # protected code placeholder — never wrap
            out.append(line)
            continue
        if stripped.startswith("$$") and stripped.endswith("$$"):
            out.append(line)
            continue
        if stripped.startswith("$") and stripped.endswith("$") and stripped.count("$") >= 2:
            out.append(line)
            continue
        # Centered short equation lines (common in PDF exports).
        math_chars = sum(
            1
            for c in stripped
            if c in _MATH_SYMBOL_MAP
            or c in _SUPER_CHARS
            or c in _SUB_CHARS
            or c in "+-=()[]{}^_\\0123456789./"
            or ("α" <= c <= "ω")
            or ("Α" <= c <= "Ω")
        )
        density = math_chars / max(len(stripped), 1)
        if density >= 0.55 and len(stripped) <= 200 and not stripped.startswith("#"):
            out.append(f"$${stripped}$$")
            continue
        out.append(line)

    return "\n".join(out)


def _wrap_simple_inline_equations(text: str) -> str:
    """Wrap patterns like E=mc^2, f(x)=..., σ² when not already delimited."""

    def wrap_eq(m: re.Match[str]) -> str:
        expr = m.group(1).strip()
        if not expr or "$" in expr or "\x00" in expr:
            return m.group(0)
        # Require a real math signal so prose ("the = symbol") isn't wrapped.
        if not _INLINE_MATH_SIGNAL.search(expr):
            return m.group(0)
        return f"${expr}$"

    # Identifier = expression (includes LaTeX fragments from symbol pass).
    text = re.sub(
        r"(?<!\$)(?<![\\\w])([A-Za-z][A-Za-z0-9]*(?:_\{[^}]+\}|\^[^{]+|\^{[^}]+})?"
        r"\s*=\s*[^$\n]{1,80}?)(?=\s|[,.;:!?\n]|$)",
        wrap_eq,
        text,
    )
    return text


def _collapse_duplicate_delimiters(text: str) -> str:
    # Drop empty display blocks ($$ $$) and empty inline math ($ $). The inline
    # rule requires *actual whitespace* between the dollars ([ \t]+) so it never
    # eats the adjacent `$$` of a real display equation like $$x = y$$ — that
    # collateral match (from the old \$(\s*)\$) silently stripped every decoded
    # display formula once Docling formula-enrichment started emitting them.
    text = re.sub(r"\$\$\s*\$\$", "", text)
    text = re.sub(r"\$([ \t]+)\$", r"\1", text)
    return text


def normalize_math_in_markdown(text: str, *, profile: str = "full") -> str:
    """Post-process PDF-derived Markdown so formulas use LaTeX delimiters.

    ``profile`` selects how aggressive the rewriting is:

    - ``"full"`` (pymupdf4llm fallback): the original heuristics — unicode→LaTeX
      symbol/script mapping plus display- and inline-equation wrapping — but now
      every transform runs with fenced and inline code masked out, and the inline
      wrapper requires a real math signal (so prose like "the = symbol" is left
      alone).
    - ``"light"`` (Docling, the default converter): Docling's text is already
      clean, so we trust it and only collapse stray empty ``$$`` delimiters. We
      deliberately skip symbol mapping here: converting ``≤`` → ``\\leq`` outside a
      wrapped equation would render the literal backslash command, which is worse
      than the perfectly readable unicode glyph.

    Code is always preserved verbatim.
    """
    if not text or not text.strip():
        return text

    masked, restore = _protect_code(text)

    if profile == "light":
        return restore(_collapse_duplicate_delimiters(masked))

    masked = _normalize_math_alphabet(masked)
    masked = _convert_super_sub_scripts(masked)
    masked = _replace_math_symbols(masked)
    masked = _wrap_display_equation_lines(masked)
    masked = _wrap_simple_inline_equations(masked)
    masked = _collapse_duplicate_delimiters(masked)
    return restore(masked)


def replacement_char_ratio(text: str) -> float:
    if not text:
        return 0.0
    return text.count(_REPLACEMENT_CHAR) / len(text)
