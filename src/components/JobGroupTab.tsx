import React from 'react';
import { useCadanestStore, JobGroup, STANDARD_MATERIALS, DEFAULT_THICKNESS_MM, DEFAULT_DENSITY_KG_M3 } from '../store/useCadanestStore';
import { PartItem } from '../App';
import { Layers, FileCode, ChevronRight } from 'lucide-react';

interface JobGroupTabProps {
  parts: PartItem[];
  onSelectGroupForNesting: (group: JobGroup) => void;
}

export const JobGroupTab: React.FC<JobGroupTabProps> = ({ parts, onSelectGroupForNesting }) => {
  const { nestingConfig, setActiveTab } = useCadanestStore();

  const jobGroups = React.useMemo(() => {
    const groupsMap = new Map<string, JobGroup>();

    parts.forEach((part) => {
      const matName = part.materialName || part.material || 'Mild Steel';
      const thick = part.thickness || DEFAULT_THICKNESS_MM;

      let matInfo = STANDARD_MATERIALS.find(
        (m) => m.name.toLowerCase() === matName.toLowerCase() || m.code.toLowerCase() === matName.toLowerCase()
      );
      if (!matInfo) {
        matInfo = { name: matName, code: matName.substring(0, 6).toUpperCase(), density: part.density || DEFAULT_DENSITY_KG_M3, kFactor: part.kfactor || 0.44 };
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
      const flatElems = (part.flatElements && part.flatElements.length > 0)
        ? part.flatElements
        : [{ id: part.id, partId: part.id, name: part.name, parentName: part.name, baseFace: part.baseFace || 'Auto', quantity: part.quantity, active: part.active }];

      flatElems.forEach((elem: any) => {
        group.elements.push({
          id: elem.id,
          partId: part.id,
          name: elem.name || part.name,
          parentName: part.name,
          baseFace: elem.baseFace,
          quantity: elem.quantity,
          active: elem.active,
          thickness: thick,
          material: matInfo?.name
        });
        group.totalQuantity += elem.quantity;
      });

      const widthM = (part.dimensions?.x || 200) / 1000.0;
      const heightM = (part.dimensions?.y || 150) / 1000.0;
      const thickM = thick / 1000.0;
      const elemWeight = widthM * heightM * thickM * matInfo.density * part.quantity;
      group.totalWeightKg += elemWeight;
    });

    return Array.from(groupsMap.values());
  }, [parts]);

  if (jobGroups.length === 0) {
    return (
      <div className="p-8 text-center bg-industrial-card/40 rounded-2xl border border-slate-800 text-slate-400">
        <Layers className="w-10 h-10 mx-auto mb-3 opacity-40 text-blue-400" />
        <h4 className="font-semibold text-slate-200">No Flat Patterns Available</h4>
        <p className="text-xs text-slate-400 mt-1">
          Import 3D models to unfold or drag-and-drop direct 2D DXF profiles into the inventory.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center space-x-2">
            <Layers className="w-4 h-4 text-blue-400" />
            <span>Pre-Nesting Material & Thickness Job Queues</span>
          </h3>
          <p className="text-xs text-slate-400 mt-0.5">
            Flat patterns automatically sorted by material alloy and thickness for optimal sheet stock allocation.
          </p>
        </div>

        <div className="text-xs text-slate-400 bg-slate-900/60 px-3 py-1.5 rounded-lg border border-slate-800">
          <span className="font-bold text-blue-400">{jobGroups.length}</span> Active Material Jobs
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {jobGroups.map((group) => (
          <div
            key={group.id}
            className="p-5 rounded-2xl bg-industrial-card border border-slate-800 hover:border-slate-700 transition-all flex flex-col justify-between space-y-4 shadow-lg group"
          >
            {/* Header info */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center space-x-2">
                  <span className="px-2.5 py-1 text-xs font-bold text-blue-400 bg-blue-500/10 border border-blue-500/20 rounded-lg">
                    {group.material} ({group.materialCode})
                  </span>
                  <span className="px-2 py-0.5 text-[11px] font-mono text-slate-400 bg-slate-800 rounded">
                    {group.density} kg/m³
                  </span>
                </div>
                <span className="px-2 py-0.5 text-xs font-mono font-semibold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded">
                  {group.thickness.toFixed(1)} mm
                </span>
              </div>

              <h4 className="text-base font-bold text-white group-hover:text-blue-300 transition-colors">
                {group.material} — {group.thickness.toFixed(1)}mm Stock Job
              </h4>
              <p className="text-xs text-slate-400 mt-1 flex items-center justify-between">
                <span>Contains {group.elements.length} unique profiles ({group.totalQuantity} total blanks)</span>
                <span className="font-semibold text-amber-400 font-mono">Est. Weight: ~{group.totalWeightKg.toFixed(1)} kg</span>
              </p>
            </div>

            {/* Elements list preview */}
            <div className="bg-slate-900/50 rounded-xl p-3 border border-slate-800/80 space-y-1.5 max-h-32 overflow-y-auto">
              {group.elements.map((elem) => (
                <div key={elem.id} className="flex items-center justify-between text-xs text-slate-300">
                  <div className="flex items-center space-x-2 truncate">
                    <FileCode className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" />
                    <span className="truncate">{elem.name}</span>
                  </div>
                  <span className="font-mono text-slate-400 font-semibold">x{elem.quantity}</span>
                </div>
              ))}
            </div>

            {/* Action footer */}
            <div className="pt-2 flex items-center justify-between border-t border-slate-800/80">
              <div className="text-[11px] text-slate-400">
                Default Sheet: <span className="text-white font-mono">{nestingConfig.sheetWidth}x{nestingConfig.sheetHeight}mm</span>
              </div>

              <button
                onClick={() => {
                  onSelectGroupForNesting(group);
                  setActiveTab('nesting');
                }}
                className="flex items-center space-x-1.5 px-4 py-2 text-xs font-bold text-white bg-blue-600 hover:bg-blue-500 rounded-xl shadow-md transition-all active:scale-95"
              >
                <span>Nest Job Run</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
