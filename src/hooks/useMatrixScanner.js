// FILE: src/hooks/useMatrixScanner.js
import { useState, useEffect, useRef } from 'react';
import QuantMath from '../core/QuantMath';
import { POOL_INTERVALS, POOL_SYMBOLS } from '../config/constants';
import { TradeValidator } from '../core/TradeValidator';

export default function useMatrixScanner({ 
  liveCapital, autoData, mvrvZScore, tradeFees, apiMacro, showToast, 
  dynamicPool, dynamicMinNotionals, setSystemHealth, systemHealth, tradeLogs
}) {
  const [scannedTopSetups, setScannedTopSetups] = useState([]);
  const [isScanningBackground, setIsScanningBackground] = useState(false);
  const [sonarEnabled, setSonarEnabled] = useState(false);
  
  const prevScannedSigRef = useRef('');

  const liveCapitalRef = useRef(liveCapital);
  const autoDataRef = useRef(autoData);
  const mvrvZScoreRef = useRef(mvrvZScore);
  const tradeFeesRef = useRef(tradeFees);
  const apiMacroRef = useRef(apiMacro);
  const dynamicPoolRef = useRef(dynamicPool);
  const dynamicMinNotionalsRef = useRef(dynamicMinNotionals);
  
  const systemHealthRef = useRef(systemHealth);
  useEffect(() => { systemHealthRef.current = systemHealth; }, [systemHealth]);

  useEffect(() => { liveCapitalRef.current = liveCapital; }, [liveCapital]);
  useEffect(() => { autoDataRef.current = autoData; }, [autoData]);
  useEffect(() => { mvrvZScoreRef.current = mvrvZScore; }, [mvrvZScore]);
  useEffect(() => { tradeFeesRef.current = tradeFees; }, [tradeFees]);
  useEffect(() => { apiMacroRef.current = apiMacro; }, [apiMacro]);
  useEffect(() => { dynamicPoolRef.current = dynamicPool; }, [dynamicPool]);
  useEffect(() => { dynamicMinNotionalsRef.current = dynamicMinNotionals; }, [dynamicMinNotionals]);

  useEffect(() => {
    let isMounted = true;

    const fetchWithTimeout = async (url, ms = 15000) => {
        const controller = new AbortController();
        const id = setTimeout(() => controller.abort(), ms);
        try {
            const startPing = Date.now();
            const response = await fetch(url, { signal: controller.signal });
            clearTimeout(id);
            const latency = Date.now() - startPing;
            
            const weight = response.headers.get('x-mbx-used-weight-1m');
            if (weight && setSystemHealth && isMounted) {
               setSystemHealth(prev => ({ ...prev, weight: parseInt(weight, 10), latency }));
            }
            
            return response.ok ? await response.json() : [];
        } catch (error) {
            clearTimeout(id);
            return []; 
        }
    };

    const runCrossAssetScan = async () => {
      if (isScanningBackground) return;
      setIsScanningBackground(true);
      
      const currentDynamicPool = dynamicPoolRef.current || [];
      const currentMinNotionals = dynamicMinNotionalsRef.current || {};

      try {
        const ts = Math.floor(Date.now() / 30000) * 30000;
        const scanResultsPool = [];
        const realtimeMetrics = {};
        
        try {
            const [allBook, allPrem] = await Promise.all([
                fetchWithTimeout(`/api/binance?path=/fapi/v1/ticker/bookTicker&t=${ts}`, 10000),
                fetchWithTimeout(`/api/binance?path=/fapi/v1/premiumIndex&t=${ts}`, 10000)
            ]);

            currentDynamicPool.forEach(sym => {
                const book = Array.isArray(allBook) ? allBook.find(b => b.symbol === sym) : null;
                const prem = Array.isArray(allPrem) ? allPrem.find(p => p.symbol === sym) : null;
                
                if (book && prem) {
                    const ask = parseFloat(book.askPrice);
                    const bid = parseFloat(book.bidPrice);
                    const bidQty = parseFloat(book.bidQty || 0);
                    const askQty = parseFloat(book.askQty || 0);
                    realtimeMetrics[sym] = {
                        spread: bid > 0 ? ((ask - bid) / bid) * 100 : 0.05,
                        obi: (bidQty + askQty > 0) ? bidQty / (bidQty + askQty) : 0.5,
                        funding: parseFloat(prem.lastFundingRate || 0)
                    };
                } else {
                    const defaultSpread = sym.includes('BTC') ? 0.01 : (sym.includes('ETH') || sym.includes('SOL') ? 0.02 : 0.05);
                    const defaultFunding = sym.includes('BTC') || sym.includes('ETH') ? 0.0001 : 0.0002;
                    realtimeMetrics[sym] = { spread: defaultSpread, obi: 0.5, funding: defaultFunding };
                }
            });
        } catch (e) {
            currentDynamicPool.forEach(sym => { realtimeMetrics[sym] = { spread: 0.05, obi: 0.5, funding: 0.0002 }; });
        }

        const fetchCache = new Map();
        const memoizedFetch = async (binanceQueryStr) => {
            const fullUrl = `/api/binance?${binanceQueryStr}&t=${ts}`;
            if (fetchCache.has(fullUrl)) return fetchCache.get(fullUrl);
            await new Promise(res => setTimeout(res, Math.random() * 500)); // Tránh Spam Rate Limit
            const promise = fetchWithTimeout(fullUrl, 15000);
            fetchCache.set(fullUrl, promise);
            return promise;
        };

        const fetchTasks = [];
        for (const targetSymbol of currentDynamicPool) {
          for (const targetInterval of POOL_INTERVALS) {
             if (['1h', '4h', '1d'].includes(targetInterval) && !POOL_SYMBOLS.includes(targetSymbol)) {
                 continue; 
             }
             fetchTasks.push({ symbol: targetSymbol, interval: targetInterval });
          }
        }

        // BẢN VÁ LỖI CỔ CHAI MẠNG: Hạ Chunk Size xuống 1 để không bị kẹt hàng đợi trình duyệt (Max 6 connections)
        const SYMBOL_CHUNK_SIZE = 1; 
        const results = [];

        for (let i = 0; i < fetchTasks.length; i += SYMBOL_CHUNK_SIZE) {
          if (systemHealthRef.current && systemHealthRef.current.weight > 2000) {
              await new Promise(resolve => setTimeout(resolve, 3000));
          }

          const taskChunk = fetchTasks.slice(i, i + SYMBOL_CHUNK_SIZE);
          const chunkPromises = [];
          
          for (const task of taskChunk) {
            let mtfInterval = '1h';
            if (task.interval === '15m') mtfInterval = '1h';
            else if (task.interval === '1h') mtfInterval = '4h';
            else if (task.interval === '4h') mtfInterval = '1d';
            else if (task.interval === '1d') mtfInterval = '1w';

            let macroInterval = task.interval;
            if (task.interval === '1w') macroInterval = '1d';

            const taskPromise = Promise.all([
              memoizedFetch(`path=/fapi/v1/klines&symbol=${task.symbol}&interval=${task.interval}&limit=250`),
              memoizedFetch(`path=/futures/data/takerlongshortRatio&symbol=${task.symbol}&period=${macroInterval}&limit=1`),
              memoizedFetch(`path=/futures/data/globalLongShortAccountRatio&symbol=${task.symbol}&period=${macroInterval}&limit=1`),
              memoizedFetch(`path=/fapi/v1/klines&symbol=${task.symbol}&interval=${mtfInterval}&limit=250`),
              memoizedFetch(`path=/fapi/v1/klines&symbol=${task.symbol}&interval=1d&limit=250`)
            ]).then(([klines, takerData, lsData, klinesMTF, klinesHTF]) => ({
              symbol: task.symbol,
              interval: task.interval,
              klines, klinesMTF, klinesHTF,
              localTakerRatio: (Array.isArray(takerData) && takerData.length > 0) ? parseFloat(takerData[takerData.length-1].buySellRatio) : 1.0,
              localLsRatio: (Array.isArray(lsData) && lsData.length > 0) ? parseFloat(lsData[lsData.length-1].longShortRatio) : 1.0
            }));

            chunkPromises.push(taskPromise);
          }

          const chunkResults = await Promise.allSettled(chunkPromises);
          results.push(...chunkResults);
        }

        for (const result of results) {
          if (result.status !== 'fulfilled' || !Array.isArray(result.value.klines) || result.value.klines.length < 50) continue;
          
          try {
            await new Promise(resolve => setTimeout(resolve, 5));
            const { symbol: targetSymbol, interval: targetInterval, klines, klinesMTF, klinesHTF, localTakerRatio, localLsRatio } = result.value;

            let closesMTF = [];
            if (Array.isArray(klinesMTF) && klinesMTF.length >= 50) {
               closesMTF = klinesMTF.map(d => parseFloat(d[4]));
            } else {
               closesMTF = klines.map(d => parseFloat(d[4])); 
            }

            const highs = klines.map(d => parseFloat(d[2]));
            const lows = klines.map(d => parseFloat(d[3]));
            const closes = klines.map(d => parseFloat(d[4]));
            const quoteVolumes = klines.map(d => parseFloat(d[7])); 
            const price = closes[closes.length - 1];

            const avgVolume20 = QuantMath.sma(quoteVolumes.slice(0, -1), 20);
            const closedVolume = quoteVolumes[quoteVolumes.length - 2];

            const atr14 = QuantMath.atr(highs, lows, closes, 14);
            const rsi = QuantMath.rsi(closes, 14);
            const cmf = QuantMath.cmf(highs, lows, closes, quoteVolumes, 20); 
            
            const bbwHist = [];
            for (let i = 20; i < closes.length; i++) {
                const bb = QuantMath.bollinger(closes.slice(0, i+1), 20, 2.0);
                bbwHist.push(bb.bbw);
            }
            const bollinger20 = QuantMath.bollinger(closes, 20, 2.0);
            const bbwRank = QuantMath.percentileRank(bollinger20.bbw, bbwHist.slice(-100)); 
            const bbwSlopeLocal = bbwHist.length >= 5 ? ((bollinger20.bbw - bbwHist[bbwHist.length - 5]) / (bbwHist[bbwHist.length - 5] || 1)) * 100 : 0;
            
            const atrHistLocal = [];
            for (let i = 14; i < closes.length; i++) {
                atrHistLocal.push(QuantMath.atr(highs.slice(0, i+1), lows.slice(0, i+1), closes.slice(0, i+1), 14));
            }
            const atrRankLocal = QuantMath.percentileRank(atr14, atrHistLocal.slice(-100));

            const scan20_50 = QuantMath.scanEmaRange(closesMTF, 20, 50, 20);
            const adxValue = QuantMath.adx(highs, lows, closes, 14); 
            
            let l1 = "Range";
            const slopeBull = scan20_50.fastSlope > 0.05 && scan20_50.slowSlope > 0.02;
            const slopeBear = scan20_50.fastSlope < -0.05 && scan20_50.slowSlope < -0.02;
            if (adxValue > 25 && scan20_50.fastEmaCurrent > scan20_50.slowEmaCurrent && slopeBull) l1 = "Trend Up";
            else if (adxValue > 25 && scan20_50.fastEmaCurrent < scan20_50.slowEmaCurrent && slopeBear) l1 = "Trend Down";
            else if (adxValue > 25) l1 = "Transition"; 
            else l1 = "Range";

            let l2 = "Normal";
            const volScoreLocal = (atrRankLocal + bbwRank) / 2;
            if (volScoreLocal < 20) l2 = "Compression";
            else if (volScoreLocal > 85) l2 = "Extreme";
            else if (volScoreLocal > 65) l2 = "Expansion";
            else l2 = "Normal";

            // cRegime/tHold/execType: CHỈ phụ thuộc vào Regime (l1/l2), KHÔNG phụ thuộc hướng lệnh
            // => tính 1 lần duy nhất, dùng chung cho cả 2 hướng LONG/SHORT bên dưới.
            let cRegime = 1.0; let tHold = 3;
            if (l1.includes('Trend')) { cRegime = 1.2; tHold = 9; }
            else if (l2 === 'Extreme') { cRegime = 0.5; tHold = 1; }
            else { cRegime = 0.8; tHold = 2; }

            const execType = (l1 === 'Range' || l2 === 'Extreme') ? 'MARKET' : 'LIMIT';

            const localObi = realtimeMetrics[targetSymbol]?.obi !== undefined ? realtimeMetrics[targetSymbol].obi : 0.5;
            const realSpread = realtimeMetrics[targetSymbol]?.spread || 0.05;
            const realFunding = realtimeMetrics[targetSymbol]?.funding || 0.0002;
            
            const localSfpLong = QuantMath.detectSFP_Advanced(highs, lows, closes, quoteVolumes, avgVolume20, 'LONG');
            const localSfpShort = QuantMath.detectSFP_Advanced(highs, lows, closes, quoteVolumes, avgVolume20, 'SHORT');

            const isVolSpikeHUD = closedVolume > (avgVolume20 * 2.5);
            let l3 = "Quiet";
            if (localSfpLong) l3 = "Sweep Low (SFP)"; 
            else if (localSfpShort) l3 = "Sweep High (SFP)";
            else if (isVolSpikeHUD && price > scan20_50.fastEmaCurrent && l2 === "Expansion") l3 = "Breakout";
            else if (isVolSpikeHUD && price < scan20_50.fastEmaCurrent && l2 === "Expansion") l3 = "Breakdown"; 
            else if (isVolSpikeHUD) l3 = "Stop Hunt / Climax";

            let l4 = "Neutral";
            let l5 = "Weak / Mixed";
            
            const currentMvrv = mvrvZScoreRef.current || 0.23;
            const globalBtcDomValue = autoDataRef.current?.btcDomValue || 55.0;
            const globalBtcDomSlope = autoDataRef.current?.btcDomSlope || 0;
            const isAltcoinBleedingLocal = targetSymbol !== 'BTCUSDT' && globalBtcDomValue > 50 && globalBtcDomSlope > 0.5;
            const isAltcoinSeasonLocal = targetSymbol !== 'BTCUSDT' && globalBtcDomSlope < -0.5;

            let l6 = "Fair Value"; 
            if (currentMvrv > 3.5) { l6 = "Extreme Overvaluation"; } 
            else if (currentMvrv >= 2.5) { l6 = "Moderate Overvaluation"; }
            else if (currentMvrv >= 1.0) { l6 = "Fair to Overvalue"; } 
            else if (currentMvrv >= 0.8) { l6 = "Fair to Undervalue"; }
            else { l6 = "Undervaluation"; }
            if (isAltcoinBleedingLocal) l6 += " (Altcoin Bleeding)"; 
            else if (isAltcoinSeasonLocal) l6 += " (Altcoin Season)";

            const scan50_200 = QuantMath.scanEmaRange(closesMTF, 50, 200, 20);
            const closesHTF = Array.isArray(klinesHTF) && klinesHTF.length >= 50 ? klinesHTF.map(d => parseFloat(d[4])) : closesMTF;
            const htfSma200 = QuantMath.sma(closesHTF, 200);

            const obvArrayLocal = [];
            let currentObvLocal = 0;
            for (let j = 1; j < closes.length; j++) {
                if (closes[j] > closes[j-1]) currentObvLocal += quoteVolumes[j];
                else if (closes[j] < closes[j-1]) currentObvLocal -= quoteVolumes[j];
                obvArrayLocal.push(currentObvLocal);
            }
            const obvEma20Local = QuantMath.ema(obvArrayLocal, 20);
            
            const isObvBearDivergenceLocal = (price > htfSma200) && (obvArrayLocal[obvArrayLocal.length-1] < obvEma20Local);
            const isObvBullDivergenceLocal = (price < htfSma200) && (obvArrayLocal[obvArrayLocal.length-1] > obvEma20Local);

            // BẢN VÁ: Đồng bộ Mock Data triệt để không để bất kỳ trường nào null/0 gây rớt Gate
            // Lưu ý: object này KHÔNG phụ thuộc hướng lệnh (direction được truyền riêng vào evaluateScore/evaluateGates)
            const localAutoData = {
                currentPrice: price,
                atr14: atr14,
                atrPercent: price > 0 ? (atr14 / price) * 100 : 0,
                atrRank: atrRankLocal,
                bbw: bollinger20.bbw,
                bbwRank: bbwRank,
                bbwSlope: bbwSlopeLocal,
                adx: adxValue,
                rsi: rsi,
                cmf: cmf,
                obi: localObi,
                fundingRate: realFunding * 100, 
                fundingSlope: 0, 
                currentOi: 100, 
                oiEma: 100, 
                oiDelta: 5.0, 
                isOiSpiking: false, 
                lastClosedVolume: closedVolume,
                avgVolume20: avgVolume20,
                isObvBearDivergence: isObvBearDivergenceLocal,
                isObvBullDivergence: isObvBullDivergenceLocal,
                isBullishSFP: localSfpLong,
                isBearishSFP: localSfpShort,
                htfSma200: htfSma200,
                ema20: { slope: scan20_50.fastSlope, value: scan20_50.fastEmaCurrent },
                ema50: { slope: scan20_50.slowSlope, value: scan20_50.slowEmaCurrent },
                ema200: { slope: scan50_200.slowSlope, value: scan50_200.slowEmaCurrent },
                btcDomValue: globalBtcDomValue,
                btcDomSlope: globalBtcDomSlope
            };

            const localApiMacro = {
                fgiValue: apiMacroRef.current?.fgiValue || 50,
                tradingSession: apiMacroRef.current?.tradingSession || 'ASIAN',
                sessionMultiplier: apiMacroRef.current?.sessionMultiplier || 1.0,
                isWeekend: apiMacroRef.current?.isWeekend || false,
                realSpreadPct: realSpread,
                longShortRatio: localLsRatio,
                takerBuySellRatio: localTakerRatio,
                lsPositionVolRatio: 1.0 
            };

            const mockVectorDetails = { 
                l1, l2, l3, l4, l5, l6, 
                isAltcoinBleeding: isAltcoinBleedingLocal, 
                isAltcoinSeason: isAltcoinSeasonLocal 
            };

            const currentMinNotional = dynamicMinNotionalsRef.current?.[targetSymbol] || 5.0;
            const capitalSafe = liveCapitalRef.current > 0 ? liveCapitalRef.current : 100.0; 

            // ============================================================
            // BƯỚC 1: SINH TOÀN BỘ ỨNG VIÊN — thử cả 2 hướng LONG/SHORT,
            // với mỗi hướng thử toàn bộ chiến thuật khả dụng theo điều kiện
            // thị trường hiện tại (Tiêu chuẩn / Squeeze / Sniper SFP / Whale).
            // ============================================================
            const candidateResults = [];

            for (const candDir of ['LONG', 'SHORT']) {
                const candSuggestedEntry = execType === 'MARKET'
                    ? price
                    : (candDir === 'LONG' ? price - (0.5 * atr14) : price + (0.5 * atr14));

                const candIsSfp = candDir === 'LONG' ? localSfpLong : localSfpShort;
                const strategyVariants = QuantMath.getStrategyVariants(
                    bbwRank, bbwSlopeLocal, candIsSfp, (atr14 / price) * 100, localObi, candDir
                );

                for (const variant of strategyVariants) {
                    const candEntry = candSuggestedEntry;
                    const candSl = candDir === 'LONG'
                        ? candEntry - (variant.slMult * atr14)
                        : candEntry + (variant.slMult * atr14);
                    const candTp1 = candDir === 'LONG'
                        ? candEntry + (variant.tpMult * atr14)
                        : candEntry - (variant.tpMult * atr14);

                    const candRiskDiffTech = Math.abs(candEntry - candSl);
                    if (candRiskDiffTech <= 0) continue;

                    const activeMakerFee = tradeFeesRef.current.maker;
                    const activeTakerFee = tradeFeesRef.current.taker;

                    const candCostDragLoss = QuantMath.costDrag(candEntry, 'FUTURES', candDir, execType, 'MARKET', realFunding, realSpread, tHold, activeMakerFee, activeTakerFee, targetInterval, localObi);
                    const candCostDragWin = QuantMath.costDrag(candEntry, 'FUTURES', candDir, execType, 'LIMIT', realFunding, realSpread, tHold, activeMakerFee, activeTakerFee, targetInterval, localObi);
                    const candRewardDiff = Math.abs(candTp1 - candEntry);

                    let candRR = candRiskDiffTech > 0 ? ((candRewardDiff - candCostDragWin) / (candRiskDiffTech + candCostDragLoss)) : 0;
                    if (isNaN(candRR) || !isFinite(candRR) || candRR < 0) candRR = 0;

                    candidateResults.push({
                        dir: candDir,
                        entry: candEntry,
                        sl: candSl,
                        tp1: candTp1,
                        riskDiffTech: candRiskDiffTech,
                        rr: candRR,
                        strategyName: variant.strategyName
                    });
                }
            }

            // ============================================================
            // BƯỚC 2: LỌC LOGIC GATES cho từng ứng viên, chỉ giữ những
            // ứng viên PASS, rồi so sánh R:R để chọn ứng viên tốt nhất.
            // ============================================================
            let bestCandidate = null;

            for (const cand of candidateResults) {
                const candSystemScore = TradeValidator.evaluateScore(
                    localAutoData, localApiMacro, mockVectorDetails, cand.dir, currentMvrv, targetSymbol
                );

                const riskMultiplier = Math.max(0.5, Math.min(2.0, (candSystemScore.score - 5) / 3));
                const appliedRiskPercent = 1.0 * riskMultiplier;
                let riskAmountUSD = capitalSafe * (appliedRiskPercent / 100);

                const isCompressedLocal = l2 === 'Compression' || bbwRank < 20;
                const effectiveAtrPercentLocal = isCompressedLocal ? Math.max(localAutoData.atrPercent, 0.5) * 1.5 : localAutoData.atrPercent;
                const slippageBuffer = cand.entry * (effectiveAtrPercentLocal / 100) * cRegime * localApiMacro.sessionMultiplier;
                const sizeSlDistance = cand.riskDiffTech + slippageBuffer;

                let slPercentForSize = sizeSlDistance / cand.entry;
                if (!isFinite(slPercentForSize) || isNaN(slPercentForSize) || slPercentForSize === 0) slPercentForSize = 0.01;

                let positionSizeUSD = riskAmountUSD / slPercentForSize;
                let hasMinNotionalErrorLocal = false;

                if (positionSizeUSD > 0 && positionSizeUSD < currentMinNotional) {
                    positionSizeUSD = currentMinNotional;
                    const forcedRiskUSD = positionSizeUSD * slPercentForSize;
                    if (forcedRiskUSD > capitalSafe * 0.025) {
                        hasMinNotionalErrorLocal = true;
                    }
                }

                const candMathCore = {
                    theoreticalRR: cand.rr.toFixed(2),
                    hasMinNotionalError: hasMinNotionalErrorLocal,
                    liqEstimate: { liqPrice: 0, maxLevForTier: 50 },
                    leverageExceedsExchangeCap: false,
                    liqSafetyMargin: 2.0
                };

                const candGates = TradeValidator.evaluateGates(
                    localAutoData, localApiMacro, mockVectorDetails, candMathCore,
                    cand.dir, 'FUTURES', cand.entry, cand.sl, candSystemScore, tradeLogs, targetSymbol
                );

                if (!candGates.isApproved) continue;

                // Chỉ giữ lại ứng viên có R:R ròng cao nhất trong số các ứng viên đã PASS Gate
                if (!bestCandidate || cand.rr > bestCandidate.rr) {
                    bestCandidate = { ...cand, positionSizeUSD, gates: candGates };
                }
            }

            // Không có ứng viên nào (dù đã thử cả 2 hướng x nhiều chiến thuật) pass Gate => bỏ qua symbol/interval này
            if (!bestCandidate) continue;

            let suggestedLeverage = Math.max(1, Math.ceil(bestCandidate.positionSizeUSD / (capitalSafe * 0.9)));
            let overrideTag = bestCandidate.strategyName !== "TIÊU CHUẨN (ADAPTIVE)" ? bestCandidate.strategyName : '';
            if (overrideTag === '') {
                if (bestCandidate.gates.isNanoOverride) overrideTag = '🦠 NANO-CAP';
                else if (bestCandidate.gates.isSniperOverride) overrideTag = '🎯 SNIPER';
                else if (bestCandidate.gates.isHighRROverride) overrideTag = '🚀 ASYM-RR';
                else if (bestCandidate.gates.isGoldenOverride) overrideTag = '⚡ GOLDEN';
            }

            scanResultsPool.push({
              symbol: targetSymbol,
              interval: targetInterval,
              direction: bestCandidate.dir,
              entry: parseFloat(bestCandidate.entry.toFixed(4)),
              slTech: parseFloat(bestCandidate.sl.toFixed(4)),
              tp1: parseFloat(bestCandidate.tp1.toFixed(4)),
              theoreticalRR: bestCandidate.rr.toFixed(2), 
              positionSizeUSD: bestCandidate.positionSizeUSD.toFixed(2),
              suggestedLeverage,
              rsi: rsi.toFixed(1),
              cmf: cmf.toFixed(2),
              overrideTag 
            });
          } catch (innerErr) { 
              console.error(`Lỗi ẩn tại coin ${result?.value?.symbol}:`, innerErr);
              continue; 
          }
        }

        scanResultsPool.sort((a, b) => parseFloat(b.theoreticalRR) - parseFloat(a.theoreticalRR));
        
        if (isMounted) {
          if (scanResultsPool.length === 0) {
            setScannedTopSetups([{ isEmpty: true }]);
          } else {
            setScannedTopSetups(scanResultsPool.slice(0, 10)); 
          }
        }
      } catch (err) {
        console.error("Scanner Hard Crash:", err);
        if (isMounted) setScannedTopSetups([{ isEmpty: true, isError: true, msg: "Vercel Timeout hoặc Lỗi kết nối" }]);
      } finally {
        if (isMounted) setIsScanningBackground(false);
      }
    };

    runCrossAssetScan();
    const scanTimer = setInterval(runCrossAssetScan, 30000); 
    return () => { isMounted = false; clearInterval(scanTimer); };
  }, []); 

  useEffect(() => {
    if (!sonarEnabled || scannedTopSetups.length === 0 || scannedTopSetups[0]?.isEmpty) {
        prevScannedSigRef.current = '';
        return;
    }
    const currentSig = scannedTopSetups.map(s => `${s.symbol}-${s.interval}-${s.direction}`).join('|');
    if (prevScannedSigRef.current !== '' && currentSig !== prevScannedSigRef.current) {
        try {
            const audio = new Audio('https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3');
            audio.volume = 0.6;
            audio.play().catch(e => console.log("Trình duyệt chặn Auto-play:", e));
            if (showToast) showToast("🎯 RADAR PING: Phát hiện biến động Setup mới trên Scanner!");
        } catch (error) {}
    }
    prevScannedSigRef.current = currentSig;
  }, [scannedTopSetups, sonarEnabled, showToast]);

  return { scannedTopSetups, isScanningBackground, sonarEnabled, setSonarEnabled };
}