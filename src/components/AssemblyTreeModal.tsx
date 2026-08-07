import React, { useState } from 'react';
import { AssemblyNode, useCadanestStore } from '../store/useCadanestStore';
import { Check, X, Box, Layers, AlertCircle, FileCheck, ArrowRight } from 'lucide-react';

interface AssemblyTreeModalProps {
  onConfirmImport: (selectedNodes: AssemblyNode[]) => void;
}

export const AssemblyTreeModal: React.FC<AssemblyTreeModalProps> = ({ onConfirmImport }) => {
  const { currentAssemblyTree, assemblyTreeModalOpen, setAssemblyTreeModalOpen } = useCadanestStore();
  const [treeData, setTreeData] = useState<AssemblyNode | null>(currentAssemblyTree);

  React.useEffect(() => {
    setTreeData(currentAssemblyTree);
  }, [currentAssemblyTree]);

  if (!assemblyTreeModalOpen || !treeData) return null;

  const toggleNodeSelection = (id: string) => {
    if (!treeData) return;

    const updateRecursive = (node: AssemblyNode): AssemblyNode => {
      if (node.id === id) {
        const newSelected = !node.selected;
        return {
          ...node,
          selected: newSelected,
          children: node.children?.map((c) => ({ ...c, selected: newSelected })),
        };
      }
      return {
        ...node,
        children: node.children?.map(updateRecursive),
      };
    };

    setTreeData(updateRecursive(treeData));
  };

  const getSelectedNodes = (node: AssemblyNode): AssemblyNode[] => {
    let result: AssemblyNode[] = [];
    if (node.selected && node.path && node.id !== treeData.id) {
      result.push(node);
    }
    if (node.children) {
      node.children.forEach((child) => {
        result = result.concat(getSelectedNodes(child));
      });
    }
    return result;
  };

  const handleImport = () => {
    if (!treeData) return;
    const selected = getSelectedNodes(treeData);
    onConfirmImport(selected);
    setAssemblyTreeModalOpen(false);
  };

  const totalChildren = treeData.children ? treeData.children.length : 0;
  const selectedCount = treeData.children ? treeData.children.filter((c) => c.selected).length : 0;
  const sheetMetalCount = treeData.children ? treeData.children.filter((c) => c.isSheetMetal).length : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="w-full max-w-3xl rounded-2xl bg-industrial-card border border-slate-700/60 shadow-2xl overflow-hidden flex flex-col max-h-[85vh] text-slate-200">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700/60 bg-slate-900/60">
          <div className="flex items-center space-x-3">
            <div className="p-2 rounded-lg bg-blue-500/10 text-blue-400 border border-blue-500/20">
              <Layers className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-white tracking-tight">CAD Assembly Structure Parser</h3>
              <p className="text-xs text-slate-400">
                {treeData.name} — Auto-filtered {sheetMetalCount} flattenable sheet metal parts
              </p>
            </div>
          </div>
          <button
            onClick={() => setAssemblyTreeModalOpen(false)}
            className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Stats summary bar */}
        <div className="grid grid-cols-3 gap-3 px-6 py-3 bg-slate-900/40 border-b border-slate-800 text-xs">
          <div className="flex items-center space-x-2">
            <span className="text-slate-400">Total Sub-components:</span>
            <span className="font-bold text-white bg-slate-800 px-2 py-0.5 rounded">{totalChildren}</span>
          </div>
          <div className="flex items-center space-x-2">
            <span className="text-slate-400">Flattenable Sheet Metal:</span>
            <span className="font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded">
              {sheetMetalCount} parts
            </span>
          </div>
          <div className="flex items-center space-x-2">
            <span className="text-slate-400">Selected for Unfolding:</span>
            <span className="font-bold text-blue-400 bg-blue-500/10 border border-blue-500/20 px-2 py-0.5 rounded">
              {selectedCount} parts
            </span>
          </div>
        </div>

        {/* Tree Content List */}
        <div className="flex-1 overflow-y-auto p-6 space-y-2">
          {treeData.children && treeData.children.length > 0 ? (
            treeData.children.map((child) => (
              <div
                key={child.id}
                onClick={() => toggleNodeSelection(child.id)}
                className={`flex items-center justify-between p-3.5 rounded-xl border transition-all cursor-pointer ${
                  child.selected
                    ? 'bg-blue-600/10 border-blue-500/40 text-white'
                    : 'bg-slate-900/40 border-slate-800 text-slate-400 hover:border-slate-700'
                }`}
              >
                <div className="flex items-center space-x-3">
                  <div
                    className={`w-5 h-5 rounded flex items-center justify-center border transition-colors ${
                      child.selected
                        ? 'bg-blue-600 border-blue-500 text-white'
                        : 'border-slate-700 bg-slate-800'
                    }`}
                  >
                    {child.selected && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                  </div>

                  <Box className={`w-4 h-4 ${child.isSheetMetal ? 'text-emerald-400' : 'text-slate-500'}`} />

                  <div>
                    <div className="font-medium text-sm text-slate-200">{child.name}</div>
                    <div className="text-xs text-slate-400 flex items-center space-x-3 mt-0.5">
                      <span>Mat: {child.material}</span>
                      <span>Thick: {child.thickness}mm</span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center space-x-2">
                  {child.isSheetMetal ? (
                    <span className="px-2.5 py-1 text-[11px] font-semibold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-full flex items-center space-x-1">
                      <FileCheck className="w-3 h-3" />
                      <span>Sheet Metal Blank</span>
                    </span>
                  ) : (
                    <span className="px-2.5 py-1 text-[11px] font-medium text-slate-400 bg-slate-800/80 rounded-full">
                      Solid Part
                    </span>
                  )}
                </div>
              </div>
            ))
          ) : (
            <div className="text-center py-12 text-slate-500">
              <AlertCircle className="w-8 h-8 mx-auto mb-2 opacity-50" />
              <p>No sub-components discovered in assembly file.</p>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-slate-700/60 bg-slate-900/80">
          <button
            onClick={() => setAssemblyTreeModalOpen(false)}
            className="px-4 py-2 text-xs font-semibold text-slate-400 hover:text-white transition-colors"
          >
            Cancel
          </button>

          <button
            onClick={handleImport}
            disabled={selectedCount === 0}
            className="flex items-center space-x-2 px-5 py-2.5 text-xs font-bold text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl shadow-lg shadow-blue-600/20 transition-all active:scale-95"
          >
            <span>Import & Process {selectedCount} Selected Parts</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};
