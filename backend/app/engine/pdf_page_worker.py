"""PDF 한 페이지 분석 워커 (pdf_parser.parse_pdf 가 페이지 병렬 처리에 사용).
사용: python -m app.engine.pdf_page_worker <pdf> <page_no> <out_dir> <result.pkl>"""
import pickle
import sys
from pathlib import Path

import pymupdf

from .pdf_parser import _parse_page


def main() -> None:
    path, pno, out_dir, res = sys.argv[1], int(sys.argv[2]), Path(sys.argv[3]), Path(sys.argv[4])
    doc = pymupdf.open(path)
    sd = _parse_page(doc[pno - 1], pno, out_dir)
    tmp = res.with_suffix(".tmp")
    with open(tmp, "wb") as fp:
        pickle.dump(sd, fp, protocol=pickle.HIGHEST_PROTOCOL)
    tmp.replace(res)


if __name__ == "__main__":
    main()
