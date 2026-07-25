import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
// @ts-ignore
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';
// @ts-ignore
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader';
// @ts-ignore
import { DragControls } from 'three/examples/jsm/controls/DragControls';
import { RotateCw, Move, Maximize2 } from 'lucide-react';

const stlBufferCache = new Map<string, ArrayBuffer>();

interface Part3DInfo {
  id: string;
  name: string;
  stlPath: string;
}

interface FaceMeta {
  name: string;
  type: string;
  area: number;
}

interface Model3DViewerProps {
  onToggleFullScreen?: () => void;
  parts: Part3DInfo[];
  combinedView?: boolean;
  activeFace?: string | null;
  faces?: FaceMeta[];
  hoveredFaceName?: string | null;
  onFaceClick?: (faceName: string) => void;
  onFaceHover?: (faceName: string | null) => void;
  themeMode?: 'light' | 'dark';
}

export const Model3DViewer: React.FC<Model3DViewerProps> = ({ 
  parts, 
  combinedView = false,
  activeFace = null,
  faces = [],
  hoveredFaceName = null,
  onFaceClick,
  onFaceHover,
  themeMode = 'dark',
  onToggleFullScreen
}) => {
  const mountRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [enableDrag, setEnableDrag] = useState<boolean>(false);
  const [viewMode, setViewMode] = useState<'edges' | 'shaded' | 'wireframe' | 'flat'>('edges');

  // Keep references to clean up
  const sceneRef = useRef<THREE.Scene | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const dragControlsRef = useRef<any | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const meshesRef = useRef<THREE.Mesh[]>([]);
  const faceMeshesRef = useRef<THREE.Mesh[]>([]);
  const gridHelperRef = useRef<THREE.GridHelper | null>(null);

  const partsKey = parts.map((p) => `${p.id}:${p.stlPath}`).join(',');

  useEffect(() => {
    if (!mountRef.current || parts.length === 0) return;

    setLoading(true);
    setError(null);

    // 1. Setup Three.js Scene, Camera, Renderer
    const width = mountRef.current.clientWidth || 800;
    const height = mountRef.current.clientHeight || 500;

    const isDark = themeMode === 'dark';

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(isDark ? '#0F111E' : '#F0F2F7'); // Matching bg-industrial-bg dynamically
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 10000);
    camera.position.set(200, 200, 300);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(width, height);
    renderer.shadowMap.enabled = true;
    renderer.setPixelRatio(window.devicePixelRatio);
    
    // Clear old canvases
    mountRef.current.innerHTML = '';
    mountRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // 2. Add Lights
    // Ambient light: soft warm light in dark theme, neutral bright white in light theme
    const ambientLight = new THREE.AmbientLight(isDark ? 0x444466 : 0xffffff, isDark ? 2.8 : 2.2);
    scene.add(ambientLight);

    const dirLight1 = new THREE.DirectionalLight(0xffffff, 2.5);
    dirLight1.position.set(500, 500, 500);
    dirLight1.castShadow = true;
    scene.add(dirLight1);

    const dirLight2 = new THREE.DirectionalLight(isDark ? 0x33A3FF : 0x4488CC, isDark ? 1.5 : 1.0); // Soft accent fill
    dirLight2.position.set(-500, 300, -500);
    scene.add(dirLight2);

    const topLight = new THREE.DirectionalLight(0xffffff, 1.0);
    topLight.position.set(0, 1000, 0);
    scene.add(topLight);

    // 3. Add Orbit Controls
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.screenSpacePanning = true;
    controlsRef.current = controls;

    // Grid helper matching theme accents (dark slate vs light blue-grey)
    const gridHelper = isDark 
      ? new THREE.GridHelper(1000, 50, 0x262B44, 0x181B2B)
      : new THREE.GridHelper(1000, 50, 0xC2C8DC, 0xD8DCE8);
    gridHelper.position.y = -50;
    scene.add(gridHelper);
    gridHelperRef.current = gridHelper;

    // Clean up old meshes & drag controls
    meshesRef.current.forEach((m) => scene.remove(m));
    meshesRef.current = [];
    faceMeshesRef.current = [];
    if (dragControlsRef.current) {
      dragControlsRef.current.dispose();
      dragControlsRef.current = null;
    }

    // Raycaster variables
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    let lastHoveredFaceName: string | null = null;

    const onMouseMove = (event: MouseEvent) => {
      if (!rendererRef.current || !cameraRef.current || combinedView) return;

      const rect = rendererRef.current.domElement.getBoundingClientRect();
      mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

      raycaster.setFromCamera(mouse, cameraRef.current);
      const intersects = raycaster.intersectObjects(faceMeshesRef.current);

      if (intersects.length > 0) {
        const intersectedMesh = intersects[0].object as THREE.Mesh;
        const faceName = intersectedMesh.userData.faceName;
        
        if (faceName !== lastHoveredFaceName) {
          lastHoveredFaceName = faceName;
          if (onFaceHover) {
            onFaceHover(faceName);
          }
        }
        rendererRef.current.domElement.style.cursor = 'pointer';
      } else {
        if (lastHoveredFaceName !== null) {
          lastHoveredFaceName = null;
          if (onFaceHover) {
            onFaceHover(null);
          }
        }
        rendererRef.current.domElement.style.cursor = 'default';
      }
    };

    const onCanvasClick = (event: MouseEvent) => {
      if (!rendererRef.current || !cameraRef.current || combinedView) return;

      const rect = rendererRef.current.domElement.getBoundingClientRect();
      mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

      raycaster.setFromCamera(mouse, cameraRef.current);
      const intersects = raycaster.intersectObjects(faceMeshesRef.current);

      if (intersects.length > 0) {
        const clickedMesh = intersects[0].object as THREE.Mesh;
        const faceName = clickedMesh.userData.faceName;
        if (onFaceClick) {
          onFaceClick(faceName);
        }
      }
    };

    let downX = 0;
    let downY = 0;

    const onMouseDown = (event: MouseEvent) => {
      downX = event.clientX;
      downY = event.clientY;
    };

    const onMouseUp = (event: MouseEvent) => {
      const dx = event.clientX - downX;
      const dy = event.clientY - downY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      
      if (dist < 5) {
        onCanvasClick(event);
      }
    };

    const dom = renderer.domElement;
    dom.addEventListener('mousemove', onMouseMove);
    dom.addEventListener('mousedown', onMouseDown);
    dom.addEventListener('mouseup', onMouseUp);

    // Load STL files asynchronously
    const loader = new STLLoader();
    
    const loadAllParts = async () => {
      try {
        const loadedMeshes: THREE.Mesh[] = [];
        const spacing = 40; // spacer between parts in combined view

        // Fetch ArrayBuffers for all paths (with memory cache check)
        const fetchPromises = parts.map(async (part) => {
          if (stlBufferCache.has(part.stlPath)) {
            return { part, arrayBuffer: stlBufferCache.get(part.stlPath)! };
          }
          const arrayBuffer = await (window as any).electronAPI.getStlData(part.stlPath);
          if (!arrayBuffer) {
            throw new Error(`Failed to load STL data for part: ${part.name}`);
          }
          stlBufferCache.set(part.stlPath, arrayBuffer);
          return { part, arrayBuffer };
        });

        const results = await Promise.all(fetchPromises);

        // Compute layout offsets
        let currentXOffset = 0;

        for (const { part, arrayBuffer } of results) {
          const geometry = loader.parse(arrayBuffer);
          geometry.computeVertexNormals();

          // 1. Center geometry to its local origin FIRST before creating wireframe or mesh
          geometry.computeBoundingBox();
          const center = new THREE.Vector3();
          if (geometry.boundingBox) {
            geometry.boundingBox.getCenter(center);
            geometry.translate(-center.x, -center.y, -center.z);
          }

          // Steel material — vibrant blue, adjusted for theme contrast
          const material = new THREE.MeshStandardMaterial({
            color: isDark ? 0x33A3FF : 0x0073CC,        // Neon blue vs Deep industrial blue
            metalness: isDark ? 0.8 : 0.7,
            roughness: 0.3,
            side: THREE.DoubleSide
          });

          // 2. Create wireframe based on centered geometry (aligned perfectly)
          const wireframeGeom = new THREE.EdgesGeometry(geometry);
          const wireframeMat = new THREE.LineBasicMaterial({ 
            color: isDark ? 0x262B44 : 0x8A9CC0,        // Slate-blue vs Medium blue-grey
            linewidth: 1 
          });
          const wireframe = new THREE.LineSegments(wireframeGeom, wireframeMat);

          const mesh = new THREE.Mesh(geometry, material);
          mesh.add(wireframe);
          mesh.castShadow = true;
          mesh.receiveShadow = true;

          // Load and overlay all planar faces for selection & hover
          if (!combinedView && faces.length > 0) {
            const activeFaceNames = activeFace ? activeFace.split(',').filter(Boolean) : [];
            
            for (const f of faces) {
              if (f.type !== 'Plane') continue;
              
              const faceName = f.name;
              const faceIdx = faceName.replace('Face', '');
              const faceStlPath = part.stlPath.replace('.stl', `_face_${faceIdx}.stl`);
              
              try {
                let faceBuffer: ArrayBuffer | null = null;
                if (stlBufferCache.has(faceStlPath)) {
                  faceBuffer = stlBufferCache.get(faceStlPath)!;
                } else {
                  faceBuffer = await (window as any).electronAPI.getStlData(faceStlPath);
                  if (faceBuffer) {
                    stlBufferCache.set(faceStlPath, faceBuffer);
                  }
                }

                if (faceBuffer) {
                  const faceGeometry = loader.parse(faceBuffer);
                  faceGeometry.computeVertexNormals();

                  // Apply the exact same centering translation
                  if (center.lengthSq() > 0) {
                    faceGeometry.translate(-center.x, -center.y, -center.z);
                  }

                  const isActive = activeFaceNames.includes(faceName);
                  const isHovered = hoveredFaceName === faceName;

                  let color = isDark ? 0x33A3FF : 0x0073CC; // Base metal sheet color
                  let metalness = 0.7;
                  let roughness = 0.3;
                  let polygonOffsetFactor = -1;

                  if (isActive) {
                    color = isDark ? 0xF97316 : 0xE84D00; // Orange accent
                    metalness = 0.9;
                    roughness = 0.1;
                    polygonOffsetFactor = -4;
                  } else if (isHovered) {
                    color = isDark ? 0x33A3FF : 0x0073CC; // Blue accent
                    metalness = 0.8;
                    roughness = 0.2;
                    polygonOffsetFactor = -3;
                  }

                  const faceMaterial = new THREE.MeshStandardMaterial({
                    color,
                    metalness,
                    roughness,
                    side: THREE.DoubleSide,
                    polygonOffset: true,
                    polygonOffsetFactor,
                    polygonOffsetUnits: polygonOffsetFactor
                  });

                  const faceMesh = new THREE.Mesh(faceGeometry, faceMaterial);
                  faceMesh.name = faceName;
                  faceMesh.userData = { 
                    faceName, 
                    isActive,
                    defaultColor: isActive ? 0xFFB300 : 0x0073CC,
                    defaultMetalness: isActive ? 0.9 : 0.7,
                    defaultRoughness: isActive ? 0.1 : 0.3
                  };

                  mesh.add(faceMesh);
                  faceMeshesRef.current.push(faceMesh);
                }
              } catch (faceErr) {
                console.warn(`Could not load face mesh for ${faceName}:`, faceErr);
              }
            }
          }

          // 3. Positioning in the 3D world (Shift group center)
          if (combinedView) {
            mesh.position.set(currentXOffset, 0, 0);
            const sizeX = geometry.boundingBox ? (geometry.boundingBox.max.x - geometry.boundingBox.min.x) : 80;
            currentXOffset += sizeX + spacing;
          } else {
            mesh.position.set(0, 0, 0);
          }

          scene.add(mesh);
          loadedMeshes.push(mesh);
          meshesRef.current.push(mesh);
        }

        // 4. Center Camera on Meshes using direct geometry bounds calculation
        if (loadedMeshes.length > 0) {
          const overallBox = new THREE.Box3();
          loadedMeshes.forEach(mesh => {
            const geom = mesh.geometry;
            geom.computeBoundingBox();
            if (geom.boundingBox) {
              const bbox = geom.boundingBox.clone();
              bbox.translate(mesh.position);
              overallBox.union(bbox);
            }
          });

          const size = new THREE.Vector3();
          overallBox.getSize(size);
          const center = new THREE.Vector3();
          overallBox.getCenter(center);

          // Center the controls target
          if (combinedView) {
            controls.target.set(center.x, center.y, center.z);
          } else {
            controls.target.set(0, 0, 0);
          }

          // Dynamic grid helper scaling and positioning
          scene.remove(gridHelper); // Remove initial static grid helper
          const gridWidth = Math.max(1000, size.x * 2.5, size.z * 2.5);
          const newGridHelper = isDark 
            ? new THREE.GridHelper(gridWidth, 50, 0x262B44, 0x181B2B)
            : new THREE.GridHelper(gridWidth, 50, 0xC2C8DC, 0xD8DCE8);
          
          newGridHelper.position.set(
            combinedView ? center.x : 0,
            overallBox.min.y - 20, // Float exactly 20mm below the lowest point of any model
            combinedView ? center.z : 0
          );
          scene.add(newGridHelper);
          gridHelperRef.current = newGridHelper;

          // Adjust camera distance to fit all models in viewport
          const maxDim = Math.max(size.x, size.y, size.z) || 100;
          const fov = camera.fov * (Math.PI / 180);
          let cameraZ = Math.abs(maxDim / 2 / Math.tan(fov / 2));
          cameraZ *= 1.5; // Zoom out slightly for breathing room
          camera.position.set(cameraZ * 0.8, cameraZ * 0.8, cameraZ * 1.2);
          camera.lookAt(controls.target);
          controls.update();

          // 5. Initialize DragControls if dragging is enabled (Combined View only)
          if (combinedView && enableDrag) {
            const dragControls = new DragControls(loadedMeshes, camera, renderer.domElement);
            
            dragControls.addEventListener('dragstart', (event: any) => {
              controls.enabled = false;
              // Highlight the dragged mesh slightly
              event.object.material.color.setHex(0xFF5733); // Neon orange accent on drag
            });
            
            dragControls.addEventListener('dragend', (event: any) => {
              controls.enabled = true;
              event.object.material.color.setHex(0x0073CC); // Reset to deep blue
            });

            dragControlsRef.current = dragControls;
          }
        }

        setLoading(false);
      } catch (err: any) {
        console.error('Error loading STL mesh:', err);
        setError(err.message || 'Failed to load 3D mesh.');
        setLoading(false);
      }
    };

    loadAllParts();

    // 6. Animation Loop
    let animationId: number;
    const animate = () => {
      animationId = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    // 7. Handle Resize
    const handleResize = () => {
      if (!mountRef.current || !cameraRef.current || !rendererRef.current) return;
      const w = mountRef.current.clientWidth;
      const h = mountRef.current.clientHeight;

      cameraRef.current.aspect = w / h;
      cameraRef.current.updateProjectionMatrix();
      rendererRef.current.setSize(w, h);
    };

    const resizeObserver = new ResizeObserver(() => handleResize());
    resizeObserver.observe(mountRef.current);

    // Cleanup on unmount or updates
    return () => {
      cancelAnimationFrame(animationId);
      resizeObserver.disconnect();
      dom.removeEventListener('mousemove', onMouseMove);
      dom.removeEventListener('mousedown', onMouseDown);
      dom.removeEventListener('mouseup', onMouseUp);
      if (rendererRef.current && rendererRef.current.domElement) {
        rendererRef.current.dispose();
      }
      controls.dispose();
      if (dragControlsRef.current) {
        dragControlsRef.current.dispose();
      }
    };
  }, [partsKey, combinedView, enableDrag, themeMode]);

  // Lightweight effect to update face colors dynamically on selection or hover changes
  useEffect(() => {
    if (combinedView) return;
    
    const isDark = themeMode === 'dark';
    const activeFaceNames = activeFace ? activeFace.split(',').filter(Boolean) : [];
    
    faceMeshesRef.current.forEach((faceMesh) => {
      const faceName = faceMesh.userData.faceName;
      const isActive = activeFaceNames.includes(faceName);
      const isHovered = hoveredFaceName === faceName;
      
      const mat = faceMesh.material as THREE.MeshStandardMaterial;
      
      if (isActive) {
        mat.color.setHex(isDark ? 0xF97316 : 0xE84D00); // Orange / deep orange highlight
        mat.metalness = 0.9;
        mat.roughness = 0.1;
        mat.polygonOffsetFactor = -4;
        mat.polygonOffsetUnits = -4;
      } else if (isHovered) {
        mat.color.setHex(isDark ? 0x33A3FF : 0x0073CC); // Neon blue vs Deep industrial blue
        mat.metalness = 0.8;
        mat.roughness = 0.2;
        mat.polygonOffsetFactor = -3;
        mat.polygonOffsetUnits = -3;
      } else {
        mat.color.setHex(isDark ? 0x33A3FF : 0x0073CC); // Base metal sheet color
        mat.metalness = 0.7;
        mat.roughness = 0.3;
        mat.polygonOffsetFactor = -1;
        mat.polygonOffsetUnits = -1;
      }
      mat.needsUpdate = true;
    });
  }, [activeFace, hoveredFaceName, combinedView, themeMode]);

  // Dynamic View Mode updates (Wireframe, Shaded, Edges, Flat Render)
  useEffect(() => {
    const isDark = themeMode === 'dark';
    
    meshesRef.current.forEach((mesh) => {
      // Find the wireframe child
      const wireframe = mesh.children.find(c => c instanceof THREE.LineSegments) as THREE.LineSegments | undefined;
      
      // Ensure mesh is always visible so its children (wireframe) are visible
      mesh.visible = true;
      
      const setMaterialVisible = (visible: boolean) => {
        const applyVisibility = (m: any) => {
          m.transparent = true;
          m.opacity = visible ? 1 : 0;
          m.depthWrite = visible; // Prevent invisible materials from writing to depth buffer and culling the wireframe
        };
        if (Array.isArray(mesh.material)) {
          mesh.material.forEach(applyVisibility);
        } else if (mesh.material) {
          applyVisibility(mesh.material);
        }
      };

      if (viewMode === 'wireframe') {
        setMaterialVisible(false);
        if (wireframe) wireframe.visible = true;
      } else if (viewMode === 'shaded') {
        setMaterialVisible(true);
        if (wireframe) wireframe.visible = false;
        
        // Revert to standard material
        mesh.material = new THREE.MeshStandardMaterial({
          color: isDark ? 0x33A3FF : 0x0073CC,
          metalness: isDark ? 0.8 : 0.7,
          roughness: 0.3,
          side: THREE.DoubleSide
        });
      } else if (viewMode === 'edges') {
        setMaterialVisible(true);
        if (wireframe) wireframe.visible = true;
        
        // Revert to standard material
        mesh.material = new THREE.MeshStandardMaterial({
          color: isDark ? 0x33A3FF : 0x0073CC,
          metalness: isDark ? 0.8 : 0.7,
          roughness: 0.3,
          side: THREE.DoubleSide
        });
      } else if (viewMode === 'flat') {
        setMaterialVisible(true);
        if (wireframe) wireframe.visible = false;
        
        // Replace with Basic Material (no lighting calculations)
        mesh.material = new THREE.MeshBasicMaterial({
          color: isDark ? 0x8F9BBF : 0x8A9CC0, // Cool slate/gray metal color adjusted for theme contrast
          side: THREE.DoubleSide
        });
      }
    });
    
    // Also toggle face meshes visibility based on wireframe mode
    faceMeshesRef.current.forEach((faceMesh) => {
      faceMesh.visible = viewMode !== 'wireframe';
    });
  }, [viewMode, partsKey, themeMode]);

  const snapToView = (view: 'top' | 'front' | 'right' | 'iso') => {
    if (!cameraRef.current || !controlsRef.current) return;
    
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    const target = controls.target.clone();
    
    // Calculate overall bounding box of all meshes to determine dynamic distance
    const overallBox = new THREE.Box3();
    let hasMeshes = false;
    
    meshesRef.current.forEach(mesh => {
      const geom = mesh.geometry;
      geom.computeBoundingBox();
      if (geom.boundingBox) {
        const bbox = geom.boundingBox.clone();
        bbox.translate(mesh.position);
        overallBox.union(bbox);
        hasMeshes = true;
      }
    });
    
    let dist = 650; // Dynamic default fallback
    if (hasMeshes) {
      const size = new THREE.Vector3();
      overallBox.getSize(size);
      const maxDim = Math.max(size.x, size.y, size.z) || 100;
      const fov = camera.fov * (Math.PI / 180);
      let cameraZ = Math.abs(maxDim / 2 / Math.tan(fov / 2));
      cameraZ *= 2.8; // Zoom out by 2.8x for perfect viewing projection
      dist = Math.max(350, cameraZ);
    }
    
    let newPos = new THREE.Vector3();
    if (view === 'top') {
      newPos.set(target.x, target.y + dist, target.z + 0.01);
    } else if (view === 'front') {
      newPos.set(target.x, target.y, target.z + dist);
    } else if (view === 'right') {
      newPos.set(target.x + dist, target.y, target.z);
    } else if (view === 'iso') {
      const isoVal = dist / Math.sqrt(3);
      newPos.set(target.x + isoVal, target.y + isoVal, target.z + isoVal);
    }
    
    camera.position.copy(newPos);
    camera.lookAt(target);
    controls.update();
  };

  // Keyboard shortcut R to reset 3D view camera
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      // Only trigger if active target is not an input
      if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA') {
        return;
      }
      if (e.key === 'r' || e.key === 'R') {
        snapToView('iso');
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => {
      window.removeEventListener('keydown', handleGlobalKeyDown);
    };
  }, []);

  return (
    <div className="relative flex-1 h-full w-full bg-industrial-darker border border-industrial-border rounded-lg overflow-hidden flex flex-col">
      {/* 3D Loading Overlay */}
      {loading && (
        <div className="absolute inset-0 bg-industrial-darker/90 backdrop-blur z-20 flex flex-col items-center justify-center font-mono text-xs gap-3">
          <RotateCw className="text-industrial-accent animate-spin" size={32} />
          <span>RENDERING 3D WORKSPACE...</span>
        </div>
      )}

      {/* Error View */}
      {error && (
        <div className="absolute inset-0 bg-industrial-darker z-20 flex flex-col items-center justify-center font-mono text-xs text-red-400 gap-2 p-6 text-center">
          <AlertTriangle size={32} className="text-red-500" />
          <span className="font-bold text-sm">3D RENDER FAILURE</span>
          <span>{error}</span>
        </div>
      )}

      {/* View Modes Toggle Panel */}
      <div className="absolute top-3 left-3 z-10 flex items-center gap-1.5 bg-industrial-card/90 backdrop-blur border border-industrial-border p-1 rounded pointer-events-auto shadow-md">
        {combinedView && (
          <button 
            onClick={() => setEnableDrag(!enableDrag)}
            className={`px-2 py-1 rounded text-[10px] font-bold font-mono transition ${
              enableDrag 
                ? 'bg-industrial-orange text-white' 
                : 'text-industrial-muted hover:text-industrial-text hover:bg-industrial-border/30'
            }`}
            title={enableDrag ? 'Move Mode Active (Drag parts)' : 'Enable Part Dragging'}
          >
            {enableDrag ? 'Move Mode' : 'Drag Mode'}
          </button>
        )}
        {combinedView && <span className="text-industrial-border/60">|</span>}
        <span className="text-industrial-muted font-mono text-[9px] px-1 font-bold">VIEW:</span>
        <button
          onClick={() => setViewMode('edges')}
          className={`px-2 py-1 rounded text-[10px] font-bold font-mono transition ${
            viewMode === 'edges' ? 'bg-industrial-accent text-industrial-bg' : 'text-industrial-muted hover:text-industrial-text hover:bg-industrial-border/30'
          }`}
          title="Shaded with Edges render mode"
        >
          Edges
        </button>
        <button
          onClick={() => setViewMode('shaded')}
          className={`px-2 py-1 rounded text-[10px] font-bold font-mono transition ${
            viewMode === 'shaded' ? 'bg-industrial-accent text-industrial-bg' : 'text-industrial-muted hover:text-industrial-text hover:bg-industrial-border/30'
          }`}
          title="Shaded solid render mode"
        >
          Shaded
        </button>
        <button
          onClick={() => setViewMode('wireframe')}
          className={`px-2 py-1 rounded text-[10px] font-bold font-mono transition ${
            viewMode === 'wireframe' ? 'bg-industrial-accent text-industrial-bg' : 'text-industrial-muted hover:text-industrial-text hover:bg-industrial-border/30'
          }`}
          title="Wireframe line render mode"
        >
          Wire
        </button>
        <button
          onClick={() => setViewMode('flat')}
          className={`px-2 py-1 rounded text-[10px] font-bold font-mono transition ${
            viewMode === 'flat' ? 'bg-industrial-accent text-industrial-bg' : 'text-industrial-muted hover:text-industrial-text hover:bg-industrial-border/30'
          }`}
          title="Flat shading color mode (no lighting)"
        >
          Flat
        </button>
      </div>

      {/* 3D View Axis Snapper (Cube Overlay) */}
      <div className="absolute top-3 right-3 z-10 flex items-start gap-2 pointer-events-auto select-none">
        {onToggleFullScreen && (
          <button
            onClick={onToggleFullScreen}
            className="p-1.5 bg-industrial-card/95 border border-industrial-border hover:bg-industrial-accent hover:text-industrial-bg rounded shadow-lg transition cursor-pointer text-industrial-text flex items-center justify-center"
            title="Expand Viewport to Full Screen (Alt+F)"
          >
            <Maximize2 size={14} />
          </button>
        )}
        <div className="flex flex-col gap-1 bg-industrial-card/95 border border-industrial-border p-1.5 rounded shadow-lg w-16 text-center">
        <span className="text-[8px] text-industrial-muted font-bold font-sans tracking-wider uppercase border-b border-industrial-border pb-1 mb-1">SNAP VIEW</span>
        <button
          onClick={() => snapToView('top')}
          className="py-1 px-1 text-[9px] font-mono font-bold text-industrial-text hover:text-industrial-accent hover:bg-industrial-border/30 rounded transition cursor-pointer"
        >
          TOP
        </button>
        <button
          onClick={() => snapToView('front')}
          className="py-1 px-1 text-[9px] font-mono font-bold text-industrial-text hover:text-industrial-accent hover:bg-industrial-border/30 rounded transition cursor-pointer"
        >
          FRONT
        </button>
        <button
          onClick={() => snapToView('right')}
          className="py-1 px-1 text-[9px] font-mono font-bold text-industrial-text hover:text-industrial-accent hover:bg-industrial-border/30 rounded transition cursor-pointer"
        >
          RIGHT
        </button>
        <button
          onClick={() => snapToView('iso')}
          className="py-1 px-1 text-[9px] font-mono font-bold text-industrial-text hover:text-industrial-accent hover:bg-industrial-border/30 rounded transition cursor-pointer"
        >
          ISO
        </button>
        </div>
      </div>

      {/* Viewport Canvas Mount */}
      <div ref={mountRef} className="flex-1 w-full h-full relative overflow-hidden block" />

      {/* Interaction Tooltip */}
      <div className="absolute bottom-3 left-3 bg-industrial-card/90 backdrop-blur border border-industrial-border px-3 py-1.5 rounded text-[10px] font-mono text-industrial-muted flex gap-3 pointer-events-none">
        <span className="flex items-center gap-1"><Move size={10} /> Drag to Rotate</span>
        <span>•</span>
        <span>Right-Click to Pan</span>
        <span>•</span>
        <span>Scroll to Zoom</span>
        {combinedView && enableDrag && (
          <>
            <span>•</span>
            <span className="text-industrial-orange font-semibold">Left-Click Drag to move models</span>
          </>
        )}
      </div>
    </div>
  );
};

const AlertTriangle: React.FC<{ size: number; className?: string }> = ({ size, className }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/>
    <line x1="12" y1="9" x2="12" y2="13"/>
    <line x1="12" y1="17" x2="12.01" y2="17"/>
  </svg>
);
