"""Tests for PDF math → LaTeX markdown normalization."""

from app.process.content.math_markdown import normalize_math_in_markdown


# --- full profile (pymupdf4llm fallback): heuristic rewriting ---

def test_greek_and_operators():
    out = normalize_math_in_markdown("Let α + β = γ and x ≤ y.")
    assert r"\alpha" in out
    assert r"\beta" in out
    assert r"\gamma" in out
    assert r"\leq" in out


def test_superscript():
    out = normalize_math_in_markdown("Energy E = mc².")
    assert "mc^{2}" in out or "mc^" in out


def test_display_equation_line():
    out = normalize_math_in_markdown("∫₀¹ f(x) dx = 1\n\nNext paragraph.")
    assert "$$" in out or "$" in out
    assert r"\int" in out


def test_existing_math_delimiters():
    out = normalize_math_in_markdown("Already $x^2$ here.")
    assert out.count("$") >= 2


def test_full_wraps_real_equation():
    out = normalize_math_in_markdown("So E = mc^2 holds.")
    assert "$E = mc^2$" in out


def test_full_skips_prose_equals():
    # Pure prose around "=" must not be wrapped as math.
    out = normalize_math_in_markdown("Here the = symbol assigns a value.")
    assert "$" not in out


# --- code is preserved verbatim under every transform (the 56%-corruption bug) ---

def test_preserves_code_fence_byte_for_byte():
    block = "```\nx = 10  # assign\noptions(prompt=\"R>\")\n```"
    md = f"{block}\n\nLet α be a value."
    out = normalize_math_in_markdown(md)
    # The fenced block must survive untouched — no stray '$' injected into code.
    assert block in out
    assert r"\alpha" in out  # prose outside the fence is still normalized


def test_preserves_inline_code():
    out = normalize_math_in_markdown("Call `x = f(1)` to assign, where α matters.")
    assert "`x = f(1)`" in out
    assert "$`" not in out and "`$" not in out


# --- light profile (Docling): trust clean output, do not rewrite ---

def test_light_leaves_code_and_prose_alone():
    md = "```\nfor (i in 1:6) print(i)\n```\n\nUse x = 10 here and x ≤ y."
    out = normalize_math_in_markdown(md, profile="light")
    assert out == md.strip() or out == md  # no $ wrapping, no symbol rewriting
    assert "$" not in out
    assert r"\leq" not in out  # unicode glyph left as-is


def test_light_keeps_existing_delimited_math():
    md = "The model is $Y = X\\beta + \\epsilon$ throughout."
    out = normalize_math_in_markdown(md, profile="light")
    assert "$Y = X\\beta + \\epsilon$" in out


def test_light_preserves_display_math_blocks():
    # Docling formula-enrichment emits $$...$$; the delimiter cleanup must NOT
    # strip the adjacent $$ off a real (non-empty) display equation.
    md = "Bayes:\n\n$$P(H \\mid e) = \\frac{P(e \\mid H) P(H)}{P(e)}$$\n\nas shown."
    out = normalize_math_in_markdown(md, profile="light")
    assert "$$P(H \\mid e) = \\frac{P(e \\mid H) P(H)}{P(e)}$$" in out


def test_light_still_drops_empty_delimiters():
    # Empty blocks should still be collapsed.
    assert "$$" not in normalize_math_in_markdown("a $$  $$ b", profile="light")
    out = normalize_math_in_markdown("a $  $ b", profile="light")
    assert "$" not in out
