import React, { useState, useRef, useEffect } from 'react';
import { 
  FolderOpen, 
  Settings, 
  FileCode, 
  Play, 
  AlertTriangle, 
  Layers, 
  Download, 
  CheckCircle,
  FileText,
  RotateCw,
  Info,
  Trash2,
  HelpCircle,
  Copy,
  Maximize2
} from 'lucide-react';
import { FlatPreviewer } from './components/FlatPreviewer';
import { Model3DViewer, getMaterialColorCss } from './components/Model3DViewer';
import { JobGroupTab } from './components/JobGroupTab';
import { STANDARD_MATERIALS, CAD_PRESETS_CATALOG, STANDARD_SHEET_SIZES, DEFAULT_THICKNESS_MM, DEFAULT_ETCH_MARKER_LENGTH_MM, PartItem, FlatElementItem } from './store/useCadanestStore';

declare global {
  interface Window {
    electronAPI: {
      selectFile: () => Promise<string[] | null>;
      getStlData: (filePath: string) => Promise<ArrayBuffer | null>;
      cancelProcess: () => Promise<boolean>;
      runAnalyze: (stepPath: string, originalPath?: string) => Promise<any>;
      runAnalyzeBatch: (items: Array<{ stepPath: string; originalPath?: string }>) => Promise<any>;
      parseDxf: (dxfPath: string) => Promise<any>;
      parseCadAssembly: (filePath: string) => Promise<any>;
      parseCadAssemblyBatch: (filePath: string) => Promise<any>;
      runUnfold: (args: { stepPath: string; kfactor: number; baseFace?: string; excludeBendLines?: boolean; bendStyle?: string; mirror?: boolean; exportMinimalDimpleHoles?: boolean; bendRadius?: number; etchMarkerPosition?: string; etchMarkerLength?: number }) => Promise<any>;
      runUnfoldBatch: (items: Array<{ stepPath: string; kfactor: number; baseFace?: string; excludeBendLines?: boolean; bendStyle?: string; mirror?: boolean; exportMinimalDimpleHoles?: boolean; bendRadius?: number; etchMarkerPosition?: string; etchMarkerLength?: number }>) => Promise<any>;
      runNesting: (args: {
        sheetWidth: number;
        sheetHeight: number;
        spacing: number;
        margin: number;
        sheetCutoutWidth?: number;
        sheetCutoutHeight?: number;
        sheetProfile?: string;
        autoFill?: boolean;
        rotations?: number[];
        exportFilename?: string;
        excludeBendLines?: boolean;
        bendStyle?: string;
        exportMinimalDimpleHoles?: boolean;
        etchMarkerPosition?: string;
        etchMarkerLength?: number;
        parts: Array<{
          id: string;
          stepPath: string;
          dxfPath?: string;
          quantity: number;
          kfactor: number;
          baseFace?: string;
          bendRadius?: number;
          etchMarkerPosition?: string;
          etchMarkerLength?: number;
        }>;
      }) => Promise<any>;
      calibrateKFactor: (args: { targetFlatLength: number; straightSum: number; bendAngles: number[]; bendRadii: number[]; thickness: number }) => Promise<{ status: string; kfactor?: number; error?: string }>;
      openFile: (filePath: string) => Promise<boolean>;
      saveFileAs: (args: { sourcePath: string; defaultFilename: string }) => Promise<{ status: string; filePath?: string; error?: string }>;
    };
  }
}

// PartItem and FlatElementItem are defined in ./store/useCadanestStore and imported above.
// Re-export PartItem for any external consumers that import it from App.
export type { PartItem };


// Reusable Quantity Control with direct numeric input, +/- buttons, and optional Auto toggle
const QuantityControl: React.FC<{
  value: number;
  isAuto?: boolean;
  disabled?: boolean;
  onUpdate: (qty: number) => void;
  onToggleAuto?: () => void;
  allowAuto?: boolean;
}> = ({ value, isAuto, disabled, onUpdate, onToggleAuto, allowAuto }) => {
  const [localText, setLocalText] = useState<string>(String(value));

  useEffect(() => {
    setLocalText(String(value));
  }, [value]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    setLocalText(raw);
    const parsed = parseInt(raw, 10);
    if (!isNaN(parsed) && parsed >= 1) {
      onUpdate(parsed);
    }
  };

  const handleBlur = () => {
    const parsed = parseInt(localText, 10);
    if (isNaN(parsed) || parsed < 1) {
      setLocalText(String(Math.max(1, value)));
      onUpdate(Math.max(1, value));
    } else {
      setLocalText(String(parsed));
      onUpdate(parsed);
    }
  };

  return (
    <div className="flex items-center gap-1 shrink-0">
      <button
        type="button"
        disabled={disabled || isAuto}
        onClick={() => onUpdate(Math.max(1, value - 1))}
        className="w-6 h-6 flex items-center justify-center rounded border border-industrial-border bg-industrial-darker text-industrial-muted hover:text-industrial-text hover:border-industrial-accent disabled:opacity-40 disabled:cursor-not-allowed font-mono text-xs cursor-pointer transition select-none"
      >
        -
      </button>
      <input
        type="text"
        inputMode="numeric"
        disabled={disabled || isAuto}
        value={isAuto ? 'AUTO' : localText}
        placeholder={isAuto ? 'AUTO' : '1'}
        onChange={handleChange}
        onBlur={handleBlur}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            (e.target as HTMLInputElement).blur();
          }
        }}
        className="w-14 h-6 text-center font-mono text-xs bg-industrial-darker border border-industrial-border rounded text-industrial-text focus:border-industrial-accent outline-none disabled:opacity-50 disabled:cursor-not-allowed"
      />
      <button
        type="button"
        disabled={disabled || isAuto}
        onClick={() => onUpdate(value + 1)}
        className="w-6 h-6 flex items-center justify-center rounded border border-industrial-border bg-industrial-darker text-industrial-muted hover:text-industrial-text hover:border-industrial-accent disabled:opacity-40 disabled:cursor-not-allowed font-mono text-xs cursor-pointer transition select-none"
      >
        +
      </button>
      {allowAuto && onToggleAuto && (
        <button
          type="button"
          disabled={disabled}
          onClick={onToggleAuto}
          className={`px-2 h-6 text-[10px] font-mono font-bold rounded border transition cursor-pointer select-none ${
            isAuto
              ? 'bg-industrial-orange text-white border-industrial-orange shadow-sm'
              : 'bg-industrial-darker border-industrial-border text-industrial-muted hover:text-industrial-text hover:border-industrial-accent'
          }`}
          title="Toggle Auto Quantity Calculation for Nesting"
        >
          {isAuto ? 'AUTO' : 'Auto'}
        </button>
      )}
    </div>
  );
};

// Derived from STANDARD_MATERIALS (single source of truth) plus a couple of
// alias spellings that aren't distinct STANDARD_MATERIALS entries.
const MATERIAL_K_PRESETS: Record<string, number> = {
  ...Object.fromEntries(STANDARD_MATERIALS.map(m => [m.name, m.kFactor])),
  'Steel, Structural': STANDARD_MATERIALS.find(m => m.name === 'Mild Steel')!.kFactor,
  'Aluminum 1060': STANDARD_MATERIALS.find(m => m.name === 'Aluminium 5052')!.kFactor,
};

export default function App() {
  // Application State
  const [parts, setParts] = useState<PartItem[]>([]);
  const lastNestingParamsRef = useRef<string>('');
  const [selectedPartId, setSelectedPartId] = useState<string | null>(null);

  // K-Factor Calibration Modal State
  const [showCalibrationModal, setShowCalibrationModal] = useState<boolean>(false);
  const [targetFlatLengthInput, setTargetFlatLengthInput] = useState<string>('');
  const [calibratedKResult, setCalibratedKResult] = useState<number | null>(null);
  const [isCalibrating, setIsCalibrating] = useState<boolean>(false);
  const [calibrationError, setCalibrationError] = useState<string | null>(null);
  const [combined3D, setCombined3D] = useState<boolean>(false);
  const [selectedFlatElementId, setSelectedFlatElementId] = useState<string | null>(null);
  const [hoveredFaceName, setHoveredFaceName] = useState<string | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState<number>(320);
  const [showSidebar, setShowSidebar] = useState<boolean>(true);

  const [pendingFaceSelection, setPendingFaceSelection] = useState<{ partId: string; faceName: string } | null>(null);
  
  // Sheet Stock config
  const [sheetSize, setSheetSize] = useState<string>('2500x1250');
  const [sheetWidth, setSheetWidth] = useState<number>(2500);
  const [sheetHeight, setSheetHeight] = useState<number>(1250);
  const [remnantCutoutWidth, setRemnantCutoutWidth] = useState<number>(500);
  const [remnantCutoutHeight, setRemnantCutoutHeight] = useState<number>(500);
  
  // Units System State: 'mm' | 'inch'
  const [unitMode, setUnitModeState] = useState<'mm' | 'inch'>(() => {
    return (localStorage.getItem('cadanest-unit-mode') as 'mm' | 'inch') || 'mm';
  });

  const setUnitMode = (unit: 'mm' | 'inch') => {
    setUnitModeState(unit);
    localStorage.setItem('cadanest-unit-mode', unit);
  };

  const formatVal = (valMm: number, decimals = 1): string => {
    if (unitMode === 'inch') {
      return `${(valMm / 25.4).toFixed(decimals + 1)} in`;
    }
    return `${valMm.toFixed(decimals)} mm`;
  };

  const formatDimStr = (xMm: number, yMm: number): string => {
    if (unitMode === 'inch') {
      return `${(xMm / 25.4).toFixed(1)}" × ${(yMm / 25.4).toFixed(1)}"`;
    }
    return `${xMm.toFixed(0)} × ${yMm.toFixed(0)} mm`;
  };

  // Hover Tooltip coordinates & active part
  const [hoveredPart, setHoveredPart] = useState<PartItem | null>(null);
  const [hoverCoords, setHoverCoords] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  // Execution status
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
  const [isUnfolding, setIsUnfolding] = useState<boolean>(false);
  const [isNesting, setIsNesting] = useState<boolean>(false);
  const [nestingProgress, setNestingProgress] = useState<{ pct: number; msg: string; packed?: number } | null>(null);
  const [consoleLogs, setConsoleLogs] = useState<string[]>(['System initialized. Ready to load models.']);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'import' | 'flatten' | 'jobgroups' | 'nesting'>('import');
  const [nestingInitialized, setNestingInitialized] = useState<boolean>(false);
  const [isDraggingFile, setIsDraggingFile] = useState<boolean>(false);
  const [showAboutModal, setShowAboutModal] = useState<boolean>(false);
  const [showDocModal, setShowDocModal] = useState<boolean>(false);
  const [docTab, setDocTab] = useState<'userguide' | 'unfolding' | 'nesting' | 'about'>('userguide');
  const [showShortcutsModal, setShowShortcutsModal] = useState<boolean>(false);
  const [showExportMenu, setShowExportMenu] = useState<boolean>(false);
  const [exportScope, setExportScope] = useState<'current' | 'all' | 'custom'>('current');
  const [exportSelectedSheetIdx, setExportSelectedSheetIdx] = useState<number>(0);
  const [selectedMaterialFilter, setSelectedMaterialFilter] = useState<string>('ALL');
  const [hierarchyMaterialFilter, setHierarchyMaterialFilter] = useState<string>('ALL');
  const [expandedPartFaces, setExpandedPartFaces] = useState<Record<string, boolean>>({});
  const [customSheetRange, setCustomSheetRange] = useState<string>('1');
  const [themeMode, setThemeMode] = useState<'light' | 'dark'>(() => {
    return (localStorage.getItem('theme-mode') as 'light' | 'dark') || 'dark';
  });

  // Antigravity enhancements states
  const [activeDropdown, setActiveDropdown] = useState<string | null>(null);
  const [showLogsModal, setShowLogsModal] = useState<boolean>(false);
  const [showAdvancedModal, setShowAdvancedModal] = useState<boolean>(false);
  const [fullScreenView, setFullScreenView] = useState<'3d' | 'flat' | 'nesting' | null>(null);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', themeMode);
    localStorage.setItem('theme-mode', themeMode);
  }, [themeMode]);
  const [viewMode, setViewMode] = useState<'single' | 'grid'>('single');
  const [nestingPending, setNestingPending] = useState<boolean>(false);
  const [_includeBendLines, setIncludeBendLines] = useState<boolean>(true);

  // Sheet Capacity Exceeded Modal State & Refs
  const [showCapacityModal, setShowCapacityModal] = useState<boolean>(false);
  const [capacityModalData, setCapacityModalData] = useState<{
    requestedQty: number;
    requiredSheets: number;
    largerSizeRecommended: { width: number; height: number; name: string } | null;
    pendingResponse: any;
    pendingSheets: any[];
    totalParts: number;
  } | null>(null);
  const lastConfirmedMultiSheetQtyRef = useRef<number>(0);
  const lastFittingParamsRef = useRef<{
    sheetWidth: number;
    sheetHeight: number;
    sheetSize: string;
    nestingMode: 'auto' | 'fixed';
    setsToNest: number;
    nestingConfigType: 'sets' | 'custom';
    parts: Array<{ id: string; active?: boolean; quantity: number; flatElements?: any[] }>;
  } | null>(null);

  // Nesting Parameters & Results
  const [partSpacing, setPartSpacing] = useState<number>(5.0);
  const [borderMargin, setBorderMargin] = useState<number>(5.0);
  const [rotationOption, setRotationOption] = useState<string>('all'); // 'all', '180', 'none'
  const [nestingMaterial, setNestingMaterial] = useState<string>('Steel');
  const [nestingMode, setNestingMode] = useState<'auto' | 'fixed'>('auto');
  const [setsToNest, setSetsToNest] = useState<number>(1);
  const [nestingConfigType, setNestingConfigType] = useState<'sets' | 'custom'>('sets');
  const [sheetDefaultStrategy, setSheetDefaultStrategyState] = useState<'count' | 'size'>(() => {
    return (localStorage.getItem('cadanest-sheet-strategy') as 'count' | 'size') || 'count';
  });

  const setSheetDefaultStrategy = (strat: 'count' | 'size') => {
    setSheetDefaultStrategyState(strat);
    localStorage.setItem('cadanest-sheet-strategy', strat);
  };
  const [showPreFlattenModal, setShowPreFlattenModal] = useState<boolean>(false);
  const [bendStyle, setBendStyle] = useState<string>('dashed');
  const [etchMarkerPosition, setEtchMarkerPosition] = useState<'interior' | 'boundary'>('interior');
  const [etchMarkerLength, setEtchMarkerLength] = useState<number>(DEFAULT_ETCH_MARKER_LENGTH_MM);
  const [exportMinimalDimpleHoles, setExportMinimalDimpleHoles] = useState<boolean>(true);
  const [allowPartInPart, setAllowPartInPart] = useState<boolean>(true);

  const [combinedFlat, setCombinedFlat] = useState<boolean>(false);
  const [flatRotations, setFlatRotations] = useState<{ [elementId: string]: number }>({});
  const [autoQuantityMap, setAutoQuantityMap] = useState<{ [elementId: string]: boolean }>({});

  const getNestingRotations = (): number[] => {
    switch (rotationOption) {
      case 'none':
        return [0.0];
      case '180':
        return [0.0, 180.0];
      case 'all':
      default:
        return [0.0, 45.0, 90.0, 135.0, 180.0, 225.0, 270.0, 315.0];
    }
  };
  const [autoFilledSets, setAutoFilledSets] = useState<number | null>(null);
  const [nestedSheets, setNestedSheets] = useState<Array<{ index: number; utilization: number; dxfPath: string; pdfPath: string; gcodePath: string; svgContent: string; nestedCount: number }>>([]);
  const [activeSheetIndex, setActiveSheetIndex] = useState<number>(0);
  const [nestingSvg, setNestingSvg] = useState<string | null>(null);
  const [nestingDxfPath, setNestingDxfPath] = useState<string | null>(null);
  const [nestingPdfPath, setNestingPdfPath] = useState<string | null>(null);
  const [nestingGcodePath, setNestingGcodePath] = useState<string | null>(null);
  const [nestingUtilization, setNestingUtilization] = useState<number | null>(null);
  const [nestingPartsCount, setNestingPartsCount] = useState<{ nested: number; total: number } | null>(null);
  useEffect(() => {
    if ((window as any).electronAPI?.onNestingProgress) {
      const cleanup = (window as any).electronAPI.onNestingProgress((data: any) => {
        setNestingProgress({
          pct: data.pct || 0,
          msg: data.msg || 'Processing nesting layout...',
        });
      });
      return cleanup;
    }
  }, []);

  const [processStartTime, setProcessStartTime] = useState<number | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState<number>(0);

  useEffect(() => {
    let timer: any = null;
    if (isNesting || isAnalyzing || isUnfolding) {
      if (!processStartTime) {
        setProcessStartTime(Date.now());
        setElapsedSeconds(0);
      }
      timer = setInterval(() => {
        setElapsedSeconds(prev => prev + 1);
      }, 1000);
    } else {
      setProcessStartTime(null);
      setElapsedSeconds(0);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [isNesting, isAnalyzing, isUnfolding]);

  const formatTimeStr = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m > 0 ? `${m}m ` : ''}${s}s`;
  };

  const calculateEta = () => {
    const pct = nestingProgress?.pct || 0;
    if (pct <= 0 || elapsedSeconds < 1) return 'Calculating...';
    if (pct >= 100) return '0s';
    const totalEstSecs = (elapsedSeconds / (pct / 100));
    const remainingSecs = Math.max(1, Math.round(totalEstSecs - elapsedSeconds));
    return formatTimeStr(remainingSecs);
  };



  // Currently active selected part helper
  const selectedPart = parts.find(p => p.id === selectedPartId) || null;

  const handleOpenCalibrationModal = (part?: PartItem | null) => {
    const p = part || selectedPart || parts[0];
    if (!p) return;
    const activeFe = p.flatElements?.find(fe => fe.id === selectedFlatElementId) || p.flatElements?.[0];
    const initialTarget = activeFe?.width || p.dimensions?.x || 200.0;
    setTargetFlatLengthInput(initialTarget.toFixed(3));
    setCalibratedKResult(null);
    setCalibrationError(null);
    setShowCalibrationModal(true);
  };

  const handleCalibrateKFactor = async () => {
    const targetPart = selectedPart || parts[0];
    if (!targetPart) return;

    const targetLen = parseFloat(targetFlatLengthInput);
    if (isNaN(targetLen) || targetLen <= 0) {
      setCalibrationError('Please enter a valid positive target flat dimension (mm).');
      return;
    }

    setIsCalibrating(true);
    setCalibrationError(null);

    try {
      const summary = targetPart.bendSummary || {
        bend_count: 0,
        bend_angles: [],
        bend_radii: [],
        straight_sum: targetPart.dimensions?.x || 100,
        avg_radius: targetPart.bendRadius || 1.0,
      };

      const angles = summary.bend_angles && summary.bend_angles.length > 0
        ? summary.bend_angles
        : Array(summary.bend_count || 1).fill(90.0);
      const radii = summary.bend_radii && summary.bend_radii.length > 0
        ? summary.bend_radii
        : Array(summary.bend_count || 1).fill(summary.avg_radius || 1.0);
      const straightSum = summary.straight_sum || targetPart.dimensions?.x || 100;
      const thickness = targetPart.thickness || 1.0;

      const res = await window.electronAPI.calibrateKFactor({
        targetFlatLength: targetLen,
        straightSum: straightSum,
        bendAngles: angles,
        bendRadii: radii,
        thickness: thickness,
      });

      if (res && res.status === 'success' && typeof res.kfactor === 'number') {
        setCalibratedKResult(res.kfactor);
        addLog(`🎯 K-Factor reverse-solved: K = ${res.kfactor.toFixed(4)} for target length ${targetLen.toFixed(3)} mm.`);
      } else {
        setCalibrationError(res?.error || 'Failed to calculate calibrated K-factor.');
      }
    } catch (err: any) {
      setCalibrationError(err.message || 'Calibration request failed.');
    } finally {
      setIsCalibrating(false);
    }
  };

  const handleApplyCalibratedKFactor = (saveAsMaterialDefault: boolean = false) => {
    const targetPart = selectedPart || parts[0];
    if (!targetPart || calibratedKResult === null) return;

    const newK = calibratedKResult;

    setParts(prev => prev.map(p => {
      if (p.id === targetPart.id) {
        return {
          ...p,
          kfactor: newK,
          kFactorMode: 'manual',
        };
      }
      return p;
    }));

    if (saveAsMaterialDefault && targetPart.materialName) {
      MATERIAL_K_PRESETS[targetPart.materialName] = newK;
      addLog(`Saved K = ${newK.toFixed(4)} as default preset for material "${targetPart.materialName}".`);
    }

    setShowCalibrationModal(false);
    addLog(`Applied calibrated K-Factor (${newK.toFixed(4)}) to part ${targetPart.name}.`);

    setTimeout(() => {
      handleRunUnfold();
    }, 50);
  };

  const handleSelectKFactorMode = (
    mode: 'material' | 'adaptive' | 'manual' | 'preset' | 'y_factor' | 'din6935',
    presetOrValue?: string | number
  ) => {
    const targetPart = selectedPart || parts[0];
    if (!targetPart) return;

    let newK = targetPart.kfactor;
    let selectedPreset = targetPart.kFactorPreset;
    let selectedY = targetPart.yFactor;
    let matName = targetPart.materialName || 'Mild Steel';

    if (mode === 'preset' && typeof presetOrValue === 'string') {
      const presetOpt = CAD_PRESETS_CATALOG.find(p => p.id === presetOrValue);
      if (presetOpt) {
        newK = presetOpt.value;
        selectedPreset = presetOpt.id;
      }
    } else if (mode === 'y_factor') {
      const yVal = typeof presetOrValue === 'number' ? presetOrValue : (targetPart.yFactor ?? 0.50);
      selectedY = yVal;
      newK = yVal * (2.0 / Math.PI); // Convert Y-factor to K-factor: K = Y * (2/pi)
    } else if (mode === 'din6935') {
      const r = targetPart.bendSummary?.avg_radius ?? targetPart.bendRadius ?? 1.0;
      const t = targetPart.thickness || 1.0;
      const ratio = r / t;
      newK = ratio >= 5.0 ? 0.500000 : Math.max(0.330000, Math.min(0.500000, 0.330000 + 0.170000 * Math.log10(Math.max(0.01, ratio))));
    } else if (mode === 'material') {
      matName = typeof presetOrValue === 'string' ? presetOrValue : (targetPart.materialName || 'Mild Steel');
      newK = MATERIAL_K_PRESETS[matName] ?? 0.44;
    } else if (mode === 'adaptive') {
      const avgR = targetPart.bendSummary?.avg_radius ?? targetPart.bendRadius ?? 1.0;
      const t = targetPart.thickness || 1.0;
      newK = avgR < 2.0 * t ? 0.333333 : 0.500000;
    } else if (mode === 'manual' && typeof presetOrValue === 'number') {
      newK = Math.max(0.0, Math.min(1.0, presetOrValue));
    }

    setParts(prev => prev.map(p => p.id === targetPart.id ? {
      ...p,
      kFactorMode: mode,
      kFactorPreset: selectedPreset,
      yFactor: selectedY,
      kfactor: newK,
      materialName: matName
    } : p));

    addLog(`Updated K-Factor mode to '${mode.toUpperCase()}' (K=${newK.toFixed(6)}) for ${targetPart.name}.`);
  };

  const handleCancelProcess = async () => {
    addLog('Cancelling active operation...');
    await window.electronAPI.cancelProcess();
    setIsAnalyzing(false);
    setIsUnfolding(false);
    setIsNesting(false);
    addLog('Process aborted by operator.');
  };

  const handleLoadFiles = async (filePaths: string[]) => {
    try {
      setErrorMessage(null);

      // Ignore hidden macOS AppleDouble metadata files starting with ._ or inside __MACOSX folders
      const validPaths = filePaths.filter(fp => {
        const base = fp.split(/[\\/]/).pop() || '';
        return !base.startsWith('._') && !fp.includes('__MACOSX');
      });

      if (validPaths.length === 0) {
        addLog("Import warning: Selected file(s) are inside a __MACOSX metadata folder and were skipped. Please select the DXF file from the main extracted folder.");
        return;
      }

      setIsAnalyzing(true);
      addLog(`Importing ${validPaths.length} file(s)...`);

      const newParts: PartItem[] = [];
      let dxfCount = 0;
      let stepCount = 0;

      for (const filePath of validPaths) {
        const name = filePath.split(/[\\/]/).pop() || filePath;
        const ext = filePath.toLowerCase().split('.').pop() || '';
        const isDxf = ext === 'dxf';
        const isAssemblyFile = ext === 'asm';
        const isCadAssembly = ['psm', 'par', 'sldprt', 'sldasm'].includes(ext);

        if (isAssemblyFile) {
          addLog(`Resolving assembly & converting sheet-metal parts: ${name}...`);
          const batchResponse = await window.electronAPI.parseCadAssemblyBatch(filePath);

          if (batchResponse.status === 'success' && Array.isArray(batchResponse.parts)) {
            let successCount = 0;
            const validPartResults = batchResponse.parts.filter((pr: any) => pr.status === 'success' && pr.step_path);

            const analyzeItems = validPartResults.map((pr: any) => {
              addLog(`Analyzing geometry for: ${pr.name}...`);
              return {
                stepPath: pr.step_path,
                originalPath: pr.file_path || pr.psm_path,
                partResult: pr
              };
            });

            const batchAnalyzeRes = await window.electronAPI.runAnalyzeBatch(
              analyzeItems.map((item: any) => ({ stepPath: item.stepPath, originalPath: item.originalPath }))
            );

            if (batchAnalyzeRes && batchAnalyzeRes.status === 'success' && Array.isArray(batchAnalyzeRes.results)) {
              for (let i = 0; i < analyzeItems.length; i++) {
                const item = analyzeItems[i];
                const partResult = item.partResult;
                const analyzeResult = batchAnalyzeRes.results[i];

                if (analyzeResult && analyzeResult.status === 'success') {
                  const partId = Math.random().toString(36).substring(2, 9);
                  const rawMatName = (partResult.metadata?.material && partResult.metadata.material !== 'Mild Steel' && partResult.metadata.material !== 'binary')
                    ? partResult.metadata.material
                    : (analyzeResult.material_name || analyzeResult.material || 'Mild Steel');

                  let stdMat = STANDARD_MATERIALS.find(
                    (m) => m.name.toLowerCase() === rawMatName.toLowerCase() || m.code.toLowerCase() === rawMatName.toLowerCase()
                  );
                  if (!stdMat) {
                    const lower = rawMatName.toLowerCase();
                    if (lower.includes('copper') || lower.includes('cu')) stdMat = STANDARD_MATERIALS.find(m => m.code === 'Cu');
                    else if (lower.includes('alum') || lower.includes('al6') || lower.includes('1060')) stdMat = STANDARD_MATERIALS.find(m => m.code === 'AL6061');
                    else if (lower.includes('al5')) stdMat = STANDARD_MATERIALS.find(m => m.code === 'AL5052');
                    else if (lower.includes('struct')) stdMat = STANDARD_MATERIALS.find(m => m.name.includes('Structural'));
                    else if (lower.includes('stainless') || lower.includes('ss3')) stdMat = STANDARD_MATERIALS.find(m => m.code === 'SS304');
                    else stdMat = STANDARD_MATERIALS[0];
                  }

                  const assignedMatName = stdMat?.name || rawMatName;
                  const assignedMatCode = stdMat?.code || 'MS';
                  const assignedDensity = stdMat?.density || 7850;

                  const partItem: PartItem = {
                    id: partId,
                    name: partResult.name,
                    stepPath: partResult.step_path,
                    quantity: 1,
                    kfactor: partResult.metadata?.kfactor !== undefined ? partResult.metadata.kfactor : (analyzeResult?.kfactor ?? 0.44),
                    kFactorMode: 'material',
                    bendSummary: analyzeResult?.bend_summary,
                    bendRadius: partResult.metadata?.bend_radius || undefined,
                    mirror: true,
                    baseFace: analyzeResult.base_face,
                    thickness: analyzeResult.thickness,
                    material: assignedMatCode,
                    materialName: assignedMatName,
                    density: assignedDensity,
                    totalFaces: analyzeResult.total_face_count,
                    planarFaces: analyzeResult.planar_face_count,
                    faces: analyzeResult.faces,
                    svgPreview: analyzeResult.svg_preview_content || null,
                    stlPath: analyzeResult.stl_preview_path || null,
                    dimensions: analyzeResult.dimensions || { x: 0, y: 0, z: 0 },
                    volume: analyzeResult.volume || 0,
                    area: analyzeResult.area || 0,
                    active: true,
                    flatElements: analyzeResult.base_face ? analyzeResult.base_face.split(',').map((f: string) => f.trim()).filter(Boolean).map((faceName: string) => ({
                      id: Math.random().toString(36).substring(2, 9),
                      partId: partId,
                      name: `${partResult.name.replace(/\.[^/.]+$/, "")} [${faceName}]`,
                      parentName: partResult.name,
                      baseFace: faceName,
                      quantity: 1,
                      active: true,
                      thickness: analyzeResult.thickness,
                      material: assignedMatName,
                      group: 'A'
                    })) : []
                  };
                  newParts.push(partItem);
                  stepCount++;
                  successCount++;
                  addLog(`✓ ${partResult.name} imported from assembly (Material: ${assignedMatName}, Thickness: ${analyzeResult.thickness.toFixed(1)}mm).`);
                } else {
                  addLog(`Error analyzing ${partResult.name}: ${analyzeResult?.error || 'Unknown error'}`);
                }
              }
            }
            addLog(`✓ Assembly ${name} processed: ${successCount}/${batchResponse.parts.length} sheet-metal parts imported. Click Flatten to unfold them, then Nesting to pack the sheet.`);
          } else {
            setErrorMessage(`Failed to process assembly ${name}: ${batchResponse.error}`);
            addLog(`Error processing assembly ${name}: ${batchResponse.error}`);
          }
        } else if (isCadAssembly) {
          addLog(`Parsing CAD Assembly & Metadata: ${name}...`);
          const response = await window.electronAPI.parseCadAssembly(filePath);
          if (response.status === 'success') {
            const meta = response.metadata || {};
            const material = meta.material || 'Default Steel';
            const thickness = meta.thickness || DEFAULT_THICKNESS_MM;
            const targetStep = response.step_path || filePath;

            // Analyze and auto-unfold STEP model to generate flat pattern with bend markers immediately
            let analyzeResult: any = null;
            let unfoldResult: any = null;
            if (response.step_path) {
              analyzeResult = await window.electronAPI.runAnalyze(response.step_path);
              try {
                const defaultK = meta.kfactor !== undefined ? meta.kfactor : (analyzeResult?.kfactor ?? 0.44);
                unfoldResult = await window.electronAPI.runUnfold({ stepPath: response.step_path, kfactor: defaultK, bendStyle: bendStyle, mirror: true, bendRadius: meta.bend_radius });
              } catch (e) {
                console.warn('Auto-unfold on import warning:', e);
              }
            }

            const partId = Math.random().toString(36).substring(2, 9);
            const partItem: PartItem = {
              id: partId,
              name: name,
              stepPath: targetStep,
              quantity: 1,
              kfactor: meta.kfactor !== undefined ? meta.kfactor : (analyzeResult?.kfactor ?? 0.44),
              kFactorMode: 'material',
              bendSummary: analyzeResult?.bend_summary,
              bendRadius: meta.bend_radius || undefined,
              mirror: true,
              baseFace: analyzeResult?.base_face || 'Auto',
              thickness: analyzeResult?.thickness || thickness,
              material: material,
              totalFaces: analyzeResult?.total_face_count || 1,
              planarFaces: analyzeResult?.planar_face_count || 1,
              faces: analyzeResult?.faces || [],
              svgPreview: unfoldResult?.svg_content || analyzeResult?.svg_preview_content || response.svg_preview_content || null,
              stlPath: analyzeResult?.stl_preview_path || response.stl_preview_path || null,
              dimensions: analyzeResult?.dimensions || response.dimensions || { x: 120, y: 80, z: thickness },
              volume: analyzeResult?.volume || 0,
              area: analyzeResult?.area || 0,
              active: true,
              flatElements: (meta.linked_parts && meta.linked_parts.length > 0) 
                ? meta.linked_parts.map((partName: string) => ({
                    id: Math.random().toString(36).substring(2, 9),
                    partId: partId,
                    name: partName,
                    parentName: name,
                    baseFace: 'Auto',
                    quantity: 1,
                    active: true,
                    group: 'A'
                  })) 
                : [{
                    id: Math.random().toString(36).substring(2, 9),
                    partId: partId,
                    name: name,
                    parentName: name,
                    baseFace: analyzeResult?.base_face || 'Auto',
                    quantity: 1,
                    active: true,
                    group: 'A'
                  }]
            };
            newParts.push(partItem);
            const isAssemblyFile = ext === '.asm' || ext === '.sldasm';
            if (isAssemblyFile) {
              addLog(`✓ ${name} CAD Assembly imported (Material: ${material}, Thickness: ${thickness}mm). Linked sub-parts: ${meta.linked_parts?.length || 0}`);
              // If sub-parts exist in the same folder, auto-import resolved sub-parts for assemblies
              if (meta.linked_part_paths && meta.linked_part_paths.length > 0) {
                for (const subPath of meta.linked_part_paths) {
                  if (!validPaths.includes(subPath)) {
                    validPaths.push(subPath);
                  }
                }
              }
            } else {
              addLog(`✓ ${name} Single Part imported (Material: ${material}, Thickness: ${thickness}mm).`);
            }
          } else {
            setErrorMessage(`Failed to parse CAD file ${name}: ${response.error}`);
            addLog(`Error parsing CAD file ${name}: ${response.error}`);
          }
        } else if (isDxf) {
          addLog(`Parsing DXF profile: ${name}...`);
          const response = await window.electronAPI.parseDxf(filePath);
          if (response.status === 'success') {
            const partId = Math.random().toString(36).substring(2, 9);
            const elementId = Math.random().toString(36).substring(2, 9);
            const partItem: PartItem = {
              id: partId,
              name: name,
              stepPath: '',
              quantity: 1,
              kfactor: 0.44,
              baseFace: 'DXF_Profile',
              thickness: response.thickness || 0,
              totalFaces: 1,
              planarFaces: 1,
              faces: [{ name: 'DXF_Profile', type: 'Plane', area: (response.dimensions?.x || 0) * (response.dimensions?.y || 0) }],
              svgPreview: response.svg_preview_content || null,
              stlPath: null,
              dimensions: response.dimensions || { x: 0, y: 0, z: 0 },
              volume: 0,
              area: (response.dimensions?.x || 0) * (response.dimensions?.y || 0),
              active: true,
              svgContent: response.svg_preview_content || null,
              dxfPath: filePath,
              isUnfolded: true,
              unfoldedKfactor: 0.44,
              unfoldedBaseFace: 'DXF_Profile',
              isDxfOnly: true,
              flatElements: [{
                id: elementId,
                partId: partId,
                name: name,
                parentName: name,
                baseFace: 'DXF_Profile',
                dxfPath: filePath,
                svgContent: response.svg_preview_content || null,
                isUnfolded: true,
                unfoldedKfactor: 0.44,
                unfoldedBaseFace: 'DXF_Profile',
                quantity: 1,
                active: true,
                group: 'A'
              }]
            };
            newParts.push(partItem);
            dxfCount++;
            addLog(`✓ ${name} direct DXF profile imported (${response.dimensions.x} x ${response.dimensions.y} mm). Ready for nesting.`);
          } else {
            setErrorMessage(`Failed to parse DXF ${name}: ${response.error}`);
            addLog(`Error parsing DXF ${name}: ${response.error}`);
          }
        } else {
          addLog(`Analyzing geometry for: ${name}...`);
          const response = await window.electronAPI.runAnalyze(filePath);
          
          if (response.status === 'success') {
            const partId = Math.random().toString(36).substring(2, 9);
            const partItem: PartItem = {
              id: partId,
              name: name,
              stepPath: filePath,
              quantity: 1,
              kfactor: response.kfactor ?? 0.44,
              kFactorMode: 'material',
              bendSummary: response.bend_summary,
              bendRadius: response.metadata?.bend_radius || undefined,
              mirror: true,
              baseFace: response.base_face,
              thickness: response.thickness,
              material: response.material || 'MS',
              materialName: response.material_name || 'Mild Steel',
              density: response.density || 7850,
              totalFaces: response.total_face_count,
              planarFaces: response.planar_face_count,
              faces: response.faces,
              svgPreview: response.svg_preview_content || null,
              stlPath: response.stl_preview_path || null,
              dimensions: response.dimensions || { x: 0, y: 0, z: 0 },
              volume: response.volume || 0,
              area: response.area || 0,
              active: true,
              flatElements: response.base_face ? response.base_face.split(',').map((f: string) => f.trim()).filter(Boolean).map((faceName: string) => ({
                id: Math.random().toString(36).substring(2, 9),
                partId: partId,
                name: `${name.replace(/\.[^/.]+$/, "")} [${faceName}]`,
                parentName: name,
                baseFace: faceName,
                quantity: 1,
                active: true,
                thickness: response.thickness,
                material: response.material_name || response.material || 'Mild Steel',
                group: 'A'
              })) : []
            };
            newParts.push(partItem);
            stepCount++;
            addLog(`✓ ${name} 3D model imported successfully (Thickness: ${response.thickness.toFixed(1)}mm).`);
          } else {
            setErrorMessage(`Analysis failed for ${name}: ${response.error}`);
            addLog(`Error analyzing ${name}: ${response.error}`);
          }
        }
      }

      if (newParts.length > 0) {
        setParts(prev => {
          const updated = [...prev, ...newParts];
          setSelectedPartId(newParts[0].id);
          return updated;
        });
        setNestingInitialized(false);
        setViewMode('single');
        setNestingPending(false);
        setNestingSvg(null);
        setNestedSheets([]);
        if (dxfCount > 0 && stepCount === 0) {
          setActiveTab('nesting');
        } else {
          setActiveTab('import');
        }
      }
    } catch (err: any) {
      setErrorMessage(`Failed to select or analyze files: ${err.message}`);
      addLog(`Error during import: ${err.message}`);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleSelectFiles = async () => {
    try {
      const filePaths = await window.electronAPI.selectFile();
      if (filePaths && filePaths.length > 0) {
        handleLoadFiles(filePaths);
      }
    } catch (err: any) {
      setErrorMessage(`Failed to select files: ${err.message}`);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingFile(true);
  };

  const handleDragLeave = () => {
    setIsDraggingFile(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingFile(false);
    
    const files = Array.from(e.dataTransfer.files);
    const validFiles = files.filter(f => {
      const name = f.name;
      const fPath = (f as any).path || '';
      const ext = name.toLowerCase();
      return !name.startsWith('._') && !fPath.includes('__MACOSX') && (ext.endsWith('.step') || ext.endsWith('.stp') || ext.endsWith('.iges') || ext.endsWith('.dxf'));
    });
    
    if (validFiles.length === 0) {
      addLog("Drag-and-drop warning: No valid STEP/STP or DXF files detected.");
      return;
    }
    
    const filePaths = validFiles.map(f => (f as any).path).filter(Boolean);
    if (filePaths.length > 0) {
      handleLoadFiles(filePaths);
    }
  };

  const handleDeletePart = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setParts(prev => {
      const filtered = prev.filter(p => p.id !== id);
      if (selectedPartId === id) {
        setSelectedPartId(filtered.length > 0 ? filtered[0].id : null);
      }
      return filtered;
    });
    addLog(`Deleted part from workspace.`);
  };

  const handleTogglePartActive = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setParts(prev => prev.map(p => {
      if (p.id === id) {
        const nextActive = p.active === false ? true : false;
        addLog(`Part ${p.name} is now ${nextActive ? 'included in' : 'excluded from'} nesting.`);
        return { ...p, active: nextActive };
      }
      return p;
    }));
  };

  const handleSaveDxfAs = async (sourcePath: string, defaultFilename: string) => {
    try {
      const response = await window.electronAPI.saveFileAs({ sourcePath, defaultFilename });
      if (response.status === 'success') {
        addLog(`✓ DXF file successfully saved to: ${response.filePath}`);
      } else if (response.status === 'error') {
        setErrorMessage(`Save failed: ${response.error}`);
        addLog(`Error saving file: ${response.error}`);
      }
    } catch (err: any) {
      setErrorMessage(`Save failed: ${err.message}`);
      addLog(`Error saving file: ${err.message}`);
    }
  };

  // Global Keyboard Shortcuts
  useEffect(() => {
    const handleGlobalShortcuts = (e: KeyboardEvent) => {
      // Disable shortcuts when typing inside form fields (except Escape)
      const isTyping = document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA' || document.activeElement?.tagName === 'SELECT';
      
      if (e.key === 'Escape') {
        setActiveDropdown(null);
        setShowLogsModal(false);
        setShowShortcutsModal(false);
        setShowDocModal(false);
        setShowAboutModal(false);
        setFullScreenView(null);
        return;
      }

      if (isTyping) {
        return;
      }

      // ? or Shift+/ -> Toggle Keyboard Shortcuts Modal
      if (e.key === '?' || (e.shiftKey && e.key === '/')) {
        e.preventDefault();
        setShowShortcutsModal(prev => !prev);
        return;
      }

      // Space -> Cycle tabs: import -> flatten -> nesting -> import
      if (e.key === ' ') {
        e.preventDefault();
        setActiveTab(prev => {
          if (prev === 'import') return 'flatten';
          if (prev === 'flatten') return 'nesting';
          return 'import';
        });
        addLog("Keyboard shortcut: Toggled workspace tab view.");
      }

      // Alt + F -> Toggle full screen view
      if (e.altKey && (e.key === 'f' || e.key === 'F')) {
        e.preventDefault();
        if (activeTab === 'import') {
          setFullScreenView(prev => prev === '3d' ? null : '3d');
        } else if (activeTab === 'flatten') {
          setFullScreenView(prev => prev === 'flat' ? null : 'flat');
        } else if (activeTab === 'nesting') {
          setFullScreenView(prev => prev === 'nesting' ? null : 'nesting');
        }
        addLog("Keyboard shortcut: Toggled full screen view.");
      }

      // Ctrl + E -> Instant DXF Export
      if ((e.ctrlKey || e.metaKey) && (e.key === 'e' || e.key === 'E')) {
        e.preventDefault();
        
        if (activeTab === 'nesting' && nestingDxfPath) {
          const defaultName = nestingDxfPath.split(/[\\/]/).pop() || `sheet_layout_nested.dxf`;
          handleSaveDxfAs(nestingDxfPath, defaultName);
          addLog("Keyboard shortcut: Triggered nested sheet DXF export.");
        } else {
          // Flattening mode export
          const currentPart = parts.find(p => p.id === selectedPartId);
          if (currentPart && currentPart.dxfPath) {
            const defaultName = currentPart.dxfPath.split(/[\\/]/).pop() || `${currentPart.name}_unfolded.dxf`;
            handleSaveDxfAs(currentPart.dxfPath, defaultName);
            addLog("Keyboard shortcut: Triggered flattened part DXF export.");
          } else {
            addLog("Keyboard shortcut warning: No active nested layout or unfolded flat pattern available to export.");
          }
        }
      }
    };

    window.addEventListener('keydown', handleGlobalShortcuts);
    return () => {
      window.removeEventListener('keydown', handleGlobalShortcuts);
    };
  }, [activeTab, nestingDxfPath, parts, selectedPartId, fullScreenView]);

  useEffect(() => {
    if (nestedSheets[activeSheetIndex]) {
      const matKey = `${(nestedSheets[activeSheetIndex] as any).material || 'Mild Steel'} (${(nestedSheets[activeSheetIndex] as any).thickness || DEFAULT_THICKNESS_MM}mm)`;
      if (selectedMaterialFilter !== 'ALL' && selectedMaterialFilter !== matKey) {
        setSelectedMaterialFilter(matKey);
      }
    }
  }, [activeSheetIndex, nestedSheets, selectedMaterialFilter]);

  const addLog = (msg: string) => {
    setConsoleLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]);
  };

  // Run unfolding on a specific flat element of a part
  const handleRunUnfoldElement = async (partId: string, elementId?: string, manageState = true, overrideBendStyle?: string, switchTab = false, overrideBaseFace?: string) => {
    const part = parts.find(p => p.id === partId);
    if (!part) return;
    const activeStyle = overrideBendStyle || part.bendStyle || bendStyle;
    const fe = elementId ? part.flatElements?.find(item => item.id === elementId) : part.flatElements?.[0];
    const targetBaseFace = overrideBaseFace || fe?.baseFace || part.baseFace || 'Auto';

    const ext = part.stepPath.toLowerCase().split('.').pop() || '';
    const isRawCadFile = ['asm', 'psm', 'par', 'sldprt', 'sldasm'].includes(ext);

    if (isRawCadFile) {
      const msg = `Solid Edge COM conversion required for raw 3D file: ${part.name}. On Client PC with Solid Edge installed, raw .${ext} files auto-convert to 3D STEP upon import.`;
      setErrorMessage(msg);
      addLog(`⚠ ${msg}`);
      return;
    }

    if (manageState) setIsUnfolding(true);
    setErrorMessage(null);
    
    addLog(`Starting unfolding for: ${part.name} [${targetBaseFace}]...`);
    addLog(`Params: K-Factor = ${part.kfactor.toFixed(5)}, Bend Style = ${activeStyle}, Base Face = ${targetBaseFace}${part.mirror ? ', Mirrored' : ''}`);

    try {
      const response = await window.electronAPI.runUnfold({
        stepPath: part.stepPath,
        kfactor: part.kfactor,
        baseFace: targetBaseFace,
        excludeBendLines: activeStyle === 'none',
        bendStyle: activeStyle,
        mirror: part.mirror || false,
        exportMinimalDimpleHoles: exportMinimalDimpleHoles,
        bendRadius: part.bendRadius,
        etchMarkerPosition: part.etchMarkerPosition || etchMarkerPosition,
        etchMarkerLength: part.etchMarkerLength || etchMarkerLength
      });

      if (response.status === 'success') {
        setParts(prev => prev.map(p => {
          if (p.id !== partId) return p;
          return {
            ...p,
            bendStyle: activeStyle,
            svgContent: response.svg_content || null,
            dxfPath: response.dxf_path,
            isUnfolded: true,
            unfoldedKfactor: part.kfactor,
            unfoldedBaseFace: response.base_face,
            flatElements: p.flatElements?.map(item => {
              if (item.id === elementId) {
                return {
                  ...item,
                  thickness: response.thickness,
                  baseFace: item.baseFace || response.base_face,
                  dxfPath: response.dxf_path,
                  svgContent: response.svg_content || null,
                  isUnfolded: true,
                  unfoldedKfactor: part.kfactor,
                  unfoldedBaseFace: item.baseFace || response.base_face,
                  unfoldedMirror: part.mirror || false,
                  unfoldedBendStyle: activeStyle
                };
              }
              return item;
            })
          };
        }));

        if (response.projection_fallback) {
          addLog(`⚠ Note: Physical unfold trace failed (likely due to spline curves or thickness variances).`);
          addLog(`✓ Silhouette Projection blank successfully extracted & projected!`);
        } else {
          addLog(`✓ Physical unfolding completed successfully!`);
        }
        addLog(`DXF file exported to: ${response.dxf_path}`);

        if (switchTab) {
          setActiveTab('flatten');
        }
      } else {
        setErrorMessage(response.error);
        addLog(`Unfold error: ${response.error}`);
      }
    } catch (err: any) {
      setErrorMessage(`Flattening failed: ${err.message}`);
      addLog(`Process failure: ${err.message}`);
    } finally {
      if (manageState) setIsUnfolding(false);
    }
  };

  // Run unfolding on all active checked parts (from the main header button)
  const handleRunUnfold = async () => {
    if (isUnfolding) return;

    const elementsToFlatten: { partId: string; elementId: string }[] = [];
    parts.forEach(p => {
      if (p.active !== false) {
        if (p.flatElements && p.flatElements.length > 0) {
          p.flatElements.forEach(fe => {
            elementsToFlatten.push({ partId: p.id, elementId: fe.id });
          });
        } else {
          elementsToFlatten.push({ partId: p.id, elementId: Math.random().toString(36).substring(2, 9) });
        }
      }
    });

    if (elementsToFlatten.length === 0) {
      if (!selectedPart) return;
      const activeFe = selectedPart.flatElements?.find(fe => fe.id === selectedFlatElementId) || selectedPart.flatElements?.[0];
      const targetElemId = activeFe ? activeFe.id : Math.random().toString(36).substring(2, 9);
      await handleRunUnfoldElement(selectedPart.id, targetElemId);
      return;
    }

    setIsUnfolding(true);
    try {
      const batchItems = elementsToFlatten.map(el => {
        const p = parts.find(part => part.id === el.partId)!;
        const fe = el.elementId ? p.flatElements?.find(item => item.id === el.elementId) : p.flatElements?.[0];
        const activeStyle = p.bendStyle || bendStyle;
        const targetBaseFace = fe?.baseFace || p.baseFace || 'Auto';

        addLog(`Starting unfolding for: ${p.name} [${targetBaseFace}]...`);
        addLog(`Params: K-Factor = ${p.kfactor.toFixed(5)}, Bend Style = ${activeStyle}, Base Face = ${targetBaseFace}${p.mirror ? ', Mirrored' : ''}`);

        return {
          partId: p.id,
          elementId: el.elementId,
          stepPath: p.stepPath,
          kfactor: p.kfactor,
          baseFace: targetBaseFace,
          excludeBendLines: activeStyle === 'none',
          bendStyle: activeStyle,
          mirror: p.mirror || false,
          exportMinimalDimpleHoles: exportMinimalDimpleHoles,
          bendRadius: p.bendRadius,
          etchMarkerPosition: p.etchMarkerPosition || etchMarkerPosition,
          etchMarkerLength: p.etchMarkerLength || etchMarkerLength
        };
      });

      const batchRes = await window.electronAPI.runUnfoldBatch(batchItems);

      if (batchRes && batchRes.status === 'success' && Array.isArray(batchRes.results)) {
        const elementResultMap = new Map<string, any>();
        batchItems.forEach((item, idx) => {
          if (batchRes.results[idx]) {
            elementResultMap.set(item.elementId, batchRes.results[idx]);
          }
        });

        // Log results outside the setParts state updater function
        parts.forEach((p: PartItem) => {
          const firstSuccessRes = p.flatElements
            ?.map((fe: FlatElementItem) => elementResultMap.get(fe.id))
            .find((res: any) => res && res.status === 'success');
          if (firstSuccessRes) {
            addLog(`✓ Physical unfolding completed successfully! (${p.name})`);
            if (firstSuccessRes.dxf_path) addLog(`DXF file exported to: ${firstSuccessRes.dxf_path}`);
          }
        });

        setParts(prevParts => prevParts.map(p => {
          const hasAnyResult = p.flatElements?.some(fe => {
            const res = elementResultMap.get(fe.id);
            return res && res.status === 'success';
          });
          if (!hasAnyResult) return p;

          const firstSuccessRes = p.flatElements
            ?.map(fe => elementResultMap.get(fe.id))
            .find(res => res && res.status === 'success');

          return {
            ...p,
            bendStyle: p.bendStyle || bendStyle,
            svgContent: firstSuccessRes?.svg_content || null,
            dxfPath: firstSuccessRes?.dxf_path,
            isUnfolded: true,
            unfoldedKfactor: p.kfactor,
            unfoldedBaseFace: firstSuccessRes?.base_face,
            flatElements: p.flatElements?.map(item => {
              const resItem = elementResultMap.get(item.id);
              if (!resItem || resItem.status !== 'success') return item;
              return {
                ...item,
                thickness: resItem.thickness || p.thickness,
                baseFace: item.baseFace || resItem.base_face,
                dxfPath: resItem.dxf_path,
                svgContent: resItem.svg_content || null,
                isUnfolded: true,
                active: true,
                unfoldedKfactor: p.kfactor,
                unfoldedBaseFace: item.baseFace || resItem.base_face,
                unfoldedMirror: p.mirror || false,
                unfoldedBendStyle: p.bendStyle || bendStyle
              };
            })
          };
        }));
      }
    } finally {
      setIsUnfolding(false);
    }
  };

  // Run nesting solver on all active parts in library
  const handleRunNesting = async () => {
    setNestingInitialized(true);
    setNestingPending(false);
    const activeElements: Array<{ part: PartItem; element: FlatElementItem }> = [];
    parts.forEach(p => {
      if (p.active !== false) {
        p.flatElements?.forEach(fe => {
          if (fe.active !== false && fe.isUnfolded && fe.dxfPath) {
            activeElements.push({ part: p, element: fe });
          }
        });
      }
    });

    if (activeElements.length === 0) {
      setErrorMessage("No active unfolded flat elements selected for nesting. Please ensure parts are unfolded and checked.");
      addLog("Nesting aborted: No active unfolded flat elements.");
      return;
    }

    // Validate that none of the active elements have a quantity of 0 or empty
    const zeroQtyElement = activeElements.find(ae => ae.element.quantity <= 0);
    if (zeroQtyElement) {
      setErrorMessage(`Nesting Error: Quantity for ${zeroQtyElement.element.baseFace} is set to 0. It must be at least 1.`);
      addLog(`Nesting aborted: Invalid part quantity (0) for ${zeroQtyElement.element.baseFace}.`);
      return;
    }

    setIsNesting(true);
    setErrorMessage(null);
    addLog(`Starting 2D irregular shape nesting job...`);
    addLog(`Active Flat Elements in Job: ${activeElements.map(ae => ae.element.name).join(', ')}`);
    addLog(`Sheet Size: ${sheetWidth} x ${sheetHeight} mm (Material: ${nestingMaterial})`);
    addLog(`Clearance Spacing: ${partSpacing} mm, Border Margin: ${borderMargin} mm`);
    addLog(`Allowed Rotations: ${rotationOption === 'all' ? 'All (0°, 90°, 180°, 270°)' : rotationOption === '180' ? '180° Steps (0°, 180°)' : 'No Rotation (0°)'}`);
    if (nestingConfigType === 'sets') {
      if (nestingMode === 'auto') {
        addLog(`Nesting Mode: Auto-Fill Sheet (Maximum utilization)`);
      } else {
        addLog(`Nesting Mode: Fixed Quantity (${setsToNest} sets)`);
      }
    } else {
      addLog(`Nesting Mode: Custom Individual Quantities`);
    }

    const now = new Date();
    const day = String(now.getDate()).padStart(2, '0');
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const year = String(now.getFullYear()).slice(-2);
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    const dateTimeStr = `${day}${month}${year}_${hours}${minutes}${seconds}`;

    const partInitialsStr = activeElements
      .map(ae => {
        const base = ae.element.name.replace(/\.[^/.]+$/, "");
        const segments = base.split(/[^a-zA-Z0-9]+/);
        return segments.map(s => s.charAt(0).toUpperCase()).join("");
      })
      .filter(Boolean)
      .join("_");

    const exportFilename = `${sheetWidth}x${sheetHeight}_${partInitialsStr}_${dateTimeStr}.dxf`;

    try {
      const response = await window.electronAPI.runNesting({
        sheetWidth,
        sheetHeight,
        spacing: partSpacing,
        margin: borderMargin,
        sheetCutoutWidth: sheetSize === 'remnant_lshape' ? remnantCutoutWidth : undefined,
        sheetCutoutHeight: sheetSize === 'remnant_lshape' ? remnantCutoutHeight : undefined,
        sheetProfile: sheetSize === 'remnant_lshape' ? 'lshape' : 'rect',
        autoFill: nestingConfigType === 'sets' && nestingMode === 'auto',
        rotations: getNestingRotations(),
        exportFilename,
        excludeBendLines: false,
        bendStyle: bendStyle,
        exportMinimalDimpleHoles: exportMinimalDimpleHoles,
        etchMarkerPosition: etchMarkerPosition,
        etchMarkerLength: etchMarkerLength,
        parts: activeElements.map(ae => {
          const isAuto = !!autoQuantityMap[ae.element.id];
          return {
            id: ae.element.id,
            name: ae.element.name,
            stepPath: ae.part.stepPath,
            dxfPath: ae.element.dxfPath || undefined,
            quantity: isAuto ? 9999 : (nestingConfigType === 'sets'
              ? (nestingMode === 'auto' ? ae.element.quantity : ae.element.quantity * setsToNest)
              : ae.element.quantity),
            auto: isAuto,
            kfactor: ae.part.kfactor,
            baseFace: ae.element.baseFace,
            bendRadius: ae.part.bendRadius,
            etchMarkerPosition: ae.part.etchMarkerPosition || etchMarkerPosition,
            etchMarkerLength: ae.part.etchMarkerLength || etchMarkerLength,
            group: ae.element.group || null,
            material: ae.part.materialName || ae.part.material || 'Mild Steel',
            thickness: ae.part.thickness || DEFAULT_THICKNESS_MM
          };
        })
      });

      if (response.status === 'success') {
        const sheets = (response.sheets || []).map((s: any) => ({
          index: s.index,
          material: s.material || 'Mild Steel',
          thickness: s.thickness || DEFAULT_THICKNESS_MM,
          utilization: s.utilization,
          dxfPath: s.dxf_path,
          pdfPath: s.pdf_path,
          gcodePath: s.gcode_path,
          svgContent: s.svg_content,
          nestedCount: s.nested_count
        }));

        // Calculate total requested quantity of parts
        const totalPartsRequested = activeElements.reduce((sum, ae) => {
          const qty = nestingConfigType === 'sets'
            ? (nestingMode === 'auto' ? ae.element.quantity : ae.element.quantity * setsToNest)
            : ae.element.quantity;
          return sum + qty;
        }, 0);

        // Check if solver exceeded single sheet capacity and apply user capacity strategy preference
        const hasCapacityExceeded = sheets.length > 1 || (response.total_count !== undefined && response.total_count < totalPartsRequested);
        if (hasCapacityExceeded && totalPartsRequested !== lastConfirmedMultiSheetQtyRef.current) {
          const getRecommendedLargerSize = (w: number, h: number) => {
            const currentTierIdx = STANDARD_SHEET_SIZES.findIndex(size => w <= size.width && h <= size.height);
            const next = currentTierIdx >= 0 ? STANDARD_SHEET_SIZES[currentTierIdx + 1] : undefined;
            if (!next) return null;
            return { width: next.width, height: next.height, name: `${next.label} (${next.width} x ${next.height} mm)` };
          };

          if (sheetDefaultStrategy === 'count') {
            lastConfirmedMultiSheetQtyRef.current = totalPartsRequested;
            addLog(`Sheet capacity exceeded: creating ${sheets.length} sheets based on preference (+Sheet Count).`);
          } else if (sheetDefaultStrategy === 'size') {
            const recommended = getRecommendedLargerSize(sheetWidth, sheetHeight);
            if (recommended) {
              lastConfirmedMultiSheetQtyRef.current = totalPartsRequested;
              addLog(`Sheet capacity exceeded: expanding to ${recommended.name} (+Sheet Size). Click 'Start Nesting Solver' to re-run with the new dimensions.`);
              setSheetWidth(recommended.width);
              setSheetHeight(recommended.height);
              setSheetSize(`${recommended.width}x${recommended.height}`);
              // Mark as pending — user must manually trigger the new nest to avoid
              // the race where isNesting briefly goes false then true via setTimeout.
              setNestingPending(true);
              setIsNesting(false);
              return;
            } else {
              setCapacityModalData({
                requestedQty: totalPartsRequested,
                requiredSheets: sheets.length,
                largerSizeRecommended: null,
                pendingResponse: response,
                pendingSheets: sheets,
                totalParts: response.total_count
              });
              setShowCapacityModal(true);
              setIsNesting(false);
              return;
            }
          }
        }

        // If it fits on 1 sheet, capture current parameters as last fitting baseline
        if (sheets.length === 1) {
          lastFittingParamsRef.current = {
            sheetWidth,
            sheetHeight,
            sheetSize,
            nestingMode,
            setsToNest,
            nestingConfigType,
            parts: parts.map(p => ({
              id: p.id,
              active: p.active,
              quantity: p.quantity,
              flatElements: p.flatElements?.map(fe => ({
                id: fe.id,
                active: fe.active,
                quantity: fe.quantity,
                group: fe.group
              }))
            }))
          };
        }
        
        lastNestingParamsRef.current = JSON.stringify({
          sheetWidth,
          sheetHeight,
          partSpacing,
          borderMargin,
          rotationOption,
          nestingMaterial,
          nestingMode,
          setsToNest,
          nestingConfigType,
          parts: activeElements.map(ae => ({
            id: ae.element.id,
            quantity: nestingConfigType === 'sets'
              ? (nestingMode === 'auto' ? ae.element.quantity : ae.element.quantity * setsToNest)
              : ae.element.quantity,
            dxfPath: ae.element.dxfPath,
            kfactor: ae.part.kfactor,
            baseFace: ae.element.baseFace,
            group: ae.element.group || null
          }))
        });
        setAutoFilledSets(response.auto_fill_sets || null);

        // Sync auto-calculated quantities into state for parts marked as Auto
        if (response.sheets) {
          const nestedCountsByPartId: { [id: string]: number } = {};
          response.sheets.forEach((s: any) => {
            (s.nested_parts || []).forEach((np: any) => {
              const pid = np.part_id;
              if (pid) {
                nestedCountsByPartId[pid] = (nestedCountsByPartId[pid] || 0) + 1;
              }
            });
          });
          const hasAuto = Object.values(autoQuantityMap).some(Boolean);
          if (hasAuto) {
            setParts(prevParts => prevParts.map(p => {
              const updatedFlatElements = p.flatElements?.map(fe => {
                if (autoQuantityMap[fe.id] && nestedCountsByPartId[fe.id] !== undefined) {
                  return { ...fe, quantity: nestedCountsByPartId[fe.id] };
                }
                return fe;
              });
              return { ...p, flatElements: updatedFlatElements };
            }));
          }
        }

        if (sheets.length > 0) {
          setNestedSheets(sheets);
          setActiveSheetIndex(0);
          setNestingSvg(sheets[0].svgContent);
          setNestingDxfPath(sheets[0].dxfPath);
          setNestingPdfPath(sheets[0].pdfPath);
          setNestingGcodePath(sheets[0].gcodePath);
          setNestingUtilization(sheets[0].utilization);
        } else {
          setNestedSheets([]);
          setActiveSheetIndex(0);
          setNestingSvg(null);
          setNestingDxfPath(null);
          setNestingPdfPath(null);
          setNestingGcodePath(null);
          setNestingUtilization(null);
        }

        const totalNested = sheets.reduce((acc: number, s: any) => acc + s.nestedCount, 0);
        setNestingPartsCount({ nested: totalNested, total: response.total_count });

        addLog(`✓ Nesting completed successfully!`);
        if (nestingMode === 'auto' && response.auto_fill_sets) {
          addLog(`✓ Auto-filled sheet with ${response.auto_fill_sets} sets.`);
        }
        addLog(`Generated ${sheets.length} sheet layout(s) for a total of ${response.total_count} part instances.`);
        sheets.forEach((s: any) => {
          addLog(`  • Sheet ${s.index}: ${s.nestedCount} parts placed, ${s.utilization}% utilization`);
        });

        if (response.skipped_parts && response.skipped_parts.length > 0) {
          addLog(`⚠ Skipped ${response.skipped_parts.length} part instances:`);
          response.skipped_parts.forEach((p: any) => {
            addLog(`    - ${p.name} (instance #${p.index}): ${p.reason || 'Does not fit'}`);
          });
        }

        if (response.warnings && response.warnings.length > 0) {
          response.warnings.forEach((warn: string) => addLog(`⚠ Warning: ${warn}`));
        }

        // Switch to Nesting View
        setActiveTab('nesting');
      } else {
        setErrorMessage(response.error);
        addLog(`Nesting error: ${response.error}`);
      }
    } catch (err: any) {
      setErrorMessage(`Nesting operation failed: ${err.message}`);
      addLog(`Process failure: ${err.message}`);
    } finally {
      setIsNesting(false);
    }
  };

  const handleUpdatePartQuantity = (id: string, qty: number) => {
    setParts(prev => prev.map(p => {
      if (p.id !== id) return p;
      const newQty = Math.max(0, qty);
      return {
        ...p,
        quantity: newQty,
        flatElements: p.flatElements?.map(fe => ({
          ...fe,
          quantity: newQty
        }))
      };
    }));
  };

  const handleUpdatePartKfactor = (id: string, k: number) => {
    setParts(prev => prev.map(p => p.id === id ? { ...p, kfactor: k } : p));
  };

  const handleUpdatePartBaseFace = (id: string, faceName: string) => {
    setParts(prev => prev.map(p => {
      if (p.id !== id) return p;
      let nextBaseFace = p.baseFace;
      const faces = p.baseFace ? p.baseFace.split(',').filter(Boolean) : [];
      let updatedFlatElements = p.flatElements ? [...p.flatElements] : [];

      if (faces.includes(faceName)) {
        const remaining = faces.filter(f => f !== faceName);
        nextBaseFace = remaining.join(',') || null;
        updatedFlatElements = updatedFlatElements.filter(fe => fe.baseFace !== faceName);
        addLog(`Deselected face ${faceName} for ${p.name}. Base face: ${nextBaseFace || 'Auto'}.`);
      } else {
        faces.push(faceName);
        nextBaseFace = faces.join(',');
        updatedFlatElements.push({
          id: Math.random().toString(36).substring(2, 9),
          partId: p.id,
          name: `${p.name.replace(/\.[^/.]+$/, "")} [${faceName}]`,
          parentName: p.name,
          baseFace: faceName,
          quantity: p.quantity,
          active: true,
          group: 'A'
        });
        addLog(`Selected face ${faceName} for ${p.name}. Base face: ${nextBaseFace}. Click 'FLATTEN MODEL' to proceed.`);
      }
      return { ...p, baseFace: nextBaseFace, flatElements: updatedFlatElements };
    }));
  };

  const handleSetSoleBaseFace = (id: string, faceName: string) => {
    setParts(prev => prev.map(p => {
      if (p.id !== id) return p;
      const existingFe = p.flatElements?.[0];
      const elemId = existingFe ? existingFe.id : Math.random().toString(36).substring(2, 9);
      const updatedFlatElements = [{
        id: elemId,
        partId: p.id,
        name: `${p.name.replace(/\.[^/.]+$/, "")} [${faceName}]`,
        parentName: p.name,
        baseFace: faceName,
        quantity: p.quantity,
        active: true,
        group: 'A' as const
      }];
      return { ...p, baseFace: faceName, flatElements: updatedFlatElements };
    }));
    addLog(`Set ${faceName} as primary base face for model. Click 'FLATTEN MODEL' to proceed.`);
  };

  const handleClearBaseFaces = (id: string) => {
    setParts(prev => prev.map(p => {
      if (p.id !== id) return p;
      return { ...p, baseFace: null, flatElements: [] };
    }));
    addLog(`Cleared base face selection.`);
  };

  const handleCycleFlatElementGroup = (partId: string, elementId: string) => {
    setParts(prev => prev.map(p => {
      if (p.id !== partId) return p;
      return {
        ...p,
        flatElements: p.flatElements?.map(fe => {
          if (fe.id === elementId) {
            let nextGroup: 'A' | 'B' | null = null;
            if (!fe.group) {
              nextGroup = 'A';
            } else if (fe.group === 'A') {
              nextGroup = 'B';
            } else {
              nextGroup = null;
            }
            addLog(`Moved element ${fe.baseFace} to ${nextGroup ? `Group ${nextGroup}` : 'Independent'}.`);
            return { ...fe, group: nextGroup };
          }
          return fe;
        })
      };
    }));
  };

  const handleUpdateFlatElementQuantity = (partId: string, elementId: string, qty: number) => {
    setParts(prev => prev.map(p => {
      if (p.id !== partId) return p;
      return {
        ...p,
        flatElements: p.flatElements?.map(fe => 
          fe.id === elementId ? { ...fe, quantity: Math.max(0, qty) } : fe
        )
      };
    }));
  };

  const handleToggleFlatElementActive = (partId: string, elementId: string) => {
    setParts(prev => prev.map(p => {
      if (p.id !== partId) return p;
      return {
        ...p,
        flatElements: p.flatElements?.map(fe => 
          fe.id === elementId ? { ...fe, active: fe.active === false ? true : false } : fe
        )
      };
    }));
  };

  const handleConfirmMultiSheet = () => {
    if (!capacityModalData) return;
    const { pendingSheets, pendingResponse, requestedQty } = capacityModalData;

    lastConfirmedMultiSheetQtyRef.current = requestedQty;
    
    setNestedSheets(pendingSheets);
    setActiveSheetIndex(0);
    setAutoFilledSets(pendingResponse.auto_fill_sets || null);

    if (pendingSheets.length > 0) {
      setNestingSvg(pendingSheets[0].svgContent);
      setNestingDxfPath(pendingSheets[0].dxfPath);
      setNestingPdfPath(pendingSheets[0].pdfPath);
      setNestingGcodePath(pendingSheets[0].gcodePath);
      setNestingUtilization(pendingSheets[0].utilization);
    }

    const totalNested = pendingSheets.reduce((acc: number, s: any) => acc + s.nestedCount, 0);
    setNestingPartsCount({ nested: totalNested, total: capacityModalData.totalParts });

    setShowCapacityModal(false);
    setCapacityModalData(null);
    addLog(`✓ Operator confirmed multi-sheet spill-over nesting across ${pendingSheets.length} sheets.`);
  };

  const handleConfirmUpsizeSheet = (w: number, h: number, sizeName: string) => {
    setSheetWidth(w);
    setSheetHeight(h);
    setSheetSize(`${w}x${h}`);
    setShowCapacityModal(false);
    setCapacityModalData(null);
    addLog(`✓ Upsized sheet stock to ${sizeName} to fit all parts on a single sheet.`);
  };

  const handleCancelCapacityModal = () => {
    if (lastFittingParamsRef.current) {
      const p = lastFittingParamsRef.current;
      setSheetWidth(p.sheetWidth);
      setSheetHeight(p.sheetHeight);
      setSheetSize(p.sheetSize);
      setNestingMode(p.nestingMode);
      setSetsToNest(p.setsToNest);
      setNestingConfigType(p.nestingConfigType);
      
      setParts(prev => prev.map(item => {
        const savedPart = p.parts.find(sp => sp.id === item.id);
        if (!savedPart) return item;
        return {
          ...item,
          active: savedPart.active,
          quantity: savedPart.quantity,
          flatElements: item.flatElements?.map(fe => {
            const savedFe = savedPart.flatElements?.find(sfe => sfe.id === fe.id);
            if (!savedFe) return fe;
            return {
              ...fe,
              active: savedFe.active,
              quantity: savedFe.quantity,
              group: savedFe.group
            };
          })
        };
      }));
      addLog(`✓ Nesting quantity reverted to the last layout configuration that fit on a single sheet.`);
    } else {
      setSetsToNest(1);
      setParts(prev => prev.map(p => ({
        ...p,
        quantity: 1,
        flatElements: p.flatElements?.map(fe => ({ ...fe, quantity: 1 }))
      })));
      addLog(`✓ Reverted requested quantities back to default (1).`);
    }
    setShowCapacityModal(false);
    setCapacityModalData(null);
  };

  // Live updates useEffect loop
  useEffect(() => {
    if (parts.length === 0) return;
    if (isAnalyzing || isUnfolding || isNesting) return;

    // Check if parameters changed immediately (to show changes pending indicator)
    const activeElements: Array<{ part: PartItem; element: FlatElementItem }> = [];
    parts.forEach(p => {
      if (p.active !== false) {
        p.flatElements?.forEach(fe => {
          if (fe.active !== false && fe.isUnfolded && fe.dxfPath) {
            activeElements.push({ part: p, element: fe });
          }
        });
      }
    });

    const currentNestingParams = JSON.stringify({
      sheetWidth,
      sheetHeight,
      partSpacing,
      borderMargin,
      rotationOption,
      nestingMaterial,
      nestingMode,
      setsToNest,
      nestingConfigType,
      parts: activeElements.map(ae => ({
        id: ae.element.id,
        quantity: nestingConfigType === 'sets'
          ? (nestingMode === 'auto' ? ae.element.quantity : ae.element.quantity * setsToNest)
          : ae.element.quantity,
        dxfPath: ae.element.dxfPath,
        kfactor: ae.part.kfactor,
        baseFace: ae.element.baseFace,
        group: ae.element.group
      }))
    });

    const isNestingDifferent = currentNestingParams !== lastNestingParamsRef.current;
    if (isNestingDifferent && !nestingPending && nestingInitialized && activeElements.length > 0) {
      setNestingPending(true);
    }

    const timer = setTimeout(async () => {
      // Prevent running if another process started during the timeout
      if (isAnalyzing || isUnfolding || isNesting) return;

      if (activeTab === 'flatten') {
        if (selectedPart) {
          const activeFe = selectedPart.flatElements?.find(fe => fe.id === selectedFlatElementId) || selectedPart.flatElements?.[0];
          if (activeFe) {
            const needsUnfold = !activeFe.isUnfolded || activeFe.unfoldedKfactor !== selectedPart.kfactor || activeFe.unfoldedMirror !== (selectedPart.mirror || false) || activeFe.unfoldedBendStyle !== (selectedPart.bendStyle || bendStyle);
            if (needsUnfold) {
              await handleRunUnfoldElement(selectedPart.id, activeFe.id);
            }
          }
        }
      } else if (activeTab === 'nesting') {
        // Find if any active flat elements across all active parts need unfolding/re-unfolding
        const outdatedElements: Array<{ part: PartItem; element: FlatElementItem }> = [];
        parts.forEach(p => {
          if (p.active !== false) {
            p.flatElements?.forEach(fe => {
              if (fe.active !== false && (!fe.isUnfolded || fe.unfoldedKfactor !== p.kfactor || fe.unfoldedMirror !== (p.mirror || false) || fe.unfoldedBendStyle !== (p.bendStyle || bendStyle))) {
                outdatedElements.push({ part: p, element: fe });
              }
            });
          }
        });

        if (outdatedElements.length > 0) {
          const { part, element } = outdatedElements[0];
          await handleRunUnfoldElement(part.id, element.id);
        } else {
          if (isNestingDifferent) {
            if (activeElements.length > 0) {
              lastNestingParamsRef.current = currentNestingParams;
              setNestingPending(true);
            }
          }
        }
      }
    }, 2500); // 2.5s debounce delay

    return () => clearTimeout(timer);
  }, [
    parts,
    partSpacing,
    borderMargin,
    sheetWidth,
    sheetHeight,
    rotationOption,
    nestingMaterial,
    nestingMode,
    setsToNest,
    nestingConfigType,
    activeTab,
    selectedPartId,
    selectedFlatElementId,
    isAnalyzing,
    isUnfolding,
    isNesting,
    nestingInitialized
  ]);


  const handleUndoUnfold = (partId: string) => {
    setParts(prev => prev.map(p => {
      if (p.id === partId) {
        addLog(`Undid flattening for: ${p.name}`);
        return {
          ...p,
          dxfPath: undefined,
          svgContent: null,
          isUnfolded: false
        };
      }
      return p;
    }));
  };

  const handleSidebarResize = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = sidebarWidth;

    const doDrag = (moveEvent: MouseEvent) => {
      const newWidth = Math.max(260, Math.min(600, startWidth + (moveEvent.clientX - startX)));
      setSidebarWidth(newWidth);
    };

    const stopDrag = () => {
      document.removeEventListener('mousemove', doDrag);
      document.removeEventListener('mouseup', stopDrag);
    };

    document.addEventListener('mousemove', doDrag);
    document.addEventListener('mouseup', stopDrag);
  };



  const handleSheetChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    setSheetSize(val);
    if (val === 'remnant_rect' || val === 'remnant_lshape') {
      setSheetWidth(1200);
      setSheetHeight(800);
    } else if (val !== 'custom') {
      const [w, h] = val.split('x').map(Number);
      setSheetWidth(w);
      setSheetHeight(h);
    }
  };

  // Setup parts array info for Three.js combined/separated views
  const viewerParts = React.useMemo(() => {
    if (combined3D) {
      return parts
        .filter(p => p.stlPath !== null)
        .map(p => ({ id: p.id, name: p.name, stlPath: p.stlPath! }));
    }
    if (selectedPart && selectedPart.stlPath) {
      return [{ id: selectedPart.id, name: selectedPart.name, stlPath: selectedPart.stlPath }];
    }
    return [];
  }, [parts, combined3D, selectedPartId]);

  // Compute combined SVG scene for 2D Flat view and full-screen view
  const combinedSvgContent = React.useMemo(() => {
    const unfoldedList = parts.flatMap(p =>
      (p.flatElements || [])
        .filter(fe => fe.isUnfolded && fe.svgContent && (fe.active !== false) && (p.active !== false))
        .map(fe => ({ part: p, element: fe }))
    );

    if (unfoldedList.length === 0) return null;

    let combinedGroups = '';
    const maxRowWidth = 2200;
    let currentX = 40;
    let currentY = 40;
    let rowMaxH = 0;
    let totalMaxX = 0;

    unfoldedList.forEach(({ element }) => {
      try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(element.svgContent!, 'image/svg+xml');
        const svgNode = doc.querySelector('svg');
        if (!svgNode) return;

        svgNode.querySelectorAll('style').forEach(s => s.remove());

        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

        const vbAttr = svgNode.getAttribute('viewBox');
        if (vbAttr) {
          const p = vbAttr.trim().split(/[\s,]+/).map(Number).filter(n => !isNaN(n));
          if (p.length === 4 && p[2] > 0 && p[3] > 0) {
            minX = p[0];
            minY = p[1];
            maxX = p[0] + p[2];
            maxY = p[1] + p[3];
          }
        }

        svgNode.querySelectorAll('path, polygon, polyline, rect, line, circle').forEach(el => {
          el.setAttribute('vector-effect', 'non-scaling-stroke');
          const f = el.getAttribute('fill');
          if (f && (f === 'black' || f === '#000000' || f === '#000' || f.includes('rgb(0,0,0)'))) {
            el.setAttribute('fill', 'rgba(56, 189, 248, 0.12)');
          }

          if (el.tagName === 'path') {
            const d = el.getAttribute('d');
            if (d) {
              const matches = d.match(/-?\d+\.?\d*/g);
              if (matches) {
                for (let i = 0; i < matches.length - 1; i += 2) {
                  const x = parseFloat(matches[i]);
                  const y = parseFloat(matches[i + 1]);
                  if (!isNaN(x) && !isNaN(y)) {
                    if (x < minX) minX = x;
                    if (x > maxX) maxX = x;
                    if (y < minY) minY = y;
                    if (y > maxY) maxY = y;
                  }
                }
              }
            }
          } else if (el.tagName === 'polygon' || el.tagName === 'polyline') {
            const pts = el.getAttribute('points');
            if (pts) {
              const matches = pts.match(/-?\d+\.?\d*/g);
              if (matches) {
                for (let i = 0; i < matches.length - 1; i += 2) {
                  const x = parseFloat(matches[i]);
                  const y = parseFloat(matches[i + 1]);
                  if (!isNaN(x) && !isNaN(y)) {
                    if (x < minX) minX = x;
                    if (x > maxX) maxX = x;
                    if (y < minY) minY = y;
                    if (y > maxY) maxY = y;
                  }
                }
              }
            }
          } else if (el.tagName === 'rect') {
            const x = parseFloat(el.getAttribute('x') || '0');
            const y = parseFloat(el.getAttribute('y') || '0');
            const w = parseFloat(el.getAttribute('width') || '0');
            const h = parseFloat(el.getAttribute('height') || '0');
            if (x < minX) minX = x;
            if (x + w > maxX) maxX = x + w;
            if (y < minY) minY = y;
            if (y + h > maxY) maxY = y + h;
          } else if (el.tagName === 'circle') {
            const cx = parseFloat(el.getAttribute('cx') || '0');
            const cy = parseFloat(el.getAttribute('cy') || '0');
            const r = parseFloat(el.getAttribute('r') || '0');
            if (cx - r < minX) minX = cx - r;
            if (cx + r > maxX) maxX = cx + r;
            if (cy - r < minY) minY = cy - r;
            if (cy + r > maxY) maxY = cy + r;
          } else if (el.tagName === 'line') {
            const x1 = parseFloat(el.getAttribute('x1') || '0');
            const y1 = parseFloat(el.getAttribute('y1') || '0');
            const x2 = parseFloat(el.getAttribute('x2') || '0');
            const y2 = parseFloat(el.getAttribute('y2') || '0');
            if (Math.min(x1, x2) < minX) minX = Math.min(x1, x2);
            if (Math.max(x1, x2) > maxX) maxX = Math.max(x1, x2);
            if (Math.min(y1, y2) < minY) minY = Math.min(y1, y2);
            if (Math.max(y1, y2) > maxY) maxY = Math.max(y1, y2);
          }
        });

        if (minX === Infinity || maxX === -Infinity || minX === maxX) {
          minX = 0; minY = 0; maxX = 250; maxY = 250;
        }

        const boxW = Math.max(30, maxX - minX);
        const boxH = Math.max(30, maxY - minY);

        const rot = flatRotations[element.id] || 0;
        const rad = (rot * Math.PI) / 180;
        const cos = Math.abs(Math.cos(rad));
        const sin = Math.abs(Math.sin(rad));

        const effW = Math.max(40, boxW * cos + boxH * sin);
        const effH = Math.max(40, boxW * sin + boxH * cos);

        if (currentX > 40 && currentX + effW > maxRowWidth) {
          currentX = 40;
          currentY += rowMaxH + 60;
          rowMaxH = 0;
        }

        rowMaxH = Math.max(rowMaxH, effH);
        totalMaxX = Math.max(totalMaxX, currentX + effW);

        const innerContent = svgNode.innerHTML;

        combinedGroups += `<g class="unfolded-component" data-face="${element.baseFace}" transform="translate(${currentX}, ${currentY})">
          <g transform="translate(${effW / 2}, ${effH / 2}) rotate(${rot}) translate(${-boxW / 2}, ${-boxH / 2}) translate(${-minX}, ${-minY})">
            ${innerContent}
          </g>
          <text x="0" y="-12" font-family="monospace" font-size="12" font-weight="bold" fill="#33A3FF">${element.baseFace} (Qty: ${element.quantity})</text>
        </g>`;

        currentX += effW + 60;
      } catch (err) {
        console.error('Failed to parse flat SVG:', err);
      }
    });

    if (!combinedGroups) return null;

    const totalH = currentY + rowMaxH + 80;
    const isDark = themeMode === 'dark';
    const strokeOuter = isDark ? '#38BDF8' : '#0284C7';
    const strokeHoles = isDark ? '#F59E0B' : '#D97706';
    const fillColor = isDark ? 'rgba(56, 189, 248, 0.08)' : 'rgba(2, 132, 199, 0.05)';

    return `<svg viewBox="0 0 ${Math.max(800, totalMaxX + 80)} ${Math.max(500, totalH)}" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
      <style>
        svg { background: transparent !important; }
        path, polygon, polyline, rect { fill: ${fillColor} !important; fill-rule: evenodd !important; stroke: ${strokeOuter} !important; stroke-width: 1.2px !important; vector-effect: non-scaling-stroke !important; stroke-linecap: round !important; stroke-linejoin: round !important; }
        circle { stroke: ${strokeHoles} !important; fill: none !important; stroke-width: 1.2px !important; vector-effect: non-scaling-stroke !important; }
        .cut, .layer-cut { stroke: ${strokeOuter} !important; stroke-width: 1.4px !important; fill: ${fillColor} !important; vector-effect: non-scaling-stroke !important; }
        .cut-inner, .layer-holes { stroke: ${strokeHoles} !important; stroke-width: 1.2px !important; fill: none !important; vector-effect: non-scaling-stroke !important; }
        .bend-centerline-up, .layer-up-bends { stroke: #10B981 !important; stroke-width: 1.2px !important; vector-effect: non-scaling-stroke !important; }
        .bend-centerline-down, .layer-down-bends { stroke: #EF4444 !important; stroke-width: 1.2px !important; vector-effect: non-scaling-stroke !important; }
        .fold { stroke: #10B981 !important; stroke-width: 1.2px !important; stroke-dasharray: 4,3 !important; vector-effect: non-scaling-stroke !important; }
      </style>
      ${combinedGroups}
    </svg>`;
  }, [parts, flatRotations, themeMode]);

  return (
    <div className="h-screen w-screen flex flex-col bg-industrial-bg select-none text-industrial-text overflow-hidden font-sans">
      {/* Top Header Toolbox / Ribbon with Menu Dropdowns */}
      <header className="h-14 border-b border-industrial-border bg-industrial-card flex items-center justify-between px-6 z-30 shrink-0 relative select-none">
        {/* Click outside overlay to close dropdowns */}
        {activeDropdown && (
          <div className="fixed inset-0 z-20 cursor-default" onClick={() => setActiveDropdown(null)} />
        )}

        <div className="flex items-center gap-6 z-30">
          <div className="flex items-center gap-2">
            <div className={`px-2 py-1 rounded-md transition-all flex items-center justify-center ${
              themeMode === 'light' ? 'bg-slate-900/10 border border-industrial-border shadow-sm' : ''
            }`}>
              <img 
                src={themeMode === 'dark' ? "/logo/logo_dark.png" : "/logo/logo_dark.png"} 
                alt="CADANEST" 
                className={`h-7 w-auto object-contain transition-all duration-200 ${
                  themeMode === 'light' ? 'filter invert brightness-25 contrast-200' : ''
                }`}
              />
            </div>
          </div>

          {/* Menus List */}
          <nav className="flex items-center gap-1.5">
            {/* Settings Menu */}
            <div className="relative">
              <button
                onClick={() => setActiveDropdown(activeDropdown === 'settings' ? null : 'settings')}
                className={`px-3 py-1.5 text-xs font-mono rounded transition cursor-pointer font-bold ${
                  activeDropdown === 'settings' ? 'bg-industrial-border text-industrial-accent' : 'text-industrial-muted hover:text-industrial-text hover:bg-industrial-border/40'
                }`}
              >
                Settings
              </button>
              {activeDropdown === 'settings' && (
                <div className="absolute left-0 mt-1 w-64 bg-industrial-card border border-industrial-border rounded shadow-2xl p-2.5 z-30 font-mono text-[10px] animate-fade-in flex flex-col gap-3 text-left">
                  <div className="flex flex-col gap-1">
                    <span className="text-industrial-muted font-bold uppercase">Measurement Units:</span>
                    <div className="grid grid-cols-2 gap-1 bg-industrial-darker p-0.5 rounded border border-industrial-border">
                      <button
                        type="button"
                        onClick={() => setUnitMode('mm')}
                        className={`py-1 rounded text-[9px] font-bold font-mono transition cursor-pointer ${
                          unitMode === 'mm' ? 'bg-industrial-accent text-industrial-bg' : 'text-industrial-muted hover:text-industrial-text'
                        }`}
                      >
                        METRIC (mm)
                      </button>
                      <button
                        type="button"
                        onClick={() => setUnitMode('inch')}
                        className={`py-1 rounded text-[9px] font-bold font-mono transition cursor-pointer ${
                          unitMode === 'inch' ? 'bg-industrial-accent text-industrial-bg' : 'text-industrial-muted hover:text-industrial-text'
                        }`}
                      >
                        IMPERIAL (in)
                      </button>
                    </div>
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-industrial-muted font-bold uppercase">Sheet Stock Material:</span>
                    <select
                      value={nestingMaterial}
                      onChange={(e) => setNestingMaterial(e.target.value)}
                      className="w-full bg-industrial-darker border border-industrial-border px-1.5 py-1 rounded text-[10px] text-industrial-text outline-none"
                    >
                      <option value="Steel">Mild Steel</option>
                      <option value="Stainless">Stainless Steel</option>
                      <option value="Aluminum">Aluminum</option>
                      <option value="Copper">Copper</option>
                      <option value="Brass">Brass</option>
                    </select>
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-industrial-muted font-bold uppercase">Grain Alignment:</span>
                    <select
                      value={rotationOption}
                      onChange={(e) => setRotationOption(e.target.value)}
                      className="w-full bg-industrial-darker border border-industrial-border px-1.5 py-1 rounded text-[10px] text-industrial-text outline-none"
                    >
                      <option value="all">Free (0°, 90°, 180°, 270°)</option>
                      <option value="180">180° Steps Only (0°, 180°)</option>
                      <option value="none">Fixed Grain (0° No Rotation)</option>
                    </select>
                  </div>

                  <div className="pt-2 border-t border-industrial-border">
                    <button
                      type="button"
                      onClick={() => {
                        setActiveDropdown(null);
                        setShowAdvancedModal(true);
                      }}
                      className="w-full text-left px-2 py-1.5 bg-industrial-darker hover:bg-industrial-border border border-industrial-border rounded transition text-industrial-accent font-bold cursor-pointer flex items-center justify-between text-[10px]"
                    >
                      <span className="flex items-center gap-1.5">⚙️ Advanced Settings...</span>
                      <span className="text-[8px] text-industrial-muted">K-Factor & Mirror</span>
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Edit Menu */}
            <div className="relative">
              <button
                onClick={() => setActiveDropdown(activeDropdown === 'edit' ? null : 'edit')}
                className={`px-3 py-1.5 text-xs font-mono rounded transition cursor-pointer font-bold ${
                  activeDropdown === 'edit' ? 'bg-industrial-border text-industrial-accent' : 'text-industrial-muted hover:text-industrial-text hover:bg-industrial-border/40'
                }`}
              >
                Edit
              </button>
              {activeDropdown === 'edit' && (
                <div className="absolute left-0 mt-1 w-56 bg-industrial-card border border-industrial-border rounded shadow-2xl p-1 z-30 font-mono text-[10px] animate-fade-in flex flex-col gap-0.5 text-left">
                  <button
                    onClick={() => {
                      setActiveDropdown(null);
                      handleRunUnfold();
                    }}
                    disabled={parts.length === 0 || isUnfolding || isAnalyzing || isNesting}
                    className="w-full text-left px-2.5 py-1.5 hover:bg-industrial-border hover:text-industrial-orange rounded transition text-industrial-text disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer flex items-center gap-2"
                  >
                    <span>⚡ Unfold All Flat Blanks</span>
                  </button>
                  <button
                    onClick={() => {
                      setActiveDropdown(null);
                      if (selectedPart) {
                        handleUndoUnfold(selectedPart.id);
                      } else {
                        addLog("Edit warning: No selected part to revert.");
                      }
                    }}
                    disabled={!selectedPart || !selectedPart.dxfPath}
                    className="w-full text-left px-2.5 py-1.5 hover:bg-industrial-border hover:text-industrial-accent rounded transition text-industrial-text disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer flex items-center gap-2"
                  >
                    <span>🔄 Undo Model Flattening</span>
                  </button>
                  <button
                    onClick={() => {
                      setActiveDropdown(null);
                      setPartSpacing(5.0);
                      setBorderMargin(5.0);
                      setRotationOption('all');
                      setNestingMaterial('Steel');
                      setIncludeBendLines(true);
                      addLog("Reset all nesting parameters to defaults.");
                    }}
                    className="w-full text-left px-2.5 py-1.5 hover:bg-industrial-border hover:text-industrial-accent rounded transition text-industrial-text cursor-pointer flex items-center gap-2"
                  >
                    <span>♻️ Reset Parameter Defaults</span>
                  </button>
                </div>
              )}
            </div>

            {/* View Menu */}
            <div className="relative">
              <button
                onClick={() => setActiveDropdown(activeDropdown === 'view' ? null : 'view')}
                className={`px-3 py-1.5 text-xs font-mono rounded transition cursor-pointer font-bold ${
                  activeDropdown === 'view' ? 'bg-industrial-border text-industrial-accent' : 'text-industrial-muted hover:text-industrial-text hover:bg-industrial-border/40'
                }`}
              >
                View
              </button>
              {activeDropdown === 'view' && (
                <div className="absolute left-0 mt-1 w-56 bg-industrial-card border border-industrial-border rounded shadow-2xl p-1 z-30 font-mono text-[10px] animate-fade-in flex flex-col gap-0.5 text-left">
                  <button
                    onClick={() => { setActiveDropdown(null); setActiveTab('import'); }}
                    className={`w-full text-left px-2.5 py-1.5 hover:bg-industrial-border rounded transition cursor-pointer flex items-center justify-between ${activeTab === 'import' ? 'text-industrial-accent font-bold' : 'text-industrial-text'}`}
                  >
                    <span>📐 3D Source Viewport</span>
                    {activeTab === 'import' && <span>✓</span>}
                  </button>
                  <button
                    onClick={() => {
                      setActiveDropdown(null);
                      if (selectedPart && selectedPart.svgContent) {
                        setActiveTab('flatten');
                      } else {
                        addLog("View warning: Unfold part first to preview flat pattern.");
                      }
                    }}
                    disabled={!selectedPart || !selectedPart.svgContent}
                    className={`w-full text-left px-2.5 py-1.5 hover:bg-industrial-border rounded transition disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer flex items-center justify-between ${activeTab === 'flatten' ? 'text-industrial-orange font-bold' : 'text-industrial-text'}`}
                  >
                    <span>🗺️ Unfolded Flat Preview</span>
                    {activeTab === 'flatten' && <span>✓</span>}
                  </button>
                  <button
                    onClick={() => { setActiveDropdown(null); setActiveTab('nesting'); }}
                    disabled={parts.length === 0}
                    className={`w-full text-left px-2.5 py-1.5 hover:bg-industrial-border rounded transition disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer flex items-center justify-between ${activeTab === 'nesting' ? 'text-industrial-accent font-bold' : 'text-industrial-text'}`}
                  >
                    <span>📦 Irregular Nesting Layout</span>
                    {activeTab === 'nesting' && <span>✓</span>}
                  </button>
                  <div className="h-[1px] bg-industrial-border/60 my-0.5"></div>
                  <div className="flex flex-col gap-0.5">
                    <span className="text-industrial-muted font-bold text-[9px] uppercase px-2.5 py-0.5">Themes:</span>
                    <button
                      onClick={() => { setActiveDropdown(null); setThemeMode('dark'); }}
                      className={`w-full text-left px-2.5 py-1.5 hover:bg-industrial-border rounded transition cursor-pointer flex items-center justify-between ${themeMode === 'dark' ? 'text-industrial-accent font-bold' : 'text-industrial-text'}`}
                    >
                      <span>🌙 Dark Theme</span>
                      {themeMode === 'dark' && <span>✓</span>}
                    </button>
                    <button
                      onClick={() => { setActiveDropdown(null); setThemeMode('light'); }}
                      className={`w-full text-left px-2.5 py-1.5 hover:bg-industrial-border rounded transition cursor-pointer flex items-center justify-between ${themeMode === 'light' ? 'text-industrial-accent font-bold' : 'text-industrial-text'}`}
                    >
                      <span>☀️ Light Theme</span>
                      {themeMode === 'light' && <span>✓</span>}
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* File Menu */}
            <div className="relative">
              <button
                onClick={() => setActiveDropdown(activeDropdown === 'file' ? null : 'file')}
                className={`px-3 py-1.5 text-xs font-mono rounded transition cursor-pointer font-bold ${
                  activeDropdown === 'file' ? 'bg-industrial-border text-industrial-accent' : 'text-industrial-muted hover:text-industrial-text hover:bg-industrial-border/40'
                }`}
              >
                File
              </button>
              {activeDropdown === 'file' && (
                <div className="absolute left-0 mt-1 w-56 bg-industrial-card border border-industrial-border rounded shadow-2xl p-1 z-30 font-mono text-[10px] animate-fade-in flex flex-col gap-0.5 text-left">
                  <button
                    onClick={() => { setActiveDropdown(null); handleSelectFiles(); }}
                    className="w-full text-left px-2.5 py-1.5 hover:bg-industrial-border hover:text-industrial-accent rounded transition text-industrial-text cursor-pointer flex items-center gap-2"
                  >
                    <span>📁 Import STEP / DXF Files...</span>
                  </button>
                  <button
                    onClick={() => {
                      setActiveDropdown(null);
                      if (activeTab === 'nesting' && nestingDxfPath) {
                        const defaultName = nestingDxfPath.split(/[\\/]/).pop() || 'nested_layout.dxf';
                        handleSaveDxfAs(nestingDxfPath, defaultName);
                      } else if (selectedPart && selectedPart.dxfPath) {
                        const defaultName = selectedPart.dxfPath.split(/[\\/]/).pop() || `${selectedPart.name}_unfolded.dxf`;
                        handleSaveDxfAs(selectedPart.dxfPath, defaultName);
                      } else {
                        addLog("Export warning: No active flat pattern or nesting layout available.");
                      }
                    }}
                    className="w-full text-left px-2.5 py-1.5 hover:bg-industrial-border hover:text-industrial-accent rounded transition text-industrial-text cursor-pointer flex items-center gap-2"
                  >
                    <span>💾 Export DXF Blank Profile</span>
                  </button>
                  <div className="h-[1px] bg-industrial-border/60 my-0.5"></div>
                  <button
                    onClick={() => {
                      setActiveDropdown(null);
                      if (confirm("Are you sure you want to clear the workspace?")) {
                        setParts([]);
                        setSelectedPartId(null);
                        addLog('Cleared workspace.');
                      }
                    }}
                    className="w-full text-left px-2.5 py-1.5 hover:bg-industrial-border hover:text-red-500 rounded transition text-industrial-text cursor-pointer flex items-center gap-2"
                  >
                    <span>❌ Clear Workspace</span>
                  </button>
                </div>
              )}
            </div>

            {/* Help Menu */}
            <div className="relative">
              <button
                onClick={() => setActiveDropdown(activeDropdown === 'help' ? null : 'help')}
                className={`px-3 py-1.5 text-xs font-mono rounded transition cursor-pointer font-bold ${
                  activeDropdown === 'help' ? 'bg-industrial-border text-industrial-accent' : 'text-industrial-muted hover:text-industrial-text hover:bg-industrial-border/40'
                }`}
              >
                Help
              </button>
              {activeDropdown === 'help' && (
                <div className="absolute left-0 mt-1 w-64 bg-industrial-card border border-industrial-border rounded shadow-2xl p-1 z-30 font-mono text-[10px] animate-fade-in flex flex-col gap-0.5 text-left">
                  <button
                    onClick={() => { setActiveDropdown(null); setShowDocModal(true); }}
                    className="w-full text-left px-2.5 py-1.5 hover:bg-industrial-border hover:text-industrial-accent rounded transition text-industrial-text cursor-pointer flex items-center justify-between"
                  >
                    <span>📖 CADANEST Documentation & Guide</span>
                    <span className="text-[8px] bg-industrial-accent/20 text-industrial-accent px-1 rounded uppercase font-bold">Docs</span>
                  </button>
                  <button
                    onClick={() => { setActiveDropdown(null); setShowShortcutsModal(true); }}
                    className="w-full text-left px-2.5 py-1.5 hover:bg-industrial-border hover:text-industrial-accent rounded transition text-industrial-text cursor-pointer flex items-center justify-between"
                  >
                    <span>⌨️ Keyboard Shortcuts Cheat Sheet</span>
                    <span className="text-[8px] font-sans font-bold bg-industrial-border px-1 rounded">?</span>
                  </button>
                  <div className="h-[1px] bg-industrial-border/60 my-0.5"></div>
                  <button
                    onClick={() => { setActiveDropdown(null); setShowAboutModal(true); }}
                    className="w-full text-left px-2.5 py-1.5 hover:bg-industrial-border hover:text-industrial-accent rounded transition text-industrial-text cursor-pointer flex items-center gap-2"
                  >
                    <span>ℹ️ About CADANEST & Open Source Licenses</span>
                  </button>
                </div>
              )}
            </div>

            {/* Customize Layout Menu */}
            <div className="relative">
              <button
                onClick={() => setActiveDropdown(activeDropdown === 'layout' ? null : 'layout')}
                className={`px-3 py-1.5 text-xs font-mono rounded transition cursor-pointer font-bold ${
                  activeDropdown === 'layout' ? 'bg-industrial-border text-industrial-accent' : 'text-industrial-muted hover:text-industrial-text hover:bg-industrial-border/40'
                }`}
              >
                Customize Layout
              </button>
              {activeDropdown === 'layout' && (
                <div className="absolute left-0 mt-1 w-64 bg-industrial-card border border-industrial-border rounded shadow-2xl p-1 z-30 font-mono text-[10px] animate-fade-in flex flex-col gap-0.5 text-left">
                  <button
                    onClick={() => { setActiveDropdown(null); setShowSidebar(prev => !prev); }}
                    className="w-full text-left px-2.5 py-1.5 hover:bg-industrial-border hover:text-industrial-accent rounded transition text-industrial-text cursor-pointer flex items-center justify-between"
                  >
                    <span>👁️ {showSidebar ? 'Hide Left Sidebar' : 'Show Left Sidebar'}</span>
                    <span className="text-[8px] text-industrial-muted uppercase font-bold font-sans">Toggle</span>
                  </button>
                  <button
                    onClick={() => { setActiveDropdown(null); setSidebarWidth(320); setShowSidebar(true); }}
                    className="w-full text-left px-2.5 py-1.5 hover:bg-industrial-border hover:text-industrial-accent rounded transition text-industrial-text cursor-pointer flex items-center gap-2"
                  >
                    <span>📐 Reset Sidebar Width (320px)</span>
                  </button>

                  <div className="h-[1px] bg-industrial-border/60 my-0.5"></div>
                  <button
                    onClick={() => {
                      setActiveDropdown(null);
                      if (activeTab === 'import') {
                        setFullScreenView(fullScreenView === '3d' ? null : '3d');
                      } else if (activeTab === 'flatten') {
                        setFullScreenView(fullScreenView === 'flat' ? null : 'flat');
                      } else if (activeTab === 'nesting') {
                        setFullScreenView(fullScreenView === 'nesting' ? null : 'nesting');
                      }
                    }}
                    className="w-full text-left px-2.5 py-1.5 hover:bg-industrial-border hover:text-industrial-orange rounded transition text-industrial-text cursor-pointer flex items-center justify-between"
                  >
                    <span>🖥️ Toggle Full Screen Visualizer</span>
                    <span className="text-[8px] font-sans font-bold bg-industrial-border px-1 rounded">Alt+F</span>
                  </button>
                  <button
                    onClick={() => { setActiveDropdown(null); setShowLogsModal(true); }}
                    className="w-full text-left px-2.5 py-1.5 hover:bg-industrial-border hover:text-industrial-accent rounded transition text-industrial-text cursor-pointer flex items-center justify-between"
                  >
                    <span>📟 Open Operator Terminal Logs</span>
                    <span className="text-[8px] bg-industrial-orange/20 text-industrial-orange px-1 rounded uppercase font-bold">Terminal</span>
                  </button>
                </div>
              )}
            </div>

            </nav>
        </div>

        {/* Right side status items */}
        <div className="flex gap-4 items-center z-30">

          {/* Primary Action Controls */}
          <button 
            onClick={handleSelectFiles}
            disabled={isAnalyzing || isUnfolding || isNesting}
            className="flex items-center gap-1.5 px-3 py-1 bg-industrial-darker hover:bg-industrial-border border border-industrial-border text-xs rounded transition text-industrial-text disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer font-mono"
            title="Import 3D STEP models or 2D DXF flat profiles"
          >
            <FolderOpen size={12} /> + Import STEP / DXF
          </button>

          <button 
            onClick={handleRunNesting}
            disabled={parts.length === 0 || isNesting || isAnalyzing || isUnfolding}
            className={`flex items-center gap-1.5 px-3.5 py-1 text-xs rounded transition border cursor-pointer font-bold font-mono shadow-sm ${
              parts.length === 0 || isNesting || isAnalyzing || isUnfolding
                ? 'bg-industrial-border/40 text-industrial-muted border-transparent cursor-not-allowed' 
                : 'bg-industrial-accent hover:bg-industrial-accent/95 text-industrial-bg border-industrial-accent/60'
            }`}
            title="Run regular/irregular shape nesting solver"
          >
            <Layers size={12} className={isNesting ? 'animate-spin' : ''} /> {isNesting ? 'Solving...' : 'Start Nesting Solver'}
          </button>
        </div>
      </header>

      {/* Main Workspace layout */}
      <div className="flex-1 flex overflow-hidden">
        
        {/* Left Sidebar: Part Library & Config */}
        {showSidebar && (
          <>
            <aside 
              className={`border-r border-industrial-border flex flex-col p-4 overflow-y-auto scrollbar-custom gap-5 shrink-0 transition-colors ${
                isDraggingFile ? 'bg-industrial-accent/5 border-industrial-accent' : 'bg-industrial-card/50'
              }`}
              style={{ width: `${sidebarWidth}px` }}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            >
          {activeTab === 'nesting' && (
            <div className={`border rounded p-2.5 text-[10px] font-mono leading-relaxed flex items-center gap-2 transition-colors ${
              isNesting || isUnfolding || isAnalyzing
                ? 'bg-industrial-orange/10 border-industrial-orange/30 text-industrial-orange'
                : 'bg-industrial-accent/10 border-industrial-accent/30 text-industrial-accent'
            }`}>
              <RotateCw size={12} className={`shrink-0 ${(isNesting || isUnfolding || isAnalyzing) ? 'animate-spin' : ''}`} />
              <span>
                {isNesting 
                  ? 'Nesting solver is running live...' 
                  : isUnfolding 
                  ? 'Unfolding modified parts...' 
                  : isAnalyzing 
                  ? 'Analyzing STEP model...' 
                  : 'Live Nesting Active. Edits will automatically update layout.'}
              </span>
            </div>
          )}
          
          {/* Part Library */}
          <div className="flex flex-col gap-2">
            <h3 className="text-xs font-mono font-bold tracking-wider text-industrial-muted flex items-center justify-between w-full">
              <span className="flex items-center gap-2"><FileText size={14} /> PART LIBRARY ({parts.length})</span>
              <div className="flex gap-2.5 text-[10px] font-mono">
                <button 
                  onClick={!(isAnalyzing || isUnfolding || isNesting) ? handleSelectFiles : undefined} 
                  disabled={isAnalyzing || isUnfolding || isNesting}
                  className={`font-bold ${(isAnalyzing || isUnfolding || isNesting) ? 'text-industrial-muted/40 cursor-not-allowed' : 'text-industrial-accent hover:underline'}`}
                >
                  + Add
                </button>
                {parts.length > 0 && (
                  <button 
                    onClick={!(isAnalyzing || isUnfolding || isNesting) ? () => { setParts([]); setSelectedPartId(null); addLog('Cleared workspace.'); } : undefined} 
                    disabled={isAnalyzing || isUnfolding || isNesting}
                    className={`font-bold ${(isAnalyzing || isUnfolding || isNesting) ? 'text-industrial-muted/40 cursor-not-allowed' : 'text-red-500 hover:underline'}`}
                  >
                    Clear
                  </button>
                )}
              </div>
            </h3>
            
            {/* Material Filter Tabs (Sticky outside scroll container) */}
            {parts.length > 0 && (
              <div className="flex items-center gap-1 overflow-x-auto pb-1 scrollbar-custom text-[9px] font-mono border-b border-industrial-border/60 pb-1.5 shrink-0">
                <button
                  type="button"
                  onClick={() => setHierarchyMaterialFilter('ALL')}
                  className={`px-2 py-0.5 rounded border transition cursor-pointer whitespace-nowrap ${
                    hierarchyMaterialFilter === 'ALL'
                      ? 'bg-industrial-accent text-white border-industrial-accent font-bold'
                      : 'bg-industrial-darker text-industrial-muted hover:text-white border-industrial-border'
                  }`}
                >
                  All ({parts.length})
                </button>
                {Array.from(new Set(parts.map(p => p.materialName || p.material || 'Mild Steel'))).map(matName => (
                  <button
                    key={matName}
                    type="button"
                    onClick={() => setHierarchyMaterialFilter(matName)}
                    className={`px-2 py-0.5 rounded border transition cursor-pointer whitespace-nowrap ${
                      hierarchyMaterialFilter === matName
                        ? 'bg-industrial-accent text-white border-industrial-accent font-bold'
                        : 'bg-industrial-darker text-industrial-muted hover:text-white border-industrial-border'
                    }`}
                  >
                    {matName} ({parts.filter(p => (p.materialName || p.material || 'Mild Steel') === matName).length})
                  </button>
                ))}
              </div>
            )}
            
            {parts.length > 0 ? (
              <div className="flex flex-col gap-2 overflow-y-auto scrollbar-custom pr-1 max-h-[340px]">

                {/* Combined View Node */}
                <div 
                  onClick={() => {
                    setCombined3D(true);
                    setActiveTab('import');
                  }}
                  className={`p-2.5 rounded border font-mono flex items-center gap-3 transition cursor-pointer ${
                    combined3D 
                      ? 'bg-industrial-accent/15 border-industrial-accent text-industrial-accent font-bold' 
                      : 'bg-industrial-darker border-industrial-border hover:border-industrial-muted text-industrial-muted'
                  }`}
                >
                  <Layers size={16} />
                  <div className="text-xs">ALL MODELS (COMBINED VIEW)</div>
                </div>

                {/* Individual Model Nodes */}
                {parts
                  .filter(part => hierarchyMaterialFilter === 'ALL' || (part.materialName || part.material || 'Mild Steel') === hierarchyMaterialFilter)
                  .map((part) => {
                    const isSelected = !combined3D && selectedPartId === part.id;
                    const matColorCss = getMaterialColorCss(part.materialName || part.material);
                    const isFacesExpanded = !!expandedPartFaces[part.id];
                    return (
                      <div key={part.id} className="flex flex-col gap-1">
                        <div 
                          onClick={() => {
                            setCombined3D(false);
                            setSelectedPartId(part.id);
                            if (activeTab !== 'nesting') {
                              if (part.svgContent) {
                                setActiveTab('flatten');
                              } else {
                                setActiveTab('import');
                              }
                            }
                          }}
                          onDoubleClick={() => {
                            setExpandedPartFaces(prev => ({ ...prev, [part.id]: !prev[part.id] }));
                          }}
                          onMouseEnter={(e) => {
                            const rect = e.currentTarget.getBoundingClientRect();
                            setHoveredPart(part);
                            setHoverCoords({ x: rect.right + 10, y: rect.top });
                          }}
                          onMouseLeave={() => setHoveredPart(null)}
                          className={`p-2.5 rounded border font-mono flex items-center gap-2.5 transition relative cursor-pointer ${
                            part.active === false ? 'opacity-50 ' : ''
                          }${
                            isSelected 
                              ? 'bg-industrial-accent/10 border-industrial-accent text-industrial-accent font-bold' 
                              : 'bg-industrial-darker border-industrial-border hover:border-industrial-muted text-industrial-muted'
                          }`}
                        >
                          <input 
                            type="checkbox" 
                            checked={part.active !== false} 
                            disabled={isAnalyzing || isUnfolding || isNesting}
                            onChange={(e) => handleTogglePartActive(part.id, e as any)}
                            onClick={(e) => e.stopPropagation()}
                            className={`w-3.5 h-3.5 rounded border-industrial-border bg-industrial-darker text-industrial-accent accent-industrial-accent shrink-0 ${(isAnalyzing || isUnfolding || isNesting) ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
                            title={part.active !== false ? "Exclude from Nesting" : "Include in Nesting"}
                          />
                          <div className="w-8 h-8 bg-industrial-card border border-industrial-border rounded overflow-hidden shrink-0 flex items-center justify-center p-0.5">
                            {part.svgPreview ? (
                              <div className="w-full h-full opacity-80" dangerouslySetInnerHTML={{ __html: part.svgPreview }} />
                            ) : (
                              <FileCode size={14} className="text-industrial-muted" />
                            )}
                          </div>
                          <div className="flex-1 min-w-0 flex flex-col gap-0.5">
                            <div className="text-xs truncate flex items-center gap-1">
                              {part.isDxfOnly && (
                                <span className="text-[8px] font-bold px-1 rounded bg-teal-500/20 text-teal-400 border border-teal-500/40 shrink-0">DXF</span>
                              )}
                              <span className="truncate">{part.name}</span>
                            </div>
                            <div className="text-[9px] text-industrial-muted flex items-center gap-1.5 flex-wrap">
                              <span>Qty: {part.quantity}</span>
                              <span>•</span>
                              <span>{part.isDxfOnly ? '2D Flat' : `${part.thickness.toFixed(1)}mm`}</span>
                              <span 
                                className="px-1.5 py-0.2 rounded text-[8px] font-bold border"
                                style={{
                                  backgroundColor: `${matColorCss}15`,
                                  borderColor: `${matColorCss}40`,
                                  color: matColorCss
                                }}
                              >
                                {part.materialName || part.material || 'Mild Steel'}
                              </span>
                            </div>
                          </div>

                          {part.faces && part.faces.length > 0 && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setExpandedPartFaces(prev => ({ ...prev, [part.id]: !prev[part.id] }));
                              }}
                              className="text-[8px] font-mono px-1 py-0.5 rounded bg-industrial-card hover:bg-industrial-border text-industrial-muted hover:text-white transition shrink-0"
                              title="Click to toggle faces list (or double click card)"
                            >
                              {isFacesExpanded ? '▼' : '▶'} {part.faces.length}
                            </button>
                          )}

                          <button 
                            onClick={(e) => handleDeletePart(part.id, e)}
                            disabled={isAnalyzing || isUnfolding || isNesting}
                            className={`p-1 rounded transition shrink-0 ${(isAnalyzing || isUnfolding || isNesting) ? 'text-industrial-muted/30 cursor-not-allowed' : 'text-industrial-muted hover:text-red-400'}`}
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>

                        {/* Indented Face Sub-list under Active Selected Model (Collapsed by default, double-click to expand) */}
                        {isSelected && isFacesExpanded && part.faces.length > 0 && (
                          <div className="pl-5 flex flex-col gap-1 border-l border-industrial-border ml-4 mt-0.5 mb-1.5">
                            <div className="text-[9px] font-bold text-industrial-muted font-mono mb-1 tracking-wider">SELECT BASE FLANGE:</div>
                            {part.faces.map((f, i) => {
                              const isPlanar = f.type?.toUpperCase() === 'PLANE' || f.type === 'Plane';
                              const isFaceSelected = part.baseFace ? part.baseFace.split(',').includes(f.name) : false;
                              const isFaceHovered = hoveredFaceName === f.name;
                              return (
                                <div 
                                  key={i}
                                  onClick={() => isPlanar && !(isAnalyzing || isUnfolding || isNesting) && handleUpdatePartBaseFace(part.id, f.name)}
                                  onMouseEnter={() => isPlanar && setHoveredFaceName(f.name)}
                                  onMouseLeave={() => isPlanar && setHoveredFaceName(null)}
                                  className={`px-2 py-1 rounded border text-[9px] font-mono flex justify-between items-center transition ${
                                    !isPlanar 
                                      ? 'bg-transparent border-transparent text-industrial-muted/45 cursor-not-allowed' 
                                      : isFaceSelected 
                                      ? 'bg-industrial-orange/20 border-industrial-orange text-industrial-orange font-bold cursor-pointer shadow-sm'
                                      : isFaceHovered
                                      ? 'bg-industrial-accent/15 border-industrial-accent text-industrial-accent font-bold cursor-pointer'
                                      : 'bg-industrial-darker/60 border-industrial-border text-industrial-muted hover:border-industrial-accent hover:text-industrial-accent cursor-pointer'
                                  }`}
                                  title={!isPlanar ? "Non-planar face cannot be used as base flange" : isFaceSelected ? "Click to deselect this face" : "Click to select this face as base flange"}
                                >
                                  <span className="truncate flex items-center gap-1">
                                    {isFaceSelected && <span className="text-industrial-orange font-bold text-[10px]">✓</span>}
                                    <span>{f.name}</span>
                                  </span>
                                  <span className={`text-[8px] px-1 py-0.2 rounded font-sans ${
                                    !isPlanar 
                                      ? 'bg-industrial-border text-industrial-muted' 
                                      : isFaceSelected 
                                      ? 'bg-industrial-orange text-white' 
                                      : 'bg-industrial-card text-industrial-accent'
                                  }`}>
                                    {f.type}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
              </div>
            ) : (
              <div 
                onClick={handleSelectFiles} 
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                className={`p-8 border border-dashed rounded flex flex-col items-center justify-center gap-2.5 text-center cursor-pointer transition ${
                  isDraggingFile 
                    ? 'border-industrial-accent bg-industrial-accent/10 text-industrial-accent' 
                    : 'border-industrial-border hover:border-industrial-accent hover:text-industrial-accent text-industrial-muted'
                }`}
              >
                <FolderOpen size={24} className={isDraggingFile ? 'animate-bounce text-industrial-accent' : 'text-industrial-muted'} />
                <div className="flex flex-col gap-0.5">
                  <span className="text-xs font-bold uppercase tracking-wide">Drag & Drop STEP or DXF Files</span>
                  <span className="text-[10px] opacity-70">or click to browse local folders</span>
                </div>
              </div>
            )}
          </div>

          {/* Config & Parameters of Selected Part */}
          {selectedPart && (
            <div className="flex flex-col gap-4 border-t border-industrial-border/60 pt-4">
              <h3 className="text-xs font-mono font-bold tracking-wider text-industrial-muted flex items-center gap-2">
                <Settings size={14} /> PART CONFIG [{selectedPart.name}]
              </h3>
              
              {/* Quantity */}
              <div className="flex justify-between items-center bg-industrial-darker/60 border border-industrial-border/60 p-2.5 rounded">
                <label className="text-xs text-industrial-muted font-medium">Qty per Set</label>
                <QuantityControl
                  value={selectedPart.quantity}
                  disabled={isAnalyzing || isUnfolding || isNesting}
                  onUpdate={(qty) => handleUpdatePartQuantity(selectedPart.id, qty)}
                />
              </div>

              {/* Material & K-Factor Configuration */}
              {!selectedPart.isDxfOnly && (
                <div className="flex flex-col gap-2.5 bg-industrial-darker/60 border border-industrial-border/60 p-2.5 rounded">
                  <div className="flex justify-between items-center">
                    <span className="text-xs font-bold text-industrial-text flex items-center gap-1">
                      <Layers size={13} className="text-industrial-accent" /> CAD System & K-Preset
                    </span>
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-industrial-dark border border-industrial-border text-industrial-accent font-bold" title="Double precision K-Factor">
                      K = {selectedPart.kfactor.toFixed(6)}
                    </span>
                  </div>

                  {/* Quick CAD Engine Parity Switcher */}
                  <div className="flex flex-col gap-1.5 bg-industrial-dark/80 border border-industrial-border/80 p-2 rounded">
                    <div className="flex justify-between items-center text-[10px] font-bold text-industrial-accent">
                      <span>⚡ CAD Engine Parity Match:</span>
                      <span className="text-[9px] text-industrial-muted font-normal">Instant 100% Geometry Match</span>
                    </div>
                    <div className="grid grid-cols-3 gap-1">
                      <button
                        type="button"
                        onClick={() => handleSelectKFactorMode('preset', 'solid_edge_tight')}
                        className={`py-1 px-1 rounded text-[9px] font-bold font-mono transition text-center cursor-pointer border ${
                          selectedPart.kFactorPreset === 'solid_edge_tight' || (selectedPart.kfactor >= 0.329 && selectedPart.kfactor <= 0.331)
                            ? 'bg-blue-600/30 border-blue-400 text-blue-300 font-bold shadow'
                            : 'bg-industrial-darker border-industrial-border text-industrial-muted hover:text-industrial-text'
                        }`}
                        title="Match Siemens Solid Edge flat pattern DXF (K = 0.330000)"
                      >
                        Solid Edge (0.33)
                      </button>
                      <button
                        type="button"
                        onClick={() => handleSelectKFactorMode('preset', 'fusion360_default')}
                        className={`py-1 px-1 rounded text-[9px] font-bold font-mono transition text-center cursor-pointer border ${
                          selectedPart.kFactorPreset === 'fusion360_default' || (selectedPart.kfactor >= 0.439 && selectedPart.kfactor <= 0.441 && selectedPart.kFactorPreset !== 'inventor_ansi')
                            ? 'bg-orange-600/30 border-orange-400 text-orange-300 font-bold shadow'
                            : 'bg-industrial-darker border-industrial-border text-industrial-muted hover:text-industrial-text'
                        }`}
                        title="Match Autodesk Fusion 360 / Inventor flat pattern DXF (K = 0.440000)"
                      >
                        Fusion 360 (0.44)
                      </button>
                      <button
                        type="button"
                        onClick={() => handleSelectKFactorMode('preset', 'solidworks_default')}
                        className={`py-1 px-1 rounded text-[9px] font-bold font-mono transition text-center cursor-pointer border ${
                          selectedPart.kFactorPreset === 'solidworks_default' || (selectedPart.kfactor >= 0.499 && selectedPart.kfactor <= 0.501)
                            ? 'bg-emerald-600/30 border-emerald-400 text-emerald-300 font-bold shadow'
                            : 'bg-industrial-darker border-industrial-border text-industrial-muted hover:text-industrial-text'
                        }`}
                        title="Match SolidWorks flat pattern DXF (K = 0.500000)"
                      >
                        SolidWorks (0.50)
                      </button>
                    </div>
                  </div>

                  {/* CAD System & Material Presets Selection Dropdown */}
                  <select
                    value={selectedPart.kFactorPreset || selectedPart.materialName || 'Mild Steel'}
                    disabled={isAnalyzing || isUnfolding || isNesting}
                    onChange={(e) => {
                      const val = e.target.value;
                      const presetMatch = CAD_PRESETS_CATALOG.find(p => p.id === val);
                      if (presetMatch) {
                        handleSelectKFactorMode('preset', val);
                      } else {
                        handleSelectKFactorMode('material', val);
                      }
                    }}
                    className="w-full bg-industrial-dark border border-industrial-border px-2 py-1.5 rounded text-xs font-mono text-industrial-text focus:border-industrial-accent outline-none cursor-pointer"
                  >
                    <optgroup label="--- CAD Software Defaults ---">
                      {CAD_PRESETS_CATALOG.filter(p => p.category === 'software').map(p => (
                        <option key={p.id} value={p.id}>{p.label} ({p.value.toFixed(6)})</option>
                      ))}
                    </optgroup>
                    <optgroup label="--- International Standards ---">
                      {CAD_PRESETS_CATALOG.filter(p => p.category === 'standard').map(p => (
                        <option key={p.id} value={p.id}>{p.label}</option>
                      ))}
                    </optgroup>
                    <optgroup label="--- Material Catalog Presets ---">
                      <option value="Mild Steel">Mild Steel / CRCA (K = 0.440000)</option>
                      <option value="Stainless Steel 304">Stainless Steel 304 (K = 0.450000)</option>
                      <option value="Stainless Steel 316">Stainless Steel 316 (K = 0.450000)</option>
                      <option value="Aluminium 5052">Aluminium 5052 (K = 0.400000)</option>
                      <option value="Aluminium 6061">Aluminium 6061 (K = 0.400000)</option>
                      <option value="Galvanized Iron">Galvanized Iron (K = 0.420000)</option>
                      <option value="Copper">Copper (K = 0.380000)</option>
                      <option value="Brass">Brass (K = 0.400000)</option>
                    </optgroup>
                  </select>

                  {/* 4-Tier Mode Selector: CAD PRESET | DIN 6935 | ADAPTIVE | MANUAL */}
                  <div className="grid grid-cols-4 gap-1 bg-industrial-dark p-0.5 rounded border border-industrial-border">
                    <button
                      type="button"
                      onClick={() => handleSelectKFactorMode('preset', selectedPart.kFactorPreset || 'solidworks_default')}
                      className={`py-1 px-0.5 rounded text-[8px] font-bold font-mono transition text-center cursor-pointer ${
                        selectedPart.kFactorMode === 'preset'
                          ? 'bg-industrial-accent text-industrial-bg shadow-sm'
                          : 'text-industrial-muted hover:text-industrial-text'
                      }`}
                      title="Use exact CAD system preset (SolidWorks, Inventor, Solid Edge, Creo, Trumpf)"
                    >
                      CAD PRESET
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSelectKFactorMode('din6935')}
                      className={`py-1 px-0.5 rounded text-[8px] font-bold font-mono transition text-center cursor-pointer ${
                        selectedPart.kFactorMode === 'din6935'
                          ? 'bg-industrial-accent text-industrial-bg shadow-sm'
                          : 'text-industrial-muted hover:text-industrial-text'
                      }`}
                      title="DIN 6935 logarithmic curve: K = 0.33 + 0.17*log10(R/T)"
                    >
                      DIN 6935
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSelectKFactorMode('adaptive')}
                      className={`py-1 px-0.5 rounded text-[8px] font-bold font-mono transition text-center cursor-pointer ${
                        selectedPart.kFactorMode === 'adaptive'
                          ? 'bg-industrial-accent text-industrial-bg shadow-sm'
                          : 'text-industrial-muted hover:text-industrial-text'
                      }`}
                      title="Adaptive K-factor based on inside radius to thickness (R/T) ratio"
                    >
                      ADAPTIVE
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSelectKFactorMode('manual')}
                      className={`py-1 px-0.5 rounded text-[8px] font-bold font-mono transition text-center cursor-pointer ${
                        selectedPart.kFactorMode === 'manual'
                          ? 'bg-industrial-accent text-industrial-bg shadow-sm'
                          : 'text-industrial-muted hover:text-industrial-text'
                      }`}
                      title="Manual custom K-factor input"
                    >
                      MANUAL
                    </button>
                  </div>

                  {/* Calibration Trigger Button */}
                  <button
                    type="button"
                    onClick={() => handleOpenCalibrationModal(selectedPart)}
                    className="w-full py-1.5 bg-industrial-accent/15 hover:bg-industrial-accent/25 border border-industrial-accent/40 text-industrial-accent font-bold rounded text-xs transition cursor-pointer flex items-center justify-center gap-1.5 font-mono"
                    title="Reverse-solve K-factor from a known physical sample or target CAD flat dimension"
                  >
                    🎯 Calibrate K-Factor
                  </button>
                </div>
              )}

              {/* Bend Line Style Selection */}
              {!selectedPart.isDxfOnly && (
                <div className="flex flex-col gap-1.5">
                  <span className="text-industrial-muted font-medium text-xs">Bend Line Style</span>
                  <div className="grid grid-cols-2 gap-1 bg-industrial-darker p-0.5 rounded border border-industrial-border">
                    <button
                      type="button"
                      onClick={() => {
                        setBendStyle('dashed');
                        setParts(prev => prev.map(p => ({ ...p, bendStyle: 'dashed' })));
                        addLog("Updated bend line style selection to 'DOTTED-DASH' for all models. Click Flatten Model to apply.");
                      }}
                      disabled={isAnalyzing || isUnfolding || isNesting}
                      className={`py-1 px-1 rounded text-[9px] font-bold font-mono transition text-center cursor-pointer ${
                        bendStyle === 'dashed'
                          ? 'bg-industrial-accent text-industrial-bg shadow-sm'
                          : 'text-industrial-muted hover:text-industrial-text'
                      }`}
                      title="Dotted & Dashed Combination Centerline"
                    >
                      DOTTED-DASH
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setBendStyle('tick');
                        setParts(prev => prev.map(p => ({ ...p, bendStyle: 'tick' })));
                        addLog("Updated bend line style selection to 'TICKS' for all models. Click Flatten Model to apply.");
                      }}
                      disabled={isAnalyzing || isUnfolding || isNesting}
                      className={`py-1 px-1 rounded text-[9px] font-bold font-mono transition text-center cursor-pointer ${
                        bendStyle === 'tick'
                          ? 'bg-industrial-accent text-industrial-bg shadow-sm'
                          : 'text-industrial-muted hover:text-industrial-text'
                      }`}
                      title="Etch Tick Mark Indicators"
                    >
                      TICKS
                    </button>
                  </div>
                </div>
              )}

              {/* Dedicated Flatten 3D Model Button */}
              {!selectedPart.isDxfOnly && (
                <button
                  onClick={handleRunUnfold}
                  disabled={isUnfolding || isAnalyzing || isNesting}
                  className="w-full py-2 bg-industrial-orange hover:bg-industrial-orange/95 text-white font-bold rounded text-xs text-center transition cursor-pointer shadow flex items-center justify-center gap-1.5 font-mono mt-1"
                  title="Run K-Factor unfolding for this 3D model"
                >
                  <Play size={13} className={isUnfolding ? 'animate-spin' : ''} /> {isUnfolding ? 'FLATTENING...' : '⚡ FLATTEN / UNFOLD MODEL'}
                </button>
              )}
            </div>
          )}

          {/* Sheet Selection */}
          {activeTab === 'nesting' && (
            <div className="flex flex-col gap-4 border-t border-industrial-border/60 pt-4 mt-auto">
              <h3 className="text-xs font-mono font-bold tracking-wider text-industrial-muted flex items-center gap-2">
                <Layers size={14} /> SHEET STOCK
              </h3>
              
              <div className="flex flex-col gap-1.5">
                <label className="text-xs text-industrial-muted font-medium">Sheet Dimension</label>
                <select 
                  value={sheetSize} 
                  onChange={handleSheetChange}
                  disabled={isAnalyzing || isUnfolding || isNesting}
                  className="w-full bg-industrial-darker border border-industrial-border px-3 py-2 rounded text-sm text-industrial-text font-mono focus:border-industrial-accent outline-none cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {STANDARD_SHEET_SIZES.map(size => (
                    <option key={`${size.width}x${size.height}`} value={`${size.width}x${size.height}`}>
                      {size.label}: {size.width} x {size.height} mm
                    </option>
                  ))}
                  <option value="custom">Custom Size...</option>
                  <option value="remnant_rect">Remnant: Custom Rectangular</option>
                  <option value="remnant_lshape">Remnant: L-Shape Profile</option>
                </select>
              </div>

              {/* Sheet Capacity Strategy Setting */}
              <div className="flex flex-col gap-1.5">
                <span className="text-[10px] text-industrial-muted font-mono font-bold tracking-wider uppercase">Capacity Exceeded Action</span>
                <div className="grid grid-cols-2 gap-1 bg-industrial-darker p-0.5 rounded border border-industrial-border">
                  <button
                    type="button"
                    onClick={() => setSheetDefaultStrategy('count')}
                    className={`py-1 px-1 rounded text-[9px] font-bold font-mono transition text-center ${
                      sheetDefaultStrategy === 'count'
                        ? 'bg-industrial-accent text-industrial-bg shadow-sm'
                        : 'text-industrial-muted hover:text-industrial-text'
                    }`}
                    title="Generate additional sheets of standard size as needed"
                  >
                    + SHEET COUNT
                  </button>
                  <button
                    type="button"
                    onClick={() => setSheetDefaultStrategy('size')}
                    className={`py-1 px-1 rounded text-[9px] font-bold font-mono transition text-center ${
                      sheetDefaultStrategy === 'size'
                        ? 'bg-industrial-accent text-industrial-bg shadow-sm'
                        : 'text-industrial-muted hover:text-industrial-text'
                    }`}
                    title="Automatically expand sheet dimensions to fit all parts on a single sheet"
                  >
                    + SHEET SIZE
                  </button>
                </div>
              </div>

              {sheetSize === 'custom' && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1">
                    <span className="text-[10px] text-industrial-muted">Width (mm)</span>
                    <input 
                      type="number" 
                      value={sheetWidth} 
                      disabled={isAnalyzing || isUnfolding || isNesting}
                      onChange={(e) => setSheetWidth(Math.max(1, Number(e.target.value)))}
                      className="w-full bg-industrial-darker border border-industrial-border px-2 py-1.5 rounded text-xs text-industrial-text font-mono disabled:opacity-50 disabled:cursor-not-allowed"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-[10px] text-industrial-muted">Height (mm)</span>
                    <input 
                      type="number" 
                      value={sheetHeight} 
                      disabled={isAnalyzing || isUnfolding || isNesting}
                      onChange={(e) => setSheetHeight(Math.max(1, Number(e.target.value)))}
                      className="w-full bg-industrial-darker border border-industrial-border px-2 py-1.5 rounded text-xs text-industrial-text font-mono disabled:opacity-50 disabled:cursor-not-allowed"
                    />
                  </div>
                </div>
              )}

              {sheetSize === 'remnant_rect' && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1">
                    <span className="text-[10px] text-industrial-muted">Remnant Width (mm)</span>
                    <input 
                      type="number" 
                      value={sheetWidth} 
                      disabled={isAnalyzing || isUnfolding || isNesting}
                      onChange={(e) => setSheetWidth(Math.max(1, Number(e.target.value)))}
                      className="w-full bg-industrial-darker border border-industrial-border px-2 py-1.5 rounded text-xs text-industrial-text font-mono disabled:opacity-50 disabled:cursor-not-allowed"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-[10px] text-industrial-muted">Remnant Height (mm)</span>
                    <input 
                      type="number" 
                      value={sheetHeight} 
                      disabled={isAnalyzing || isUnfolding || isNesting}
                      onChange={(e) => setSheetHeight(Math.max(1, Number(e.target.value)))}
                      className="w-full bg-industrial-darker border border-industrial-border px-2 py-1.5 rounded text-xs text-industrial-text font-mono disabled:opacity-50 disabled:cursor-not-allowed"
                    />
                  </div>
                </div>
              )}

              {sheetSize === 'remnant_lshape' && (
                <div className="flex flex-col gap-2">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="flex flex-col gap-1">
                      <span className="text-[10px] text-industrial-muted">Outer Width (W)</span>
                      <input 
                        type="number" 
                        value={sheetWidth} 
                        disabled={isAnalyzing || isUnfolding || isNesting}
                        onChange={(e) => setSheetWidth(Math.max(1, Number(e.target.value)))}
                        className="w-full bg-industrial-darker border border-industrial-border px-2 py-1.5 rounded text-xs text-industrial-text font-mono disabled:opacity-50"
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <span className="text-[10px] text-industrial-muted">Outer Height (H)</span>
                      <input 
                        type="number" 
                        value={sheetHeight} 
                        disabled={isAnalyzing || isUnfolding || isNesting}
                        onChange={(e) => setSheetHeight(Math.max(1, Number(e.target.value)))}
                        className="w-full bg-industrial-darker border border-industrial-border px-2 py-1.5 rounded text-xs text-industrial-text font-mono disabled:opacity-50"
                      />
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-3">
                    <div className="flex flex-col gap-1">
                      <span className="text-[10px] text-industrial-muted">Cutout Width (Cw)</span>
                      <input 
                        type="number" 
                        value={remnantCutoutWidth} 
                        disabled={isAnalyzing || isUnfolding || isNesting}
                        onChange={(e) => setRemnantCutoutWidth(Math.max(0, Number(e.target.value)))}
                        className="w-full bg-industrial-darker border border-industrial-border px-2 py-1.5 rounded text-xs text-industrial-text font-mono disabled:opacity-50"
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <span className="text-[10px] text-industrial-muted">Cutout Height (Ch)</span>
                      <input 
                        type="number" 
                        value={remnantCutoutHeight} 
                        disabled={isAnalyzing || isUnfolding || isNesting}
                        onChange={(e) => setRemnantCutoutHeight(Math.max(0, Number(e.target.value)))}
                        className="w-full bg-industrial-darker border border-industrial-border px-2 py-1.5 rounded text-xs text-industrial-text font-mono disabled:opacity-50"
                      />
                    </div>
                  </div>
                  
                  {/* L-Shape Remnant Mini-Visualizer */}
                  <div className="bg-industrial-darker border border-industrial-border/60 p-2 rounded flex items-center justify-between text-[9px] font-mono text-industrial-muted mt-0.5">
                    <div className="flex flex-col">
                      <span className="font-bold text-industrial-text">L-Shape Remnant:</span>
                      <span>W: {sheetWidth}mm, H: {sheetHeight}mm</span>
                      <span>Cutout: {remnantCutoutWidth}x{remnantCutoutHeight}mm</span>
                    </div>
                    <div className="w-10 h-10 relative border border-dashed border-industrial-border/60 flex items-end justify-start shrink-0">
                      <div className="absolute top-0 right-0 w-5 h-5 bg-industrial-darker border-l border-b border-dashed border-red-500/30 flex items-center justify-center text-[6px] text-red-500/40">
                        Cut
                      </div>
                      <div className="w-10 h-10 bg-industrial-accent/15 border border-industrial-accent/40 absolute bottom-0 left-0" style={{
                        clipPath: 'polygon(0% 0%, 50% 0%, 50% 50%, 100% 50%, 100% 100%, 0% 100%)'
                      }}></div>
                    </div>
                  </div>
                </div>
              )}

              {/* Nesting-specific configurations */}
              <div className="flex flex-col gap-3 border-t border-industrial-border/40 pt-3 mt-1">
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1">
                    <span className="text-[10px] text-industrial-muted">Spacing (mm)</span>
                    <input 
                      type="number" 
                      min="1" 
                      max="50"
                      value={partSpacing} 
                      disabled={isAnalyzing || isUnfolding || isNesting}
                      onChange={(e) => setPartSpacing(Math.max(1, Number(e.target.value)))}
                      className="w-full bg-industrial-darker border border-industrial-border px-2 py-1.5 rounded text-xs text-industrial-text font-mono focus:border-industrial-accent outline-none disabled:opacity-50 disabled:cursor-not-allowed"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-[10px] text-industrial-muted">Margin (mm)</span>
                    <input 
                      type="number" 
                      min="0" 
                      max="50"
                      value={borderMargin} 
                      disabled={isAnalyzing || isUnfolding || isNesting}
                      onChange={(e) => setBorderMargin(Math.max(0, Number(e.target.value)))}
                      className="w-full bg-industrial-darker border border-industrial-border px-2 py-1.5 rounded text-xs text-industrial-text font-mono focus:border-industrial-accent outline-none disabled:opacity-50 disabled:cursor-not-allowed"
                    />
                  </div>
                </div>
                
                <div className="flex flex-col gap-1">
                  <span className="text-[10px] text-industrial-muted">Material Type</span>
                  <select 
                    value={nestingMaterial} 
                    disabled={isAnalyzing || isUnfolding || isNesting}
                    onChange={(e) => setNestingMaterial(e.target.value)}
                    className="w-full bg-industrial-darker border border-industrial-border px-2 py-1.5 rounded text-xs text-industrial-text font-mono focus:border-industrial-accent outline-none cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <option value="Steel">Mild Steel</option>
                    <option value="Stainless">Stainless Steel</option>
                    <option value="Aluminum">Aluminum</option>
                    <option value="Copper">Copper</option>
                    <option value="Brass">Brass</option>
                  </select>
                </div>

                <div className="flex flex-col gap-1">
                  <span className="text-[10px] text-industrial-muted">Part Rotation (Grain Alignment)</span>
                  <select 
                    value={rotationOption} 
                    disabled={isAnalyzing || isUnfolding || isNesting}
                    onChange={(e) => setRotationOption(e.target.value)}
                    className="w-full bg-industrial-darker border border-industrial-border px-2 py-1.5 rounded text-xs text-industrial-text font-mono focus:border-industrial-accent outline-none cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <option value="all">Free (0°, 90°, 180°, 270°)</option>
                    <option value="180">180° Steps Only (0°, 180°)</option>
                    <option value="none">No Rotation (0° - Fixed Grain)</option>
                  </select>
                </div>


                <div className="flex flex-col gap-1.5 border-t border-industrial-border/30 pt-2.5">
                  <span className="text-[10px] text-industrial-muted font-mono">Nesting Mode</span>
                  <div className="grid grid-cols-2 gap-1 bg-industrial-darker p-0.5 rounded border border-industrial-border">
                    <button
                      onClick={!(isAnalyzing || isUnfolding || isNesting) ? () => setNestingMode('auto') : undefined}
                      disabled={isAnalyzing || isUnfolding || isNesting}
                      className={`py-1 rounded text-[9px] font-bold font-mono transition ${
                        (isAnalyzing || isUnfolding || isNesting)
                          ? 'text-industrial-muted/30 cursor-not-allowed'
                          : nestingMode === 'auto'
                          ? 'bg-industrial-accent text-industrial-bg cursor-pointer'
                          : 'text-industrial-muted hover:text-industrial-text cursor-pointer'
                      }`}
                    >
                      AUTO-FILL SHEET
                    </button>
                    <button
                      onClick={!(isAnalyzing || isUnfolding || isNesting) ? () => setNestingMode('fixed') : undefined}
                      disabled={isAnalyzing || isUnfolding || isNesting}
                      className={`py-1 rounded text-[9px] font-bold font-mono transition ${
                        (isAnalyzing || isUnfolding || isNesting)
                          ? 'text-industrial-muted/30 cursor-not-allowed'
                          : nestingMode === 'fixed'
                          ? 'bg-industrial-accent text-industrial-bg cursor-pointer'
                          : 'text-industrial-muted hover:text-industrial-text cursor-pointer'
                      }`}
                    >
                      FIXED QTY
                    </button>
                  </div>
                </div>

                {nestingMode === 'fixed' && (
                  <div className="flex flex-col gap-1.5 border-t border-industrial-border/30 pt-2.5">
                    <span className="text-[10px] text-industrial-muted font-mono">Sets to Nest (Multiplier)</span>
                    <input 
                      type="number" 
                      min="1" 
                      value={setsToNest} 
                      disabled={isAnalyzing || isUnfolding || isNesting}
                      onChange={(e) => setSetsToNest(Math.max(1, Number(e.target.value)))}
                      className="w-full bg-industrial-darker border border-industrial-border px-2 py-1.5 rounded text-xs text-industrial-text font-mono focus:border-industrial-accent outline-none disabled:opacity-50 disabled:cursor-not-allowed"
                    />
                  </div>
                )}


                {/* Primary Start Nesting Call to Action */}
                <div className="border-t border-industrial-border/30 pt-4 mt-2">
                  <button
                    onClick={handleRunNesting}
                    disabled={parts.length === 0 || isNesting || isAnalyzing || isUnfolding}
                    className={`w-full py-2.5 rounded font-bold text-xs uppercase transition tracking-wider flex items-center justify-center gap-2 cursor-pointer shadow-md ${
                      parts.length === 0 || isNesting || isAnalyzing || isUnfolding
                        ? 'bg-industrial-border/30 text-industrial-muted/50 border border-transparent cursor-not-allowed'
                        : 'bg-industrial-orange text-white hover:bg-industrial-orange/95 hover:border-industrial-orange border border-industrial-orange'
                    }`}
                  >
                    <Layers size={14} className={isNesting ? 'animate-spin' : ''} />
                    <span>{isNesting ? 'Solving Packing...' : 'Start Nesting Solver'}</span>
                  </button>
                </div>
              </div>
            </div>
          )}
        </aside>

        {/* Sidebar Vertical Resizer Handle */}
        <div 
          onMouseDown={handleSidebarResize}
          className="w-1 hover:bg-industrial-accent bg-transparent cursor-col-resize transition-all shrink-0 z-20 border-r border-industrial-border/60 hover:w-1.5"
          title="Drag to resize sidebar"
        />
      </>
    )}

        {/* Central Viewport & Canvas Section */}
        <main className="flex-1 flex flex-col p-4 gap-4 overflow-hidden">
          {/* Main Visual tab headers */}
          <div className="flex justify-between items-center border-b border-industrial-border pb-2 shrink-0">
            <div className="flex gap-2">
              <button 
                onClick={() => setActiveTab('import')}
                className={`px-4 py-1.5 rounded text-sm font-semibold tracking-wider transition hover-lift ${
                  activeTab === 'import' 
                    ? 'bg-industrial-border text-industrial-accent border border-industrial-border shadow-sm' 
                    : 'hover:text-industrial-text text-industrial-muted'
                }`}
              >
                3D SOURCE
              </button>
              <button 
                onClick={() => setActiveTab('flatten')}
                disabled={parts.length === 0}
                className={`px-4 py-1.5 rounded text-sm font-semibold tracking-wider transition hover-lift ${
                  parts.length === 0
                    ? 'text-industrial-muted/35 cursor-not-allowed' 
                    : activeTab === 'flatten' 
                    ? 'bg-industrial-border text-industrial-orange border border-industrial-border shadow-sm' 
                    : 'hover:text-industrial-text text-industrial-muted'
                }`}
              >
                FLAT
              </button>
              <button 
                onClick={() => setActiveTab('jobgroups')}
                disabled={parts.length === 0}
                className={`px-4 py-1.5 rounded text-sm font-semibold tracking-wider transition hover-lift ${
                  parts.length === 0
                    ? 'text-industrial-muted/35 cursor-not-allowed' 
                    : activeTab === 'jobgroups' 
                    ? 'bg-industrial-border text-blue-400 border border-industrial-border shadow-sm' 
                    : 'hover:text-industrial-text text-industrial-muted'
                }`}
              >
                JOB QUEUES
              </button>
              <button 
                onClick={() => setActiveTab('nesting')}
                disabled={parts.length === 0}
                className={`px-4 py-1.5 rounded text-sm font-semibold tracking-wider transition hover-lift ${
                  parts.length === 0
                    ? 'text-industrial-muted/35 cursor-not-allowed' 
                    : activeTab === 'nesting' 
                    ? 'bg-industrial-border text-industrial-accent border border-industrial-border shadow-sm' 
                    : 'hover:text-industrial-text text-industrial-muted'
                }`}
              >
                NESTING VIEW
              </button>
            </div>

            {/* Combined View Toggle for 3D View */}
            {activeTab === 'import' && parts.length > 1 && (
              <div className="flex items-center gap-2 bg-industrial-card border border-industrial-border px-3 py-1 rounded text-xs animate-fade-in">
                <span className="text-industrial-muted font-mono text-[10px]">3D View Mode:</span>
                <button 
                  onClick={() => setCombined3D(false)}
                  className={`px-2 py-0.5 rounded font-mono text-[10px] transition ${!combined3D ? 'bg-industrial-accent text-white font-bold' : 'text-industrial-muted hover:text-industrial-text'}`}
                >
                  Selected Part
                </button>
                <button 
                  onClick={() => setCombined3D(true)}
                  className={`px-2 py-0.5 rounded font-mono text-[10px] transition ${combined3D ? 'bg-industrial-accent text-white font-bold' : 'text-industrial-muted hover:text-industrial-text'}`}
                >
                  Combined Scene ({parts.length})
                </button>
              </div>
            )}

            {/* Combined View Toggle for FLAT View */}
            {activeTab === 'flatten' && parts.length > 0 && (
              <div className="flex items-center gap-2 bg-industrial-card border border-industrial-border px-3 py-1 rounded text-xs animate-fade-in">
                <span className="text-industrial-muted font-mono text-[10px]">FLAT View Mode:</span>
                <button 
                  onClick={() => setCombinedFlat(false)}
                  className={`px-2 py-0.5 rounded font-mono text-[10px] transition ${!combinedFlat ? 'bg-industrial-orange text-white font-bold' : 'text-industrial-muted hover:text-industrial-text'}`}
                >
                  Selected Part
                </button>
                <button 
                  onClick={() => setCombinedFlat(true)}
                  className={`px-2 py-0.5 rounded font-mono text-[10px] transition ${combinedFlat ? 'bg-industrial-orange text-white font-bold' : 'text-industrial-muted hover:text-industrial-text'}`}
                >
                  Combined Scene ({parts.reduce((acc, p) => acc + (p.flatElements?.length || 0), 0)})
                </button>
              </div>
            )}
            
            {/* Status alerts */}
            {errorMessage && (
              <div className="flex items-center gap-2 bg-red-50 border border-red-300 text-red-700 text-xs px-3 py-1 rounded">
                <AlertTriangle size={14} /> {errorMessage}
              </div>
            )}
            
            {activeTab === 'nesting' && nestingDxfPath ? (
              <div className="flex items-center gap-4">
                <div className="text-xs font-mono text-industrial-muted">
                  Utilization: <span className="text-industrial-accent font-bold">{nestingUtilization}%</span>
                </div>
                <div className="text-xs font-mono text-industrial-muted">
                  Nested: <span className="text-industrial-accent font-bold">{nestingPartsCount?.nested} / {nestingPartsCount?.total}</span>
                </div>
                <div className="relative">
                  <button 
                    onClick={() => setShowExportMenu(prev => !prev)}
                    className="flex items-center gap-1.5 px-3 py-1 bg-industrial-orange hover:bg-industrial-orange/80 border border-industrial-orange/60 rounded text-xs text-white transition font-mono cursor-pointer font-bold shadow-md"
                    title="Export DXF patterns, G-Code, or Fabrication Reports"
                  >
                    <Download size={12} /> Export Options &darr;
                  </button>
                  
                  {showExportMenu && (
                    <div className="absolute right-0 mt-1.5 w-52 bg-industrial-card border border-industrial-border rounded-md shadow-2xl p-1 z-30 font-mono text-[10px] animate-fade-in flex flex-col gap-0.5 text-left">
                      <button
                        onClick={() => {
                          setShowExportMenu(false);
                          if (nestingDxfPath) {
                            const defaultName = nestingDxfPath.split(/[\\/]/).pop() || 'nested_layout.dxf';
                            handleSaveDxfAs(nestingDxfPath, defaultName);
                          }
                        }}
                        className="w-full text-left px-2.5 py-1.5 hover:bg-industrial-border hover:text-industrial-accent rounded transition text-industrial-text cursor-pointer flex items-center justify-between"
                      >
                        <span>📄 DXF Profile (2D)</span>
                        <span className="text-[8px] text-industrial-muted uppercase">Ready</span>
                      </button>
                      
                      <button
                        onClick={() => {
                          setShowExportMenu(false);
                          if (nestingPdfPath) {
                            const defaultName = nestingPdfPath.split(/[\\/]/).pop() || `sheet_layout_report_sheet_${activeSheetIndex + 1}.pdf`;
                            handleSaveDxfAs(nestingPdfPath, defaultName);
                          } else {
                            addLog("Export warning: No fabrication report generated. Run nesting first.");
                          }
                        }}
                        className="w-full text-left px-2.5 py-1.5 hover:bg-industrial-border hover:text-industrial-accent rounded transition text-industrial-text cursor-pointer flex items-center justify-between"
                      >
                        <span>📋 PDF Fab Report</span>
                        <span className="text-[8px] text-industrial-orange uppercase">Download</span>
                      </button>
                      
                      <button
                        onClick={() => {
                          setShowExportMenu(false);
                          if (nestingGcodePath) {
                            const defaultName = nestingGcodePath.split(/[\\/]/).pop() || `sheet_layout_laser_sheet_${activeSheetIndex + 1}.nc`;
                            handleSaveDxfAs(nestingGcodePath, defaultName);
                          } else {
                            addLog("Export warning: No NC G-code path generated. Run nesting first.");
                          }
                        }}
                        className="w-full text-left px-2.5 py-1.5 hover:bg-industrial-border hover:text-industrial-accent rounded transition text-industrial-text cursor-pointer flex items-center justify-between"
                      >
                        <span>⚙ NC Laser G-Code</span>
                        <span className="text-[8px] text-industrial-orange uppercase">Download</span>
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              selectedPart && selectedPart.dxfPath && (
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-1.5 text-industrial-success text-xs font-mono">
                    <CheckCircle size={14} /> Ready to Nest
                  </div>
                  <button 
                    onClick={() => handleUndoUnfold(selectedPart.id)}
                    className="flex items-center gap-1.5 px-3 py-1 bg-industrial-card hover:bg-red-500 hover:text-white hover:border-red-500 border border-industrial-border rounded text-xs text-red-500 transition font-mono cursor-pointer"
                    title="Discard unfolded DXF layout and revert this part to 3D-only"
                  >
                    <RotateCw size={12} /> Undo Flatten
                  </button>
                  <button 
                    onClick={() => {
                      if (selectedPart.dxfPath) {
                        const defaultName = selectedPart.dxfPath.split(/[\\/]/).pop() || `${selectedPart.name}_unfolded.dxf`;
                        handleSaveDxfAs(selectedPart.dxfPath, defaultName);
                      }
                    }}
                    className="flex items-center gap-1.5 px-3 py-1 bg-industrial-card hover:bg-industrial-border border border-industrial-border rounded text-xs text-industrial-accent hover:text-white transition font-mono cursor-pointer"
                    title="Save a copy of the unfolded flat pattern DXF to a custom location"
                  >
                    <Download size={12} /> Save DXF Path
                  </button>
                </div>
              )
            )}
          </div>

          {/* Interactive display render */}
          {isAnalyzing ? (
            <div className="flex-1 bg-industrial-darker border border-industrial-border rounded-lg flex flex-col items-center justify-center p-6 text-center font-mono">
              <RotateCw className="text-industrial-accent animate-spin mb-3" size={36} />
              <div className="text-sm">BATCH ANALYZING CAD GEOMETRY...</div>
              <div className="text-xs text-industrial-muted mt-1">Reading 3D solid coordinate bounds & loading STL meshes.</div>
              <button 
                onClick={handleCancelProcess}
                className="mt-5 px-5 py-2 bg-red-100 hover:bg-red-200 border border-red-300 text-red-800 text-xs font-semibold rounded transition shadow-md"
              >
                STOP LOADING PROCESS
              </button>
            </div>
          ) : isUnfolding ? (
            <div className="flex-1 bg-industrial-darker border border-industrial-border rounded-lg flex flex-col items-center justify-center p-6 text-center font-mono">
              <RotateCw className="text-industrial-orange animate-spin mb-3" size={36} />
              <div className="text-sm">FLATTENING MODEL GEOMETRY...</div>
              <div className="text-xs text-industrial-muted mt-1">OCC engine is solving K-Factor offsets & tracing flat profile.</div>
              <button 
                onClick={handleCancelProcess}
                className="mt-5 px-5 py-2 bg-red-100 hover:bg-red-200 border border-red-300 text-red-800 text-xs font-semibold rounded transition shadow-md"
              >
                STOP LOADING PROCESS
              </button>
            </div>
          ) : isNesting ? (
            <div className="flex-1 bg-industrial-darker border border-industrial-border rounded-lg flex flex-col items-center justify-center p-6 text-center font-mono">
              <RotateCw className="text-industrial-accent animate-spin mb-3" size={36} />
              <div className="text-sm">RUNNING 2D SHEET NESTING SOLVER...</div>
              <div className="text-xs text-industrial-muted mt-1">Nesting engine is solving irregular shapes placement and clearances.</div>
              <button 
                onClick={handleCancelProcess}
                className="mt-5 px-5 py-2 bg-red-100 hover:bg-red-200 border border-red-300 text-red-800 text-xs font-semibold rounded transition shadow-md"
              >
                STOP NESTING PROCESS
              </button>
            </div>
          ) : activeTab === 'import' ? (
            <div className="flex-1 flex gap-4 overflow-hidden">
              {/* Three.js Interactive 3D Orbiting Viewport */}
              <div className="flex-1 h-full min-w-0 relative">
                {parts.length > 0 ? (
                  <Model3DViewer 
                    onToggleFullScreen={() => setFullScreenView('3d')}
                    parts={viewerParts} 
                    combinedView={combined3D} 
                    activeFace={selectedPart?.baseFace || null}
                    faces={selectedPart?.faces || []}
                    hoveredFaceName={hoveredFaceName}
                    onFaceClick={(faceName) => selectedPart && handleUpdatePartBaseFace(selectedPart.id, faceName)}
                    onFaceHover={setHoveredFaceName}
                    onSetBaseFace={(faceName) => selectedPart && handleSetSoleBaseFace(selectedPart.id, faceName)}
                    onAddBaseFace={(faceName) => selectedPart && handleUpdatePartBaseFace(selectedPart.id, faceName)}
                    onRemoveBaseFace={(faceName) => selectedPart && handleUpdatePartBaseFace(selectedPart.id, faceName)}
                    onClearBaseFace={() => selectedPart && handleClearBaseFaces(selectedPart.id)}
                    onSelectPart={(partId) => setSelectedPartId(partId)}
                    selectedPartId={selectedPartId}
                    themeMode={themeMode}
                  />
                ) : (
                  <div className="h-full w-full bg-industrial-darker border border-industrial-border rounded-lg flex flex-col items-center justify-center text-industrial-muted font-mono text-center gap-2">
                    <Layers size={36} className="text-industrial-border animate-pulse" />
                    <div className="text-sm">NO MODELS IMPORTED</div>
                    <button onClick={handleSelectFiles} className="mt-2 px-4 py-1.5 bg-industrial-accent text-industrial-bg rounded font-bold hover:bg-industrial-accent/80 transition text-xs">
                      LOAD STEP OR DXF FILES
                    </button>
                  </div>
                )}
              </div>
              
              {/* Detailed Bounding Box Info Panel of Active Part */}
              {selectedPart && !combined3D && (
                <div className="w-72 flex flex-col gap-4 text-left p-4 bg-industrial-card border border-industrial-border rounded-md font-mono shrink-0 justify-between">
                  {pendingFaceSelection && pendingFaceSelection.partId === selectedPart.id ? (
                    <div className="flex flex-col gap-4 h-full justify-between">
                      <div className="flex flex-col gap-3">
                        <h4 className="text-industrial-orange font-bold border-b border-industrial-border pb-1.5 flex items-center gap-2 text-xs">
                          <HelpCircle size={14} className="animate-pulse" /> ADD BASE FLANGE?
                        </h4>
                        
                        <div className="bg-industrial-darker p-3 rounded border border-industrial-border flex flex-col gap-2.5 text-xs">
                          <div>
                            <span className="text-industrial-muted">Target Face:</span>
                            <span className="ml-2 font-bold text-industrial-accent">{pendingFaceSelection.faceName}</span>
                          </div>
                          <div>
                            <span className="text-industrial-muted">Face Type:</span>
                            <span className="ml-2 font-semibold text-industrial-orange">
                              {selectedPart.faces.find(f => f.name === pendingFaceSelection.faceName)?.type || 'PLANE'}
                            </span>
                          </div>
                          <div className="text-[10px] text-industrial-muted leading-relaxed mt-1">
                            This face will be added as an additional root for unfolding. The flat blanks will be aligned side-by-side.
                          </div>
                        </div>
                      </div>
                      
                      <div className="flex flex-col gap-2 pt-2">
                        <button
                          onClick={() => {
                            handleUpdatePartBaseFace(pendingFaceSelection.partId, pendingFaceSelection.faceName);
                            setPendingFaceSelection(null);
                          }}
                          className="w-full py-2 bg-industrial-accent hover:bg-industrial-accent/80 text-white font-bold rounded text-xs text-center transition cursor-pointer"
                        >
                          Confirm: Add Base Face
                        </button>
                        <button
                          onClick={() => setPendingFaceSelection(null)}
                          className="w-full py-2 bg-industrial-darker hover:bg-industrial-border border border-industrial-border text-industrial-muted hover:text-industrial-text font-bold rounded text-xs text-center transition cursor-pointer"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="flex flex-col gap-3">
                        <h4 className="text-industrial-accent font-bold border-b border-industrial-border pb-1.5 flex items-center gap-2 text-xs">
                          <FileCode size={14} /> 3D SOLID STRUCTURE
                        </h4>
                        <div className="grid grid-cols-2 gap-y-2.5 text-[11px] pr-1">
                          <div className="text-industrial-muted">Part Name:</div>
                          <div className="text-industrial-text break-all font-semibold">{selectedPart.name}</div>

                          <div className="text-industrial-muted font-bold">Material Alloy:</div>
                          <div className="font-bold flex items-center gap-1.5 flex-wrap" style={{ color: getMaterialColorCss(selectedPart.materialName || selectedPart.material) }}>
                            <span>{selectedPart.materialName || selectedPart.material || 'Mild Steel'}</span>
                            <span className="text-[9px] px-1 py-0.2 rounded bg-industrial-darker border border-industrial-border opacity-80 text-industrial-muted font-mono">
                              {selectedPart.density || 7850} kg/m³
                            </span>
                          </div>
                          
                          <div className="text-industrial-muted">Est. Thickness:</div>
                          <div className="text-industrial-orange font-bold">{formatVal(selectedPart.thickness)}</div>
      
                          <div className="text-industrial-muted">Dimensions X:</div>
                          <div className="text-industrial-text font-semibold">{formatVal(selectedPart.dimensions.x)}</div>
                          
                          <div className="text-industrial-muted">Dimensions Y:</div>
                          <div className="text-industrial-text font-semibold">{formatVal(selectedPart.dimensions.y)}</div>
      
                          <div className="text-industrial-muted">Dimensions Z:</div>
                          <div className="text-industrial-text font-semibold">{formatVal(selectedPart.dimensions.z)}</div>
      
                          <div className="text-industrial-muted">Total Volume:</div>
                          <div className="text-industrial-text">{(selectedPart.volume / 1000).toFixed(1)} cm³</div>
      
                          <div className="text-industrial-muted">Surface Area:</div>
                          <div className="text-industrial-text">{(selectedPart.area / 100).toFixed(1)} cm²</div>
      
                          <div className="text-industrial-muted">Total Faces:</div>
                          <div className="text-industrial-text">{selectedPart.faces.length}</div>
                        </div>
                      </div>

                      <div className="flex flex-col gap-2 pt-2 border-t border-industrial-border">
                        <button
                          onClick={() => setShowPreFlattenModal(true)}
                          disabled={isUnfolding || isAnalyzing || isNesting}
                          className="w-full py-2 bg-industrial-orange hover:bg-industrial-orange/90 text-white font-bold rounded text-xs text-center transition cursor-pointer shadow-md flex items-center justify-center gap-1.5 font-mono"
                          title="Run K-Factor unfolding for this 3D model"
                        >
                          <Play size={13} className={isUnfolding ? 'animate-spin' : ''} /> {isUnfolding ? 'FLATTENING...' : '⚡ FLATTEN / UNFOLD MODEL'}
                        </button>
                      </div>
                      
                      <div className="text-[10px] text-industrial-muted leading-relaxed border-t border-industrial-border pt-2 italic">
                        Note: Cylinder bodies (machined shafts, bushings) cannot be flattened unless modeled with a cut/seam. Select a planar face to unfold.
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          ) : activeTab === 'flatten' ? (
            <div className="flex-1 flex flex-col h-full overflow-hidden gap-2 text-left animate-fade-in">
              {combinedFlat ? (
                /* Single Combined 2D Flat Scene View (Side-by-Side Unified Canvas with Individual Controls) */
                <div className="flex-1 flex flex-col h-full min-h-0 relative gap-2">
                  {/* Top Bar for Individual Blank Controls in Flat Combined View */}
                  <div className="bg-industrial-card border border-industrial-border p-2 rounded-md font-mono text-xs flex flex-col gap-2 shrink-0 z-10 shadow-sm">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-industrial-muted uppercase font-bold tracking-wider flex items-center gap-1.5">
                        <span>🗺️ COMBINED FLAT BLANKS CONTROLS</span>
                        <span className="text-industrial-accent">
                          ({parts.reduce((acc, p) => acc + (p.flatElements?.filter(fe => fe.active !== false && fe.isUnfolded).length || 0), 0)} Blanks Active)
                        </span>
                      </span>
                      <span className="text-[9px] text-industrial-muted italic">
                        Tip: Click rotate or edit quantity per blank. Combined view auto-arranges in a non-overlapping grid layout.
                      </span>
                    </div>

                    <div className="flex items-center gap-2 overflow-x-auto scrollbar-custom pb-1 pr-1">
                      {parts.flatMap(p => (p.flatElements || []).map(fe => ({ part: p, element: fe }))).map(({ part, element }) => {
                        const rot = flatRotations[element.id] || 0;
                        const isFeActive = element.active !== false && part.active !== false;
                        return (
                          <div 
                            key={element.id}
                            className={`flex items-center gap-2 px-2.5 py-1.5 rounded border shrink-0 transition text-[10px] ${
                              !isFeActive 
                                ? 'opacity-40 bg-industrial-darker/40 border-industrial-border/30' 
                                : 'bg-industrial-darker border-industrial-border hover:border-industrial-accent/60'
                            }`}
                          >
                            <input 
                              type="checkbox"
                              checked={isFeActive}
                              disabled={isAnalyzing || isUnfolding || isNesting}
                              onChange={() => handleToggleFlatElementActive(part.id, element.id)}
                              className="w-3 h-3 rounded border-industrial-border bg-industrial-darker text-industrial-accent accent-industrial-accent cursor-pointer"
                              title="Include/Exclude blank from nesting"
                            />
                            <div className="flex flex-col min-w-0">
                              <span className="font-bold text-industrial-text truncate max-w-[120px]" title={element.name}>
                                {element.baseFace}
                              </span>
                              <span className="text-[8px] text-industrial-muted truncate max-w-[120px]">
                                {part.name}
                              </span>
                            </div>

                            <button
                              disabled={!isFeActive || isAnalyzing || isUnfolding || isNesting}
                              onClick={() => {
                                setFlatRotations(prev => ({
                                  ...prev,
                                  [element.id]: ((prev[element.id] || 0) + 90) % 360
                                }));
                              }}
                              className="px-1.5 py-0.5 bg-industrial-card hover:bg-industrial-accent hover:text-white border border-industrial-border rounded transition text-industrial-text text-[9px] font-mono flex items-center gap-1 cursor-pointer disabled:opacity-50"
                              title="Rotate flat blank 90°"
                            >
                              <RotateCw size={10} /> {rot}°
                            </button>

                            <QuantityControl
                              value={element.quantity}
                              isAuto={autoQuantityMap[element.id] || false}
                              allowAuto={false}
                              disabled={!isFeActive || isAnalyzing || isUnfolding || isNesting}
                              onUpdate={(qty) => handleUpdateFlatElementQuantity(part.id, element.id, qty)}
                            />
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Combined SVG Canvas */}
                  <div className="flex-1 min-h-0 relative">
                    {combinedSvgContent && (
                      <FlatPreviewer 
                        svgContent={combinedSvgContent} 
                        baseFace="Combined Flat Scene" 
                        thickness={parts[0]?.thickness || DEFAULT_THICKNESS_MM} 
                        onToggleFullScreen={() => setFullScreenView('flat')}
                        themeMode={themeMode}
                      />
                    )}
                  </div>
                </div>
              ) : (
                /* Single Flat Part View */
                <>
                  {/* Selected Flat Element Selector */}
                  {selectedPart && selectedPart.flatElements && selectedPart.flatElements.length > 1 && (
                    <div className="flex items-center gap-2 bg-industrial-card border border-industrial-border px-3 py-1.5 rounded text-xs font-mono w-fit shrink-0">
                      <span className="text-industrial-muted text-[10px] uppercase font-bold">Unfolded Blanks:</span>
                      <div className="flex gap-1">
                        {selectedPart.flatElements.map(fe => {
                          const isActive = selectedFlatElementId === fe.id || (!selectedFlatElementId && selectedPart.flatElements?.[0]?.id === fe.id);
                          return (
                            <button
                              key={fe.id}
                              onClick={() => {
                                setSelectedFlatElementId(fe.id);
                                if (selectedPart && fe && !fe.svgContent) {
                                  handleRunUnfoldElement(selectedPart.id, fe.id, false, undefined, false, fe.baseFace);
                                }
                              }}
                              className={`px-2 py-0.5 rounded text-[10px] border transition cursor-pointer ${
                                isActive
                                  ? 'bg-industrial-accent text-industrial-bg border-industrial-accent font-bold'
                                  : 'bg-industrial-darker hover:bg-industrial-border border-industrial-border text-industrial-muted hover:text-industrial-text'
                              }`}
                            >
                              {fe.baseFace}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Flat Previewer canvas */}
                  {(() => {
                    const activeFe = selectedPart?.flatElements?.find(fe => fe.id === selectedFlatElementId) || selectedPart?.flatElements?.[0] || null;
                    const activeRot = activeFe ? flatRotations[activeFe.id] || 0 : 0;
                    const activeSvg = activeFe?.svgContent || selectedPart?.svgContent || null;
                    return (
                      <div className="flex-1 min-h-0 relative">
                        {activeFe && activeSvg && (
                          <div className="absolute top-3 right-[136px] z-10 flex items-center gap-2 pointer-events-auto">
                            <button
                              onClick={() => {
                                if (activeFe) {
                                  setFlatRotations(prev => ({
                                    ...prev,
                                    [activeFe.id]: ((prev[activeFe.id] || 0) + 90) % 360
                                  }));
                                }
                              }}
                              className="px-2 py-1 bg-industrial-card/90 hover:bg-industrial-accent hover:text-white border border-industrial-border rounded transition text-industrial-text text-[10px] font-mono flex items-center gap-1 shadow-md"
                              title="Rotate 2D Flat Model by 90°"
                            >
                              <RotateCw size={11} /> {activeRot}°
                            </button>
                            <button
                              onClick={() => setFullScreenView('flat')}
                              className="p-1.5 bg-industrial-card/90 hover:bg-industrial-accent hover:text-industrial-bg border border-industrial-border rounded transition text-industrial-text shadow-md"
                              title="Expand Viewport to Full Screen"
                            >
                              <Maximize2 size={12} />
                            </button>
                          </div>
                        )}
                        <FlatPreviewer 
                          onToggleFullScreen={() => setFullScreenView('flat')}
                          svgContent={activeSvg} 
                          baseFace={activeFe ? activeFe.baseFace : null} 
                          thickness={selectedPart ? selectedPart.thickness : DEFAULT_THICKNESS_MM}
                          rotationAngle={activeRot}
                          onRemoveComponent={(faceName) => {
                            if (selectedPart) {
                              handleUpdatePartBaseFace(selectedPart.id, faceName);
                              setSelectedFlatElementId(null);
                            }
                          }}
                          themeMode={themeMode}
                        />
                      </div>
                    );
                  })()}
                </>
              )}
            </div>
          ) : activeTab === 'jobgroups' ? (
            <div className="flex-1 overflow-y-auto p-4 bg-industrial-darker/60 border border-industrial-border rounded-lg text-left animate-fade-in">
              <JobGroupTab 
                parts={parts}
                onSelectGroupForNesting={(_group) => {
                  setNestingInitialized(true);
                  handleRunNesting();
                }} 
              />
            </div>
          ) : (
            <div className="flex-1 flex gap-4 overflow-hidden">
              {/* Nesting layout flat previewer */}
              <div className="flex-1 h-full min-w-0 flex flex-col gap-2.5">
                {/* Pending changes banner */}
                {nestingPending && nestingInitialized && (
                  <div className="bg-amber-500/10 border border-amber-500/20 px-3.5 py-2 rounded-lg flex items-center justify-between text-amber-500 text-xs font-mono shrink-0 text-left">
                    <div className="flex items-center gap-2">
                      <AlertTriangle size={14} className="shrink-0" />
                      <span>Nesting layout out of date. Click to recalculate solver:</span>
                    </div>
                    <button
                      onClick={() => handleRunNesting()}
                      className="px-3 py-1 bg-industrial-orange hover:bg-industrial-orange/90 text-white rounded font-bold transition cursor-pointer text-[10px] tracking-wider shrink-0 shadow-sm flex items-center gap-1"
                    >
                      <Play size={10} /> RECALCULATE NESTING
                    </button>
                  </div>
                )}

                {/* Material & Thickness Filter Pills for Nested Sheets */}
                {nestedSheets.length > 0 && (
                  <div className="bg-industrial-card/80 border border-industrial-border rounded-lg p-2.5 flex items-center justify-between gap-3 text-xs font-mono shrink-0 select-none shadow-sm">
                    <div className="flex items-center gap-2 overflow-x-auto scrollbar-custom pb-0.5 min-w-0">
                      <span className="text-[10px] text-industrial-muted uppercase font-bold tracking-wider shrink-0 flex items-center gap-1">
                        <span>⚡ Sheet Filter:</span>
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedMaterialFilter('ALL');
                          if (nestedSheets[0]) {
                            setActiveSheetIndex(0);
                            setNestingSvg(nestedSheets[0].svgContent);
                            setNestingDxfPath(nestedSheets[0].dxfPath);
                            setNestingPdfPath(nestedSheets[0].pdfPath);
                            setNestingGcodePath(nestedSheets[0].gcodePath);
                            setNestingUtilization(nestedSheets[0].utilization);
                          }
                        }}
                        className={`px-2.5 py-1 rounded text-[10px] border transition cursor-pointer whitespace-nowrap font-bold ${
                          selectedMaterialFilter === 'ALL'
                            ? 'bg-industrial-accent text-white border-industrial-accent shadow-sm'
                            : 'bg-industrial-darker text-industrial-muted hover:text-white border-industrial-border'
                        }`}
                      >
                        All Sheets ({nestedSheets.length})
                      </button>

                      {Array.from(new Set(nestedSheets.map(s => `${(s as any).material || 'Mild Steel'} (${(s as any).thickness || DEFAULT_THICKNESS_MM}mm)`))).map(matKey => {
                        const matchingSheets = nestedSheets.filter(s => `${(s as any).material || 'Mild Steel'} (${(s as any).thickness || DEFAULT_THICKNESS_MM}mm)` === matKey);
                        return (
                          <button
                            key={matKey}
                            type="button"
                            onClick={() => {
                              setSelectedMaterialFilter(matKey);
                              const firstMatchingIdx = nestedSheets.findIndex(s => `${(s as any).material || 'Mild Steel'} (${(s as any).thickness || DEFAULT_THICKNESS_MM}mm)` === matKey);
                              if (firstMatchingIdx >= 0) {
                                setActiveSheetIndex(firstMatchingIdx);
                                setNestingSvg(nestedSheets[firstMatchingIdx].svgContent);
                                setNestingDxfPath(nestedSheets[firstMatchingIdx].dxfPath);
                                setNestingPdfPath(nestedSheets[firstMatchingIdx].pdfPath);
                                setNestingGcodePath(nestedSheets[firstMatchingIdx].gcodePath);
                                setNestingUtilization(nestedSheets[firstMatchingIdx].utilization);
                              }
                            }}
                            className={`px-2.5 py-1 rounded text-[10px] border transition cursor-pointer whitespace-nowrap font-bold ${
                              selectedMaterialFilter === matKey
                                ? 'bg-industrial-accent text-white border-industrial-accent shadow-sm'
                                : 'bg-industrial-darker text-industrial-muted hover:text-white border-industrial-border'
                            }`}
                          >
                            {matKey} ({matchingSheets.length})
                          </button>
                        );
                      })}
                    </div>

                    {nestedSheets.length > 1 && (
                      <button
                        onClick={() => setViewMode(prev => prev === 'single' ? 'grid' : 'single')}
                        className={`px-2.5 py-1 rounded text-[10px] border transition cursor-pointer shrink-0 font-bold ${
                          viewMode === 'grid'
                            ? 'bg-industrial-orange text-industrial-bg border-industrial-orange'
                            : 'bg-industrial-darker border-industrial-border text-industrial-muted hover:text-industrial-text'
                        }`}
                        title="Toggle Grid Overview of all sheets"
                      >
                        {viewMode === 'grid' ? '🗂 Single Sheet View' : '🗂 Grid Overview'}
                      </button>
                    )}
                  </div>
                )}

                {(() => {
                  const displayedSheets = selectedMaterialFilter === 'ALL'
                    ? nestedSheets
                    : nestedSheets.filter(s => `${(s as any).material || 'Mild Steel'} (${(s as any).thickness || DEFAULT_THICKNESS_MM}mm)` === selectedMaterialFilter);

                  if (viewMode === 'grid' && nestedSheets.length > 1) {
                    return (
                      <div className="flex-1 min-h-0 overflow-y-auto bg-industrial-darker/60 border border-industrial-border rounded-lg p-4 scrollbar-custom">
                        <div className="grid grid-cols-2 gap-4">
                          {displayedSheets.map((sheet) => {
                            const origIdx = nestedSheets.findIndex(ns => ns.index === sheet.index);
                            return (
                              <div 
                                key={sheet.index}
                                onClick={() => {
                                  setActiveSheetIndex(origIdx);
                                  setNestingSvg(sheet.svgContent);
                                  setNestingDxfPath(sheet.dxfPath);
                                  setNestingPdfPath(sheet.pdfPath);
                                  setNestingGcodePath(sheet.gcodePath);
                                  setNestingUtilization(sheet.utilization);
                                  setViewMode('single');
                                  addLog(`Selected Sheet ${sheet.index} (${(sheet as any).material || 'Mild Steel'}) from grid overview.`);
                                }}
                                className={`bg-industrial-card border rounded-lg p-3 flex flex-col gap-2 cursor-pointer transition transform hover:-translate-y-0.5 shadow-lg group hover:shadow-xl text-left ${
                                  activeSheetIndex === origIdx ? 'border-industrial-accent' : 'border-industrial-border hover:border-industrial-accent/50'
                                }`}
                              >
                                <div className="flex items-center justify-between text-[11px] font-mono font-bold">
                                  <div className="flex items-center gap-2">
                                    <span className={activeSheetIndex === origIdx ? 'text-industrial-accent' : 'text-industrial-text/90 group-hover:text-industrial-accent'}>
                                      SHEET {sheet.index}
                                    </span>
                                    <span className="px-2 py-0.5 text-[9px] font-bold text-blue-400 bg-blue-500/10 border border-blue-500/20 rounded">
                                      {(sheet as any).material || 'Mild Steel'} ({(sheet as any).thickness || DEFAULT_THICKNESS_MM}mm)
                                    </span>
                                  </div>
                                  <span className="text-industrial-orange font-semibold">{sheet.utilization}% Utilization</span>
                                </div>
                                
                                <div className="bg-industrial-darker p-3 rounded border border-industrial-border/60 flex items-center justify-center h-48 relative overflow-hidden">
                                  <div className="w-full h-full flex items-center justify-center select-none pointer-events-none scale-90" dangerouslySetInnerHTML={{ __html: sheet.svgContent }} />
                                </div>
                                <div className="text-[9px] text-industrial-muted text-center italic group-hover:text-industrial-text transition">
                                  Click to open sheet layout for detailed view
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  }

                  if (!nestingSvg) return null;
                  return null;
                })()}

                {viewMode !== 'grid' && nestingSvg ? (
                  <div className="flex-1 min-h-0 flex flex-col gap-3">
                    <div className="flex-1 min-h-0 relative">
                      {nestingSvg && (
                        <button
                          onClick={() => setFullScreenView('nesting')}
                          className="absolute top-3 right-[136px] z-10 p-1.5 bg-industrial-card/90 hover:bg-industrial-accent hover:text-industrial-bg border border-industrial-border rounded transition text-industrial-text shadow-md pointer-events-auto"
                          title="Expand Viewport to Full Screen"
                        >
                          <Maximize2 size={12} />
                        </button>
                      )}
                      <FlatPreviewer 
                        onToggleFullScreen={() => setFullScreenView('nesting')}
                        svgContent={nestingSvg} 
                        baseFace={null} 
                        thickness={0} 
                        is3dView={false} 
                        title={`2D Nested Layout`}
                        themeMode={themeMode}
                      />
                    </div>
                    
                    {/* Comprehensive Selected Sheet Information Card below the sheet viewer */}
                    {nestedSheets.length > 0 && (() => {
                      const curSheet = nestedSheets[activeSheetIndex] || nestedSheets[0];
                      const matName = (curSheet as any).material || 'Mild Steel';
                      const thickVal = (curSheet as any).thickness || DEFAULT_THICKNESS_MM;
                      const sheetAreaM2 = (sheetWidth * sheetHeight) / 1000000;
                      const usedAreaM2 = (sheetAreaM2 * (curSheet.utilization / 100));
                      const scrapAreaM2 = (sheetAreaM2 - usedAreaM2);
                      const scrapPercent = (100 - curSheet.utilization).toFixed(1);

                      const getCleanFilename = (sheet: any, ext: 'dxf' | 'pdf' | 'nc') => {
                        const matClean = ((sheet?.material || 'Mild_Steel') as string)
                          .replace(/[^a-zA-Z0-9]+/g, '_')
                          .replace(/^_+|_+$/g, '');
                        const thickClean = `${sheet?.thickness || DEFAULT_THICKNESS_MM}mm`;
                        const idxStr = `Sheet_${sheet?.index || (activeSheetIndex + 1)}_of_${nestedSheets.length}`;
                        const dimStr = `${sheetWidth}x${sheetHeight}mm`;
                        return `Cadanest_${matClean}_${thickClean}_${idxStr}_${dimStr}.${ext}`;
                      };

                      return (
                        <div className="bg-industrial-card border border-industrial-border rounded-lg p-3.5 flex flex-col gap-3 font-mono text-xs shrink-0 select-none shadow-lg text-left">
                          {/* Top Row: Page Navigation & Active Sheet Title */}
                          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-industrial-border/60 pb-2.5">
                            <div className="flex items-center gap-2">
                              <button
                                disabled={activeSheetIndex === 0}
                                onClick={() => {
                                  const prevIdx = activeSheetIndex - 1;
                                  setActiveSheetIndex(prevIdx);
                                  setNestingSvg(nestedSheets[prevIdx].svgContent);
                                  setNestingDxfPath(nestedSheets[prevIdx].dxfPath);
                                  setNestingPdfPath(nestedSheets[prevIdx].pdfPath);
                                  setNestingGcodePath(nestedSheets[prevIdx].gcodePath);
                                  setNestingUtilization(nestedSheets[prevIdx].utilization);
                                }}
                                className="px-2.5 py-1 bg-industrial-darker hover:bg-industrial-border border border-industrial-border hover:text-white rounded disabled:opacity-30 transition cursor-pointer disabled:cursor-not-allowed font-bold"
                                title="Previous Sheet"
                              >
                                &larr; Prev
                              </button>

                              <div className="flex items-center gap-1">
                                {nestedSheets.map((_s, idx) => (
                                  <button
                                    key={idx}
                                    onClick={() => {
                                      setActiveSheetIndex(idx);
                                      setNestingSvg(nestedSheets[idx].svgContent);
                                      setNestingDxfPath(nestedSheets[idx].dxfPath);
                                      setNestingPdfPath(nestedSheets[idx].pdfPath);
                                      setNestingGcodePath(nestedSheets[idx].gcodePath);
                                      setNestingUtilization(nestedSheets[idx].utilization);
                                    }}
                                    className={`px-2.5 py-1 text-[10px] rounded font-bold transition cursor-pointer ${
                                      activeSheetIndex === idx
                                        ? 'bg-industrial-accent text-white shadow-sm'
                                        : 'text-industrial-muted hover:text-industrial-text hover:bg-industrial-border'
                                    }`}
                                  >
                                    Sheet {idx + 1}
                                  </button>
                                ))}
                              </div>

                              <button
                                disabled={activeSheetIndex === nestedSheets.length - 1}
                                onClick={() => {
                                  const nextIdx = activeSheetIndex + 1;
                                  setActiveSheetIndex(nextIdx);
                                  setNestingSvg(nestedSheets[nextIdx].svgContent);
                                  setNestingDxfPath(nestedSheets[nextIdx].dxfPath);
                                  setNestingPdfPath(nestedSheets[nextIdx].pdfPath);
                                  setNestingGcodePath(nestedSheets[nextIdx].gcodePath);
                                  setNestingUtilization(nestedSheets[nextIdx].utilization);
                                }}
                                className="px-2.5 py-1 bg-industrial-darker hover:bg-industrial-border border border-industrial-border hover:text-white rounded disabled:opacity-30 transition cursor-pointer disabled:cursor-not-allowed font-bold"
                                title="Next Sheet"
                              >
                                Next &rarr;
                              </button>
                            </div>

                            {/* Active Sheet Badge */}
                            <div className="flex items-center gap-2">
                              <span className="text-[11px] font-bold text-industrial-accent">
                                Active Sheet {curSheet.index} of {nestedSheets.length}
                              </span>
                              <span className="px-2.5 py-0.5 text-[10px] font-bold text-blue-400 bg-blue-500/10 border border-blue-500/20 rounded-full">
                                {matName} ({thickVal}mm)
                              </span>
                            </div>
                          </div>

                          {/* Middle Row: Detailed Information Grid */}
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-industrial-darker/60 p-3 rounded-lg border border-industrial-border/40 text-[11px]">
                            <div>
                              <span className="text-industrial-muted text-[10px] block uppercase font-bold">Sheet Stock Size:</span>
                              <strong className="text-industrial-text">{sheetWidth} × {sheetHeight} mm</strong>
                              <span className="text-[9px] text-industrial-muted block">({sheetAreaM2.toFixed(3)} m²)</span>
                            </div>

                            <div>
                              <span className="text-industrial-muted text-[10px] block uppercase font-bold">Material Utilization:</span>
                              <strong className="text-industrial-orange font-bold text-xs">{curSheet.utilization}%</strong>
                              <span className="text-[9px] text-industrial-muted block">({usedAreaM2.toFixed(3)} m² cut)</span>
                            </div>

                            <div>
                              <span className="text-industrial-muted text-[10px] block uppercase font-bold">Scrap / Offcut:</span>
                              <strong className="text-gray-300 font-semibold">{scrapPercent}%</strong>
                              <span className="text-[9px] text-industrial-muted block">({scrapAreaM2.toFixed(3)} m² scrap)</span>
                            </div>

                            <div>
                              <span className="text-industrial-muted text-[10px] block uppercase font-bold">Nested Blanks:</span>
                              <strong className="text-industrial-accent font-bold">{curSheet.nestedCount} Parts</strong>
                              <span className="text-[9px] text-industrial-muted block">Margin: {borderMargin}mm | Gap: {partSpacing}mm</span>
                            </div>
                          </div>

                          {/* Bottom Row: Direct Export Options with Standard Production Filenames */}
                          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                            <div className="text-[10px] text-industrial-muted italic">
                              Standardized Production Export Filename: <span className="text-industrial-accent font-mono font-semibold">{getCleanFilename(curSheet, 'dxf')}</span>
                            </div>

                            <div className="flex items-center gap-2 text-xs">
                              {curSheet.dxfPath && (
                                <button
                                  onClick={() => handleSaveDxfAs(curSheet.dxfPath, getCleanFilename(curSheet, 'dxf'))}
                                  className="px-2.5 py-1 bg-industrial-accent/20 hover:bg-industrial-accent/30 text-industrial-accent border border-industrial-accent/40 rounded transition flex items-center gap-1 font-bold text-[10px]"
                                  title="Export 2D DXF Flat Cutting Contour"
                                >
                                  <Download size={11} /> Save DXF
                                </button>
                              )}

                              {curSheet.pdfPath && (
                                <button
                                  onClick={() => handleSaveDxfAs(curSheet.pdfPath, getCleanFilename(curSheet, 'pdf'))}
                                  className="px-2.5 py-1 bg-industrial-orange/20 hover:bg-industrial-orange/30 text-industrial-orange border border-industrial-orange/40 rounded transition flex items-center gap-1 font-bold text-[10px]"
                                  title="Export PDF Fabrication Summary Sheet"
                                >
                                  <Download size={11} /> Save Fab PDF
                                </button>
                              )}

                              {curSheet.gcodePath && (
                                <button
                                  onClick={() => handleSaveDxfAs(curSheet.gcodePath, getCleanFilename(curSheet, 'nc'))}
                                  className="px-2.5 py-1 bg-industrial-card hover:bg-industrial-border text-industrial-text border border-industrial-border rounded transition flex items-center gap-1 font-bold text-[10px]"
                                  title="Export Laser Toolpath G-Code (.NC)"
                                >
                                  <Download size={11} /> Save G-Code
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                ) : !nestingInitialized ? (
                  <div className="h-full w-full bg-industrial-darker border border-industrial-border rounded-lg flex flex-col items-center justify-center text-industrial-muted font-mono text-center gap-6 p-8">
                    <Layers size={48} className="text-industrial-accent animate-pulse" />
                    <div className="flex flex-col gap-1.5">
                      <div className="text-sm font-bold text-industrial-text">SELECT NESTING WORKFLOW</div>
                      <div className="text-xs text-industrial-muted max-w-sm leading-relaxed mx-auto">
                        Choose your nesting strategy to begin nesting active unfolded blanks:
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4 max-w-md w-full">
                      {/* Option 1: Full Auto */}
                      <button
                        onClick={async () => {
                          setNestingConfigType('sets');
                          setNestingMode('auto');
                          addLog("Selected workflow: Full Auto Nesting (Auto-Fill Sets).");
                          setNestingInitialized(true);
                          setTimeout(() => {
                            handleRunNesting();
                          }, 100);
                        }}
                        className="flex flex-col items-center gap-2 p-4 bg-industrial-card hover:bg-industrial-border border border-industrial-border hover:border-industrial-accent rounded-lg text-center transition group cursor-pointer"
                      >
                        <Play size={20} className="text-industrial-accent shrink-0 group-hover:scale-110 transition" />
                        <span className="text-xs font-bold text-industrial-text">Full Auto Nesting</span>
                        <span className="text-[10px] text-industrial-muted leading-relaxed">
                          Auto-calculate set ratios to maximize sheet utilization.
                        </span>
                      </button>

                      {/* Option 2: Semi Auto (Custom) */}
                      <button
                        onClick={() => {
                          setNestingConfigType('custom');
                          setNestingInitialized(true);
                          addLog("Selected workflow: Semi Auto Nesting (Custom Qty). Configure settings and click Run Nesting when ready.");
                        }}
                        className="flex flex-col items-center gap-2 p-4 bg-industrial-card hover:bg-industrial-border border border-industrial-border hover:border-industrial-orange rounded-lg text-center transition group cursor-pointer"
                      >
                        <Settings size={20} className="text-industrial-orange shrink-0 group-hover:scale-110 transition" />
                        <span className="text-xs font-bold text-industrial-text">Semi Auto Nesting</span>
                        <span className="text-[10px] text-industrial-muted leading-relaxed">
                          Manually configure individual quantities and groups before nesting.
                        </span>
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="h-full w-full bg-industrial-darker border border-industrial-border rounded-lg flex flex-col items-center justify-center text-industrial-muted font-mono text-center gap-3 p-6">
                    <Layers size={48} className="text-industrial-border animate-pulse mb-2" />
                    <div className="text-sm font-bold text-industrial-text">NESTING LAYOUT GENERATION PENDING</div>
                    <div className="text-xs max-w-md leading-relaxed text-industrial-muted">
                      No layout has been generated yet. Configure options in the setup panel on the right and click <strong className="text-industrial-accent font-semibold">Run Nesting</strong> in the top header (or wait for live updates) to solve part packing.
                    </div>
                  </div>
                )}
              </div>

              {/* Nesting Configuration Dashboard Sidebar */}
              <div className="w-80 flex flex-col gap-4 text-left p-4 bg-industrial-card border border-industrial-border rounded-md font-mono shrink-0 overflow-y-auto scrollbar-custom justify-between">
                <div className="flex flex-col gap-4">
                  <h4 className="text-industrial-accent font-bold border-b border-industrial-border pb-1.5 flex items-center gap-2 text-xs">
                    <Settings size={14} /> NESTING SETUP
                  </h4>

                  {/* Strategy Selection */}
                  <div className="flex flex-col gap-1.5">
                    <span className="text-[10px] text-industrial-muted font-bold uppercase">Nesting Mode</span>
                    <div className="grid grid-cols-2 gap-1 bg-industrial-darker p-0.5 rounded border border-industrial-border">
                      <button
                        onClick={() => {
                          setNestingConfigType('sets');
                          setNestingMode('auto');
                        }}
                        className={`py-1.5 rounded text-[9px] font-bold font-mono transition cursor-pointer ${
                          nestingConfigType === 'sets' && nestingMode === 'auto'
                            ? 'bg-industrial-accent text-industrial-bg font-bold'
                            : 'text-industrial-muted hover:text-industrial-text'
                        }`}
                      >
                        1ST: AUTO-FILL
                      </button>
                      <button
                        onClick={() => {
                          setNestingConfigType('custom');
                        }}
                        className={`py-1.5 rounded text-[9px] font-bold font-mono transition cursor-pointer ${
                          nestingConfigType === 'custom'
                            ? 'bg-industrial-accent text-industrial-bg font-bold'
                            : 'text-industrial-muted hover:text-industrial-text'
                        }`}
                      >
                        2ND: CUSTOM QTY
                      </button>
                    </div>
                  </div>

                  {/* strategy-specific mode details */}
                  {nestingConfigType === 'sets' ? (
                    <div className="text-[10px] text-industrial-muted border border-dashed border-industrial-border/60 p-2.5 rounded bg-industrial-darker/30 leading-relaxed">
                      Auto-Fill active. Solver will automatically calculate and fit as many complete sets of part ratios as possible onto the sheet layout.
                    </div>
                  ) : (
                    <div className="text-[10px] text-industrial-muted border border-dashed border-industrial-border/60 p-2.5 rounded bg-industrial-darker/30 leading-relaxed">
                      Custom mode active. Solver will place exactly the target quantities configured below, spilling over sheets if necessary.
                    </div>
                  )}

                  {/* Hierarchical ready parts list section */}
                  <div className="flex flex-col gap-2 border-t border-industrial-border/60 pt-3">
                    <span className="text-[10px] text-industrial-muted font-bold uppercase flex justify-between">
                      <span>Nesting Parts Hierarchy</span>
                      <span className="text-industrial-accent">
                        {parts.reduce((sum, p) => sum + (p.flatElements?.filter(fe => fe.active !== false).length || 0), 0)} Elements Active
                      </span>
                    </span>
                    <div className="flex flex-col gap-3 max-h-[300px] overflow-y-auto scrollbar-custom pr-1">
                      {parts.map(p => {
                        const isPartActive = p.active !== false;
                        return (
                          <div key={p.id} className="flex flex-col gap-1 border border-industrial-border/40 rounded p-1.5 bg-industrial-darker/10">
                            {/* Parent part row */}
                            <div className="flex items-center justify-between text-xs font-mono border-b border-industrial-border/20 pb-1">
                              <div className="flex items-center gap-1.5 min-w-0 flex-1">
                                <input 
                                  type="checkbox"
                                  checked={isPartActive}
                                  disabled={isAnalyzing || isUnfolding || isNesting}
                                  onChange={(e) => handleTogglePartActive(p.id, e as any)}
                                  className="w-3.5 h-3.5 rounded border-industrial-border bg-industrial-darker text-industrial-accent accent-industrial-accent cursor-pointer"
                                />
                                <span className="truncate font-bold text-industrial-text/90 flex items-center gap-1" title={p.name}>
                                  📁 {p.name}
                                </span>
                              </div>
                              <div className="flex items-center gap-1.5 shrink-0 ml-2">
                                <span className="text-[8px] text-industrial-muted font-sans mr-1">
                                  {p.flatElements?.length || 0} blanks
                                </span>
                                <span className="text-[9px] text-industrial-muted font-sans">
                                  Qty:
                                </span>
                                <input 
                                  type="number"
                                  min="0"
                                  value={p.quantity === 0 ? '' : p.quantity}
                                  disabled={isAnalyzing || isUnfolding || isNesting || !isPartActive}
                                  onChange={(e) => handleUpdatePartQuantity(p.id, Number(e.target.value))}
                                  className="w-10 bg-industrial-bg border border-industrial-border px-1 py-0.5 rounded text-center text-[10px] font-mono text-industrial-text outline-none focus:border-industrial-accent disabled:opacity-50"
                                />
                              </div>
                            </div>

                            {/* Child flat elements list */}
                            <div className="flex flex-col gap-1 pl-3.5 mt-1 border-l border-industrial-border/30">
                              {p.flatElements?.map(fe => {
                                const isFeActive = fe.active !== false && isPartActive;
                                const hasDxf = !!fe.dxfPath;
                                return (
                                  <div key={fe.id} className={`p-1.5 rounded border font-mono flex items-center justify-between text-[11px] transition ${
                                    !isFeActive ? 'opacity-40 bg-industrial-darker/20 border-industrial-border/20' : 'bg-industrial-darker/60 border-industrial-border'
                                  }`}>
                                    <div className="flex items-center gap-1.5 min-w-0 flex-1">
                                      <input 
                                        type="checkbox"
                                        checked={fe.active !== false}
                                        disabled={!isPartActive || isAnalyzing || isUnfolding || isNesting}
                                        onChange={() => handleToggleFlatElementActive(p.id, fe.id)}
                                        className="w-3 h-3 rounded border-industrial-border bg-industrial-darker text-industrial-accent accent-industrial-accent cursor-pointer"
                                      />
                                      <div className="flex flex-col min-w-0">
                                        <span className="truncate text-industrial-text text-[10px] font-semibold" title={fe.name}>
                                          ⚡ {fe.baseFace}
                                        </span>
                                        <span className={`text-[8px] font-sans ${hasDxf ? 'text-industrial-success font-semibold' : 'text-industrial-orange font-bold animate-pulse'}`}>
                                          {hasDxf ? '✓ Ready' : '⚠ Needs Flattening'}
                                        </span>
                                      </div>
                                    </div>
                                    
                                    {/* Nesting Group Cycling Badge */}
                                    <button
                                      disabled={!isFeActive || isAnalyzing || isUnfolding || isNesting}
                                      onClick={() => handleCycleFlatElementGroup(p.id, fe.id)}
                                      className={`px-1.5 py-0.5 rounded text-[8px] font-bold font-mono transition border shrink-0 mr-1.5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                                        fe.group === 'A'
                                          ? 'bg-blue-500/20 text-blue-400 border-blue-500/30 hover:bg-blue-500/30'
                                          : fe.group === 'B'
                                          ? 'bg-purple-500/20 text-purple-400 border-purple-500/30 hover:bg-purple-500/30'
                                          : 'bg-industrial-darker text-industrial-muted border-industrial-border hover:bg-industrial-border hover:text-industrial-text'
                                      }`}
                                      title="Click to cycle group: Group A -> Group B -> Independent"
                                    >
                                      {fe.group === 'A' ? 'Grp A' : fe.group === 'B' ? 'Grp B' : 'Indep'}
                                    </button>
                                    
                                    <div className="flex items-center gap-1 shrink-0 ml-1">
                                      <QuantityControl
                                        value={fe.quantity}
                                        isAuto={autoQuantityMap[fe.id] || false}
                                        allowAuto={true}
                                        onToggleAuto={() => {
                                          setAutoQuantityMap(prev => ({
                                            ...prev,
                                            [fe.id]: !prev[fe.id]
                                          }));
                                        }}
                                        disabled={!isFeActive || isAnalyzing || isUnfolding || isNesting}
                                        onUpdate={(qty) => handleUpdateFlatElementQuantity(p.id, fe.id, qty)}
                                      />
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Nesting Metrics embedded if solved */}
                  {nestingPartsCount && nestingSvg && (
                    <div className="flex flex-col gap-2.5 border-t border-industrial-border/60 pt-3 text-[11px]">
                      <h4 className="text-industrial-accent font-bold flex items-center gap-2 text-xs">
                        <Layers size={14} /> NESTING METRICS
                      </h4>
                      <div className="grid grid-cols-2 gap-y-2 text-[10px]">
                        <div className="text-industrial-muted">Material:</div>
                        <div className="text-industrial-text font-semibold text-right">{nestingMaterial}</div>
                        
                        <div className="text-industrial-muted">Sheet Size:</div>
                        <div className="text-industrial-text font-semibold text-right">{formatDimStr(sheetWidth, sheetHeight)}</div>

                        {nestingConfigType === 'sets' && nestingMode === 'auto' && autoFilledSets !== null && (
                          <>
                            <div className="text-industrial-muted">Sets Placed:</div>
                            <div className="text-industrial-text font-bold text-industrial-success text-right">{autoFilledSets} sets</div>
                          </>
                        )}
                        {nestingConfigType === 'sets' && nestingMode === 'fixed' && (
                          <>
                            <div className="text-industrial-muted">Sets Requested:</div>
                            <div className="text-industrial-text font-semibold text-right">{setsToNest} sets</div>
                          </>
                        )}

                        <div className="text-industrial-muted">Total Sheets:</div>
                        <div className="text-industrial-text font-bold text-industrial-accent text-right">{nestedSheets.length}</div>
                        
                        <div className="text-industrial-muted">Active Sheet:</div>
                        <div className="text-industrial-text font-semibold text-right">Sheet {activeSheetIndex + 1}</div>

                        <div className="text-industrial-muted">Sheet Util:</div>
                        <div className="text-industrial-orange font-bold text-right">{nestingUtilization}%</div>

                        <div className="text-industrial-muted font-bold">Nested parts:</div>
                        <div className="text-industrial-text font-bold text-right">{nestingPartsCount.nested} of {nestingPartsCount.total}</div>
                      </div>
                    </div>
                  )}
                </div>

                <div className="text-[10px] text-industrial-muted leading-relaxed border-t border-industrial-border pt-2 italic">
                  Note: The clearance spacing ({partSpacing}mm) and border margin ({borderMargin}mm) can be configured on the left panel.
                </div>
              </div>
            </div>
          )}

        </main>



      </div>

      {/* Floating Detailed Hover Popover */}
      {hoveredPart && (
        <div 
          className="absolute z-50 p-4 bg-industrial-card border-2 border-industrial-accent/80 rounded shadow-xl pointer-events-none font-mono text-[10px] flex flex-col gap-2 max-w-sm text-industrial-text glass-panel-glow"
          style={{ 
            left: `${hoverCoords.x}px`, 
            top: `${Math.min(hoverCoords.y, window.innerHeight - 180)}px` 
          }}
        >
          <div className="text-industrial-accent font-bold border-b border-industrial-border pb-1 text-xs flex items-center gap-1.5">
            <Info size={12} /> {hoveredPart.name}
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 bg-industrial-darker p-2 rounded">
            <div className="text-industrial-muted font-bold">Material:</div>
            <div className="text-right font-bold flex items-center justify-end gap-1" style={{ color: getMaterialColorCss(hoveredPart.materialName || hoveredPart.material) }}>
              <span>{hoveredPart.materialName || hoveredPart.material || 'Mild Steel'}</span>
              <span className="text-[8px] font-normal text-industrial-muted">({hoveredPart.density || 7850}kg/m³)</span>
            </div>

            <div className="text-industrial-muted">Est. Thickness:</div>
            <div className="text-industrial-orange font-bold text-right">{hoveredPart.thickness.toFixed(1)} mm</div>
            
            <div className="text-industrial-muted">Dimensions X:</div>
            <div className="text-right font-semibold">{hoveredPart.dimensions.x.toFixed(1)} mm</div>

            <div className="text-industrial-muted">Dimensions Y:</div>
            <div className="text-right font-semibold">{hoveredPart.dimensions.y.toFixed(1)} mm</div>

            <div className="text-industrial-muted">Dimensions Z:</div>
            <div className="text-right font-semibold">{hoveredPart.dimensions.z.toFixed(1)} mm</div>

            <div className="text-industrial-muted">Volume:</div>
            <div className="text-right">{(hoveredPart.volume / 1000).toFixed(1)} cm³</div>

            <div className="text-industrial-muted font-bold">Total Faces:</div>
            <div className="text-right">{hoveredPart.totalFaces}</div>
          </div>
        </div>
      )}

      {/* Sheet Capacity Exceeded Dialog Modal */}
      {showCapacityModal && capacityModalData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-industrial-bg/85 backdrop-blur-sm p-4 font-mono">
          <div className="bg-industrial-card border border-industrial-border rounded-lg shadow-2xl max-w-md w-full overflow-hidden flex flex-col animate-fade-in text-left">
            {/* Modal Header */}
            <div className="bg-red-950/40 border-b border-red-500/20 px-6 py-4 flex items-center gap-3 text-red-500 text-sm font-bold">
              <AlertTriangle className="animate-pulse" size={20} />
              <span>SHEET STOCK CAPACITY EXCEEDED</span>
            </div>
            
            {/* Modal Content */}
            <div className="p-6 flex flex-col gap-4">
              <p className="text-xs text-industrial-muted leading-relaxed">
                The requested quantity cannot fit on a single sheet. The nesting solver generated <strong className="text-industrial-orange font-semibold">{capacityModalData.requiredSheets} sheets</strong> for these <strong className="text-industrial-accent font-semibold">{capacityModalData.totalParts} part instances</strong>.
              </p>
              
              <div className="flex flex-col gap-3 mt-2">
                {/* Option 1: Spill-over to multiple sheets */}
                <button
                  onClick={handleConfirmMultiSheet}
                  className="flex items-start gap-3 p-3 bg-industrial-darker/60 hover:bg-industrial-darker border border-industrial-border hover:border-industrial-accent rounded text-left transition group cursor-pointer"
                >
                  <Copy size={16} className="text-industrial-accent shrink-0 mt-0.5 group-hover:scale-110 transition" />
                  <div className="flex flex-col gap-0.5">
                    <span className="text-xs font-bold text-industrial-text">Spill Over to Multiple Sheets</span>
                    <span className="text-[10px] text-industrial-muted leading-relaxed">
                      Nests the parts across <strong className="text-industrial-accent font-bold">{capacityModalData.requiredSheets} separate sheets</strong> of {sheetWidth}x{sheetHeight} mm.
                    </span>
                  </div>
                </button>

                {/* Option 2: Increase Sheet Size (if recommended size is available) */}
                {capacityModalData.largerSizeRecommended ? (
                  <button
                    onClick={() => handleConfirmUpsizeSheet(
                      capacityModalData.largerSizeRecommended!.width,
                      capacityModalData.largerSizeRecommended!.height,
                      capacityModalData.largerSizeRecommended!.name
                    )}
                    className="flex items-start gap-3 p-3 bg-industrial-darker/60 hover:bg-industrial-darker border border-industrial-border hover:border-industrial-orange rounded text-left transition group cursor-pointer"
                  >
                    <Maximize2 size={16} className="text-industrial-orange shrink-0 mt-0.5 group-hover:scale-110 transition" />
                    <div className="flex flex-col gap-0.5">
                      <span className="text-xs font-bold text-industrial-text">Increase Sheet Size</span>
                      <span className="text-[10px] text-industrial-muted leading-relaxed">
                        Upsize your sheet stock to <strong className="text-industrial-orange font-bold">{capacityModalData.largerSizeRecommended.name}</strong> to fit all parts on a single sheet.
                      </span>
                    </div>
                  </button>
                ) : (
                  <div className="p-3 bg-industrial-darker/20 border border-dashed border-industrial-border/60 rounded text-[10px] text-industrial-muted text-center leading-relaxed">
                    Already at maximum standard sheet size ({STANDARD_SHEET_SIZES[STANDARD_SHEET_SIZES.length - 1].width}x{STANDARD_SHEET_SIZES[STANDARD_SHEET_SIZES.length - 1].height} mm). Upsize option unavailable.
                  </div>
                )}
              </div>
            </div>

            {/* Modal Footer */}
            <div className="bg-industrial-darker/80 border-t border-industrial-border px-6 py-3.5 flex justify-end gap-3 shrink-0">
              <button
                onClick={handleCancelCapacityModal}
                className="px-4 py-1.5 bg-industrial-card hover:bg-industrial-border border border-industrial-border hover:text-white rounded text-xs text-industrial-muted transition cursor-pointer"
              >
                Cancel & Revert Qty
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Keyboard Shortcuts Cheat Sheet Modal */}
      {showShortcutsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-industrial-bg/85 backdrop-blur-sm p-4 font-mono select-text">
          <div className="bg-industrial-card border border-industrial-border rounded-lg shadow-2xl max-w-lg w-full overflow-hidden flex flex-col animate-fade-in text-left">
            <div className="bg-industrial-darker border-b border-industrial-border px-6 py-4 flex items-center justify-between text-industrial-accent text-sm font-bold">
              <span className="flex items-center gap-2">⌨️ KEYBOARD SHORTCUTS CHEAT SHEET</span>
              <button 
                onClick={() => setShowShortcutsModal(false)}
                className="text-industrial-muted hover:text-white font-extrabold text-base cursor-pointer"
                title="Close modal"
              >
                &times;
              </button>
            </div>
            
            <div className="p-6 flex flex-col gap-3 text-xs leading-relaxed">
              <div className="grid grid-cols-2 gap-2 bg-industrial-darker p-3 rounded border border-industrial-border/60">
                <span className="text-industrial-muted">Cycle Workspace Tabs</span>
                <kbd className="px-2 py-0.5 bg-industrial-card border border-industrial-border rounded font-bold text-industrial-accent text-[10px] justify-self-end">Space</kbd>
                
                <span className="text-industrial-muted">Toggle Full Screen View</span>
                <kbd className="px-2 py-0.5 bg-industrial-card border border-industrial-border rounded font-bold text-industrial-orange text-[10px] justify-self-end">Alt + F</kbd>
                
                <span className="text-industrial-muted">Export Active DXF Layout</span>
                <kbd className="px-2 py-0.5 bg-industrial-card border border-industrial-border rounded font-bold text-industrial-accent text-[10px] justify-self-end">Ctrl + E / Cmd + E</kbd>
                
                <span className="text-industrial-muted">Reset 3D Viewport Orbit</span>
                <kbd className="px-2 py-0.5 bg-industrial-card border border-industrial-border rounded font-bold text-industrial-text text-[10px] justify-self-end">R</kbd>
                
                <span className="text-industrial-muted">Open Keyboard Shortcuts</span>
                <kbd className="px-2 py-0.5 bg-industrial-card border border-industrial-border rounded font-bold text-industrial-accent text-[10px] justify-self-end">? / Shift + /</kbd>
                
                <span className="text-industrial-muted">Close Floating Modals / Windows</span>
                <kbd className="px-2 py-0.5 bg-industrial-card border border-industrial-border rounded font-bold text-red-400 text-[10px] justify-self-end">Escape</kbd>
              </div>

              <div className="text-[10px] text-industrial-muted italic mt-1">
                Note: Keyboard shortcuts are paused when typing into numerical inputs or text fields.
              </div>
            </div>

            <div className="bg-industrial-darker/80 border-t border-industrial-border px-6 py-3 flex justify-end shrink-0">
              <button
                onClick={() => setShowShortcutsModal(false)}
                className="px-4 py-1.5 bg-industrial-accent hover:bg-industrial-accent/80 text-industrial-bg rounded font-bold text-xs transition cursor-pointer"
              >
                Close Shortcuts
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Precision K-Factor Calibration Solver Modal */}
      {showCalibrationModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-industrial-bg/85 backdrop-blur-sm p-4 font-mono select-text">
          <div className="bg-industrial-card border border-industrial-border rounded-lg shadow-2xl max-w-lg w-full overflow-hidden flex flex-col animate-fade-in text-left">
            {/* Header */}
            <div className="bg-industrial-darker border-b border-industrial-border px-5 py-3.5 flex items-center justify-between text-industrial-accent text-sm font-bold">
              <span className="flex items-center gap-2">🎯 PRECISION K-FACTOR CALIBRATION SOLVER</span>
              <button
                onClick={() => setShowCalibrationModal(false)}
                className="text-industrial-muted hover:text-white font-extrabold text-base cursor-pointer"
                title="Close modal"
              >
                &times;
              </button>
            </div>

            {/* Content */}
            <div className="p-5 flex flex-col gap-4 text-xs">
              {/* Part Specs Card */}
              {selectedPart && (
                <div className="bg-industrial-darker p-3 rounded border border-industrial-border flex flex-col gap-1.5">
                  <div className="flex justify-between items-center text-industrial-text font-bold">
                    <span>Part: {selectedPart.name}</span>
                    <span className="text-industrial-accent font-mono">T = {selectedPart.thickness.toFixed(2)} mm</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-[11px] text-industrial-muted pt-1 border-t border-industrial-border/50">
                    <div>Bends (N): <span className="text-industrial-text font-bold">{selectedPart.bendSummary?.bend_count ?? 'N/A'}</span></div>
                    <div>Avg Radius (R): <span className="text-industrial-text font-bold">{(selectedPart.bendSummary?.avg_radius ?? selectedPart.bendRadius ?? 1.0).toFixed(2)} mm</span></div>
                    <div>Straight Sum (ΣL): <span className="text-industrial-text font-bold">{(selectedPart.bendSummary?.straight_sum ?? selectedPart.dimensions.x).toFixed(2)} mm</span></div>
                    <div>Current Unfolded Flat: <span className="text-industrial-text font-bold">{(selectedPart.flatElements?.[0]?.width || selectedPart.dimensions.x).toFixed(2)} mm</span></div>
                  </div>
                </div>
              )}

              {/* Target Measured Flat Input */}
              <div className="flex flex-col gap-1.5">
                <label className="text-industrial-text font-bold text-xs flex justify-between">
                  <span>Target Reference Flat Dimension (L_target in mm):</span>
                  <span className="text-[10px] text-industrial-muted font-normal">Physical sample / CAD table</span>
                </label>
                <div className="flex gap-2">
                  <input
                    type="number"
                    step="0.001"
                    value={targetFlatLengthInput}
                    onChange={(e) => setTargetFlatLengthInput(e.target.value)}
                    placeholder="e.g. 231.048"
                    className="flex-1 bg-industrial-darker border border-industrial-border px-3 py-2 rounded text-sm font-mono text-industrial-accent font-bold focus:border-industrial-accent outline-none"
                  />
                  <button
                    type="button"
                    onClick={handleCalibrateKFactor}
                    disabled={isCalibrating || !targetFlatLengthInput}
                    className="px-4 py-2 bg-industrial-accent hover:bg-industrial-accent/90 disabled:opacity-50 text-industrial-bg font-bold rounded text-xs transition cursor-pointer flex items-center gap-1 font-mono"
                  >
                    {isCalibrating ? 'SOLVING...' : 'CALIBRATE'}
                  </button>
                </div>
              </div>

              {/* Error Alert */}
              {calibrationError && (
                <div className="bg-red-500/10 border border-red-500/40 text-red-400 p-2.5 rounded text-[11px] flex items-center gap-2">
                  <AlertTriangle size={14} className="shrink-0" />
                  <span>{calibrationError}</span>
                </div>
              )}

              {/* Calibrated Result Panel */}
              {calibratedKResult !== null && (
                <div className="bg-industrial-accent/10 border border-industrial-accent/40 p-3.5 rounded flex flex-col gap-2 animate-fade-in">
                  <div className="flex justify-between items-center">
                    <span className="text-industrial-muted text-xs uppercase tracking-wider font-bold">Reverse-Solved K-Factor</span>
                    <span className="text-xl font-bold font-mono text-industrial-accent">
                      K = {calibratedKResult.toFixed(4)}
                    </span>
                  </div>
                  <p className="text-[10px] text-industrial-muted leading-relaxed">
                    Exact neutral axis offset ratio derived using closed-form linear back-solver. Precision: 4 decimal places (10⁻⁴).
                  </p>
                </div>
              )}
            </div>

            {/* Modal Actions */}
            <div className="bg-industrial-darker/80 border-t border-industrial-border px-5 py-3 flex items-center justify-end gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setShowCalibrationModal(false)}
                className="px-3.5 py-1.5 bg-industrial-dark hover:bg-industrial-border text-industrial-muted hover:text-white rounded font-bold text-xs transition cursor-pointer"
              >
                Cancel
              </button>
              {calibratedKResult !== null && (
                <>
                  <button
                    type="button"
                    onClick={() => handleApplyCalibratedKFactor(true)}
                    className="px-3.5 py-1.5 bg-industrial-dark border border-industrial-accent/50 text-industrial-accent hover:bg-industrial-accent/10 rounded font-bold text-xs transition cursor-pointer"
                  >
                    Set as Material Default
                  </button>
                  <button
                    type="button"
                    onClick={() => handleApplyCalibratedKFactor(false)}
                    className="px-4 py-1.5 bg-industrial-accent hover:bg-industrial-accent/90 text-industrial-bg rounded font-bold text-xs transition cursor-pointer shadow"
                  >
                    Apply to Part
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* CADANEST Documentation & Guide Modal */}
      {showDocModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-industrial-bg/85 backdrop-blur-sm p-4 font-mono select-text">
          <div className="bg-industrial-card border border-industrial-border rounded-lg shadow-2xl max-w-2xl w-full overflow-hidden flex flex-col animate-fade-in text-left">
            <div className="bg-industrial-darker border-b border-industrial-border px-6 py-3.5 flex items-center justify-between text-industrial-accent text-sm font-bold">
              <span className="flex items-center gap-2">📖 CADANEST DOCUMENTATION & USER MANUAL</span>
              <button 
                onClick={() => setShowDocModal(false)}
                className="text-industrial-muted hover:text-white font-extrabold text-base cursor-pointer"
                title="Close documentation modal"
              >
                &times;
              </button>
            </div>

            {/* Modal Tabs */}
            <div className="flex border-b border-industrial-border bg-industrial-darker/60 px-6 gap-2 pt-2">
              <button
                onClick={() => setDocTab('userguide')}
                className={`px-3 py-1.5 text-xs font-bold rounded-t border-t border-l border-r transition cursor-pointer ${
                  docTab === 'userguide' ? 'bg-industrial-card border-industrial-border text-industrial-accent' : 'bg-transparent border-transparent text-industrial-muted hover:text-industrial-text'
                }`}
              >
                🚀 Quick Start
              </button>
              <button
                onClick={() => setDocTab('unfolding')}
                className={`px-3 py-1.5 text-xs font-bold rounded-t border-t border-l border-r transition cursor-pointer ${
                  docTab === 'unfolding' ? 'bg-industrial-card border-industrial-border text-industrial-orange' : 'bg-transparent border-transparent text-industrial-muted hover:text-industrial-text'
                }`}
              >
                📐 Unfolding & K-Factor
              </button>
              <button
                onClick={() => setDocTab('nesting')}
                className={`px-3 py-1.5 text-xs font-bold rounded-t border-t border-l border-r transition cursor-pointer ${
                  docTab === 'nesting' ? 'bg-industrial-card border-industrial-border text-industrial-accent' : 'bg-transparent border-transparent text-industrial-muted hover:text-industrial-text'
                }`}
              >
                📦 2D Irregular Nesting
              </button>
            </div>
            
            <div className="p-6 flex flex-col gap-4 max-h-[440px] overflow-y-auto scrollbar-custom text-xs leading-relaxed text-industrial-muted">
              {docTab === 'userguide' && (
                <div className="flex flex-col gap-3">
                  <h4 className="text-industrial-text font-bold text-sm">Step 1: Import STEP 3D Models or 2D DXF Profiles</h4>
                  <p>Drag and drop <code>.step</code>, <code>.stp</code>, or <code>.dxf</code> files directly onto the app window, or click <strong>+ Import STEP / DXF</strong>. DXF files bypass 3D geometry analysis and are directly available for nesting.</p>
                  
                  <h4 className="text-industrial-text font-bold text-sm">Step 2: Unfold Sheet Metal Models</h4>
                  <p>Select a 3D model in the Part Library, click a planar face to set the Base Flange, adjust the <strong>K-Factor</strong> slider, and click <strong>⚡ UNFOLD FLAT BLANK</strong> to generate true flat patterns.</p>
                  
                  <h4 className="text-industrial-text font-bold text-sm">Step 3: Configure Quantities & Nesting Strategy</h4>
                  <p>Set individual quantities for each flat blank using the direct quantity input or <code>+</code> / <code>-</code> buttons. Select <strong>Auto-Fill Sheet</strong> to maximize utilization or <strong>Fixed Production Qty</strong> for exact part sets.</p>

                  <h4 className="text-industrial-text font-bold text-sm">Step 4: Execute & Export CNC DXF Layouts</h4>
                  <p>Click <strong>🚀 Start Nesting Solver</strong> to generate irregular 2D sheet nesting layouts. Click <strong>Export Options</strong> to download 2D DXF contours, PDF Fabrication Reports, or NC Laser G-Code.</p>
                </div>
              )}

              {docTab === 'unfolding' && (
                <div className="flex flex-col gap-3">
                  <h4 className="text-industrial-orange font-bold text-sm">K-Factor Formula & Bend Allowance Calculation</h4>
                  <p>CADANEST uses Open CASCADE (OCCT) topology analysis to unroll sheet metal bends according to neutral axis displacement:</p>
                  <pre className="bg-industrial-darker p-3 rounded border border-industrial-border text-[11px] text-industrial-text font-mono">
Bend Allowance (BA) = (π / 180) × Angle × (Radius + K-Factor × Thickness)
                  </pre>
                  
                  <h4 className="text-industrial-text font-bold text-sm">Selecting Base Flanges</h4>
                  <p>If a STEP file contains multiple planar faces, click any plane in the 3D viewer or Part Library face sub-list to assign it as the root base flange for unfolding.</p>
                </div>
              )}

              {docTab === 'nesting' && (
                <div className="flex flex-col gap-3">
                  <h4 className="text-industrial-accent font-bold text-sm">Irregular Shape Packing & Clearance Spacing</h4>
                  <p>The nesting solver calculates true irregular polygon outer contours, inner cutouts, and rotation steps to optimize sheet yield:</p>
                  <ul className="list-disc pl-5 flex flex-col gap-1.5">
                    <li><strong>Kerf / Part Clearance</strong>: Defines minimum clearance between adjacent nested parts to account for laser beam width or plasma torch diameter.</li>
                    <li><strong>Sheet Border Margin</strong>: Defines safety margin around outer perimeter of the sheet stock.</li>
                    <li><strong>Grain Alignment Constraints</strong>: Restricts part rotation to 0° (fixed grain), 180° steps, or free (0°, 90°, 180°, 270°).</li>
                  </ul>
                </div>
              )}
            </div>

            <div className="bg-industrial-darker/80 border-t border-industrial-border px-6 py-3.5 flex justify-end shrink-0">
              <button
                onClick={() => setShowDocModal(false)}
                className="px-4 py-1.5 bg-industrial-accent hover:bg-industrial-accent/80 text-industrial-bg rounded font-bold text-xs transition cursor-pointer"
              >
                Close Documentation
              </button>
            </div>
          </div>
        </div>
      )}

      {/* About & License Credits Modal */}
      {showAboutModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-industrial-bg/85 backdrop-blur-sm p-4 font-mono select-text">
          <div className="bg-industrial-card border border-industrial-border rounded-lg shadow-2xl max-w-xl w-full overflow-hidden flex flex-col animate-fade-in text-left">
            {/* Modal Header */}
            <div className="bg-industrial-darker border-b border-industrial-border px-6 py-4 flex items-center justify-between text-industrial-accent text-sm font-bold">
              <span className="flex items-center gap-2">ℹ ABOUT & COMPLIANCE CREDITS</span>
              <button 
                onClick={() => setShowAboutModal(false)}
                className="text-industrial-muted hover:text-white font-extrabold text-base cursor-pointer"
                title="Close modal"
              >
                &times;
              </button>
            </div>
            
            {/* Modal Content */}
            <div className="p-6 flex flex-col gap-4 max-h-[420px] overflow-y-auto scrollbar-custom text-xs leading-relaxed text-industrial-muted">
              <div>
                <h4 className="text-industrial-text font-bold uppercase mb-1">Open CASCADE Technology (OCCT)</h4>
                <p>
                  This software is powered by Open CASCADE Technology (OCCT) under the terms of the GNU LGPL version 2.1 with exceptions. You can download or study the source code and modifications of this library at the official Open CASCADE repository.
                </p>
              </div>

              <div>
                <h4 className="text-industrial-text font-bold uppercase mb-1">Three.js (WebGL 3D Viewer)</h4>
                <p>
                  MIT License. Copyright © 2010-2026 three.js authors. Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files.
                </p>
              </div>

              <div>
                <h4 className="text-industrial-text font-bold uppercase mb-1">Geometric Helpers & DXF Engines</h4>
                <p>
                  Includes **ezdxf** (MIT License, Copyright © Manfred Moitzi) and **Shapely** (BSD 3-Clause License, Copyright © Sean Gillies).
                </p>
              </div>

              <div className="border-t border-industrial-border/60 pt-3 mt-1">
                <h4 className="text-industrial-orange font-bold uppercase mb-1.5 flex items-center gap-1.5">
                  ⚠️ LIABILITY DISCLAIMER & COMPLIANCE NOTICE
                </h4>
                <p className="bg-industrial-orange/5 border border-industrial-orange/20 p-3 rounded text-[11px] text-industrial-orange italic">
                  "Flattening and nesting calculations (K-Factor, bend allowances, and nesting efficiency) are estimates. Operators must verify DXF contours and G-code before cutting. The software author is not liable for material waste or machine damage."
                </p>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="bg-industrial-darker/80 border-t border-industrial-border px-6 py-3.5 flex justify-end shrink-0">
              <button
                onClick={() => setShowAboutModal(false)}
                className="px-4 py-1.5 bg-industrial-accent hover:bg-industrial-accent/80 text-industrial-bg rounded font-bold text-xs transition cursor-pointer"
              >
                Close Credits
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Floating Operator Logs Window */}
      {showLogsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-industrial-bg/85 backdrop-blur-sm p-4 font-mono">
          <div className="bg-industrial-card border border-industrial-border rounded-lg shadow-2xl max-w-2xl w-full h-[500px] overflow-hidden flex flex-col animate-fade-in text-left">
            {/* Modal Header */}
            <div className="bg-industrial-darker border-b border-industrial-border px-5 py-3.5 flex items-center justify-between text-industrial-accent text-xs font-bold select-none shrink-0">
              <span className="flex items-center gap-2">📟 OPERATOR LOGS TERMINAL</span>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => {
                    const logText = consoleLogs.join('\n');
                    navigator.clipboard.writeText(logText);
                    alert("Logs copied to clipboard!");
                  }}
                  className="px-2 py-0.5 bg-industrial-card hover:bg-industrial-border border border-industrial-border rounded text-[9px] text-industrial-text hover:text-white transition cursor-pointer"
                  title="Copy logs to clipboard"
                >
                  Copy
                </button>
                <button
                  onClick={() => setConsoleLogs(['Log buffer cleared.'])}
                  className="px-2 py-0.5 bg-industrial-card hover:bg-industrial-border border border-industrial-border rounded text-[9px] text-industrial-text hover:text-white transition cursor-pointer"
                  title="Clear log buffer"
                >
                  Clear
                </button>
                <button
                  onClick={() => {
                    const logWindow = window.open("", "_blank", "width=800,height=600,menubar=no,toolbar=no,location=no,status=no");
                    if (logWindow) {
                      logWindow.document.title = "Cadanest - Operator Logs";
                      logWindow.document.body.style.backgroundColor = "#0F111E";
                      logWindow.document.body.style.color = "#F1F5F9";
                      logWindow.document.body.style.fontFamily = "monospace";
                      logWindow.document.body.style.padding = "20px";
                      logWindow.document.body.innerHTML = `
                        <h3 style="border-bottom: 1px solid #262B44; padding-bottom: 8px; margin-top: 0; color: #33A3FF; font-size: 14px;">OPERATOR LOGS RECORD</h3>
                        <pre style="white-space: pre-wrap; font-size: 11px; line-height: 1.6;">${consoleLogs.join('\n')}</pre>
                      `;
                    }
                  }}
                  className="px-2 py-0.5 bg-industrial-card hover:bg-industrial-border border border-industrial-border rounded text-[9px] text-industrial-orange hover:text-white transition cursor-pointer"
                  title="Open logs in a separate browser window"
                >
                  Tear Off ↗
                </button>
                <button 
                  onClick={() => setShowLogsModal(false)}
                  className="text-industrial-muted hover:text-white font-extrabold text-sm ml-1 cursor-pointer"
                  title="Close logs window"
                >
                  &times;
                </button>
              </div>
            </div>
            
            {/* Logs Viewport */}
            <div className="flex-1 p-4 overflow-y-auto font-mono text-[11px] text-industrial-muted/95 flex flex-col gap-1.5 scrollbar-custom bg-industrial-darker/90 select-text">
              {consoleLogs.map((log, i) => (
                <div key={i} className="leading-5 whitespace-pre-wrap border-b border-industrial-border/10 pb-1">{log}</div>
              ))}
            </div>
            
            {/* Modal Footer */}
            <div className="bg-industrial-darker/80 border-t border-industrial-border px-5 py-3 flex justify-between items-center shrink-0">
              <span className="text-[9px] text-industrial-muted">Buffer size: {consoleLogs.length} entries</span>
              <button
                onClick={() => setShowLogsModal(false)}
                className="px-4 py-1.5 bg-industrial-accent hover:bg-industrial-accent/80 text-industrial-bg rounded font-bold text-xs transition cursor-pointer"
              >
                Close Logs Window
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Full-Screen Visualizer Overlays */}
      {fullScreenView === '3d' && parts.length > 0 && (
        <div className="fixed inset-0 z-[100] bg-industrial-bg w-screen h-screen flex flex-col p-4 font-mono text-xs overflow-hidden">
          <div className="flex items-center justify-between border-b border-industrial-border pb-3 mb-3 shrink-0">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 bg-industrial-accent rounded-full animate-ping"></span>
              <span className="font-bold text-sm text-industrial-accent uppercase tracking-wider">
                {combined3D ? `3D COMBINED SCENE - FULL SCREEN MODE (${parts.length} PARTS)` : `3D SOURCE VIEWER - FULL SCREEN MODE (${selectedPart?.name})`}
              </span>
            </div>
            <button
              onClick={() => setFullScreenView(null)}
              className="px-3.5 py-1.5 bg-red-600 hover:bg-red-500 text-white rounded font-bold transition flex items-center gap-1.5 shadow-md cursor-pointer text-xs"
              title="Close Full Screen View (ESC)"
            >
              <span className="font-extrabold text-sm">✕</span> Exit Full Screen
            </button>
          </div>
          <div className="flex-1 min-h-0 relative">
            <Model3DViewer 
              onToggleFullScreen={() => setFullScreenView(null)}
              parts={viewerParts} 
              combinedView={combined3D} 
              activeFace={selectedPart?.baseFace || null}
              faces={selectedPart?.faces || []}
              hoveredFaceName={hoveredFaceName}
              onFaceClick={(faceName) => selectedPart && handleUpdatePartBaseFace(selectedPart.id, faceName)}
              onFaceHover={setHoveredFaceName}
              onSetBaseFace={(faceName) => selectedPart && handleSetSoleBaseFace(selectedPart.id, faceName)}
              onAddBaseFace={(faceName) => selectedPart && handleUpdatePartBaseFace(selectedPart.id, faceName)}
              onRemoveBaseFace={(faceName) => selectedPart && handleUpdatePartBaseFace(selectedPart.id, faceName)}
              onClearBaseFace={() => selectedPart && handleClearBaseFaces(selectedPart.id)}
              onSelectPart={(partId) => setSelectedPartId(partId)}
              selectedPartId={selectedPartId}
              themeMode={themeMode}
            />
          </div>
        </div>
      )}

      {fullScreenView === 'flat' && (parts.length > 0 || selectedPart) && (
        <div className="fixed inset-0 z-[100] bg-industrial-bg w-screen h-screen flex flex-col p-4 font-mono text-xs overflow-hidden">
          <div className="flex items-center justify-between border-b border-industrial-border pb-3 mb-3 shrink-0">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 bg-industrial-orange rounded-full animate-ping"></span>
              <span className="font-bold text-sm text-industrial-orange uppercase tracking-wider">
                {combinedFlat ? `2D COMBINED FLAT SCENE - FULL SCREEN MODE (${parts.length} BLANKS)` : `FLAT PREVIEWER - FULL SCREEN MODE (${selectedPart?.name})`}
              </span>
            </div>
            <button
              onClick={() => setFullScreenView(null)}
              className="px-3.5 py-1.5 bg-red-600 hover:bg-red-500 text-white rounded font-bold transition flex items-center gap-1.5 shadow-md cursor-pointer text-xs"
              title="Close Full Screen View (ESC)"
            >
              <span className="font-extrabold text-sm">✕</span> Exit Full Screen
            </button>
          </div>
          <div className="flex-1 min-h-0 relative">
            {combinedFlat ? (
              <FlatPreviewer 
                svgContent={combinedSvgContent} 
                baseFace="Combined Flat Scene" 
                thickness={parts[0]?.thickness || DEFAULT_THICKNESS_MM} 
                onToggleFullScreen={() => setFullScreenView(null)}
                themeMode={themeMode}
              />
            ) : selectedPart ? (
              <FlatPreviewer 
                svgContent={selectedPart.flatElements?.find(fe => fe.id === selectedFlatElementId)?.svgContent || selectedPart.flatElements?.[0]?.svgContent || null} 
                baseFace={selectedPart.flatElements?.find(fe => fe.id === selectedFlatElementId)?.baseFace || selectedPart.flatElements?.[0]?.baseFace || null} 
                thickness={selectedPart.thickness} 
                onToggleFullScreen={() => setFullScreenView(null)}
                onRemoveComponent={(faceName) => {
                  handleUpdatePartBaseFace(selectedPart.id, faceName);
                  setSelectedFlatElementId(null);
                }}
                themeMode={themeMode}
              />
            ) : null}
          </div>
        </div>
      )}

      {/* Advanced Settings Modal */}
      {showAdvancedModal && (
        <div className="fixed inset-0 z-[110] bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 font-mono text-xs animate-fade-in select-none">
          <div className="bg-industrial-card border border-industrial-border rounded-xl shadow-2xl w-full max-w-md p-6 flex flex-col gap-5 text-left">
            <div className="flex items-center justify-between border-b border-industrial-border pb-3">
              <div className="flex items-center gap-2">
                <span className="font-bold text-sm text-industrial-accent uppercase tracking-wider flex items-center gap-2">
                  ⚙️ ADVANCED FLATTENING & K-FACTOR CONFIG
                </span>
              </div>
              <button
                onClick={() => setShowAdvancedModal(false)}
                className="text-industrial-muted hover:text-white text-lg font-bold px-2 py-0.5 rounded transition cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="flex flex-col gap-4">
              {/* CAD System Presets Selection */}
              <div className="flex flex-col gap-2 bg-industrial-darker/70 p-3 rounded border border-industrial-border">
                <span className="font-bold text-industrial-accent text-xs">CAD Software & Standard Presets:</span>
                <select
                  value={selectedPart?.kFactorPreset || 'solidworks_default'}
                  disabled={isAnalyzing || isUnfolding || isNesting}
                  onChange={(e) => handleSelectKFactorMode('preset', e.target.value)}
                  className="w-full bg-industrial-dark border border-industrial-border px-2 py-1.5 rounded text-xs font-mono text-industrial-text focus:border-industrial-accent outline-none cursor-pointer"
                >
                  {CAD_PRESETS_CATALOG.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.label} (K = {p.value.toFixed(6)})
                    </option>
                  ))}
                </select>
                {selectedPart?.kFactorPreset && (
                  <span className="text-[10px] text-industrial-muted italic">
                    {CAD_PRESETS_CATALOG.find(p => p.id === selectedPart.kFactorPreset)?.description}
                  </span>
                )}
              </div>

              {/* PTC Creo Y-Factor Interactive Converter */}
              <div className="flex flex-col gap-2 bg-industrial-darker/70 p-3 rounded border border-industrial-border">
                <div className="flex justify-between items-center">
                  <span className="font-bold text-industrial-text text-xs">PTC Creo Y-Factor Converter:</span>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="number"
                      min="0.10"
                      max="1.50"
                      step="0.0001"
                      placeholder="e.g. 0.5000"
                      value={selectedPart?.yFactor ?? 0.5000}
                      disabled={isAnalyzing || isUnfolding || isNesting}
                      onChange={(e) => handleSelectKFactorMode('y_factor', Number(e.target.value))}
                      className="w-24 px-1.5 py-0.5 text-xs text-center font-mono bg-industrial-dark border border-industrial-border rounded text-industrial-accent font-bold outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => handleSelectKFactorMode('y_factor', selectedPart?.yFactor ?? 0.5000)}
                      className="px-2 py-0.5 bg-industrial-accent text-industrial-bg rounded text-[10px] font-bold cursor-pointer"
                    >
                      APPLY Y
                    </button>
                  </div>
                </div>
                <span className="text-[10px] text-industrial-muted italic">
                  Formula: K = Y × (2 / π). (e.g. Creo Y = 0.500000 → K = 0.318310).
                </span>
              </div>

              {/* K-Factor Setting with 6-decimal precision */}
              <div className="flex flex-col gap-2">
                <div className="flex justify-between items-center">
                  <span className="font-bold text-industrial-text">Exact Neutral Axis K-Factor:</span>
                  <input
                    type="number"
                    min="0.10"
                    max="0.90"
                    step="0.000001"
                    value={selectedPart ? selectedPart.kfactor : (parts[0]?.kfactor ?? 0.44)}
                    disabled={isAnalyzing || isUnfolding || isNesting}
                    onChange={(e) => {
                      const val = Number(e.target.value);
                      if (selectedPart) {
                        handleUpdatePartKfactor(selectedPart.id, val);
                      } else {
                        setParts(prev => prev.map(p => ({ ...p, kfactor: val })));
                      }
                    }}
                    className="w-28 px-1.5 py-0.5 text-xs text-center font-mono bg-industrial-darker border border-industrial-border rounded text-industrial-accent font-bold outline-none"
                  />
                </div>
                <input
                  type="range"
                  min="0.10"
                  max="0.90"
                  step="0.0001"
                  value={selectedPart ? selectedPart.kfactor : (parts[0]?.kfactor ?? 0.44)}
                  disabled={isAnalyzing || isUnfolding || isNesting}
                  onChange={(e) => {
                    const val = Number(e.target.value);
                    if (selectedPart) {
                      handleUpdatePartKfactor(selectedPart.id, val);
                    } else {
                      setParts(prev => prev.map(p => ({ ...p, kfactor: val })));
                    }
                  }}
                  className="w-full h-1.5 bg-industrial-darker rounded-lg appearance-none cursor-pointer accent-industrial-accent"
                />
                <span className="text-[10px] text-industrial-muted italic leading-relaxed">
                  Specifies the exact neutral bending line ratio (t/T) up to 6 decimal places to eliminate human typing error.
                </span>
              </div>

              {/* Mirror Flat Pattern Toggle */}
              <div className="flex flex-col gap-2 pt-3 border-t border-industrial-border/60">
                <div className="flex justify-between items-center">
                  <span className="font-bold text-industrial-text">Mirror Flat DXF Output:</span>
                  <button
                    type="button"
                    onClick={() => {
                      if (selectedPart) {
                        setParts(prev => prev.map(p => p.id === selectedPart.id ? { ...p, mirror: !p.mirror } : p));
                      } else {
                        setParts(prev => prev.map(p => ({ ...p, mirror: !p.mirror })));
                      }
                    }}
                    className={`px-3 py-1 rounded text-xs font-bold font-mono transition cursor-pointer ${
                      (selectedPart?.mirror ?? false)
                        ? 'bg-industrial-accent text-industrial-bg shadow-sm'
                        : 'bg-industrial-darker border border-industrial-border text-industrial-muted'
                    }`}
                  >
                    {(selectedPart?.mirror ?? false) ? 'MIRRORED (ON)' : 'STANDARD (OFF)'}
                  </button>
                </div>
                <span className="text-[10px] text-industrial-muted italic leading-relaxed">
                  Flips the flat pattern orientation across the Y axis for bottom-side laser cutting or reverse press brake bending.
                </span>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-industrial-border">
              <button
                type="button"
                onClick={() => setShowAdvancedModal(false)}
                className="px-5 py-2 bg-industrial-accent hover:bg-industrial-accent/90 text-industrial-bg font-bold rounded text-xs transition cursor-pointer shadow-md"
              >
                DONE / CLOSE SETTINGS
              </button>
            </div>
          </div>
        </div>
      )}

      {fullScreenView === 'nesting' && nestingSvg && (
        <div className="fixed inset-0 z-[100] bg-industrial-bg w-screen h-screen flex flex-col p-4 font-mono text-xs overflow-hidden">
          <div className="flex items-center justify-between border-b border-industrial-border pb-3 mb-3 shrink-0">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 bg-industrial-accent rounded-full animate-ping"></span>
                <span className="font-bold text-sm text-industrial-accent uppercase tracking-wider">NESTING SHEET VIEW - FULL SCREEN MODE</span>
              </div>
              <span className="text-industrial-muted">|</span>
              <div className="flex items-center gap-3">
                <span>Active: <strong className="text-industrial-accent">Sheet {activeSheetIndex + 1} of {nestedSheets.length}</strong></span>
                <span>Utilization: <strong className="text-industrial-orange">{nestingUtilization}%</strong></span>
              </div>
            </div>
            <button
              onClick={() => setFullScreenView(null)}
              className="px-3.5 py-1.5 bg-red-600 hover:bg-red-500 text-white rounded font-bold transition flex items-center gap-1.5 shadow-md cursor-pointer text-xs"
              title="Close Full Screen View (ESC)"
            >
              <span className="font-extrabold text-sm">✕</span> Exit Full Screen
            </button>
          </div>
          <div className="flex-1 min-h-0 relative">
            <FlatPreviewer 
              svgContent={nestingSvg} 
              baseFace="Combined Sheet Layout" 
              thickness={parts[0]?.thickness || DEFAULT_THICKNESS_MM} 
              is3dView={false}
              title={`Nesting Sheet ${activeSheetIndex + 1} (${nestingUtilization}% Eff.)`}
              onToggleFullScreen={() => setFullScreenView(null)}
              themeMode={themeMode}
            />
          </div>
        </div>
      )}

      {/* Sleek Real-Time Progress Indicator Toast with Live Time & ETA in Bottom-Left */}
      {(isNesting || isAnalyzing || isUnfolding) && (
        <div className="fixed bottom-6 left-6 z-50 font-mono text-xs animate-fade-in">
          <div className="bg-industrial-card/95 border border-industrial-accent/60 rounded-xl px-4 py-3 shadow-2xl flex flex-col gap-2 text-industrial-text min-w-[340px] backdrop-blur-md">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-industrial-accent animate-ping shrink-0" />
                <span className="font-bold text-industrial-accent text-xs">
                  {isNesting ? '🚀 Nesting Solver Active' : isUnfolding ? '⚡ Unfolding Sheet Metal' : '🔍 STEP Topology Analysis'}
                </span>
              </div>
              <span className="font-bold text-emerald-400 font-mono text-xs">
                {nestingProgress?.pct !== undefined ? `${nestingProgress.pct}%` : 'Working...'}
              </span>
            </div>

            <div className="w-full h-2 bg-industrial-darker rounded-full overflow-hidden border border-industrial-border">
              <div 
                className="h-full bg-gradient-to-r from-industrial-accent via-emerald-400 to-industrial-accent transition-all duration-200 rounded-full shadow-md"
                style={{ width: `${Math.max(6, nestingProgress?.pct || (isNesting ? 30 : 60))}%` }}
              />
            </div>

            <div className="flex items-center justify-between text-[10px] text-industrial-muted">
              <span className="truncate max-w-[210px]" title={nestingProgress?.msg}>{nestingProgress?.msg || 'Processing layout...'}</span>
              <span className="shrink-0">{nestingProgress?.packed ? `Blanks: ${nestingProgress.packed}` : ''}</span>
            </div>

            {/* Live Monitoring Metrics: Elapsed Time & Dynamic ETA */}
            <div className="flex items-center justify-between pt-2 border-t border-industrial-border/60 text-[10px] font-mono">
              <div className="flex items-center gap-3">
                <span>⏱️ Time: <strong className="text-industrial-text">{formatTimeStr(elapsedSeconds)}</strong></span>
                <span>⏳ ETA: <strong className="text-industrial-accent">{calculateEta()}</strong></span>
              </div>
              <button
                onClick={handleCancelProcess}
                className="px-2 py-0.5 bg-red-500/20 hover:bg-red-500/30 text-red-400 border border-red-500/40 rounded text-[9px] font-bold cursor-pointer transition"
                title="Abort Task"
              >
                Abort
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Interactive Export Options Modal */}
      {showExportMenu && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-6 font-mono">
          <div className="bg-industrial-card/95 border border-industrial-border rounded-xl max-w-2xl w-full shadow-2xl overflow-hidden flex flex-col animate-fade-in text-industrial-text">
            {/* Header */}
            <div className="bg-industrial-darker px-6 py-4 border-b border-industrial-border flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Download className="text-industrial-orange" size={18} />
                <h3 className="font-bold text-sm text-industrial-text">CNC Nesting Layout Export Options</h3>
              </div>
              <button 
                onClick={() => setShowExportMenu(false)}
                className="text-industrial-muted hover:text-industrial-text font-bold text-sm transition cursor-pointer"
              >
                ✕
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 flex flex-col gap-5 text-xs">
              {/* Export Scope Selector */}
              <div className="flex flex-col gap-2">
                <label className="text-industrial-muted font-bold uppercase text-[10px]">Export Scope Selection:</label>
                <div className="grid grid-cols-3 gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setExportScope('current');
                      setExportSelectedSheetIdx(activeSheetIndex);
                    }}
                    className={`p-3 rounded-lg border flex flex-col gap-1 transition cursor-pointer text-left ${
                      exportScope === 'current'
                        ? 'bg-industrial-accent/15 border-industrial-accent text-industrial-accent shadow-sm'
                        : 'bg-industrial-darker border-industrial-border text-industrial-muted hover:text-industrial-text'
                    }`}
                  >
                    <span className="font-bold text-xs">Selected Sheet Only</span>
                    <span className="text-[10px] text-industrial-muted">Sheet {activeSheetIndex + 1} of {nestedSheets.length || 1}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setExportScope('all')}
                    className={`p-3 rounded-lg border flex flex-col gap-1 transition cursor-pointer text-left ${
                      exportScope === 'all'
                        ? 'bg-industrial-accent/15 border-industrial-accent text-industrial-accent shadow-sm'
                        : 'bg-industrial-darker border-industrial-border text-industrial-muted hover:text-industrial-text'
                    }`}
                  >
                    <span className="font-bold text-xs">All Nested Sheets</span>
                    <span className="text-[10px] text-industrial-muted">{nestedSheets.length || 1} Total Sheets</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setExportScope('custom')}
                    className={`p-3 rounded-lg border flex flex-col gap-1 transition cursor-pointer text-left ${
                      exportScope === 'custom'
                        ? 'bg-industrial-accent/15 border-industrial-accent text-industrial-accent shadow-sm'
                        : 'bg-industrial-darker border-industrial-border text-industrial-muted hover:text-industrial-text'
                    }`}
                  >
                    <span className="font-bold text-xs">Custom Range</span>
                    <span className="text-[10px] text-industrial-muted">Specific sheet indices</span>
                  </button>
                </div>
              </div>

              {/* Sheet Selector if Custom */}
              {exportScope === 'custom' && (
                <div className="flex items-center gap-3 bg-industrial-darker p-3 rounded border border-industrial-border">
                  <span className="text-industrial-muted font-bold text-[10px]">Sheet Range (e.g. 1, 3, 5):</span>
                  <input
                    type="text"
                    value={customSheetRange}
                    onChange={(e) => setCustomSheetRange(e.target.value)}
                    placeholder="1, 2, 3"
                    className="flex-1 bg-industrial-bg border border-industrial-border px-3 py-1 rounded text-industrial-text outline-none focus:border-industrial-accent"
                  />
                </div>
              )}

              {/* Live Preview & Sheet Metadata */}
              <div className="grid grid-cols-2 gap-4 bg-industrial-darker/60 p-4 rounded-lg border border-industrial-border">
                {/* SVG Preview Thumbnail */}
                <div className="flex flex-col gap-2">
                  <span className="text-[10px] text-industrial-muted font-bold uppercase">Live Sheet Preview:</span>
                  <div className="bg-industrial-bg border border-industrial-border rounded-lg p-2 h-44 flex items-center justify-center relative overflow-hidden">
                    {nestedSheets[exportSelectedSheetIdx]?.svgContent || nestingSvg ? (
                      <div 
                        className="w-full h-full flex items-center justify-center scale-95 pointer-events-none select-none"
                        dangerouslySetInnerHTML={{ __html: nestedSheets[exportSelectedSheetIdx]?.svgContent || nestingSvg || '' }}
                      />
                    ) : (
                      <span className="text-industrial-muted italic text-[11px]">No layout available</span>
                    )}
                  </div>
                </div>

                {/* Sheet Metadata Summary */}
                <div className="flex flex-col justify-between">
                  <div className="flex flex-col gap-2">
                    <span className="text-[10px] text-industrial-muted font-bold uppercase">Sheet Stock Metadata:</span>
                    <div className="grid grid-cols-2 gap-y-1.5 text-[11px]">
                      <span className="text-industrial-muted">Sheet Dimensions:</span>
                      <span className="text-industrial-text font-bold text-right">{formatDimStr(sheetWidth, sheetHeight)}</span>

                      <span className="text-industrial-muted">Sheet Utilization:</span>
                      <span className="text-industrial-orange font-bold text-right">
                        {nestedSheets[exportSelectedSheetIdx]?.utilization || nestingUtilization || 0}%
                      </span>

                      <span className="text-industrial-muted font-bold">Nested Blanks:</span>
                      <span className="text-industrial-text font-bold text-right">
                        {nestedSheets[exportSelectedSheetIdx]?.nestedCount || nestingPartsCount?.nested || 0} parts
                      </span>

                      <span className="text-industrial-muted">Material Stock:</span>
                      <span className="text-industrial-text text-right font-semibold">{nestingMaterial}</span>
                    </div>
                  </div>

                  <div className="text-[10px] text-industrial-muted italic bg-industrial-darker p-2 rounded border border-industrial-border/40">
                    Outputs DXF 2D outlines, PDF fabrication report, and NC G-Code toolpath files.
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center justify-end gap-3 pt-3 border-t border-industrial-border">
                <button
                  onClick={() => setShowExportMenu(false)}
                  className="px-4 py-2 bg-industrial-darker hover:bg-industrial-border border border-industrial-border text-industrial-muted hover:text-industrial-text font-bold rounded transition cursor-pointer"
                >
                  Cancel
                </button>

                <button
                  onClick={async () => {
                    const targetSheet = nestedSheets[exportSelectedSheetIdx] || { dxfPath: nestingDxfPath, pdfPath: nestingPdfPath, gcodePath: nestingGcodePath };
                    if (targetSheet.dxfPath) {
                      const matClean = (((targetSheet as any).material || 'Mild_Steel') as string).replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
                      const thickClean = `${(targetSheet as any).thickness || DEFAULT_THICKNESS_MM}mm`;
                      const defaultName = `Cadanest_${matClean}_${thickClean}_Sheet_${exportSelectedSheetIdx + 1}_of_${nestedSheets.length}_${sheetWidth}x${sheetHeight}mm.dxf`;
                      await window.electronAPI.saveFileAs({
                        sourcePath: targetSheet.dxfPath,
                        defaultFilename: defaultName
                      });
                      setShowExportMenu(false);
                      addLog(`✓ Exported ${defaultName} successfully.`);
                    }
                  }}
                  className="px-4 py-2 bg-industrial-accent hover:bg-industrial-accent/80 text-industrial-bg font-bold rounded transition cursor-pointer flex items-center gap-1.5 shadow-md"
                >
                  <Download size={14} /> Export Selected Sheet (.DXF)
                </button>

                {nestedSheets.length > 1 && (
                  <button
                    onClick={async () => {
                      for (let i = 0; i < nestedSheets.length; i++) {
                        const s = nestedSheets[i];
                        if (s.dxfPath) {
                          const matClean = (((s as any).material || 'Mild_Steel') as string).replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
                          const thickClean = `${(s as any).thickness || DEFAULT_THICKNESS_MM}mm`;
                          const defaultName = `Cadanest_${matClean}_${thickClean}_Sheet_${i + 1}_of_${nestedSheets.length}_${sheetWidth}x${sheetHeight}mm.dxf`;
                          await window.electronAPI.saveFileAs({
                            sourcePath: s.dxfPath,
                            defaultFilename: defaultName
                          });
                        }
                      }
                      setShowExportMenu(false);
                      addLog(`✓ Exported all ${nestedSheets.length} sheets successfully with standard filenames.`);
                    }}
                    className="px-4 py-2 bg-industrial-orange hover:bg-industrial-orange/90 text-white font-bold rounded transition cursor-pointer flex items-center gap-1.5 shadow-md"
                  >
                    <Download size={14} /> Export All {nestedSheets.length} Sheets
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Pre-Flatten Settings Modal */}
      {showPreFlattenModal && selectedPart && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-industrial-card border border-industrial-border rounded-xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col">
            <div className="bg-industrial-darker px-5 py-4 border-b border-industrial-border flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="p-1.5 bg-industrial-orange/20 border border-industrial-orange/30 rounded text-industrial-orange font-bold text-xs">⚡</span>
                <div>
                  <h3 className="text-sm font-bold text-industrial-text font-mono">Pre-Flatten Unfolding Settings</h3>
                  <p className="text-[10px] text-industrial-muted">Configure bend style and hole parameters for {selectedPart.name}</p>
                </div>
              </div>
              <button onClick={() => setShowPreFlattenModal(false)} className="text-industrial-muted hover:text-white p-1 transition cursor-pointer">&times;</button>
            </div>

            <div className="p-5 flex flex-col gap-4 text-xs font-mono">
              {/* 1. Bend Line Style Selection */}
              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] font-bold text-industrial-text">Bend Line Style:</label>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { id: 'dashed', label: 'Dotted & Dashed Centerline (Default)', desc: 'Standard dash-dot centerline' },
                    { id: 'tick', label: 'Etch Tick Markers', desc: 'Customizable etch markers' }
                  ].map(style => (
                    <button
                      key={style.id}
                      onClick={() => {
                        setBendStyle(style.id);
                        if (selectedPart) {
                          setParts(prev => prev.map(p => p.id === selectedPart.id ? { ...p, bendStyle: style.id } : p));
                        }
                      }}
                      className={`p-2.5 rounded border text-left flex flex-col transition cursor-pointer ${
                        bendStyle === style.id 
                          ? 'bg-industrial-accent/15 border-industrial-accent text-industrial-accent font-bold' 
                          : 'bg-industrial-darker border-industrial-border/60 text-industrial-muted hover:text-white'
                      }`}
                    >
                      <span className="text-[11px] font-bold">{style.label}</span>
                      <span className="text-[9px] opacity-75">{style.desc}</span>
                    </button>
                  ))}
                </div>

                {/* Sub-controls when Etch Tick Markers selected */}
                {bendStyle === 'tick' && (
                  <div className="mt-2 p-3 bg-industrial-darker/80 border border-industrial-border/80 rounded-lg flex flex-col gap-3">
                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] font-bold text-industrial-text">Etch Marker Position Strategy:</label>
                      <div className="grid grid-cols-2 gap-1.5">
                        <button
                          type="button"
                          onClick={() => {
                            setEtchMarkerPosition('interior');
                            if (selectedPart) {
                              setParts(prev => prev.map(p => p.id === selectedPart.id ? { ...p, etchMarkerPosition: 'interior' } : p));
                            }
                          }}
                          className={`px-2.5 py-1.5 rounded border text-left text-[10px] flex flex-col cursor-pointer transition ${
                            (selectedPart?.etchMarkerPosition || etchMarkerPosition) === 'interior'
                              ? 'bg-industrial-accent/20 border-industrial-accent text-industrial-accent font-bold'
                              : 'bg-industrial-card border-industrial-border text-industrial-muted hover:text-white'
                          }`}
                        >
                          <span className="font-bold">Interior Centered</span>
                          <span className="text-[9px] opacity-75">1-2 ticks far from corners</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setEtchMarkerPosition('boundary');
                            if (selectedPart) {
                              setParts(prev => prev.map(p => p.id === selectedPart.id ? { ...p, etchMarkerPosition: 'boundary' } : p));
                            }
                          }}
                          className={`px-2.5 py-1.5 rounded border text-left text-[10px] flex flex-col cursor-pointer transition ${
                            (selectedPart?.etchMarkerPosition || etchMarkerPosition) === 'boundary'
                              ? 'bg-industrial-accent/20 border-industrial-accent text-industrial-accent font-bold'
                              : 'bg-industrial-card border-industrial-border text-industrial-muted hover:text-white'
                          }`}
                        >
                          <span className="font-bold">Boundary Ends</span>
                          <span className="text-[9px] opacity-75">Ticks at line endpoints</span>
                        </button>
                      </div>
                    </div>

                    <div className="flex flex-col gap-1">
                      <div className="flex justify-between items-center text-[10px]">
                        <span className="font-bold text-industrial-text">Etch Marker Segment Length:</span>
                        <div className="flex items-center gap-1">
                          <input
                            type="number"
                            step="0.5"
                            min="1.0"
                            max="15.0"
                            value={selectedPart?.etchMarkerLength || etchMarkerLength}
                            onChange={e => {
                              const val = Math.max(1.0, Math.min(15.0, parseFloat(e.target.value) || 4.5));
                              setEtchMarkerLength(val);
                              if (selectedPart) {
                                setParts(prev => prev.map(p => p.id === selectedPart.id ? { ...p, etchMarkerLength: val } : p));
                              }
                            }}
                            className="w-14 h-5 px-1 bg-industrial-card border border-industrial-border rounded text-center text-industrial-text font-bold text-[10px]"
                          />
                          <span className="text-industrial-muted">mm</span>
                        </div>
                      </div>
                      <input
                        type="range"
                        min="1.0"
                        max="15.0"
                        step="0.5"
                        value={selectedPart?.etchMarkerLength || etchMarkerLength}
                        onChange={e => {
                          const val = parseFloat(e.target.value);
                          setEtchMarkerLength(val);
                          if (selectedPart) {
                            setParts(prev => prev.map(p => p.id === selectedPart.id ? { ...p, etchMarkerLength: val } : p));
                          }
                        }}
                        className="w-full accent-industrial-accent h-1.5 bg-industrial-border rounded-lg cursor-pointer"
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* 2. Dimple Hole Layering Config */}
              <div className="flex flex-col gap-1.5 pt-2 border-t border-industrial-border/50">
                <label className="text-[11px] font-bold text-industrial-text">Dimple & Countersink Hole Output:</label>
                <label className="flex items-center gap-2 p-2 bg-industrial-darker border border-industrial-border/60 rounded cursor-pointer hover:border-industrial-accent/40">
                  <input
                    type="checkbox"
                    checked={exportMinimalDimpleHoles}
                    onChange={e => setExportMinimalDimpleHoles(e.target.checked)}
                    className="w-3.5 h-3.5 accent-industrial-accent rounded cursor-pointer"
                  />
                  <div className="flex flex-col">
                    <span className="font-bold text-industrial-text text-[11px]">Prefer Smaller Pilot Hole Diameter (Default)</span>
                    <span className="text-[9px] text-industrial-muted">Outputs minimal pilot laser cut diameter on FORMING_FEATURES layer</span>
                  </div>
                </label>
              </div>

              {/* 3. K-Factor Parameter Slider */}
              <div className="flex flex-col gap-1.5 pt-2 border-t border-industrial-border/50">
                <div className="flex justify-between items-center text-[11px]">
                  <span className="font-bold text-industrial-text">K-Factor Parameter:</span>
                  <input
                    type="number"
                    step="any"
                    min="0.05"
                    max="0.95"
                    value={selectedPart.kfactor}
                    onChange={(e) => handleUpdatePartKfactor(selectedPart.id, Number(e.target.value))}
                    className="w-20 px-1 py-0.5 text-xs text-center font-mono bg-industrial-darker border border-industrial-border rounded text-industrial-accent font-bold"
                  />
                </div>
                <input
                  type="range"
                  min="0.10"
                  max="0.80"
                  step="0.001"
                  value={selectedPart.kfactor}
                  onChange={e => handleUpdatePartKfactor(selectedPart.id, parseFloat(e.target.value))}
                  className="w-full accent-industrial-accent cursor-pointer"
                />
              </div>

              {/* 4. Mirror Flat Pattern & Part-in-Part Hole Nesting */}
              <div className="flex items-center justify-between pt-2 border-t border-industrial-border/50">
                <span className="text-[11px] font-bold text-industrial-text">Mirror Flat Pattern:</span>
                <button
                  onClick={() => {
                    setParts(prev => prev.map(p => p.id === selectedPart.id ? { ...p, mirror: !p.mirror } : p));
                  }}
                  className={`px-3 py-1 text-[10px] font-bold rounded border transition cursor-pointer ${
                    selectedPart.mirror 
                      ? 'bg-industrial-orange/20 border-industrial-orange text-industrial-orange' 
                      : 'bg-industrial-darker border-industrial-border text-industrial-muted'
                  }`}
                >
                  {selectedPart.mirror ? 'MIRRORED (ON)' : 'STANDARD (OFF)'}
                </button>
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-industrial-border/50">
                <span className="text-[11px] font-bold text-industrial-text">Part-in-Part Hole Nesting:</span>
                <button
                  onClick={() => setAllowPartInPart(prev => !prev)}
                  className={`px-3 py-1 text-[10px] font-bold rounded border transition cursor-pointer ${
                    allowPartInPart 
                      ? 'bg-industrial-accent/20 border-industrial-accent text-industrial-accent' 
                      : 'bg-industrial-darker border-industrial-border text-industrial-muted'
                  }`}
                >
                  {allowPartInPart ? 'ENABLED (ON)' : 'DISABLED (OFF)'}
                </button>
              </div>
            </div>

            <div className="bg-industrial-darker px-5 py-3 border-t border-industrial-border flex items-center justify-end gap-3">
              <button
                onClick={() => setShowPreFlattenModal(false)}
                className="px-4 py-1.5 bg-industrial-card hover:bg-industrial-border border border-industrial-border text-industrial-muted hover:text-white font-bold rounded transition cursor-pointer text-xs"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  setShowPreFlattenModal(false);
                  await handleRunUnfold();
                }}
                className="px-4 py-1.5 bg-industrial-orange hover:bg-industrial-orange/90 text-white font-bold rounded transition cursor-pointer text-xs flex items-center gap-1.5 shadow-md"
              >
                <Play size={13} /> Confirm & Flatten Model
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
