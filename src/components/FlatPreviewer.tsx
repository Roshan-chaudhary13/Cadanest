

import React, { useState, useRef, useEffect } from 'react';
import { ZoomIn, ZoomOut, Maximize2, Move, RotateCw } from 'lucide-react';

interface FlatPreviewerProps {
  onToggleFullScreen?: () => void;
  svgContent: string | null;
  baseFace: string | null;
  thickness: number;
  is3dView?: boolean;
  title?: string;
  onRemoveComponent?: (faceName: string) => void;
  themeMode?: 'light' | 'dark';
  rotationAngle?: number;
}

export const FlatPreviewer: React.FC<FlatPreviewerProps> = ({ 
  onToggleFullScreen,
  svgContent, 
  baseFace, 
  thickness, 
  is3dView = false,
  title,
  onRemoveComponent,
  themeMode = 'dark',
  rotationAngle
}) => {
  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [rotation, setRotation] = useState(rotationAngle || 0);

  const [showCut, setShowCut] = useState(true);
  const [showHoles, setShowHoles] = useState(true);
  const [showUpBends, setShowUpBends] = useState(true);
  const [showDownBends, setShowDownBends] = useState(true);
  const [showForming, setShowForming] = useState(true);

  useEffect(() => {
    if (rotationAngle !== undefined) {
      setRotation(rotationAngle);
    }
  }, [rotationAngle]);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [clickStart, setClickStart] = useState({ x: 0, y: 0 });
  const [viewBox, setViewBox] = useState({ x: 0, y: 0, width: 500, height: 500 });
  const [innerElements, setInnerElements] = useState<string>('');

  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  // Center and fit the drawing in the viewport
  const resetView = (currentViewBox = viewBox) => {
    if (!containerRef.current || !currentViewBox || currentViewBox.width <= 0 || currentViewBox.height <= 0) return;
    const { clientWidth, clientHeight } = containerRef.current;
    if (clientWidth <= 0 || clientHeight <= 0) return;
    
    // Scale to fit container with 15% margin
    const scaleX = (clientWidth * 0.85) / currentViewBox.width;
    const scaleY = (clientHeight * 0.85) / currentViewBox.height;
    const newScale = Math.min(scaleX, scaleY);

    setScale(newScale);
    
    // Center alignment
    const newX = (clientWidth - currentViewBox.width * newScale) / 2 - currentViewBox.x * newScale;
    const newY = (clientHeight - currentViewBox.height * newScale) / 2 - currentViewBox.y * newScale;
    setPosition({ x: newX, y: newY });
  };

  // Parse SVG content and override colors dynamically
  useEffect(() => {
    setRotation(0);
    if (!svgContent) {
      setInnerElements('');
      return;
    }

    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(svgContent, 'image/svg+xml');
      const svgNode = doc.querySelector('svg');

      if (svgNode) {
        // Calculate exact bounding box from actual SVG geometry elements
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        const geomElements = svgNode.querySelectorAll('path, line, polyline, rect, circle');
        geomElements.forEach(el => {
          if (el.tagName === 'line') {
            const x1 = parseFloat(el.getAttribute('x1') || '0');
            const y1 = parseFloat(el.getAttribute('y1') || '0');
            const x2 = parseFloat(el.getAttribute('x2') || '0');
            const y2 = parseFloat(el.getAttribute('y2') || '0');
            minX = Math.min(minX, x1, x2); maxX = Math.max(maxX, x1, x2);
            minY = Math.min(minY, y1, y2); maxY = Math.max(maxY, y1, y2);
          } else if (el.tagName === 'polyline') {
            const pts = (el.getAttribute('points') || '').trim().split(/\s+/).flatMap(p => p.split(',').map(Number)).filter(v => !isNaN(v));
            for (let i = 0; i < pts.length; i += 2) {
              minX = Math.min(minX, pts[i]); maxX = Math.max(maxX, pts[i]);
              if (i + 1 < pts.length) { minY = Math.min(minY, pts[i+1]); maxY = Math.max(maxY, pts[i+1]); }
            }
          } else if (el.tagName === 'rect') {
            const x = parseFloat(el.getAttribute('x') || '0');
            const y = parseFloat(el.getAttribute('y') || '0');
            const w = parseFloat(el.getAttribute('width') || '0');
            const h = parseFloat(el.getAttribute('height') || '0');
            minX = Math.min(minX, x); maxX = Math.max(maxX, x + w);
            minY = Math.min(minY, y); maxY = Math.max(maxY, y + h);
          } else if (el.tagName === 'circle') {
            const cx = parseFloat(el.getAttribute('cx') || '0');
            const cy = parseFloat(el.getAttribute('cy') || '0');
            const r = parseFloat(el.getAttribute('r') || '0');
            minX = Math.min(minX, cx - r); maxX = Math.max(maxX, cx + r);
            minY = Math.min(minY, cy - r); maxY = Math.max(maxY, cy + r);
          } else if (el.tagName === 'path') {
            const d = el.getAttribute('d') || '';
            const nums = (d.match(/[-+]?\d*\.?\d+/g) || []).map(Number);
            for (let i = 0; i < nums.length; i += 2) {
              if (!isNaN(nums[i])) { minX = Math.min(minX, nums[i]); maxX = Math.max(maxX, nums[i]); }
              if (i + 1 < nums.length && !isNaN(nums[i+1])) { minY = Math.min(minY, nums[i+1]); maxY = Math.max(maxY, nums[i+1]); }
            }
          }
        });

        let activeViewBox = { x: 0, y: 0, width: 500, height: 500 };
        if (minX !== Infinity && maxX !== -Infinity && minX < maxX && minY < maxY) {
          const padW = (maxX - minX) * 0.05;
          const padH = (maxY - minY) * 0.05;
          activeViewBox = {
            x: minX - padW,
            y: minY - padH,
            width: (maxX - minX) + 2 * padW,
            height: (maxY - minY) + 2 * padH
          };
          setViewBox(activeViewBox);
        } else {
          const vbAttr = svgNode.getAttribute('viewBox');
          if (vbAttr) {
            const parts = vbAttr.split(' ').map(Number);
            if (parts.length === 4) {
              activeViewBox = { x: parts[0], y: parts[1], width: parts[2], height: parts[3] };
              setViewBox(activeViewBox);
            }
          } else {
            const w = parseFloat(svgNode.getAttribute('width') || '500');
            const h = parseFloat(svgNode.getAttribute('height') || '500');
            activeViewBox = { x: 0, y: 0, width: w, height: h };
            setViewBox(activeViewBox);
          }
        }

        // Color mapping override: convert any legacy FreeCAD dark-bg colors to
        // high-contrast colors that work on a light (white) background.
        const isDark = themeMode === 'dark';
        let bendLineCount = 0;
        const overrideElements = (selector: string) => {
          svgNode.querySelectorAll(selector).forEach(el => {
            el.setAttribute('vector-effect', 'non-scaling-stroke');

            if (selector === 'path' && !el.getAttribute('fill-rule')) {
              el.setAttribute('fill-rule', 'evenodd');
            }

            const stroke = el.getAttribute('stroke');
            const fill = el.getAttribute('fill');
            
            // Preserve high-contrast filled silhouettes (like DXF artwork) or override semi-transparent nesting fills
            if (fill && (fill.includes('rgba(0,163,255') || fill.includes('rgba(0, 163, 255'))) {
              el.setAttribute('fill', isDark ? 'rgba(51, 163, 255, 0.15)' : 'rgba(0, 115, 204, 0.1)');
            }

            const cls = (el.getAttribute('class') || '').toLowerCase();
            const lowerStroke = (stroke || '').toLowerCase().replace(/\s/g, '');

            if (cls.includes('bend-zone-band')) {
              el.setAttribute('fill', isDark ? '#FFFFFF' : '#E2E8F0');
              el.setAttribute('fill-opacity', isDark ? '0.85' : '0.6');
              el.setAttribute('stroke', isDark ? '#94A3B8' : '#64748B');
              el.setAttribute('stroke-width', '1.0px');
              el.setAttribute('stroke-dasharray', '4,3');
              el.setAttribute('vector-effect', 'non-scaling-stroke');
            } else if (cls.includes('bend-centerline-up') || cls.includes('up-bend')) {
              el.setAttribute('stroke', '#0073CC'); // Industrial Blue for UP bend
              el.setAttribute('stroke-width', '2.0px');
              const origDash = el.getAttribute('stroke-dasharray');
              if (origDash && origDash !== 'none') {
                el.setAttribute('stroke-dasharray', origDash);
              } else {
                el.removeAttribute('stroke-dasharray');
              }
              el.setAttribute('stroke-linecap', 'round');
              el.setAttribute('vector-effect', 'non-scaling-stroke');
            } else if (cls.includes('bend-centerline-down') || cls.includes('down-bend')) {
              el.setAttribute('stroke', '#EF4444'); // Crimson Red for DOWN bend
              el.setAttribute('stroke-width', '2.0px');
              const origDash = el.getAttribute('stroke-dasharray');
              if (origDash && origDash !== 'none') {
                el.setAttribute('stroke-dasharray', origDash);
              } else {
                el.removeAttribute('stroke-dasharray');
              }
              el.setAttribute('stroke-linecap', 'round');
              el.setAttribute('vector-effect', 'non-scaling-stroke');
            } else if (cls.includes('fold') || cls.includes('bend') || lowerStroke === '#e84d00' || lowerStroke === '#ff5733' || lowerStroke === '#10b981') {
              bendLineCount++;
              const isUpBend = bendLineCount % 2 === 1;
              el.setAttribute('stroke', isUpBend ? '#0073CC' : '#EF4444');
              el.setAttribute('stroke-width', '2.0px');
              const origDash = el.getAttribute('stroke-dasharray');
              if (origDash && origDash !== 'none') {
                el.setAttribute('stroke-dasharray', origDash);
              } else {
                el.removeAttribute('stroke-dasharray');
              }
              el.setAttribute('stroke-linecap', 'round');
              el.setAttribute('vector-effect', 'non-scaling-stroke');
            } else if (stroke) {
              if (lowerStroke === '#c00000' || cls.includes('cut') || cls.includes('outer')) {
                el.setAttribute('stroke', isDark ? '#38BDF8' : '#0284C7');
                el.setAttribute('stroke-width', '1.2px');
              } else if (cls.includes('hole') || cls.includes('inner') || lowerStroke === '#000080' || lowerStroke === '#00a3ff') {
                el.setAttribute('stroke', isDark ? '#F59E0B' : '#D97706');
                el.setAttribute('stroke-width', '1.2px');
                el.setAttribute('fill', 'none');
              } else if (cls.includes('up-bend') || cls.includes('bend-centerline-up')) {
                el.setAttribute('stroke', isDark ? '#10B981' : '#059669');
                el.setAttribute('stroke-width', '1.5px');
              } else if (cls.includes('down-bend') || cls.includes('bend-centerline-down')) {
                el.setAttribute('stroke', isDark ? '#EF4444' : '#DC2626');
                el.setAttribute('stroke-width', '1.5px');
              } else if (lowerStroke === '#33ff33') {
                el.setAttribute('stroke', isDark ? '#10B981' : '#0A8F5A');
                el.setAttribute('stroke-width', '0.8px');
              } else if (
                lowerStroke === '#000000' || 
                lowerStroke === 'black' || 
                lowerStroke === 'rgb(0,0,0)' || 
                lowerStroke.startsWith('rgb(0,0,0')
              ) {
                el.setAttribute('stroke', is3dView ? (isDark ? '#38BDF8' : '#0284C7') : (isDark ? '#F8FAFC' : '#0F172A'));
                el.setAttribute('stroke-width', '1.0px');
              }
            }
          });
        };

        overrideElements('path');
        overrideElements('circle');
        overrideElements('line');
        overrideElements('polyline');

        // Group elements (lines, polylines, rects, paths) along X axis to identify separate unfolded bodies
        if (!is3dView && baseFace && !baseFace.toLowerCase().startsWith('combined')) {
          const baseFacesList = baseFace.split(',').filter(Boolean);
          const elements = Array.from(svgNode.querySelectorAll('line, polyline, rect, path, circle'));
          
          const elementsWithX = elements.map(el => {
            let minX = Infinity;
            let maxX = -Infinity;
            
            if (el.tagName === 'line') {
              const x1 = parseFloat(el.getAttribute('x1') || '0');
              const x2 = parseFloat(el.getAttribute('x2') || '0');
              minX = Math.min(x1, x2);
              maxX = Math.max(x1, x2);
            } else if (el.tagName === 'polyline') {
              const ptsAttr = el.getAttribute('points') || '';
              const pts = ptsAttr.trim().split(/\s+/).map(p => {
                const parts = p.split(',');
                return parts.length > 0 ? parseFloat(parts[0]) : 0;
              }).filter(val => !isNaN(val));
              if (pts.length > 0) {
                minX = Math.min(...pts);
                maxX = Math.max(...pts);
              }
            } else if (el.tagName === 'rect') {
              const x = parseFloat(el.getAttribute('x') || '0');
              const w = parseFloat(el.getAttribute('width') || '0');
              minX = x;
              maxX = x + w;
            } else if (el.tagName === 'circle') {
              const cx = parseFloat(el.getAttribute('cx') || '0');
              const r = parseFloat(el.getAttribute('r') || '0');
              minX = cx - r;
              maxX = cx + r;
            } else if (el.tagName === 'path') {
              const d = el.getAttribute('d') || '';
              const matches = d.match(/[-+]?\d*\.?\d+/g);
              if (matches) {
                const xCoords = matches.filter((_, idx) => idx % 2 === 0).map(Number).filter(val => !isNaN(val));
                if (xCoords.length > 0) {
                  minX = Math.min(...xCoords);
                  maxX = Math.max(...xCoords);
                }
              }
            }
            
            return { el, minX, maxX, center: (minX + maxX) / 2 };
          }).filter(item => item.minX !== Infinity && !isNaN(item.center));

          // Sort elements by center X coordinate
          elementsWithX.sort((a, b) => a.center - b.center);

          // Group elements by X coordinates (connected component clustering)
          const groups: Array<typeof elementsWithX> = [];
          let currentGroup: typeof elementsWithX = [];

          for (const item of elementsWithX) {
            if (currentGroup.length === 0) {
              currentGroup.push(item);
            } else {
              const lastItem = currentGroup[currentGroup.length - 1];
              if (item.minX - lastItem.maxX > 8.0) {
                groups.push(currentGroup);
                currentGroup = [item];
              } else {
                currentGroup.push(item);
              }
            }
          }
          if (currentGroup.length > 0) {
            groups.push(currentGroup);
          }

          // Wrap elements of each group into a separate SVG group element <g>
          const transformGroup = svgNode.querySelector('g') || svgNode;
          
          groups.forEach((group, groupIdx) => {
            const correspondingFace = baseFacesList[groupIdx] || `Face${groupIdx + 1}`;
            
            const gEl = doc.createElementNS('http://www.w3.org/2000/svg', 'g');
            gEl.setAttribute('class', 'unfolded-component');
            gEl.setAttribute('data-face', correspondingFace);
            gEl.setAttribute('data-group-idx', groupIdx.toString());
            
            group.forEach(item => {
              gEl.appendChild(item.el);
            });
            
            transformGroup.appendChild(gEl);
          });
        }

        // Inject component hover & select highlighting rules + layer display controls
        let styleNode = svgNode.querySelector('style') as Element | null;
        if (!styleNode) {
          const newStyle = doc.createElementNS('http://www.w3.org/2000/svg', 'style');
          svgNode.prepend(newStyle);
          styleNode = newStyle as Element;
        }
        styleNode.textContent = (styleNode.textContent || '') + `
          .cut-outer, .layer-cut { display: ${showCut ? 'inline' : 'none'} !important; }
          .cut-inner, .layer-holes { display: ${showHoles ? 'inline' : 'none'} !important; }
          .bend-centerline-up, .layer-up-bends { display: ${showUpBends ? 'inline' : 'none'} !important; }
          .bend-centerline-down, .layer-down-bends { display: ${showDownBends ? 'inline' : 'none'} !important; }
          .layer-forming { display: ${showForming ? 'inline' : 'none'} !important; }
          .unfolded-component { cursor: pointer; }
          .unfolded-component:hover .cut { stroke: #FFB300 !important; stroke-width: 2.2px !important; }
          .unfolded-component:hover .fold { stroke: #E84D00 !important; stroke-width: 1.8px !important; }
        `;

        // Get inner HTML of the SVG (excluding outer <svg> tag)
        setInnerElements(svgNode.innerHTML);
        
        // Reset zoom and center
        resetView(activeViewBox);
      }
    } catch (e) {
      console.error('Failed to parse SVG content:', e);
    }
  }, [svgContent, is3dView, baseFace, themeMode, showCut, showHoles, showUpBends, showDownBends, showForming]);

  // Automatically recalculate scale and center when container resizes
  useEffect(() => {
    if (!containerRef.current) return;
    const resizeObserver = new ResizeObserver(() => {
      resetView();
    });
    resizeObserver.observe(containerRef.current);
    return () => resizeObserver.disconnect();
  }, [viewBox]);

  // Zooming via mouse wheel
  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (!svgContent) return;
    e.preventDefault();
    const zoomFactor = 1.1;
    const nextScale = e.deltaY < 0 ? scale * zoomFactor : scale / zoomFactor;
    
    if (nextScale < 0.1 || nextScale > 30) return;

    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      const dx = mouseX - position.x;
      const dy = mouseY - position.y;

      const ratio = nextScale / scale;
      
      setScale(nextScale);
      setPosition({
        x: mouseX - dx * ratio,
        y: mouseY - dy * ratio
      });
    }
  };

  const handleMouseDown = (e: React.MouseEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    setIsDragging(true);
    setDragStart({ x: e.clientX - position.x, y: e.clientY - position.y });
    setClickStart({ x: e.clientX, y: e.clientY });
  };

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!isDragging) return;
    setPosition({
      x: e.clientX - dragStart.x,
      y: e.clientY - dragStart.y
    });
  };

  const handleMouseUp = (e: React.MouseEvent<SVGSVGElement>) => {
    setIsDragging(false);
    
    const dx = e.clientX - clickStart.x;
    const dy = e.clientY - clickStart.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    
    if (dist < 4) {
      const target = e.target as SVGElement;
      const parentG = target.closest('.unfolded-component');
      if (parentG) {
        const faceName = parentG.getAttribute('data-face');
        if (faceName && onRemoveComponent) {
          onRemoveComponent(faceName);
        }
      }
    }
  };

  const handleMouseLeave = () => {
    setIsDragging(false);
  };

  return (
    <div className="relative flex-1 h-full w-full bg-industrial-darker border border-industrial-border rounded-lg overflow-hidden flex flex-col" ref={containerRef} onWheel={handleWheel}>
      {/* Upper Viewport Toolbar */}
      <div className="absolute top-3 left-3 right-3 flex justify-between items-center pointer-events-none z-10">
        <div className="bg-industrial-card/90 backdrop-blur border border-industrial-border px-3 py-1.5 rounded text-xs font-mono text-industrial-muted flex flex-wrap items-center gap-4 pointer-events-auto max-w-[70%]">
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 bg-industrial-accent rounded-full animate-ping"></span>
            <span>{title ? title : (is3dView ? '3D Isometric view' : '2D Flattened Pattern')}</span>
          </div>
          {!is3dView && (
            <>
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] text-industrial-muted font-bold">Unfolded Flanges:</span>
                <div className="flex flex-wrap gap-1">
                  {(baseFace ? baseFace.split(',').filter(Boolean) : []).map((face, fIdx) => (
                    <span key={fIdx} className="inline-flex items-center gap-1.5 px-2 py-0.5 bg-industrial-darker border border-industrial-border rounded text-[10px] text-industrial-text font-bold select-none">
                      {face}
                      <button 
                        onClick={() => onRemoveComponent && onRemoveComponent(face)}
                        className="text-red-500 hover:text-red-700 font-extrabold hover:bg-red-100 rounded px-1 transition text-[11px]"
                        title={`Remove component unfolded from ${face}`}
                      >
                        &times;
                      </button>
                    </span>
                  ))}
                </div>
              </div>
              <div>Thickness: <span className="text-industrial-orange font-semibold">{thickness.toFixed(1)} mm</span></div>
            </>
          )}
        </div>
        
        {/* Controls */}
        <div className="flex gap-1.5 pointer-events-auto items-center bg-industrial-darker/95 border border-industrial-border shadow-xl backdrop-blur-md rounded-lg p-1">
          <button onClick={() => setScale(s => Math.min(s * 1.2, 30))} className="h-7 w-7 flex items-center justify-center bg-industrial-card hover:bg-industrial-accent hover:text-white border border-industrial-border/60 rounded text-industrial-text transition cursor-pointer shrink-0" title="Zoom In">
            <ZoomIn size={14} />
          </button>
          <button onClick={() => setScale(s => Math.max(s / 1.2, 0.1))} className="h-7 w-7 flex items-center justify-center bg-industrial-card hover:bg-industrial-accent hover:text-white border border-industrial-border/60 rounded text-industrial-text transition cursor-pointer shrink-0" title="Zoom Out">
            <ZoomOut size={14} />
          </button>
          <button onClick={() => setRotation(r => (r + 90) % 360)} className="h-7 w-7 flex items-center justify-center bg-industrial-card hover:bg-industrial-accent hover:text-white border border-industrial-border/60 rounded text-industrial-text transition cursor-pointer shrink-0" title="Rotate Clockwise 90°">
            <RotateCw size={14} />
          </button>
          <button onClick={() => { resetView(); setRotation(0); }} className="h-7 px-2.5 flex items-center justify-center bg-industrial-card hover:bg-industrial-accent hover:text-white border border-industrial-border/60 rounded text-industrial-text transition cursor-pointer font-mono font-bold text-[10px] shrink-0" title="Reset View & Scale">
            FIT
          </button>
          {onToggleFullScreen && (
            <button onClick={onToggleFullScreen} className="h-7 w-7 flex items-center justify-center bg-industrial-card hover:bg-industrial-accent hover:text-white border border-industrial-border/60 rounded text-industrial-text transition cursor-pointer shrink-0 ml-0.5" title="Expand Viewport to Full Screen">
              <Maximize2 size={14} />
            </button>
          )}
        </div>
      </div>

      {svgContent ? (
        <svg
          ref={svgRef}
          className={`flex-1 w-full h-full ${isDragging ? 'cursor-grabbing' : 'cursor-grab'}`}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseLeave}
        >
          <g 
            style={{ willChange: 'transform', transformOrigin: 'center' }}
            transform={`translate(${position.x}, ${position.y}) scale(${scale}) rotate(${rotation}, ${viewBox.x + viewBox.width / 2}, ${viewBox.y + viewBox.height / 2})`} 
            dangerouslySetInnerHTML={{ __html: innerElements }} 
          />
        </svg>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center text-industrial-muted gap-2 font-mono p-8">
          <Move size={36} className="animate-pulse text-industrial-border" />
          <div className="text-sm">{is3dView ? 'NO 3D SOURCE DETECTED' : 'NO FLAT PATTERN DETECTED'}</div>
          <div className="text-xs text-center max-w-xs text-opacity-50">
            {is3dView 
              ? 'Import a 3D STEP part to display its isometric geometry.' 
              : 'Click "Flatten Model" in the top bar to run the unfolding engine.'}
          </div>
        </div>
      )}

      {/* Grid Coordinates Overlay */}
  <div className="absolute bottom-3 left-3 bg-industrial-card/90 backdrop-blur border border-industrial-border px-2 py-1 rounded text-[10px] font-mono text-industrial-muted">
    Scale: {(scale * 100).toFixed(0)}%
  </div>

  {/* Interactive DXF Layer Visibility Control Panel */}
  {!is3dView && svgContent && (
    <div className="absolute bottom-3 right-3 bg-industrial-card/95 backdrop-blur border border-industrial-border p-2 rounded-lg flex flex-wrap items-center gap-3 text-[10px] font-mono select-none shadow-xl">
      <span className="text-industrial-muted font-bold uppercase text-[9px]">Layers:</span>
      <label className="flex items-center gap-1 cursor-pointer text-gray-200 hover:text-white">
        <input type="checkbox" checked={showCut} onChange={e => setShowCut(e.target.checked)} className="w-3 h-3 accent-green-500 rounded" />
        <span className="text-green-400 font-semibold">Cut Outer</span>
      </label>
      <label className="flex items-center gap-1 cursor-pointer text-gray-200 hover:text-white">
        <input type="checkbox" checked={showHoles} onChange={e => setShowHoles(e.target.checked)} className="w-3 h-3 accent-yellow-500 rounded" />
        <span className="text-yellow-400 font-semibold">Holes</span>
      </label>
      <label className="flex items-center gap-1 cursor-pointer text-gray-200 hover:text-white">
        <input type="checkbox" checked={showUpBends} onChange={e => setShowUpBends(e.target.checked)} className="w-3 h-3 accent-emerald-500 rounded" />
        <span className="text-emerald-400 font-semibold">Up Bends</span>
      </label>
      <label className="flex items-center gap-1 cursor-pointer text-gray-200 hover:text-white">
        <input type="checkbox" checked={showDownBends} onChange={e => setShowDownBends(e.target.checked)} className="w-3 h-3 accent-red-500 rounded" />
        <span className="text-red-400 font-semibold">Down Bends</span>
      </label>
      <label className="flex items-center gap-1 cursor-pointer text-gray-200 hover:text-white">
        <input type="checkbox" checked={showForming} onChange={e => setShowForming(e.target.checked)} className="w-3 h-3 accent-magenta-500 rounded" />
        <span className="text-purple-400 font-semibold">Forming/Dimples</span>
      </label>
    </div>
  )}
</div>
  );
};
