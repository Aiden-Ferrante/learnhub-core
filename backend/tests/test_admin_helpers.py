"""Tests for pure helpers behind the admin/course-status endpoints."""

from app.admin_routes import chapter_key_of
from app.pdf_convert import source_hash_of


def test_chapter_key_of_numeric_sections():
    assert chapter_key_of("toc:2.1") == "toc:2"
    assert chapter_key_of("toc:10.4") == "toc:10"
    assert chapter_key_of("toc:3") == "toc:3"
    assert chapter_key_of("toc:1.2.3") == "toc:1"
    assert chapter_key_of("toc:5.1~2") == "toc:5"  # dedup-suffixed keys


def test_chapter_key_of_slug_sections_are_their_own_chapter():
    assert chapter_key_of("toc:preface") == "toc:preface"
    assert chapter_key_of("toc:summary-of-design-principles") == "toc:summary-of-design-principles"
    assert chapter_key_of("") == ""


def test_source_hash_is_stable_and_content_keyed():
    a = source_hash_of(b"%PDF-1.4 hello")
    assert a == source_hash_of(b"%PDF-1.4 hello")
    assert a != source_hash_of(b"%PDF-1.4 hello!")
    assert len(a) == 64
