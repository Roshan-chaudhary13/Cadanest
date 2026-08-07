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

try:
    _here = os.path.dirname(os.path.abspath(__file__))
    if _here not in sys.path:
        sys.path.insert(0, _here)
    from occ_unfold_bridge import MATERIAL_CATALOG
except Exception:
    # Fallback if occ_unfold_bridge is unavailable at import time; keep names in sync manually.
    MATERIAL_CATALOG = [
        ("Aluminum, 1060", "AL6061", "Aluminum 1060", 2700),
        ("Aluminum 1060", "AL6061", "Aluminum 1060", 2700),
        ("Aluminum 6061", "AL6061", "Aluminium 6061", 2700),
        ("Aluminium 6061", "AL6061", "Aluminium 6061", 2700),
        ("Aluminum 5052", "AL5052", "Aluminium 5052", 2680),
        ("Aluminium 5052", "AL5052", "Aluminium 5052", 2680),
        ("Aluminum", "AL6061", "Aluminium", 2700),
        ("Aluminium", "AL6061", "Aluminium", 2700),
        ("Steel, structural", "MS", "Steel, Structural", 7850),
        ("Structural Steel", "MS", "Steel, Structural", 7850),
        ("Stainless Steel 304", "SS304", "Stainless Steel 304", 7930),
        ("SS304", "SS304", "Stainless Steel 304", 7930),
        ("Stainless Steel 316", "SS316", "Stainless Steel 316", 8000),
        ("SS316", "SS316", "Stainless Steel 316", 8000),
        ("Copper", "Cu", "Copper", 8960),
        ("Brass", "Brass", "Brass", 8500),
        ("Galvanized Iron", "GI", "Galvanized Iron", 7850),
        ("Galvanized", "GI", "Galvanized Iron", 7850),
        ("CRCA Sheet", "CRCA", "CRCA Sheet", 7850),
        ("CRCA", "CRCA", "CRCA Sheet", 7850),
        ("Mild Steel", "MS", "Mild Steel", 7850),
        ("IS2062", "MS", "Mild Steel", 7850),
        ("Steel", "MS", "Mild Steel", 7850),
    ]

_DIR_FILES_CACHE = {}

def get_cached_dir_files(base_dir):
    """
    Returns a cached case-insensitive dict mapping of filename -> absolute path for base_dir.
    Eliminates redundant disk walks during batch assembly processing.
    """
    abs_dir = os.path.abspath(base_dir)
    if abs_dir in _DIR_FILES_CACHE:
        return _DIR_FILES_CACHE[abs_dir]
    
    dir_files = {}
    try:
        if os.path.exists(abs_dir):
            for root, dirs, files in os.walk(abs_dir):
                # Skip irrelevant subtrees for maximum speed
                dirs[:] = [d for d in dirs if d.lower() not in ('.git', 'node_modules', 'dist', 'build', '__pycache__', 'export_cache', 'cache')]
                for f in files:
                    f_low = f.lower()
                    if f_low not in dir_files:
                        dir_files[f_low] = os.path.join(root, f)
    except Exception:
        pass

    _DIR_FILES_CACHE[abs_dir] = dir_files
    return dir_files

def _parse_solid_edge_custom_properties(file_path):
    props = {}
    if not olefile or not olefile.isOleFile(file_path):
        return props
    try:
        ole = olefile.OleFileIO(file_path)
        if ole.exists(['\x05DocumentSummaryInformation']):
            data = ole.openstream(['\x05DocumentSummaryInformation']).read()
            
            import struct
            if len(data) >= 28:
                num_sections = struct.unpack('<I', data[24:28])[0]
                
                # Pass 1: Find Codepage globally
                codepage = 1252
                for sec_idx in range(num_sections):
                    start = 28 + sec_idx * 20
                    if start + 20 <= len(data):
                        set_offset = struct.unpack('<I', data[start + 16 : start + 20])[0]
                        if set_offset + 8 <= len(data):
                            sec_data = data[set_offset:]
                            sec_size, num_props = struct.unpack('<II', sec_data[:8])
                            for i in range(num_props):
                                idx = 8 + i*8
                                if idx + 8 <= len(sec_data):
                                    p_id, p_offset = struct.unpack('<II', sec_data[idx : idx + 8])
                                    if p_id == 1:
                                        off = p_offset
                                        if off + 6 <= len(sec_data):
                                            type_tag = struct.unpack('<I', sec_data[off : off + 4])[0]
                                            if type_tag == 2: # VT_I2
                                                codepage = struct.unpack('<h', sec_data[off + 4 : off + 6])[0]
                                                
                # Pass 2: Parse Dictionary and properties for each section
                for sec_idx in range(num_sections):
                    start = 28 + sec_idx * 20
                    if start + 20 <= len(data):
                        set_offset = struct.unpack('<I', data[start + 16 : start + 20])[0]
                        if set_offset + 8 <= len(data):
                            sec_data = data[set_offset:]
                            sec_size, num_props = struct.unpack('<II', sec_data[:8])
                            
                            # Read property offsets
                            prop_entries = []
                            for i in range(num_props):
                                idx = 8 + i*8
                                if idx + 8 <= len(sec_data):
                                    p_id, p_offset = struct.unpack('<II', sec_data[idx : idx + 8])
                                    prop_entries.append((p_id, p_offset))
                                    
                            pid_to_name = {}
                            for p_id, p_offset in prop_entries:
                                if p_id == 0: # Dictionary
                                    off = p_offset
                                    if off + 4 <= len(sec_data):
                                        num_entries = struct.unpack('<I', sec_data[off : off + 4])[0]
                                        off += 4
                                        for _ in range(num_entries):
                                            if off + 8 <= len(sec_data):
                                                d_pid, name_len = struct.unpack('<II', sec_data[off : off + 8])
                                                off += 8
                                                if codepage == 1200: # UTF-16
                                                    raw_name = sec_data[off : off + name_len * 2]
                                                    name = raw_name.decode('utf-16le', errors='ignore').split('\x00')[0]
                                                    off += name_len * 2
                                                    off = (off + 3) & ~3
                                                else: # ANSI
                                                    raw_name = sec_data[off : off + name_len]
                                                    name = raw_name.decode('latin1', errors='ignore').split('\x00')[0]
                                                    off += name_len
                                                pid_to_name[d_pid] = name
                                                
                            # Read property values
                            for p_id, p_offset in prop_entries:
                                if p_id in [0, 1]:
                                    continue
                                name = pid_to_name.get(p_id)
                                if not name:
                                    continue
                                off = p_offset
                                if off + 4 <= len(sec_data):
                                    type_tag = struct.unpack('<I', sec_data[off : off + 4])[0]
                                    val = None
                                    if type_tag == 30: # VT_LPSTR
                                        if off + 8 <= len(sec_data):
                                            str_len = struct.unpack('<I', sec_data[off + 4 : off + 8])[0]
                                            if off + 8 + str_len <= len(sec_data):
                                                val = sec_data[off + 8 : off + 8 + str_len].split(b'\x00')[0].decode('latin1', errors='ignore').strip()
                                    elif type_tag == 31: # VT_LPWSTR
                                        if off + 8 <= len(sec_data):
                                            char_len = struct.unpack('<I', sec_data[off + 4 : off + 8])[0]
                                            if off + 8 + char_len*2 <= len(sec_data):
                                                val = sec_data[off + 8 : off + 8 + char_len*2].decode('utf-16le', errors='ignore').split('\x00')[0].strip()
                                    elif type_tag == 5: # VT_R8
                                        if off + 12 <= len(sec_data):
                                            val = struct.unpack('<d', sec_data[off + 4 : off + 12])[0]
                                    elif type_tag == 3: # VT_I4
                                        if off + 8 <= len(sec_data):
                                            val = struct.unpack('<i', sec_data[off + 4 : off + 8])[0]
                                    elif type_tag == 11: # VT_BOOL
                                        if off + 6 <= len(sec_data):
                                            val = struct.unpack('<H', sec_data[off + 4 : off + 6])[0] != 0
                                    if val is not None:
                                        props[name] = val
        ole.close()
    except Exception:
        pass
    return props


def extract_ole_metadata(file_path):
    """
    Extracts metadata from Siemens Solid Edge & SolidWorks OLE compound files (.asm, .psm, .par, .sldprt, .sldasm).
    Uses fast stream inspection (first 512KB) and cached directory indexing for instant performance.
    """
    custom_props = _parse_solid_edge_custom_properties(file_path)
    
    res = {
        "status": "success",
        "file_path": file_path,
        "filename": os.path.basename(file_path),
        "author": "",
        "creating_app": "Solid Edge",
        "template": "",
        "material": "Default Steel",
        "thickness": 2.0,
        "kfactor": 0.44,
        "bend_radius": 1.0,
        "linked_parts": [],
        "linked_part_paths": [],
        "custom_properties": custom_props
    }
    
    # Extract thickness if present in custom properties
    if "Material Thickness" in custom_props:
        try:
            val_str = custom_props["Material Thickness"].replace("mm", "").strip()
            res["thickness"] = float(val_str)
        except ValueError:
            pass
            
    # Extract K-Factor (Neutral Factor) if present in custom properties
    if "Neutral Factor" in custom_props:
        try:
            res["kfactor"] = float(custom_props["Neutral Factor"])
        except ValueError:
            pass

    # Extract bend radius if present in custom properties
    if "Bend Radius" in custom_props:
        try:
            val_str = custom_props["Bend Radius"].replace("mm", "").strip()
            res["bend_radius"] = float(val_str)
        except ValueError:
            pass

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
        # Read only the first 512KB of binary stream (OLE metadata/headers are always at the beginning)
        with open(file_path, 'rb') as f:
            raw_data = f.read(524288)

        ext = os.path.splitext(file_path)[1].lower()
        unique_links = []
        resolved_paths = []

        # ONLY extract linked component parts if file is an assembly (.asm, .sldasm)
        if ext in ('.asm', '.sldasm'):
            linked = re.findall(b'([a-zA-Z0-9_\\-\\s]+\\.(?:psm|par|sldprt|sldasm|asm|step|stp|dxf))', raw_data, re.IGNORECASE)
            dir_files = get_cached_dir_files(base_dir)

            for l in linked:
                name = l.decode('latin1', errors='ignore').strip()
                name = re.sub(r'[\x00-\x1f\x7f-\xff]', '', name).strip()
                if name and len(name) > 3 and name.lower() not in [u.lower() for u in unique_links] and name.lower() != os.path.basename(file_path).lower():
                    unique_links.append(name)
                    if name.lower() in dir_files:
                        resolved_paths.append(dir_files[name.lower()])

        res["linked_parts"] = unique_links
        res["linked_part_paths"] = resolved_paths

        # Search for material strings from the shared catalog (occ_unfold_bridge.MATERIAL_CATALOG
        # is the single source of truth for material name aliases).
        catalog_mats = [entry[0] for entry in MATERIAL_CATALOG]

        u16_raw = raw_data.decode('utf-16le', errors='ignore').upper()
        u8_raw = raw_data.decode('utf-8', errors='ignore').upper()

        found_mat = None
        for cm in catalog_mats:
            pattern = cm.upper()
            if pattern in u16_raw or pattern in u8_raw:
                found_mat = cm
                break

        if found_mat:
            res["material"] = found_mat
        else:
            res["material"] = "Mild Steel"

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

def resolve_assembly_psm_children(asm_path):
    """
    Scans an .asm assembly's OLE streams for linked component filenames and
    returns only its sheet-metal .psm children (resolved to absolute paths),
    excluding non-sheet-metal accessories (.par, .sldprt, etc.) and the
    assembly file itself.
    """
    metadata = extract_ole_metadata(asm_path)
    children = []
    seen = set()
    base_dir = os.path.dirname(os.path.abspath(asm_path))
    dir_files = get_cached_dir_files(base_dir)

    for name in metadata.get("linked_parts", []):
        if not name.lower().endswith(".psm"):
            continue
        key = name.lower()
        if key in seen:
            continue
        resolved_path = dir_files.get(key)
        if not resolved_path:
            continue
        seen.add(key)
        children.append({"name": name, "psm_path": resolved_path})

    return children


def convert_assembly_batch(asm_path, output_dir):
    """
    Resolves an assembly's .psm children and converts each to STEP using a
    single shared Solid Edge COM session (one launch, one quit), avoiding the
    cost of relaunching Solid Edge per part.
    """
    children = resolve_assembly_psm_children(asm_path)
    if not children:
        return {"status": "error", "error": "No linked .psm sheet-metal parts found in assembly.", "parts": []}

    try:
        import win32com.client
    except ImportError:
        return {"status": "error", "error": "win32com library not available in Python environment.", "parts": []}

    os.makedirs(output_dir, exist_ok=True)

    se_app = None
    was_app_already_running = True
    try:
        try:
            se_app = win32com.client.GetActiveObject("SolidEdge.Application")
        except Exception:
            was_app_already_running = False

        if not se_app:
            se_app = win32com.client.Dispatch("SolidEdge.Application")

        try:
            se_app.Visible = False
            se_app.DisplayAlerts = False
            if hasattr(se_app, "ScreenUpdating"):
                se_app.ScreenUpdating = False
            if hasattr(se_app, "DelayCompute"):
                se_app.DelayCompute = True
        except Exception:
            pass

        global_cache_dir = os.path.join(os.path.expanduser("~"), ".cadanest_cache", "converted_step")
        os.makedirs(global_cache_dir, exist_ok=True)

        results = []
        for child in children:
            psm_path = child["psm_path"]
            base_no_ext = os.path.splitext(os.path.basename(psm_path))[0]
            output_step = os.path.join(output_dir, f"{base_no_ext}.step")

            # Check persistent global cache first
            mtime_str = str(os.path.getmtime(psm_path)) if os.path.exists(psm_path) else "0"
            cached_step_name = f"{base_no_ext}_{mtime_str}.step"
            cached_step_path = os.path.join(global_cache_dir, cached_step_name)

            if os.path.exists(cached_step_path) and os.path.getsize(cached_step_path) > 100:
                if not os.path.exists(output_step) or os.path.getsize(output_step) <= 100:
                    import shutil
                    shutil.copyfile(cached_step_path, output_step)
                child_meta = extract_ole_metadata(psm_path)
                results.append({
                    "name": child["name"],
                    "psm_path": psm_path,
                    "file_path": psm_path,
                    "step_path": output_step,
                    "metadata": child_meta,
                    "status": "success"
                })
                continue

            # Check local output_dir STEP representation (cache hit)
            if os.path.exists(output_step) and os.path.getsize(output_step) > 100:
                child_meta = extract_ole_metadata(psm_path)
                results.append({
                    "name": child["name"],
                    "psm_path": psm_path,
                    "file_path": psm_path,
                    "step_path": output_step,
                    "metadata": child_meta,
                    "status": "success"
                })
                continue

            doc = None
            was_doc_already_open = False
            try:
                try:
                    if hasattr(se_app, "ActiveDocument") and se_app.ActiveDocument:
                        active_doc = se_app.ActiveDocument
                        if os.path.basename(active_doc.FullName).lower() == os.path.basename(psm_path).lower():
                            doc = active_doc
                            was_doc_already_open = True
                except Exception:
                    pass

                if not doc:
                    doc = se_app.Documents.Open(psm_path)

                if not doc:
                    results.append({"name": child["name"], "psm_path": psm_path, "file_path": psm_path, "status": "error", "error": "Failed to open document."})
                    continue

                if os.path.exists(output_step):
                    try:
                        os.remove(output_step)
                    except Exception:
                        pass

                doc.SaveAs(output_step)

                if os.path.exists(output_step):
                    try:
                        import shutil
                        shutil.copyfile(output_step, cached_step_path)
                    except Exception:
                        pass
                    child_meta = extract_ole_metadata(psm_path)
                    results.append({
                        "name": child["name"],
                        "psm_path": psm_path,
                        "file_path": psm_path,
                        "step_path": output_step,
                        "metadata": child_meta,
                        "status": "success"
                    })
                else:
                    results.append({"name": child["name"], "psm_path": psm_path, "file_path": psm_path, "status": "error", "error": "STEP export did not produce an output file."})
            except Exception as ex:
                results.append({"name": child["name"], "psm_path": psm_path, "file_path": psm_path, "status": "error", "error": str(ex)})
            finally:
                if doc and not was_doc_already_open:
                    try:
                        doc.Close(False)
                    except Exception:
                        pass

        return {"status": "success", "parts": results}
    except Exception as ex:
        return {"status": "error", "error": f"Assembly batch conversion error: {str(ex)}", "parts": []}
    finally:
        if se_app and not was_app_already_running:
            try:
                se_app.Quit()
            except Exception:
                pass
        if se_app and not was_app_already_running:
            try:
                se_app.Quit()
            except Exception:
                pass


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
            BRepMesh_IncrementalMesh(shape, 1.0).Perform()
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

    # Look for matching pre-flattened DXF representations using cached directory index
    dir_files = get_cached_dir_files(base_dir)
    dxf_target_name = f"{base_no_ext}.dxf".lower()
    matching_dxf = dir_files.get(dxf_target_name)

    if matching_dxf:
        res["dxf_path"] = matching_dxf

    if step_analysis:
        res["step_path"] = step_analysis["step_path"]
        res["analysis"] = step_analysis
        res["thickness"] = step_analysis["thickness"]

    return res

def extract_sub_solids_from_step(step_path, out_dir):
    """
    If a STEP file contains multiple distinct TopAbs_SOLID sub-shapes (multi-body assembly STEP),
    extracts each solid into an individual STEP file in out_dir and returns a list of dicts.
    """
    try:
        from OCC.Core.STEPControl import STEPControl_Reader, STEPControl_AsIs, STEPControl_Writer
        from OCC.Core.IFSelect import IFSelect_RetDone
        from OCC.Core.TopExp import TopExp_Explorer
        from OCC.Core.TopAbs import TopAbs_SOLID
        from OCC.Core.TopoDS import topods

        reader = STEPControl_Reader()
        if reader.ReadFile(step_path) != IFSelect_RetDone:
            return []

        reader.TransferRoots()
        shape = reader.OneShape()
        if not shape:
            return []

        exp = TopExp_Explorer(shape, TopAbs_SOLID)
        solids = []
        while exp.More():
            solids.append(topods.Solid(exp.Current()))
            exp.Next()

        if len(solids) <= 1:
            return []

        extracted = []
        base_name = os.path.splitext(os.path.basename(step_path))[0]
        sub_dir = os.path.join(out_dir, "extracted_parts")
        os.makedirs(sub_dir, exist_ok=True)

        for idx, sol in enumerate(solids, 1):
            part_name = f"{base_name}_Part_{idx}.step"
            part_path = os.path.join(sub_dir, part_name)

            if not os.path.exists(part_path):
                writer = STEPControl_Writer()
                writer.Transfer(sol, STEPControl_AsIs)
                writer.Write(part_path)

            extracted.append({
                "name": part_name,
                "path": part_path,
                "solid_index": idx
            })

        return extracted
    except Exception:
        return []

def build_assembly_tree(file_path):
    """
    Parses an assembly file (.asm, .sldasm, .step, .stp) and constructs a structured
    hierarchical tree of all child parts, marking whether each is a flattenable sheet metal part,
    and flagging missing sub-assemblies/parts with missing: True.
    """
    base_name = os.path.basename(file_path)
    base_dir = os.path.dirname(os.path.abspath(file_path))
    meta = extract_ole_metadata(file_path)

    ext = os.path.splitext(file_path)[1].lower()
    # Parse linked assembly children for assembly files (.asm, .sldasm) or multi-body (.step, .stp)
    if ext in (".asm", ".sldasm"):
        linked_parts = meta.get("linked_parts", [])
        resolved_paths = meta.get("linked_part_paths", [])
    elif ext in (".step", ".stp"):
        linked_parts = []
        extracted = extract_sub_solids_from_step(file_path, base_dir)
        resolved_paths = [e["path"] for e in extracted]
    else:
        linked_parts = []
        resolved_paths = []

    children_nodes = []
    seen = set()

    # 1. Process resolved paths
    for idx, rel_path in enumerate(resolved_paths):
        child_name = os.path.basename(rel_path)
        if child_name.lower() in seen or child_name.lower() == base_name.lower():
            continue
        seen.add(child_name.lower())

        exists = os.path.exists(rel_path)
        ext = os.path.splitext(child_name)[1].lower()
        is_psm = ext == ".psm"
        is_dxf = ext == ".dxf"
        is_step = ext in (".step", ".stp")
        
        is_sheet = (is_psm or is_dxf or is_step) and exists

        child_meta = extract_ole_metadata(rel_path) if exists else {}
        thick = child_meta.get("thickness", meta.get("thickness", 2.0))

        children_nodes.append({
            "id": f"node_{idx}_{child_name}",
            "name": child_name,
            "path": rel_path,
            "exists": exists,
            "missing": not exists,
            "status": "ok" if exists else "missing",
            "isSheetMetal": is_sheet,
            "thickness": float(thick),
            "material": child_meta.get("material", meta.get("material", "Default Steel")),
            "selected": is_sheet,
            "children": []
        })

    # 2. Process unresolved linked parts (missing on disk)
    for idx, part_name in enumerate(linked_parts):
        if part_name.lower() in seen or part_name.lower() == base_name.lower():
            continue
        seen.add(part_name.lower())

        children_nodes.append({
            "id": f"node_missing_{idx}_{part_name}",
            "name": part_name,
            "path": os.path.join(base_dir, part_name),
            "exists": False,
            "missing": True,
            "status": "missing",
            "isSheetMetal": False,
            "thickness": float(meta.get("thickness", 2.0)),
            "material": meta.get("material", "Default Steel"),
            "selected": False,
            "children": []
        })

    root_node = {
        "id": f"root_{base_name}",
        "name": base_name,
        "path": file_path,
        "exists": os.path.exists(file_path),
        "missing": not os.path.exists(file_path),
        "isSheetMetal": False,
        "thickness": float(meta.get("thickness", 2.0)),
        "material": meta.get("material", "Default Steel"),
        "selected": True,
        "children": children_nodes
    }

    return {
        "status": "success",
        "assembly_file": file_path,
        "tree": root_node,
        "total_parts": len(children_nodes),
        "sheet_metal_parts": sum(1 for c in children_nodes if c["isSheetMetal"]),
        "missing_parts": sum(1 for c in children_nodes if c.get("missing"))
    }



if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "parse_assembly":
        if len(sys.argv) < 3:
            print(json.dumps({"status": "error", "error": "Usage: python solid_edge_bridge.py parse_assembly <asm_path>"}))
            sys.exit(1)
        asm_file = sys.argv[2]
        tree_res = build_assembly_tree(asm_file)
        print(json.dumps(tree_res))
        sys.exit(0)

    if len(sys.argv) > 1 and sys.argv[1] == "--assembly":
        if len(sys.argv) < 3:
            print(json.dumps({"status": "error", "error": "Usage: python solid_edge_bridge.py --assembly <asm_path> [export_dir]", "parts": []}))
            sys.exit(1)
        asm_file = sys.argv[2]
        out_dir = sys.argv[3] if len(sys.argv) > 3 else os.path.dirname(os.path.abspath(asm_file))
        result = convert_assembly_batch(asm_file, out_dir)
        print(json.dumps(result))
        sys.exit(0)

    if len(sys.argv) < 2:
        print(json.dumps({"status": "error", "error": "Usage: python solid_edge_bridge.py <cad_file_path> [export_dir]"}))
        sys.exit(1)

    cad_file = sys.argv[1]
    out_dir = sys.argv[2] if len(sys.argv) > 2 else os.path.dirname(os.path.abspath(cad_file))

    result = process_cad_file(cad_file, out_dir)
    print(json.dumps(result))

