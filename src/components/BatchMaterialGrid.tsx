import React, { useState } from 'react';
import { Layers, AlertTriangle, CheckSquare, Square, RefreshCw } from 'lucide-react';

export interface BatchPartItem {
  id: string;
  name: string;
  path: string;
  isSheetMetal: boolean;
  thickness: number;
  material: string;
  selected: boolean;
  missing?: boolean;
  status?: string;
  quantity?: number;
}

interface BatchMaterialGridProps {
  parts: BatchPartItem[];
  onUpdatePart: (id: string, updates: Partial<BatchPartItem>) => void;
  onToggleSelectAll: (selected: boolean) => void;
  onApplyGlobalMaterial: (material: string, thickness?: number) => void;
}

const COMMON_MATERIALS = [
  'Mild Steel',
  'SS304',
  'SS316',
  'AL6061',
  'AL5052',
  'CRCA Sheet',
  'GI',
  'Copper',
  'Brass'
];

export const BatchMaterialGrid: React.FC<BatchMaterialGridProps> = ({
  parts,
  onUpdatePart,
  onToggleSelectAll,
  onApplyGlobalMaterial
}) => {
  const [globalMaterial, setGlobalMaterial] = useState<string>('Mild Steel');
  const allSelected = parts.length > 0 && parts.every(p => p.selected || p.missing);
  const sheetMetalCount = parts.filter(p => p.isSheetMetal && !p.missing).length;
  const missingCount = parts.filter(p => p.missing).length;

  return (
    <div className="bg-[#181B26] border border-[#2A2E3D] rounded-xl p-4 shadow-xl text-white my-4">
      <div className="flex flex-wrap items-center justify-between gap-4 pb-3 border-b border-[#2A2E3D]">
        <div className="flex items-center gap-2">
          <Layers className="w-5 h-5 text-[#00A3FF]" />
          <h3 className="font-semibold text-base text-gray-100">Batch Assembly Material & Thickness Grid</h3>
          <span className="bg-[#00A3FF]/20 text-[#00A3FF] text-xs px-2.5 py-0.5 rounded-full font-medium">
            {sheetMetalCount} / {parts.length} Sheet Metal Parts
          </span>
          {missingCount > 0 && (
            <span className="bg-red-500/20 text-red-400 text-xs px-2.5 py-0.5 rounded-full font-medium flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" /> {missingCount} Missing Parts
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 text-xs">
          <select
            value={globalMaterial}
            onChange={(e) => setGlobalMaterial(e.target.value)}
            className="bg-[#12141D] border border-[#2A2E3D] text-gray-200 text-xs rounded px-2 py-1 focus:border-[#00A3FF] outline-none"
          >
            {COMMON_MATERIALS.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
          <button
            onClick={() => onApplyGlobalMaterial(globalMaterial)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 bg-[#00A3FF]/20 hover:bg-[#00A3FF]/30 text-[#00A3FF] rounded-lg transition"
            title="Apply material to all parts"
          >
            <RefreshCw className="w-3.5 h-3.5" /> Set All Material
          </button>
          <button
            onClick={() => onToggleSelectAll(!allSelected)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-[#242838] hover:bg-[#2F3448] text-gray-300 rounded-lg transition"
          >
            {allSelected ? <CheckSquare className="w-4 h-4 text-[#00A3FF]" /> : <Square className="w-4 h-4 text-gray-400" />}
            {allSelected ? 'Deselect All' : 'Select All Sheet Metal'}
          </button>
        </div>
      </div>


      <div className="overflow-x-auto mt-3 max-h-[350px]">
        <table className="w-full text-left text-xs">
          <thead className="bg-[#12141D] text-gray-400 uppercase tracking-wider sticky top-0 z-10">
            <tr>
              <th className="py-2.5 px-3 w-10 text-center">Include</th>
              <th className="py-2.5 px-3">Part Name</th>
              <th className="py-2.5 px-3 w-28">Type</th>
              <th className="py-2.5 px-3 w-36">Material</th>
              <th className="py-2.5 px-3 w-24">Thickness (mm)</th>
              <th className="py-2.5 px-3 w-20 text-center">Quantity</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#2A2E3D]">
            {parts.map((part) => (
              <tr
                key={part.id}
                className={`hover:bg-[#202434] transition ${
                  part.missing
                    ? 'bg-red-950/20 text-red-300'
                    : part.selected
                    ? 'bg-[#1E2436]'
                    : 'text-gray-400'
                }`}
              >
                <td className="py-2 px-3 text-center">
                  <input
                    type="checkbox"
                    disabled={Boolean(part.missing)}
                    checked={Boolean(part.selected && !part.missing)}
                    onChange={(e) => onUpdatePart(part.id, { selected: e.target.checked })}
                    className="w-4 h-4 rounded border-[#3A3F55] bg-[#12141D] text-[#00A3FF] focus:ring-[#00A3FF]"
                  />
                </td>
                <td className="py-2 px-3 font-medium truncate max-w-[220px]" title={part.path}>
                  <div className="flex items-center gap-2">
                    <span className="truncate">{part.name}</span>
                    {part.missing && (
                      <span className="text-[10px] bg-red-500/20 text-red-400 px-1.5 py-0.5 rounded border border-red-500/30">
                        Missing File
                      </span>
                    )}
                  </div>
                </td>
                <td className="py-2 px-3">
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                      part.missing
                        ? 'bg-red-500/20 text-red-400'
                        : part.isSheetMetal
                        ? 'bg-emerald-500/20 text-emerald-400'
                        : 'bg-amber-500/20 text-amber-400'
                    }`}
                  >
                    {part.missing ? 'MISSING' : part.isSheetMetal ? 'SHEET METAL' : 'SOLID BLOCK'}
                  </span>
                </td>
                <td className="py-2 px-3">
                  <select
                    disabled={Boolean(part.missing)}
                    value={part.material || 'Mild Steel'}
                    onChange={(e) => onUpdatePart(part.id, { material: e.target.value })}
                    className="bg-[#12141D] border border-[#2A2E3D] text-gray-200 text-xs rounded px-2 py-1 focus:border-[#00A3FF] outline-none w-full"
                  >
                    {COMMON_MATERIALS.map((mat) => (
                      <option key={mat} value={mat}>
                        {mat}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="py-2 px-3">
                  <input
                    type="number"
                    step="0.1"
                    min="0.1"
                    max="50.0"
                    disabled={Boolean(part.missing)}
                    value={part.thickness}
                    onChange={(e) => onUpdatePart(part.id, { thickness: parseFloat(e.target.value) || 2.0 })}
                    className="bg-[#12141D] border border-[#2A2E3D] text-gray-200 text-xs rounded px-2 py-1 focus:border-[#00A3FF] outline-none w-20 text-right"
                  />
                </td>
                <td className="py-2 px-3 text-center">
                  <input
                    type="number"
                    min="1"
                    max="10000"
                    disabled={Boolean(part.missing)}
                    value={part.quantity || 1}
                    onChange={(e) => onUpdatePart(part.id, { quantity: parseInt(e.target.value) || 1 })}
                    className="bg-[#12141D] border border-[#2A2E3D] text-gray-200 text-xs rounded px-2 py-1 focus:border-[#00A3FF] outline-none w-16 text-center"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
