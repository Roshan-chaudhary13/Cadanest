import sys
import os
import json
import re
import uuid

# ── FreeCAD path resolution ──────────────────────────────────────────────────
# Prefer portable FreeCAD next to this project; fall back to system install.
_SCRIPT_DIR   = os.path.dirname(os.path.abspath(__file__))
_PROJECT_ROOT = os.path.normpath(os.path.join(_SCRIPT_DIR, "..", ".."))
_PORTABLE_BIN = os.path.join(_PROJECT_ROOT, "FreeCAD_1.1.1-Windows-x86_64-py311", "bin")

FREECAD_BIN_PATH = _PORTABLE_BIN if os.path.isdir(_PORTABLE_BIN) else r"C:\Program Files\FreeCAD 1.1\bin"

if FREECAD_BIN_PATH not in sys.path:
    sys.path.insert(0, FREECAD_BIN_PATH)

try:
    import FreeCAD
    import Part
    import TechDraw
    import MeshPart
except Exception as e:
    print(json.dumps({"status": "error", "error": f"Failed to import FreeCAD libraries: {str(e)}"}))
    sys.exit(1)

def estimate_thickness_from_shape(part_shape):
    try:
        # Prevent O(N^2) hanging on parts with complex tessellation
        total_faces = len(part_shape.Faces)
        if total_faces > 120:
            return 2.0
            
        cylinder_count = 0
        for face in part_shape.Faces:
            if face.Surface and "Cylinder" in type(face.Surface).__name__:
                cylinder_count += 1
        
        if cylinder_count > 20:
            return 2.0

        from SheetMetalNewUnfolder import EstimateThickness
        thickness = EstimateThickness.from_cylinders(part_shape)
        if thickness <= 0.0:
            thickness = EstimateThickness.from_normal_edges(part_shape, 0)
        
        if thickness <= 0.0 or thickness > 150.0: # Sanity check for thickness limit
            return 2.0
        return thickness
    except Exception:
        return 2.0

def get_face_normal(face):
    try:
        if face.Surface and "Plane" in type(face.Surface).__name__:
            return face.Surface.Axis
        
        # For non-planar surfaces, sample the surface normal at parameter center
        uv = face.ParameterRange
        u = (uv[0] + uv[1]) / 2.0
        v = (uv[2] + uv[3]) / 2.0
        return face.normalAt(u, v)
    except Exception:
        return FreeCAD.Base.Vector(0.0, 0.0, 1.0)

def generate_svg_viewbox(svg_geom):
    d_paths = re.findall(r'd\s*=\s*"\s*([^"]+)"', svg_geom)
    x_coords = []
    y_coords = []
    for path in d_paths:
        coords = [float(x) for x in re.findall(r'[-+]?\d*\.?\d+', path)]
        for i in range(0, len(coords) - 1, 2):
            x_coords.append(coords[i])
            y_coords.append(coords[i+1])
    
    if x_coords and y_coords:
        min_x, max_x = min(x_coords), max(x_coords)
        min_y, max_y = min(y_coords), max(y_coords)
        w = max_x - min_x
        h = max_y - min_y
        pad_x = w * 0.08 if w > 0 else 10
        pad_y = h * 0.08 if h > 0 else 10
        return f"{min_x - pad_x} {min_y - pad_y} {w + 2*pad_x} {h + 2*pad_y}"
    return "-200 -200 400 400"

def generate_3d_preview(part_shape, export_svg_path):
    try:
        # Project shape with isometric vector (1, 1, 1)
        direction = FreeCAD.Base.Vector(1.0, 1.0, 1.0)
        svg_geom = TechDraw.projectToSVG(part_shape, direction)
        
        view_box_str = generate_svg_viewbox(svg_geom)
            
        full_svg = (
            f'<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n'
            f'<svg viewBox="{view_box_str}" xmlns="http://www.w3.org/2000/svg" version="1.1" width="100%" height="100%">\n'
            f'<style>\n'
            f'  svg {{ background: transparent !important; }}\n'
            f'  path {{ stroke: #00A3FF !important; stroke-width: 0.8px !important; fill: none !important; stroke-linecap: round !important; stroke-linejoin: round !important; }}\n'
            f'  circle {{ stroke: #8A90B4 !important; stroke-width: 0.8px !important; fill: none !important; }}\n'
            f'</style>\n'
            f'{svg_geom}\n'
            f'</svg>'
        )
        
        os.makedirs(os.path.dirname(os.path.abspath(export_svg_path)), exist_ok=True)
        with open(export_svg_path, 'w', encoding='utf-8') as f:
            f.write(full_svg)
        return True
    except Exception as e:
        return False

def post_process_flat_svg(svg_path):
    try:
        if not os.path.exists(svg_path):
            return
        with open(svg_path, 'r', encoding='utf-8') as f:
            content = f.read()
            
        style_block = (
            "<style>\n"
            "  svg { background: transparent !important; }\n"
            "  path[stroke='#c00000'] { stroke: #E2E4F0 !important; stroke-width: 1.0px !important; }\n"
            "  path[stroke='#ff5733'] { stroke: #FF5733 !important; stroke-dasharray: 4,4 !important; stroke-width: 0.8px !important; }\n"
            "  path[stroke='#000080'] { stroke: #00A3FF !important; stroke-width: 0.8px !important; }\n"
            "  circle[stroke='#c00000'] { stroke: #E2E4F0 !important; stroke-width: 1.0px !important; }\n"
            "  circle[stroke='#ff5733'] { stroke: #FF5733 !important; stroke-width: 0.8px !important; }\n"
            "  circle[stroke='#000000'] { stroke: #8A90B4 !important; stroke-width: 0.8px !important; }\n"
            "  circle { stroke: #8A90B4 !important; }\n"
            "  path { stroke: #E2E4F0 !important; }\n"
            "</style>\n"
        )
        
        svg_start = content.find('<svg')
        if svg_start != -1:
            tag_end = content.find('>', svg_start)
            if tag_end != -1:
                content = content[:tag_end+1] + "\n" + style_block + content[tag_end+1:]
                
        with open(svg_path, 'w', encoding='utf-8') as f:
            f.write(content)
    except Exception as e:
        pass

def analyze_only(step_path, export_svg_preview_path, export_stl_path):
    doc_name = "AnalyzeDoc_" + str(uuid.uuid4()).replace("-", "_")
    try:
        if not os.path.exists(step_path):
            return {"status": "error", "error": f"Step file not found: {step_path}"}

        doc = FreeCAD.newDocument(doc_name)
        part_shape = Part.read(step_path)
        if not part_shape or part_shape.isNull():
            return {"status": "error", "error": "Failed to read solid shape from STEP file."}

        # Bounding box dimensions
        bb = part_shape.BoundBox
        dims = {
            "x": bb.XLength,
            "y": bb.YLength,
            "z": bb.ZLength
        }
        volume = part_shape.Volume
        surface_area = part_shape.Area

        # Analyze faces
        faces_meta = []
        planar_faces = []
        for i, face in enumerate(part_shape.Faces):
            surface_type = type(face.Surface).__name__
            face_name = f"Face{i + 1}"
            faces_meta.append({
                "name": face_name,
                "type": surface_type,
                "area": face.Area
            })
            if surface_type == "Plane":
                planar_faces.append((i + 1, face.Area))

        planar_faces.sort(key=lambda x: x[1], reverse=True)
        thickness = estimate_thickness_from_shape(part_shape)
        
        try:
            from occ_unfold_bridge import auto_discover_base_faces
            from unfold.step_loader import load_step_file, extract_faces
            from unfold.face_graph import classify_face
            occ_shape = load_step_file(step_path)
            occ_faces = extract_faces(occ_shape)
            occ_class = [classify_face(f) for f in occ_faces]
            default_base_face = auto_discover_base_faces(occ_shape, occ_faces, occ_class, thickness)
        except Exception:
            default_base_face = f"Face{planar_faces[0][0]}" if planar_faces else None

        # Generate 3D preview SVG
        preview_success = generate_3d_preview(part_shape, export_svg_preview_path)

        # Export 3D STL mesh for WebGL rendering using fast MeshPart
        os.makedirs(os.path.dirname(os.path.abspath(export_stl_path)), exist_ok=True)
        mesh = MeshPart.meshFromShape(Shape=part_shape, LinearDeflection=0.5, AngularDeflection=0.5)
        mesh.write(export_stl_path)
        stl_success = os.path.exists(export_stl_path)

        # Export individual planar face STL files for selective highlighting in Three.js
        for idx in range(len(part_shape.Faces)):
            face = part_shape.Faces[idx]
            if type(face.Surface).__name__ == "Plane":
                face_stl_path = export_stl_path.replace(".stl", f"_face_{idx + 1}.stl")
                try:
                    face_mesh = MeshPart.meshFromShape(Shape=face, LinearDeflection=0.2, AngularDeflection=0.2)
                    face_mesh.write(face_stl_path)
                except Exception:
                    pass

        return {
            "status": "success",
            "thickness": thickness,
            "base_face": default_base_face,
            "planar_face_count": len(planar_faces),
            "total_face_count": len(part_shape.Faces),
            "preview_generated": preview_success,
            "stl_generated": stl_success,
            "dimensions": dims,
            "volume": volume,
            "area": surface_area,
            "faces": faces_meta
        }
    except Exception as ex:
        return {"status": "error", "error": f"Exception during analysis: {str(ex)}"}
    finally:
        try:
            FreeCAD.closeDocument(doc_name)
        except:
            pass

def analyze_and_unfold(step_path, kfactor, export_dxf_path, export_svg_path, base_face_name=None, exclude_bend_lines=False, bend_line_style="tick"):
    """
    Unfold a sheet-metal STEP file using the OCC-based engine.
    Returns a JSON-serialisable dict compatible with the Cadanest IPC protocol.
    """
    # Ensure backend dir is on path so occ_unfold_bridge can import unfold package
    _backend_dir = os.path.dirname(os.path.abspath(__file__))
    if _backend_dir not in sys.path:
        sys.path.insert(0, _backend_dir)

    try:
        from occ_unfold_bridge import unfold_with_occ
        result = unfold_with_occ(step_path, kfactor, export_dxf_path, export_svg_path, base_face_name, exclude_bend_lines, bend_line_style)
        return result
    except Exception as ex:
        import traceback
        return {
            "status": "error",
            "error": f"OCC unfold failed: {str(ex)}",
            "traceback": traceback.format_exc()
        }
        return {
            "status": "error",
            "error": f"OCC unfold bridge failed: {str(ex)}",
            "traceback": traceback.format_exc()
        }

def parse_dxf_file(dxf_path, export_svg_path=None):
    """
    Advanced DXF Parser & Viewer Engine:
    Extracts all 2D vector curves (Line, Polyline, Arc, Circle, Spline, Ellipse, Insert),
    inverts Y for correct SVG screen orientation, generates non-scaling stroke SVG
    with evenodd fill-rule for high-contrast vector silhouette artwork and CAD profiles.
    """
    try:
        import os
        import ezdxf
        from ezdxf import path

        filename = os.path.basename(dxf_path)
        if '__MACOSX' in dxf_path or filename.startswith('._'):
            raise ValueError(f"File '{filename}' is inside a __MACOSX archive folder containing macOS metadata, not a 2D DXF vector drawing file.")

        doc = None
        try:
            doc = ezdxf.readfile(dxf_path)
        except Exception as err1:
            try:
                from ezdxf import recover
                doc, auditor = recover.readfile(dxf_path)
            except Exception:
                try:
                    doc = ezdxf.readfile(dxf_path, encoding='cp1252')
                except Exception:
                    raise ValueError(f"File '{filename}' is not a valid DXF vector file or has corrupt structure ({str(err1)}).")

        msp = doc.modelspace()
        cut_entities = [e for e in msp if getattr(e.dxf, 'layer', '').upper() in ('CUT', 'OUTER', 'PROFILE', '0')]
        bend_entities = [e for e in msp if any(k in getattr(e.dxf, 'layer', '').upper() for k in ['BEND', 'FOLD', 'CENTER', 'AXIS', 'MARKER'])]
        
        if not cut_entities:
            cut_entities = [e for e in msp if e.dxftype() in ('LINE', 'LWPOLYLINE', 'POLYLINE', 'ARC', 'CIRCLE', 'SPLINE', 'ELLIPSE', 'INSERT', 'SOLID', '3DFACE') and e not in bend_entities]

        if not cut_entities and not bend_entities:
            cut_entities = [e for e in msp if e.dxftype() in ('LINE', 'LWPOLYLINE', 'POLYLINE', 'ARC', 'CIRCLE', 'SPLINE', 'ELLIPSE', 'INSERT', 'SOLID', '3DFACE')]

        path_strs = []
        bend_path_strs = []
        all_pts_svg = []
        all_pts_cad = []

        def process_entity(ent, is_bend=False):
            try:
                p = path.make_path(ent)
                pts = list(p.flattening(distance=0.08))
                if len(pts) >= 2:
                    cad_pts = [(v.x, v.y) for v in pts]
                    svg_pts = [(round(v.x, 3), round(-v.y, 3)) for v in pts] # Invert Y for SVG!
                    all_pts_cad.extend(cad_pts)
                    all_pts_svg.extend(svg_pts)
                    
                    d = f"M {svg_pts[0][0]} {svg_pts[0][1]} " + " ".join(f"L {pt[0]} {pt[1]}" for pt in svg_pts[1:])
                    if is_bend:
                        bend_path_strs.append(d)
                    else:
                        path_strs.append(d + " Z")
            except Exception:
                pass

        for entity in cut_entities:
            if entity.dxftype() == 'INSERT':
                try:
                    for sub in entity.virtual_entities():
                        process_entity(sub, is_bend=False)
                except Exception:
                    pass
            else:
                process_entity(entity, is_bend=False)

        for entity in bend_entities:
            if entity.dxftype() == 'INSERT':
                try:
                    for sub in entity.virtual_entities():
                        process_entity(sub, is_bend=True)
                except Exception:
                    pass
            else:
                process_entity(entity, is_bend=True)

        if not all_pts_cad:
            raise ValueError("Could not extract any vector points from DXF entities.")

        xs_cad = [p[0] for p in all_pts_cad]
        ys_cad = [p[1] for p in all_pts_cad]
        width = max(xs_cad) - min(xs_cad)
        height = max(ys_cad) - min(ys_cad)

        xs_svg = [p[0] for p in all_pts_svg]
        ys_svg = [p[1] for p in all_pts_svg]
        minx_svg, maxx_svg = min(xs_svg), max(xs_svg)
        miny_svg, maxy_svg = min(ys_svg), max(ys_svg)
        w_svg = maxx_svg - minx_svg
        h_svg = maxy_svg - miny_svg

        pad_x = max(w_svg * 0.04, 2.0)
        pad_y = max(h_svg * 0.04, 2.0)
        vb = f"{minx_svg-pad_x:.2f} {miny_svg-pad_y:.2f} {w_svg+2*pad_x:.2f} {h_svg+2*pad_y:.2f}"
        d_full = " ".join(path_strs)
        d_bend_full = " ".join(bend_path_strs)

        svg_content = (
            f'<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n'
            f'<svg viewBox="{vb}" xmlns="http://www.w3.org/2000/svg" width="100%" height="100%">\n'
            f'  <style>\n'
            f'    svg {{ background: transparent !important; }}\n'
            f'    path.cut {{ fill: rgba(0, 163, 255, 0.15) !important; fill-rule: evenodd !important; stroke: #38BDF8 !important; stroke-width: 1.5px !important; vector-effect: non-scaling-stroke !important; stroke-linecap: round !important; stroke-linejoin: round !important; }}\n'
            f'    path.fold {{ stroke: #10B981 !important; stroke-width: 3.5px !important; fill: none !important; vector-effect: non-scaling-stroke !important; stroke-linecap: round !important; stroke-dasharray: 6,4 !important; }}\n'
            f'  </style>\n'
            f'  <path class="cut" vector-effect="non-scaling-stroke" fill-rule="evenodd" d="{d_full}" />\n'
            f'  <path class="fold" vector-effect="non-scaling-stroke" d="{d_bend_full}" />\n'
            f'</svg>'
        )

        if export_svg_path:
            with open(export_svg_path, 'w', encoding='utf-8') as f:
                f.write(svg_content)

        return {
            "status": "success",
            "name": filename,
            "dxf_path": dxf_path,
            "thickness": 0.0,
            "dimensions": {"x": round(width, 2), "y": round(height, 2), "z": 0},
            "svg_preview_content": svg_content,
            "svg_preview_path": export_svg_path
        }
    except Exception as ex:
        import traceback
        return {
            "status": "error",
            "error": f"Failed to parse DXF file: {str(ex)}",
            "traceback": traceback.format_exc()
        }

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print(json.dumps({
            "status": "error", 
            "error": "Usage:\n  python unfolder.py analyze <step_path> <export_svg_preview_path> <export_stl_path>\n  python unfolder.py unfold <step_path> <kfactor> <export_dxf_path> <export_svg_path> [base_face_name] [exclude_bend_lines]\n  python unfolder.py parse_dxf <dxf_path> [export_svg_path]"
        }))
        sys.exit(1)

    mode = sys.argv[1]

    if mode == "analyze":
        if len(sys.argv) < 5:
            print(json.dumps({"status": "error", "error": "Missing arguments for analyze mode."}))
            sys.exit(1)
        step = sys.argv[2]
        svg_preview = sys.argv[3]
        stl_preview = sys.argv[4]
        result = analyze_only(step, svg_preview, stl_preview)
        print(json.dumps(result))
    elif mode == "parse_dxf":
        dxf = sys.argv[2]
        svg_out = sys.argv[3] if len(sys.argv) > 3 else None
        result = parse_dxf_file(dxf, svg_out)
        print(json.dumps(result))
    else:
        if len(sys.argv) < 6:
            print(json.dumps({"status": "error", "error": "Missing arguments for unfold mode."}))
            sys.exit(1)
        step = sys.argv[2]
        k_fact = sys.argv[3]
        dxf_out = sys.argv[4]
        svg_out = sys.argv[5]
        
        base_face = None
        exclude_bend = False
        bend_line_style = "tick"
        
        if len(sys.argv) > 6:
            arg6 = sys.argv[6]
            if arg6.lower() == "auto":
                base_face = None
            elif arg6.lower() in ("true", "false"):
                exclude_bend = (arg6.lower() == "true")
            else:
                base_face = arg6

            if len(sys.argv) > 7:
                arg7 = sys.argv[7]
                if arg7.lower() in ("true", "false"):
                    exclude_bend = (arg7.lower() == "true")
                    if len(sys.argv) > 8:
                        bend_line_style = sys.argv[8]
                else:
                    bend_line_style = arg7

        result = analyze_and_unfold(step, k_fact, dxf_out, svg_out, base_face, exclude_bend, bend_line_style)
        print(json.dumps(result))

