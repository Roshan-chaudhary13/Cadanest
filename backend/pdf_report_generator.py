"""
pdf_report_generator.py - Printable Fabrication Report Generator for Cadanest
Produces formatted PDF fabrication summary reports with sheet utilization %,
part breakdown, sheet dimensions, and nesting statistics.
"""

import os


def generate_fabrication_pdf_report(
    output_pdf_path: str,
    sheet_index: int,
    sheet_width: float,
    sheet_height: float,
    material: str,
    thickness: float,
    utilization_pct: float,
    spacing: float,
    margin: float,
    packed_results: list
) -> str:
    """
    Writes a standard PDF 1.4 layout document detailing nesting statistics and part placement.
    """
    os.makedirs(os.path.dirname(os.path.abspath(output_pdf_path)), exist_ok=True)

    header = (
        "%PDF-1.4\n"
        "%âãÏÓ\n"
        "1 0 obj\n"
        "<< /Type /Catalog /Pages 2 0 R >>\n"
        "endobj\n"
        "2 0 obj\n"
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>\n"
        "endobj\n"
        "3 0 obj\n"
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\n"
        "endobj\n"
        "5 0 obj\n"
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\n"
        "endobj\n"
    )

    text_lines = [
        "BT",
        "/F1 18 Tf",
        "50 800 Td",
        f"(CADANEST PRODUCTION FABRICATION REPORT - SHEET #{sheet_index}) Tj",
        "0 -25 Td",
        "/F1 12 Tf",
        f"(Material: {material}  |  Thickness: {thickness:.1f} mm) Tj",
        "0 -18 Td",
        f"(Sheet Stock Dimensions: {sheet_width:.1f} mm x {sheet_height:.1f} mm) Tj",
        "0 -18 Td",
        f"(Border Margin: {margin:.1f} mm  |  Part-to-Part Spacing: {spacing:.1f} mm) Tj",
        "0 -18 Td",
        f"(Sheet Packing Utilization: {utilization_pct:.1f}%) Tj",
        "0 -18 Td",
        f"(Nested Blanks Count: {len(packed_results)}) Tj",
        "0 -30 Td",
        "/F1 14 Tf",
        "(PRODUCTION PARTS CUT LIST:) Tj",
        "0 -20 Td",
        "/F1 10 Tf"
    ]

    for idx, item in enumerate(packed_results[:25]):
        name = item.get("name", f"Part {idx+1}")
        dx = item.get("dx", 0.0)
        dy = item.get("dy", 0.0)
        rot = item.get("rotation", 0.0)
        text_lines.append(f"({idx+1}. {name} - Position: X={dx:.1f}mm, Y={dy:.1f}mm, Rot={rot:.1f}deg) Tj")
        text_lines.append("0 -15 Td")

    if len(packed_results) > 25:
        text_lines.append(f"(... and {len(packed_results) - 25} more nested parts) Tj")
        text_lines.append("0 -15 Td")

    text_lines.append("ET")
    content_stream = "\n".join(text_lines)

    stream_len = len(content_stream.encode('latin1', errors='ignore'))
    obj4 = f"4 0 obj\n<< /Length {stream_len} >>\nstream\n{content_stream}\nendstream\nendobj\n"

    xref = (
        "xref\n"
        "0 6\n"
        "0000000000 65535 f \n"
        "0000000015 00000 n \n"
        "0000000068 00000 n \n"
        "0000000125 00000 n \n"
        "0000000300 00000 n \n"
        "0000000230 00000 n \n"
        "trailer\n"
        "<< /Size 6 /Root 1 0 R >>\n"
        "startxref\n"
        "400\n"
        "%%EOF\n"
    )

    full_pdf = header + obj4 + xref
    with open(output_pdf_path, "wb") as f:
        f.write(full_pdf.encode('latin1', errors='ignore'))

    return output_pdf_path
