// File: src/components/terminal/TradeJournal.jsx
import React from 'react';
import { History, RefreshCw, CheckCircle2, XCircle, TrendingUp, TrendingDown, Clock, Link, AlertTriangle } from 'lucide-react';

export default function TradeJournal({ tradeLogs, currentPrice, syncBinanceToSupabase, isSyncing, binancePositions }) {
  
  // Tính toán Lệnh GHOST (Lệnh đang mở trên Binance nhưng KHÔNG CÓ trong Sổ tay PENDING/OPEN)
  const activeLogSymbols = tradeLogs.filter(l => l.status === 'OPEN' || l.status === 'PENDING').map(l => l.symbol);
  const ghostPositions = binancePositions.filter(p => !activeLogSymbols.includes(p.symbol) && parseFloat(p.positionAmt) !== 0);

  return (
    <div className="bg-[#111116] border border-slate-800 rounded-xl p-4 shadow-xl mt-6">
      <div className="flex justify-between items-center mb-4 border-b border-slate-800/80 pb-3">
        <h2 className="text-[12px] font-black text-slate-300 uppercase flex items-center gap-2 tracking-widest">
          <History className="w-4 h-4 text-purple-500" /> SỔ TAY LƯỢNG TỬ (SUPABASE LOGS)
        </h2>
        <button 
          onClick={syncBinanceToSupabase}
          disabled={isSyncing}
          className="bg-purple-600/20 hover:bg-purple-600/40 text-purple-400 border border-purple-500/30 px-3 py-1.5 rounded text-[10px] font-bold flex items-center gap-2 transition-all"
        >
          <RefreshCw className={`w-3 h-3 ${isSyncing ? 'animate-spin' : ''}`} /> 
          {isSyncing ? 'ĐANG ĐỒNG BỘ BINANCE...' : 'ĐỒNG BỘ AUTO-SYNC'}
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="text-[9px] text-slate-500 uppercase tracking-wider border-b border-slate-800">
              <th className="pb-2">Trạng thái</th>
              <th className="pb-2">Cặp / Hướng</th>
              <th className="pb-2">Entry / SL / TP</th>
              <th className="pb-2">Regime / Soft Score</th>
              <th className="pb-2 text-right">PnL (Thực tế)</th>
            </tr>
          </thead>
          <tbody className="text-[10px] font-mono">
            {/* IN RA CÁC LỆNH GHOST TRƯỚC TIÊN ĐỂ CẢNH BÁO TRADER */}
            {ghostPositions.map(pos => {
              const isLong = parseFloat(pos.positionAmt) > 0;
              const pnl = parseFloat(pos.unRealizedProfit);
              return (
                  <tr key={`ghost-${pos.symbol}`} className="border-b border-amber-900/50 bg-amber-950/10 hover:bg-amber-900/30">
                      <td className="py-3 flex items-center gap-1.5">
                          <AlertTriangle className="w-3.5 h-3.5 text-amber-500 animate-pulse" />
                          <span className="font-bold text-amber-500">GHOST_BINANCE</span>
                      </td>
                      <td className="py-3">
                          <div className="font-black text-white">{pos.symbol}</div>
                          <div className={`flex items-center gap-1 text-[9px] ${isLong ? 'text-emerald-400' : 'text-red-400'}`}>
                              {isLong ? <TrendingUp className="w-3 h-3"/> : <TrendingDown className="w-3 h-3"/>} {isLong ? 'LONG' : 'SHORT'}
                          </div>
                      </td>
                      <td className="py-3 text-slate-400">
                          E: <span className="text-white">${parseFloat(pos.entryPrice).toFixed(4)}</span><br/>
                          <span className="text-[9px] text-amber-500 italic">⚠️ Lệnh chưa lưu DB</span>
                      </td>
                      <td className="py-3">
                          <div className="text-slate-500 text-[9px]">Không có data Audit AI. Vui lòng quay lại Hub lưu lệnh.</div>
                      </td>
                      <td className={`py-3 text-right font-black ${pnl > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                          {pnl > 0 ? '+' : ''}{pnl.toFixed(2)}$
                          <div className="text-[8px] text-slate-500 font-normal mt-0.5">(Live Binance)</div>
                      </td>
                  </tr>
              );
            })}

            {tradeLogs.length === 0 && ghostPositions.length === 0 ? (
              <tr><td colSpan="5" className="text-center py-4 text-slate-600">Chưa có dữ liệu giao dịch.</td></tr>
            ) : (
              tradeLogs.slice(0, 15).map((log) => {
                let isLive = log.status === 'OPEN';
                let isPending = log.status === 'PENDING';
                let displayPnl = parseFloat(log.pnl_usd || 0);
                let displayEntry = parseFloat(log.entry || 0);

                // ƯU TIÊN SỐ 1: BỐC DATA PNL THẬT TỪ BINANCE NẾU ĐANG CHẠY
                if (isLive || isPending) {
                   const actualPos = binancePositions.find(p => p.symbol === log.symbol);
                   if (actualPos) {
                      displayPnl = parseFloat(actualPos.unRealizedProfit);
                      displayEntry = parseFloat(actualPos.entryPrice);
                      isLive = true; 
                      isPending = false;
                   }
                }

                return (
                  <tr key={log.id} className="border-b border-slate-800/50 hover:bg-slate-900/30 transition-colors">
                    <td className="py-3 flex items-center gap-1.5">
                      {isPending ? <Link className="w-3.5 h-3.5 text-blue-400 animate-pulse" /> : 
                       isLive ? <Clock className="w-3.5 h-3.5 text-amber-500 animate-pulse" /> : 
                       displayPnl > 0 ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" /> : 
                       <XCircle className="w-3.5 h-3.5 text-red-500" />}
                      <span className={`font-bold ${isPending ? 'text-blue-400' : isLive ? 'text-amber-500' : displayPnl > 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                        {isPending ? 'CHỜ KHỚP' : log.status}
                      </span>
                    </td>
                    <td className="py-3">
                      <div className="font-black text-white">{log.symbol}</div>
                      <div className={`flex items-center gap-1 text-[9px] ${log.direction === 'LONG' ? 'text-emerald-400' : 'text-red-400'}`}>
                        {log.direction === 'LONG' ? <TrendingUp className="w-3 h-3"/> : <TrendingDown className="w-3 h-3"/>} {log.direction}
                      </div>
                    </td>
                    <td className="py-3 text-slate-400">
                      E: <span className="text-white">${displayEntry.toFixed(4)}</span><br/>
                      S: <span className="text-red-400">${parseFloat(log.sl).toFixed(4)}</span> | T: <span className="text-emerald-400">${parseFloat(log.tp_1_price).toFixed(4)}</span>
                    </td>
                    <td className="py-3">
                      <div className="text-cyan-400 text-[8.5px] truncate max-w-[150px]">{log.market_regime}</div>
                      <div className="text-slate-500">AI Score: <span className="text-white font-bold">{parseFloat(log.soft_score).toFixed(1)}/10</span></div>
                    </td>
                    <td className={`py-3 text-right font-black ${isPending ? 'text-slate-500' : displayPnl > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {isPending ? '0.00$' : `${displayPnl > 0 ? '+' : ''}${displayPnl.toFixed(2)}$`}
                      {isLive && <div className="text-[8px] text-slate-500 font-normal mt-0.5">(Thực tế Binance)</div>}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}