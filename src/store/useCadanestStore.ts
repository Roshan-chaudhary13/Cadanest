import { create } from 'zustand';

export interface MaterialInfo {
  name: string;
  code: string;
  density: number; // in kg/m³
  kFactor: number; // default neutral-axis K-factor for this material
}

// Single source of truth for standard material name/code/density/K-factor.
// MATERIAL_K_PRESETS and the 'material' rows of CAD_PRESETS_CATALOG in App.tsx
// derive from this list instead of keeping their own copies of these numbers.
export const STANDARD_MATERIALS: MaterialInfo[] = [
  { name: 'Mild Steel', code: 'MS / IS2062', density: 7850, kFactor: 0.44 },
  { name: 'Stainless Steel 304', code: 'SS304', density: 7930, kFactor: 0.45 },
  { name: 'Stainless Steel 316', code: 'SS316', density: 8000, kFactor: 0.45 },
  { name: 'Aluminium 5052', code: 'AL5052', density: 2680, kFactor: 0.40 },
  { name: 'Aluminium 6061', code: 'AL6061', density: 2700, kFactor: 0.40 },
  { name: 'Galvanized Iron', code: 'GI', density: 7850, kFactor: 0.42 },
  { name: 'Copper', code: 'Cu', density: 8960, kFactor: 0.38 },
  { name: 'Brass', code: 'Brass', density: 8500, kFactor: 0.40 },
  { name: 'CRCA Sheet', code: 'CRCA', density: 7850, kFactor: 0.42 },
  { name: 'High Tensile Steel', code: 'HT Steel', density: 7850, kFactor: 0.44 },
];

export function getMaterialByDensity(density: number): MaterialInfo {
  let closest = STANDARD_MATERIALS[0];
  let minDiff = Math.abs(density - closest.density);

  for (const mat of STANDARD_MATERIALS) {
    const diff = Math.abs(density - mat.density);
    if (diff < minDiff) {
      minDiff = diff;
      closest = mat;
    }
  }
  return closest;
}

export interface FaceMeta {
  name: string;
  type: string;
  area: number;
  normal?: number[];
}

export interface CadPresetOption {
  id: string;
  label: string;
  category: 'software' | 'standard' | 'material';
  value: number;
  software: string;
  description: string;
}

export const CAD_PRESETS_CATALOG: CadPresetOption[] = [
  { id: 'solidworks_default', label: 'SolidWorks Default (Air Bend)', category: 'software', value: 0.500000, software: 'SolidWorks', description: 'Default air bending K=0.500 (neutral axis at T/2)' },
  { id: 'inventor_default', label: 'Autodesk Inventor / Fusion 360', category: 'software', value: 0.440000, software: 'Autodesk', description: 'Autodesk standard neutral axis K=0.440' },
  { id: 'inventor_ansi', label: 'Autodesk ANSI Fine Standard', category: 'software', value: 0.446000, software: 'Autodesk', description: 'ANSI high-precision B-Rep preset K=0.446' },
  { id: 'solid_edge_tight', label: 'Solid Edge Tight Bend (R ≤ 2T)', category: 'software', value: 0.330000, software: 'Solid Edge', description: 'Solid Edge tight radius neutral factor K=0.330000' },
  { id: 'solid_edge_std', label: 'Solid Edge Standard Material', category: 'software', value: 0.440000, software: 'Solid Edge', description: 'Solid Edge standard material catalog default K=0.440' },
  { id: 'creo_y_050', label: 'PTC Creo Default (Y = 0.50)', category: 'software', value: 0.318310, software: 'PTC Creo', description: 'Creo Y-Factor 0.50 converted to K=0.318310 (K = Y * 2/π)' },
  { id: 'din_6935', label: 'DIN 6935 Logarithmic (ISO/EU)', category: 'standard', value: 0.330000, software: 'DIN 6935', description: 'European DIN 6935 formula: K = 0.33 + 0.17*log10(R/T)' },
  { id: 'trumpf_air', label: 'Trumpf TruTops Air Bending', category: 'software', value: 0.380000, software: 'Trumpf', description: 'Trumpf press brake V-die air bending K=0.380' },
  { id: 'bystronic_air', label: 'Bystronic BySoft CNC Air Bend', category: 'software', value: 0.390000, software: 'Bystronic', description: 'Bystronic CNC press brake air bending K=0.390' },
  { id: 'mild_steel', label: 'Mild Steel / CRCA (IS2062)', category: 'material', value: STANDARD_MATERIALS.find(m => m.name === 'Mild Steel')!.kFactor, software: 'Material', description: 'Mild Steel & CRCA structural sheet default K=0.440' },
  { id: 'stainless_304', label: 'Stainless Steel 304 / 316', category: 'material', value: STANDARD_MATERIALS.find(m => m.name === 'Stainless Steel 304')!.kFactor, software: 'Material', description: 'Austenitic Stainless Steel K=0.450' },
  { id: 'aluminum_5052', label: 'Aluminium 5052 / 6061', category: 'material', value: STANDARD_MATERIALS.find(m => m.name === 'Aluminium 5052')!.kFactor, software: 'Material', description: 'Aluminium alloy sheet default K=0.400' },
  { id: 'copper', label: 'Copper / Copper Alloys', category: 'material', value: STANDARD_MATERIALS.find(m => m.name === 'Copper')!.kFactor, software: 'Material', description: 'Soft Copper sheet default K=0.380' },
  { id: 'brass', label: 'Brass Sheet', category: 'material', value: STANDARD_MATERIALS.find(m => m.name === 'Brass')!.kFactor, software: 'Material', description: 'Brass sheet metal default K=0.400' },
];

export interface SheetSizeOption {
  width: number;
  height: number;
  label: string;
}

// Single source of truth for standard sheet stock sizes, sorted smallest to largest.
// The sheet-size dropdown, the auto-upsize-on-capacity-exceeded logic, and the
// "already at maximum size" messaging in App.tsx all derive from this list.
export const STANDARD_SHEET_SIZES: SheetSizeOption[] = [
  { width: 1500, height: 1000, label: 'Small' },
  { width: 2500, height: 1250, label: 'Standard' },
  { width: 3000, height: 1500, label: 'Standard Large' },
  { width: 4000, height: 2000, label: 'Oversized' },
];

// Default sheet thickness (mm) used whenever a part/sheet's thickness is unknown.
export const DEFAULT_THICKNESS_MM = 2.0;

// Default etch/tick mark length (mm) for bend-line indicators in DXF/SVG export.
export const DEFAULT_ETCH_MARKER_LENGTH_MM = 4.5;

// Default bend-line rendering style and etch marker position — mirror
// DEFAULT_BEND_STYLE / DEFAULT_ETCH_MARKER_POSITION in backend/unfold/bend_math.py.
export const DEFAULT_BEND_STYLE = 'tick';
export const DEFAULT_ETCH_MARKER_POSITION: 'interior' | 'boundary' = 'interior';

export interface PartItem {
  id: string;
  name: string;
  stepPath: string;
  quantity: number;
  kfactor: number;
  baseFace: string | null;
  thickness: number;
  material?: string;
  materialName?: string;
  density?: number;
  isSheetMetal?: boolean;
  totalFaces: number;
  planarFaces: number;
  faces: FaceMeta[];
  svgPreview: string | null;
  stlPath: string | null;
  dimensions: { x: number; y: number; z: number };
  volume: number;
  area: number;
  svgContent?: string | null;
  dxfPath?: string | null;
  bendStyle?: string;
  etchMarkerPosition?: 'interior' | 'boundary';
  etchMarkerLength?: number;
  isUnfolded?: boolean;
  parentAssembly?: string | null;
  assemblyTree?: AssemblyNode | null;
  // UI workflow fields (present after import/unfold)
  mirror?: boolean;
  active?: boolean;
  isDxfOnly?: boolean;
  flatElements?: FlatElementItem[];
  bendRadius?: number;
  unfoldedKfactor?: number;
  unfoldedBaseFace?: string | null;
  kFactorMode?: 'material' | 'adaptive' | 'manual' | 'preset' | 'y_factor' | 'din6935';
  kFactorPreset?: string;
  yFactor?: number;
  bendSummary?: {
    bend_count: number;
    bend_angles: number[];
    bend_radii: number[];
    straight_sum: number;
    avg_radius: number;
  };
}

export interface AssemblyNode {
  id: string;
  name: string;
  path: string;
  isSheetMetal: boolean;
  thickness: number;
  material?: string;
  children?: AssemblyNode[];
  selected?: boolean;
}

export interface FlatElementItem {
  id: string;
  partId: string;
  name: string;
  parentName: string;
  baseFace: string;
  dxfPath?: string | null;
  svgContent?: string | null;
  isUnfolded?: boolean;
  unfoldedKfactor?: number;
  unfoldedBaseFace?: string | null;
  unfoldedMirror?: boolean;
  unfoldedBendStyle?: string;
  unfoldedEtchMarkerPosition?: 'interior' | 'boundary';
  unfoldedEtchMarkerLength?: number;
  unfoldedKFactorMode?: 'material' | 'adaptive' | 'manual' | 'preset' | 'y_factor' | 'din6935';
  unfoldedKFactorPreset?: string;
  unfoldedYFactor?: number;
  quantity: number;
  thickness?: number;
  material?: string;
  active?: boolean;
  group?: 'A' | 'B' | null;
  width?: number;
  height?: number;
}

export interface JobGroup {
  id: string;
  material: string;
  materialCode: string;
  density: number; // in kg/m³
  thickness: number;
  elements: FlatElementItem[];
  totalQuantity: number;
  totalWeightKg: number;
}

export interface NestingConfig {
  sheetWidth: number;
  sheetHeight: number;
  spacing: number;
  margin: number;
  autoFill: boolean;
  rotations: number[];
  excludeBendLines: boolean;
  policy: 'auto_increase_count' | 'auto_upsize_dimension';
  allowHoleInHole: boolean;
  useNFP: boolean;
}

export interface NestingResultSheet {
  sheetIndex: number;
  width: number;
  height: number;
  utilization: number;
  material?: string;
  thickness?: number;
  packedParts: Array<{
    part_id: string;
    name: string;
    dx: number;
    dy: number;
    rotation: number;
    dxf_path?: string;
  }>;
  svgContent?: string;
  dxfPath?: string;
}

interface CadanestState {
  // Navigation & UI State
  activeTab: 'models' | 'flat' | 'nesting' | 'export';
  themeMode: 'dark' | 'light';
  isAnalyzing: boolean;
  isUnfolding: boolean;
  isNesting: boolean;
  statusMessage: string;
  progressPct: number;

  // Data Inventory
  parts: PartItem[];
  flatElements: FlatElementItem[];
  activePartId: string | null;
  activeFace: string | null;
  hoveredFaceName: string | null;
  assemblyTreeModalOpen: boolean;
  currentAssemblyTree: AssemblyNode | null;

  // Nesting Config & Results
  nestingConfig: NestingConfig;
  nestingResults: NestingResultSheet[];
  activeSheetIndex: number;

  // Actions
  setActiveTab: (tab: 'models' | 'flat' | 'nesting' | 'export') => void;
  setThemeMode: (mode: 'dark' | 'light') => void;
  setStatus: (message: string, pct?: number) => void;
  setAnalyzing: (loading: boolean) => void;
  setUnfolding: (loading: boolean) => void;
  setNesting: (loading: boolean) => void;

  // Part Actions
  addParts: (newParts: PartItem[]) => void;
  updatePart: (id: string, updates: Partial<PartItem>) => void;
  removePart: (id: string) => void;
  clearAllParts: () => void;
  setActivePartId: (id: string | null) => void;
  setActiveFace: (face: string | null) => void;
  setHoveredFaceName: (face: string | null) => void;

  // Flat Elements Actions
  addFlatElements: (elements: FlatElementItem[]) => void;
  updateFlatElement: (id: string, updates: Partial<FlatElementItem>) => void;
  removeFlatElement: (id: string) => void;
  clearFlatElements: () => void;

  // Assembly Actions
  setAssemblyTree: (tree: AssemblyNode | null) => void;
  setAssemblyTreeModalOpen: (open: boolean) => void;

  // Nesting Config Actions
  updateNestingConfig: (updates: Partial<NestingConfig>) => void;
  setNestingResults: (results: NestingResultSheet[]) => void;
  setActiveSheetIndex: (index: number) => void;

  // Derived Selectors
  getJobGroups: () => JobGroup[];
}

export const useCadanestStore = create<CadanestState>((set, get) => ({
  activeTab: 'models',
  themeMode: 'dark',
  isAnalyzing: false,
  isUnfolding: false,
  isNesting: false,
  statusMessage: 'Ready',
  progressPct: 0,

  parts: [],
  flatElements: [],
  activePartId: null,
  activeFace: null,
  hoveredFaceName: null,
  assemblyTreeModalOpen: false,
  currentAssemblyTree: null,

  nestingConfig: {
    sheetWidth: 2500,
    sheetHeight: 1250,
    spacing: 5,
    margin: 10,
    autoFill: true,
    rotations: [0, 90, 180, 270],
    excludeBendLines: false,
    policy: 'auto_increase_count',
    allowHoleInHole: true,
    useNFP: true,
  },
  nestingResults: [],
  activeSheetIndex: 0,

  setActiveTab: (tab) => set({ activeTab: tab }),
  setThemeMode: (mode) => set({ themeMode: mode }),
  setStatus: (message, pct = 0) => set({ statusMessage: message, progressPct: pct }),
  setAnalyzing: (loading) => set({ isAnalyzing: loading }),
  setUnfolding: (loading) => set({ isUnfolding: loading }),
  setNesting: (loading) => set({ isNesting: loading }),

  addParts: (newParts) =>
    set((state) => ({
      parts: [...state.parts, ...newParts],
      activePartId: state.activePartId || (newParts.length > 0 ? newParts[0].id : null),
    })),

  updatePart: (id, updates) =>
    set((state) => ({
      parts: state.parts.map((p) => (p.id === id ? { ...p, ...updates } : p)),
    })),

  removePart: (id) =>
    set((state) => ({
      parts: state.parts.filter((p) => p.id !== id),
      flatElements: state.flatElements.filter((f) => f.partId !== id),
      activePartId: state.activePartId === id ? null : state.activePartId,
    })),

  clearAllParts: () =>
    set({
      parts: [],
      flatElements: [],
      activePartId: null,
      activeFace: null,
      nestingResults: [],
    }),

  setActivePartId: (id) => set({ activePartId: id }),
  setActiveFace: (face) => set({ activeFace: face }),
  setHoveredFaceName: (face) => set({ hoveredFaceName: face }),

  addFlatElements: (elements) =>
    set((state) => ({
      flatElements: [...state.flatElements, ...elements],
    })),

  updateFlatElement: (id, updates) =>
    set((state) => ({
      flatElements: state.flatElements.map((f) => (f.id === id ? { ...f, ...updates } : f)),
    })),

  removeFlatElement: (id) =>
    set((state) => ({
      flatElements: state.flatElements.filter((f) => f.id !== id),
    })),

  clearFlatElements: () => set({ flatElements: [] }),

  setAssemblyTree: (tree) => set({ currentAssemblyTree: tree }),
  setAssemblyTreeModalOpen: (open) => set({ assemblyTreeModalOpen: open }),

  updateNestingConfig: (updates) =>
    set((state) => ({
      nestingConfig: { ...state.nestingConfig, ...updates },
    })),

  setNestingResults: (results) => set({ nestingResults: results, activeSheetIndex: 0 }),
  setActiveSheetIndex: (index) => set({ activeSheetIndex: index }),

  getJobGroups: () => {
    const { flatElements } = get();
    const groupsMap = new Map<string, JobGroup>();

    flatElements.forEach((elem) => {
      const matName = elem.material || 'Mild Steel';
      const thick = elem.thickness || DEFAULT_THICKNESS_MM;

      // Find matching standard material or fallback
      let matInfo = STANDARD_MATERIALS.find(
        (m) => m.name.toLowerCase() === matName.toLowerCase() || m.code.toLowerCase() === matName.toLowerCase()
      );
      if (!matInfo) {
        matInfo = STANDARD_MATERIALS[0]; // Default Mild Steel (7850 kg/m³)
      }

      const key = `${matInfo.code}_${thick.toFixed(1)}mm`;

      if (!groupsMap.has(key)) {
        groupsMap.set(key, {
          id: key,
          material: matInfo.name,
          materialCode: matInfo.code,
          density: matInfo.density,
          thickness: thick,
          elements: [],
          totalQuantity: 0,
          totalWeightKg: 0,
        });
      }

      const group = groupsMap.get(key)!;
      group.elements.push(elem);
      group.totalQuantity += elem.quantity;

      // Calculate approximate mass weight in kg: Area(m²) * Thickness(m) * Density(kg/m³)
      const widthM = (elem.width || 200) / 1000.0;
      const heightM = (elem.height || 150) / 1000.0;
      const thickM = thick / 1000.0;
      const elemWeight = widthM * heightM * thickM * matInfo.density * elem.quantity;
      group.totalWeightKg += elemWeight;
    });

    return Array.from(groupsMap.values());
  },
}));
