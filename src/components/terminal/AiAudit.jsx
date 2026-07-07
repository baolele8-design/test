import React from 'react';
import { Bot, Database, Loader2 } from 'lucide-react';

export default function AiAudit({
  autoData,
  runGeminiAnalysis,
  isAnalyzing,
  geminiCooldown,
  aiAnalysis
}) {
  return (
    <div className="bg-[#111116] border border-slate-800 rounded-xl p-4 shadow-xl">
       <h2 className="text-[10px] font-bold text-blue-400 uppercase flex items-center gap-2 mb-3">
         <Bot className="w-3.5 h-3.5" /> QUANTUM COUNCIL AUDIT (5 AGENTS LITE &rarr; MASTER 3.5)
       </h2>
       <button 
         onClick={runGeminiAnalysis} 
         disabled={isAnalyzing || !autoData || geminiCooldown > 0} 
         className={`w-full py-2 border rounded text-[10px] font-bold flex items-center justify-center gap-2 transition-all bg-blue-600/10 hover:bg-blue-600/20 text-blue-400 border-blue-500/30`}
       >
         {isAnalyzing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Database className="w-3.5 h-3.5" />}
         KÍCH HOẠT HỘI ĐỒNG KIỂM TOÁN LỆNH 
       </button>
       {aiAnalysis && (
         <div className="mt-3 bg-[#0a0a0c] p-3 rounded border border-blue-900/30 text-[10.5px] text-slate-300 whitespace-pre-line leading-relaxed shadow-inner font-mono max-h-96 overflow-y-auto">
           <span className="text-blue-500 mr-1">{'>'}</span> {aiAnalysis}
         </div>
       )}
    </div>
  );
}