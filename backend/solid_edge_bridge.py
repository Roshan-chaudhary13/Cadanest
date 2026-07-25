"""
solid_edge_bridge.py
Provides OLE metadata parsing (Material, Thickness, Part Numbers, Assembly Tree links),
Open CASCADE 3D B-Rep mesh extraction, and optional Solid Edge COM background converter for Cadanest.
"""

import sys
import os
import json
import re

try:
    import olefile
except ImportError:
    olefile = None

def extract_ole_metadata(file_path):
    """
    Extracts metadata from Siemens Solid Edge & SolidWorks OLE compound files (.asm, .psm, .par, .sldprt, .sldasm).
    """
    res = {
        "status": "success",
        "file_path": file_path,
        "filename": os.path.basename(file_path),
        "author": "",
        "creating_app": "Solid Edge",
        "template": "",
        "material": "Default Steel",
        "thickness": 2.0,
        "linked_parts": [],
        "linked_part_paths": [],
        "custom_properties": {}
    }

    base_dir = os.path.dirname(os.path.abspath(file_path))

    if olefile and olefile.isOleFile(file_path):
        try:
            ole = olefile.OleFileIO(file_path)
            meta = ole.get_metadata()
            if meta:
                if hasattr(meta, 'author') and meta.author:
                    res["author"] = str(meta.author).split('\x00')[0].strip()
                if hasattr(meta, 'creating_application') and meta.creating_application:
                    res["creating_app"] = str(meta.creating_application).split('\x00')[0].strip()
                if hasattr(meta, 'template') and meta.template:
                    res["template"] = str(meta.template).split('\x00')[0].strip()
            ole.close()
        except Exception as e:
            res["warning"] = f"OLE parse notice: {str(e)}"

    try:
        # Parse binary streams for material, thickness, and component references
        with open(file_path, 'rb') as f:
            raw_data = f.read()

        # Find linked part filenames in assembly streams (.psm, .par, .sldprt, .sldasm, .asm, .step, .stp, .dxf)
        linked = re.findall(b'([a-zA-Z0-9_\\-\\s]+\\.(?:psm|par|sldprt|sldasm|asm|step|stp|dxf))', raw_data, re.IGNORECASE)
        unique_links = []
        resolved_paths = []

        # Map directory files for fast case-insensitive lookup
        dir_files = {}
        for root, _, files in os.walk(base_dir):
            for file in files:
                dir_files[file.lower()] = os.path.join(root, file)

        for l in linked:
            name = l.decode('latin1', errors='ignore').strip()
            # Clean control characters
            name = re.sub(r'[\x00-\x1f\x7f-\xff]', '', name).strip()
            if name and len(name) > 3 and name.lower() not in [u.lower() for u in unique_links] and name.lower() != os.path.basename(file_path).lower():
                unique_links.append(name)
                if name.lower() in dir_files:
                    resolved_paths.append(dir_files[name.lower()])

        res["linked_parts"] = unique_links
        res["linked_part_paths"] = resolved_paths

        # Search for material strings
        mat_match = re.search(b'(?:Material|MAT|MatName|SheetMetal\\.Material)\\s*=\\s*([a-zA-Z0-9_\\-\\s]{3,30})', raw_data, re.IGNORECASE)
        if mat_match:
            res["material"] = mat_match.group(1).decode('latin1', errors='ignore').strip()
        else:
            # Common sheet metal materials regex check
            for m in [b'Stainless Steel', b'Mild Steel', b'CRCA', b'HRCA', b'Galvanized', b'Aluminum', b'Aluminium', b'Copper', b'Brass', b'Steel']:
                if m.lower() in raw_data.lower():
                    res["material"] = m.decode('latin1')
                    break

        # Search for thickness strings
        thick_match = re.search(b'(?:Thickness|Thick|Gauge|SheetThickness)\\s*[:=]?\\s*([0-9]+\\.?[0-9]*)', raw_data, re.IGNORECASE)
        if thick_match:
            try:
                t_val = float(thick_match.group(1).decode('latin1'))
                if 0.1 <= t_val <= 100.0:
                    res["thickness"] = t_val
            except ValueError:
                pass

    except Exception as ex:
        res["error"] = str(ex)

    return res

def convert_with_solid_edge_com(file_path, output_dir):
    """
    If Solid Edge is installed on the machine (e.g. client PC),
    uses Windows COM API to open file in background and export to STEP / DXF.
    """
    try:
        import win32com.client
    except ImportError:
        return {"status": "error", "error": "win32com library not available in Python environment."}

    ext = os.path.splitext(file_path)[1].lower()
    base_name = os.path.basename(file_path)
    output_step = os.path.join(output_dir, f"{os.path.splitext(base_name)[0]}.step")
    output_dxf = os.path.join(output_dir, f"{os.path.splitext(base_name)[0]}.dxf")

    se_app = None
    was_app_already_running = True
    doc = None
    was_doc_already_open = False

    try:
        # Try connecting to running Solid Edge application first
        try:
            se_app = win32com.client.GetActiveObject("SolidEdge.Application")
        except Exception:
            was_app_already_running = False

        if not se_app:
            se_app = win32com.client.Dispatch("SolidEdge.Application")

        # Force headless silent operation without GUI prompts or alerts
        try:
            se_app.Visible = False
            se_app.DisplayAlerts = False
        except Exception:
            pass

        # Check if file is already open in Solid Edge
        try:
            if hasattr(se_app, "ActiveDocument") and se_app.ActiveDocument:
                active_doc = se_app.ActiveDocument
                if os.path.basename(active_doc.FullName).lower() == base_name.lower():
                    doc = active_doc
                    was_doc_already_open = True
        except Exception:
            pass

        if not doc:
            doc = se_app.Documents.Open(file_path)

        if not doc:
            return {"status": "error", "error": f"Failed to open {base_name} in Solid Edge."}

        # Remove pre-existing export files to prevent overwrite dialogs
        os.makedirs(output_dir, exist_ok=True)
        if os.path.exists(output_step):
            try:
                os.remove(output_step)
            except Exception:
                pass
        if os.path.exists(output_dxf):
            try:
                os.remove(output_dxf)
            except Exception:
                pass

        # SaveAs to STEP AP242
        doc.SaveAs(output_step)
        
        # If sheet metal part, export flat DXF if flat pattern exists
        if ext == ".psm":
            try:
                doc.SaveAs(output_dxf)
            except Exception:
                pass

        return {
            "status": "success",
            "converted_step": output_step if os.path.exists(output_step) else None,
            "converted_dxf": output_dxf if os.path.exists(output_dxf) else None
        }
    except Exception as ex:
        return {"status": "error", "error": f"Solid Edge COM export error: {str(ex)}"}
    finally:
        # Close document if Cadanest opened it
        if doc and not was_doc_already_open:
            try:
                doc.Close(False)
            except Exception:
                pass

        # Quit Solid Edge application ONLY if Cadanest launched it in the background
        if se_app and not was_app_already_running:
            try:
                se_app.Quit()
            except Exception:
                pass

def generate_box_stl(filepath, dx=120.0, dy=80.0, dz=2.0):
    """Generates a binary STL 3D mesh file for CAD preview fallback."""
    import struct
    os.makedirs(os.path.dirname(os.path.abspath(filepath)), exist_ok=True)
    with open(filepath, 'wb') as f:
        f.write(b'\x00' * 80)
        f.write(struct.pack('<I', 12))
        
        hx, hy, hz = dx / 2.0, dy / 2.0, dz / 2.0
        vertices = [
            (-hx, -hy, -hz), (hx, -hy, -hz), (hx, hy, -hz), (-hx, hy, -hz),
            (-hx, -hy, hz), (hx, -hy, hz), (hx, hy, hz), (-hx, hy, hz)
        ]
        indices = [
            (0,1,2), (0,2,3), (4,6,5), (4,7,6),
            (0,4,5), (0,5,1), (2,6,7), (2,7,3),
            (0,3,7), (0,7,4), (1,5,6), (1,6,2)
        ]
        for tri in indices:
            p1, p2, p3 = vertices[tri[0]], vertices[tri[1]], vertices[tri[2]]
            f.write(struct.pack('<3f', 0.0, 0.0, 1.0))
            f.write(struct.pack('<3f', *p1))
            f.write(struct.pack('<3f', *p2))
            f.write(struct.pack('<3f', *p3))
            f.write(struct.pack('<H', 0))
    return filepath

def generate_svg_preview(filename, material, thickness):
    """Generates a clean vector SVG card preview for raw CAD files."""
    return (
        f'<svg viewBox="-120 -80 240 160" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">\n'
        f'  <style>\n'
        f'    svg {{ background: transparent !important; }}\n'
        f'    rect {{ fill: rgba(0, 163, 255, 0.15); stroke: #00A3FF; stroke-width: 1.5px; rx: 4px; }}\n'
        f'    text {{ fill: #38BDF8; font-family: monospace; font-size: 10px; font-weight: bold; text-anchor: middle; }}\n'
        f'  </style>\n'
        f'  <rect x="-90" y="-50" width="180" height="100" />\n'
        f'  <line x1="-90" y1="0" x2="90" y2="0" stroke="#FF5733" stroke-width="1.0" stroke-dasharray="4,4" />\n'
        f'  <text x="0" y="-15">{filename}</text>\n'
        f'  <text x="0" y="15">{material} | {thickness:.1f} mm</text>\n'
        f'</svg>'
    )

def process_cad_file(file_path, export_dir):
    """
    Main entry point for Solid Edge & CAD assembly file processing.
    Combines silent OLE metadata extraction with Open CASCADE geometry parsing.
    Only invokes Solid Edge COM if no neutral STEP/DXF file exists.
    """
    metadata = extract_ole_metadata(file_path)
    base_name = os.path.basename(file_path)
    base_no_ext = os.path.splitext(base_name)[0]
    base_dir = os.path.dirname(os.path.abspath(file_path))

    # Look for existing STEP AP214/AP242 representations with same base name in directory
    candidate_step = None
    for ext in [".step", ".stp", ".iges", ".igs"]:
        cand = os.path.join(base_dir, f"{base_no_ext}{ext}")
        if os.path.exists(cand):
            candidate_step = cand
            break
        cand_export = os.path.join(export_dir, f"{base_no_ext}{ext}")
        if os.path.exists(cand_export):
            candidate_step = cand_export
            break

    com_result = {"status": "skipped", "reason": "STEP representation already available"}
    # Only invoke COM if no neutral STEP file is available
    if not candidate_step and os.path.splitext(file_path)[1].lower() in [".psm", ".par", ".asm", ".sldprt", ".sldasm"]:
        com_result = convert_with_solid_edge_com(file_path, export_dir)
        if com_result.get("status") == "success" and com_result.get("converted_step"):
            candidate_step = com_result["converted_step"]

    step_analysis = None
    if candidate_step and os.path.exists(candidate_step):
        try:
            _here = os.path.dirname(os.path.abspath(__file__))
            if _here not in sys.path:
                sys.path.insert(0, _here)
            from unfold.step_loader import load_step_file, extract_faces
            from unfold.face_graph import classify_face
            from unfold.unfolder import detect_thickness

            shape = load_step_file(candidate_step)
            faces = extract_faces(shape)
            classification = [classify_face(f) for f in faces]
            detected_thick = detect_thickness(faces, classification) or float(metadata.get("thickness", 2.0))

            # Mesh shape into binary STL preview file
            stl_out = os.path.join(export_dir, f"{base_no_ext}_preview.stl")
            svg_out = os.path.join(export_dir, f"{base_no_ext}_preview.svg")

            from OCC.Core.BRepMesh import BRepMesh_IncrementalMesh
            from OCC.Core.StlAPI import StlAPI_Writer
            BRepMesh_IncrementalMesh(shape, 0.25).Perform()
            stl_w = StlAPI_Writer()
            stl_w.Write(shape, stl_out)

            # Compute bounding box
            from OCC.Core.Bnd import Bnd_Box
            from OCC.Core.BRepBndLib import brepbndlib
            bbox = Bnd_Box()
            brepbndlib.Add(shape, bbox)
            xmin, ymin, zmin, xmax, ymax, zmax = bbox.Get()
            dim_x = round(abs(xmax - xmin), 2)
            dim_y = round(abs(ymax - ymin), 2)
            dim_z = round(abs(zmax - zmin), 2)

            step_analysis = {
                "step_path": candidate_step,
                "stl_preview_path": stl_out,
                "svg_preview_path": svg_out,
                "thickness": detected_thick,
                "planar_face_count": len([c for c in classification if c["type"] == "PLANE"]),
                "total_face_count": len(faces),
                "faces": [{"name": f"Face{i+1}", "type": c["type"], "area": c["area"]} for i, c in enumerate(classification)],
                "dimensions": {"x": dim_x, "y": dim_y, "z": dim_z}
            }
        except Exception as e:
            step_analysis = None

    fallback_stl_path = os.path.join(export_dir, f"{base_no_ext}_preview.stl")
    if not step_analysis or not os.path.exists(step_analysis.get("stl_preview_path", "")):
        generate_box_stl(fallback_stl_path, 120.0, 80.0, float(metadata.get("thickness", 2.0)))
    else:
        fallback_stl_path = step_analysis["stl_preview_path"]

    svg_content = generate_svg_preview(base_name, metadata.get("material", "Default Steel"), float(metadata.get("thickness", 2.0)))

    res = {
        "status": "success",
        "file_path": file_path,
        "filename": base_name,
        "metadata": metadata,
        "com_conversion": com_result,
        "stl_preview_path": fallback_stl_path,
        "svg_preview_content": svg_content,
        "dimensions": step_analysis["dimensions"] if step_analysis else {"x": 120.0, "y": 80.0, "z": float(metadata.get("thickness", 2.0))}
    }

    # Look for matching pre-flattened DXF representations in directory or subdirectories
    matching_dxf = None
    dxf_target_name = f"{base_no_ext}.dxf".lower()
    for root, _, files in os.walk(base_dir):
        for f in files:
            if f.lower() == dxf_target_name:
                matching_dxf = os.path.join(root, f)
                break
        if matching_dxf:
            break

    if matching_dxf:
        res["dxf_path"] = matching_dxf

    if step_analysis:
        res["step_path"] = step_analysis["step_path"]
        res["analysis"] = step_analysis
        res["thickness"] = step_analysis["thickness"]

    return res

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"status": "error", "error": "Usage: python solid_edge_bridge.py <cad_file_path> [export_dir]"}))
        sys.exit(1)

    cad_file = sys.argv[1]
    out_dir = sys.argv[2] if len(sys.argv) > 2 else os.path.dirname(os.path.abspath(cad_file))
    
    result = process_cad_file(cad_file, out_dir)
    print(json.dumps(result))
