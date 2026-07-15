import WebSocket from 'ws';
import { createClient } from '@supabase/supabase-js';
import QuantMath from './QuantMath.js';
import { TradeValidator } from './TradeValidator.js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Load biến môi trường từ file .env hoặc .env.local ở thư mục gốc
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY);

const POOL_SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'LINKUSDT', 'XRPUSDT', 'ADAUSDT', 'DASHUSDT', 'AVAXUSDT'];
const INTERVALS = ['15m', '1h', '4h'];

// Bộ nhớ RAM lưu trữ nến và dữ liệu
let klinesMemory = {};
let tradeLogsMemory = [];
let apiMacroMemory = { realSpreadPct: 0.05, longShortRatio: 1.0, takerBuySellRatio: 1.0, sessionMultiplier: 1.0, tradingSession: 'NEW_YORK' };

console.log("🚀 [LOCAL QUANT DAEMON] Đang khởi động...");

async function init() {
    // 1. Kéo Lịch sử Trade Logs từ Supabase để Check Cooldown Gate (h_cd)
    const { data: logs } = await supabase.from('trade_logs').select('*').order('created_at', { ascending: false }).limit(100);
    if (logs) tradeLogsMemory = logs;

    // 2. Kéo 250 nến lịch sử làm móng cho từng coin bằng REST API[cite: 5]
    console.log("⏳ Đang fetch nến lịch sử làm móng...");
    for (const sym of POOL_SYMBOLS) {
        klinesMemory[sym] = {};
        for (const intv of INTERVALS) {
            try {
                const res = await fetch(`https://fapi.binance.com/fapi/v1/klines?symbol=${sym}&interval=${intv}&limit=250`);
                const data = await res.json();
                klinesMemory[sym][intv] = data;
            } catch (err) {
                console.error(`Lỗi fetch móng ${sym} ${intv}:`, err.message);
            }
        }
    }
    console.log("✅ Fetch nến hoàn tất. Đang mở WebSockets...");

    // 3. Mở luồng Multiplexing WebSocket cho toàn bộ Coin[cite: 5]
    const streamParams = [];
    POOL_SYMBOLS.forEach(sym => {
        INTERVALS.forEach(intv => streamParams.push(`${sym.toLowerCase()}@kline_${intv}`));
    });
    
    // Binance hỗ trợ gộp luồng (multiplexing)[cite: 5]
    const wsUrl = `wss://fstream.binance.com/stream?streams=${streamParams.join('/')}`;
    const ws = new WebSocket(wsUrl);

    ws.on('open', () => console.log("🟢 Đã kết nối WebSocket Binance. Radar đang hoạt động..."));

    ws.on('message', async (message) => {
        const payload = JSON.parse(message);
        if (!payload.data) return;

        const k = payload.data.k;
        const symbol = k.s;
        const interval = k.i;
        const isClosed = k.x;
        
        // Cập nhật nến vào RAM
        const liveCandle = [k.t, k.o, k.h, k.l, k.c, k.v, k.T, k.q, k.n, k.V, k.Q, k.B];
        let klinesArr = klinesMemory[symbol][interval];
        
        if (klinesArr[klinesArr.length - 1][0] === k.t) {
            klinesArr[klinesArr.length - 1] = liveCandle; // Đè nến đang chạy
        } else {
            klinesArr.push(liveCandle); // Sang nến mới
            klinesArr.shift(); // Xóa nến cũ nhất để giữ 250 nến
        }

        // Chỉ chạy Logic quét khi nến VỪA ĐÓNG để tránh nhiễu tín hiệu (Noise)
        if (isClosed) {
            runQuantEngine(symbol, interval, klinesArr);
        }
    });

    ws.on('error', (err) => console.error("🔴 Lỗi WS:", err.message));
}

async function runQuantEngine(symbol, interval, klines) {
    const highs = klines.map(d => parseFloat(d[2]));
    const lows = klines.map(d => parseFloat(d[3]));
    const closes = klines.map(d => parseFloat(d[4]));
    const volumes = klines.map(d => parseFloat(d[7]));
    const price = closes[closes.length - 1];

    const rsi = QuantMath.rsi(closes, 14);
    const atr14 = QuantMath.atr(highs, lows, closes, 14);
    const cmf = QuantMath.cmf(highs, lows, closes, volumes, 20);
    const bbwData = QuantMath.bollinger(closes, 20, 2.0);
    const avgVol20 = QuantMath.sma(volumes.slice(0, -1), 20);

    const isSfpLong = QuantMath.detectSFP_Advanced(highs, lows, closes, volumes, avgVol20, 'LONG');
    const isSfpShort = QuantMath.detectSFP_Advanced(highs, lows, closes, volumes, avgVol20, 'SHORT');

    const mockAutoData = {
        currentPrice: price, atr14: atr14, atrPercent: (atr14 / price) * 100, atrRank: 50,
        bbw: bbwData.bbw, bbwRank: 50, bbwSlope: 1.0, adx: 30, rsi: rsi, cmf: cmf, obi: 0.5,
        fundingRate: 0.01, fundingSlope: 0, currentOi: 100, oiEma: 100, oiDelta: 1.0,
        lastClosedVolume: volumes[volumes.length - 2], avgVolume20: avgVol20,
        isBullishSFP: isSfpLong, isBearishSFP: isSfpShort, btcDomValue: 55.0, btcDomSlope: 0,
        ema20: { slope: 0.1, value: price }, ema50: { slope: 0.1, value: price }, ema200: { slope: 0.1, value: price },
        isObvBearDivergence: false, isObvBullDivergence: false, htfSma200: price
    };

    const mockVectorDetails = { l1: 'Trend Up', l2: 'Normal', l3: 'Quiet', l4: 'Neutral', l5: 'Strong', l6: 'Fair Value' };
    let bestCandidate = null;

    for (const candDir of ['LONG', 'SHORT']) {
        const candIsSfp = candDir === 'LONG' ? isSfpLong : isSfpShort;
        const variants = QuantMath.getStrategyVariants(50, 1.0, candIsSfp, (atr14/price)*100, 0.5, candDir);

        for (const variant of variants) {
            const candSl = candDir === 'LONG' ? price - (variant.slMult * atr14) : price + (variant.slMult * atr14);
            const candTp1 = candDir === 'LONG' ? price + (variant.tpMult * atr14) : price - (variant.tpMult * atr14);

            const candSystemScore = TradeValidator.evaluateScore(mockAutoData, apiMacroMemory, mockVectorDetails, candDir, 0.23, symbol);
            
            const candMathCore = QuantMath.calculateMathCore(
                mockAutoData, apiMacroMemory, mockVectorDetails, 100.0, 
                { entry: price, slTech: candSl, tp1: candTp1, tradeType: 'FUTURES', direction: candDir, execution: 'MARKET', riskPercent: 1.0 }, 
                { totalClosed: 30, winRate: 0.45, historicalRR: 1.5 }, 
                { maker: 0.0002, taker: 0.0004 }, 5.0, candSystemScore.score, interval, null
            );

            const candGates = TradeValidator.evaluateGates(mockAutoData, apiMacroMemory, mockVectorDetails, candMathCore, candDir, 'FUTURES', price, candSl, candSystemScore, tradeLogsMemory, symbol);

            if (candGates.isApproved) {
                if (!bestCandidate || parseFloat(candMathCore.theoreticalRR) > parseFloat(bestCandidate.theoreticalRR)) {
                    bestCandidate = { dir: candDir, entry: price, sl: candSl, tp1: candTp1, strategyName: variant.strategyName, positionSizeUSD: candMathCore.positionSizeUSD, theoreticalRR: candMathCore.theoreticalRR, suggestedLeverage: candMathCore.suggestedLeverage, gates: candGates };
                }
            }
        }
    }

    if (bestCandidate) {
        console.log(`🔥 PHÁT HIỆN SETUP: ${symbol} [${interval}] ${bestCandidate.dir} | RR: 1:${bestCandidate.theoreticalRR}`);
        
        let overrideTag = bestCandidate.strategyName !== "TIÊU CHUẨN (ADAPTIVE)" ? bestCandidate.strategyName : '';
        if (overrideTag === '') {
            if (bestCandidate.gates.isNanoOverride) overrideTag = '🦠 NANO-CAP';
            else if (bestCandidate.gates.isSniperOverride) overrideTag = '🎯 SNIPER';
            else if (bestCandidate.gates.isHighRROverride) overrideTag = '🚀 ASYM-RR';
        }

        const payload = {
            symbol, interval, direction: bestCandidate.dir, entry: parseFloat(bestCandidate.entry.toFixed(4)),
            sl_tech: parseFloat(bestCandidate.sl.toFixed(4)), tp_1: parseFloat(bestCandidate.tp1.toFixed(4)),
            theoretical_rr: parseFloat(bestCandidate.theoreticalRR), position_size_usd: parseFloat(bestCandidate.positionSizeUSD),
            suggested_leverage: bestCandidate.suggestedLeverage, rsi: parseFloat(rsi.toFixed(1)), cmf: parseFloat(cmf.toFixed(2)), override_tag: overrideTag 
        };

        // Bắn lên Cloud (Supabase)
        await supabase.from('matrix_signals').insert([payload]);
        
        // Dọn dẹp Database: Chỉ giữ lại 10 signal mới nhất để UI không bị nặng
        const { data: currentSignals } = await supabase.from('matrix_signals').select('id').order('created_at', { ascending: false });
        if (currentSignals && currentSignals.length > 10) {
            const idsToDelete = currentSignals.slice(10).map(s => s.id);
            await supabase.from('matrix_signals').delete().in('id', idsToDelete);
        }
    }
}

init();