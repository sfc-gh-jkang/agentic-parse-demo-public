from scripts.load_design_docs import DOC_GLOBS, chunk_markdown, collect


def test_chunk_by_heading_keeps_section_path():
    md = "intro line\n# Title\nalpha\n## Sub A\nbeta\n### Deep\ngamma\n## Sub B\ndelta\n"
    chunks = chunk_markdown(md)
    assert [c[0] for c in chunks] == ["", "Title", "Title > Sub A", "Title > Sub A > Deep", "Title > Sub B"]
    assert chunks[2][1].startswith("## Sub A") and "beta" in chunks[2][1]
    assert "gamma" not in chunks[2][1]


def test_headings_inside_code_fences_are_ignored():
    md = "# Top\n```bash\n# not a heading\n```\nafter\n"
    chunks = chunk_markdown(md)
    assert len(chunks) == 1 and "# not a heading" in chunks[0][1]


def test_blank_sections_dropped_and_long_sections_split():
    md = "# Empty\n\n# Big\n" + ("word " * 2000)
    chunks = chunk_markdown(md, max_chars=3000)
    assert all(s != "Empty" for s, _ in chunks)
    assert len(chunks) >= 3 and all(len(t) <= 3000 for _, t in chunks)


def test_collect_reads_repo_design_docs():
    rows = collect()
    paths = {p for p, _, _ in rows}
    assert {"docs/SPEC.md", "GLOSSARY.md"} <= paths
    assert any(p.startswith("docs/adr/") for p in paths)
    assert "docs/stage2-report.md" in DOC_GLOBS
