"""Industry packs: the same Corpus structures, re-themed names, titles and labels.

A pack is a small map of {neutral text: pack text}. It is applied to the string literals of
generator/corpus.py only (never to code or numbers), longest key first, and the themed module builds
the Corpus. Documents and Ground Truth are produced by the same literals, so the truth stays
single-sourced: a renamed company is renamed in the PDF and in its truth file together.
"neutral" applies no map and runs generator/corpus.py unchanged, so the default Corpus is byte-identical.

    uv run python -m generator.packs insurance            # -> corpus_packs/insurance/
    uv run python -m generator.packs finance some/dir
"""
import io
import sys
import tokenize
import types
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = Path(__file__).with_name("corpus.py")

PACKS: dict[str, dict[str, str]] = {
    "neutral": {},
    "insurance": {
        "Northwind Analytics, Inc.": "Bluestone Underwriting, Inc.",
        "Northwind Analytics": "Bluestone Underwriting",
        "NORTHWIND": "BLUESTONE",
        "Contoso Retail Group": "Harborview Brokers Group",
        "Fabrikam Logistics Ltd.": "Lakeshore Reinsurance Ltd.",
        "Data platform subscription (annual)": "Policy admin subscription (annual)",
        "FY26 Quarterly Business Review": "FY26 Underwriting Review",
        "Active Customers": "Active Policies",
        "Investor Pitch - FY26 Update": "Board Update - FY26 Portfolio",
        "Harbor Street Market": "Harbor Street Pharmacy",
        "Equipment Inspection Form": "Risk Survey Inspection Form",
    },
    "manufacturing": {
        "Northwind Analytics, Inc.": "Ironbridge Fabrication, Inc.",
        "Northwind Analytics": "Ironbridge Fabrication",
        "NORTHWIND": "IRONBRIDGE",
        "Contoso Retail Group": "Calder Machine Works",
        "Fabrikam Logistics Ltd.": "Fabrikam Castings Ltd.",
        "Data platform subscription (annual)": "CNC line maintenance (annual)",
        "Onboarding workshop": "Operator training workshop",
        "FY26 Quarterly Business Review": "FY26 Plant Operations Review",
        "Active Customers": "Active Work Orders",
        "Investor Pitch - FY26 Update": "Plant Update - FY26 Capacity",
        "Harbor Street Market": "Harbor Street Hardware",
    },
    "finance": {
        "Northwind Analytics, Inc.": "Ledgerline Capital, Inc.",
        "Northwind Analytics": "Ledgerline Capital",
        "NORTHWIND": "LEDGERLINE",
        "Contoso Retail Group": "Contoso Wealth Partners",
        "Fabrikam Logistics Ltd.": "Fabrikam Asset Management Ltd.",
        "Data platform subscription (annual)": "Portfolio analytics subscription (annual)",
        "FY26 Quarterly Business Review": "FY26 Quarterly Fund Review",
        "Active Customers": "Active Accounts",
        "Investor Pitch - FY26 Update": "Investor Update - FY26 Fund",
        "Harbor Street Market": "Harbor Street Cafe",
    },
}


def themed_source(pack: str) -> str:
    """generator/corpus.py with the pack's map applied to string-literal tokens only."""
    mapping = PACKS[pack]
    src = SRC.read_text()
    if not mapping:
        return src
    keys = sorted(mapping, key=len, reverse=True)
    toks = []
    for t in tokenize.generate_tokens(io.StringIO(src).readline):
        s = t.string
        if t.type == tokenize.STRING and not s.startswith(('"""', "'''")):
            for k in keys:
                s = s.replace(k, mapping[k])
        toks.append((t.type, s, t.start, t.end, t.line))
    return tokenize.untokenize(toks)


def load(pack: str = "neutral") -> types.ModuleType:
    if pack == "neutral":
        import generator.corpus as mod
        return mod
    mod = types.ModuleType(f"generator.corpus_{pack}")
    mod.__file__ = str(SRC)  # asset paths in corpus.py resolve relative to the real file
    exec(compile(themed_source(pack), str(SRC), "exec"), mod.__dict__)
    return mod


def build_pack(pack: str, outdir: Path | str, seed: int = 42) -> list[dict]:
    if pack not in PACKS:
        raise ValueError(f"unknown pack {pack!r}; choose from {', '.join(PACKS)}")
    return load(pack).build_corpus(outdir, seed=seed)


if __name__ == "__main__":
    pack = sys.argv[1] if len(sys.argv) > 1 else "neutral"
    default = ROOT / ("corpus" if pack == "neutral" else f"corpus_packs/{pack}")
    target = Path(sys.argv[2]) if len(sys.argv) > 2 else default
    for d in build_pack(pack, target):
        print(target / d["file"])
