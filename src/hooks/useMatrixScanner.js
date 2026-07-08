// FILE: src/hooks/useMatrixScanner.js
import { useState, useEffect, useRef } from 'react';
import QuantMath from '../core/QuantMath';
import { POOL_INTERVALS, POOL_SYMBOLS } from '../config/constants';

export default function useMatrixScanner({ 
  liveCapital, autoData, mvrvZScore, tradeFees, apiMacro, showToast, 
  dynamicPool, dynamicMinNotionals, setSystemHealth, systemHealth
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
            const response = await fetch(url, { signal: controller.signal });
            clearTimeout(id);
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
        const ts = Date.now();
        const scanResultsPool = [];
        const realtimeMetrics = {};
        
        try {
            // Đâm thẳng vào API Binance, tối ưu hóa tốc độ xử lý gói tin
            const [allBook, allPrem] = await Promise.all([
                fetchWithTimeout(`https://fapi.binance.com/fapi/v1/ticker/bookTicker?t=${ts}`, 10000),
                fetchWithTimeout(`https://fapi.binance.com/fapi/v1/premiumIndex?t=${ts}`, 10000)
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
            const fullUrl = `https://fapi.binance.com/fapi/v1/klines?${binanceQueryStr}`;
            if (fetchCache.has(fullUrl)) return fetchCache.get(fullUrl);
            await new Promise(res => setTimeout(res, Math.random() * 500));
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

        const SYMBOL_CHUNK_SIZE = 3; 
        const results = [];

        for (let i = 0; i < fetchTasks.length; i += SYMBOL_CHUNK_SIZE) {
          if (systemHealthRef.current && systemHealthRef.current.weight > 1800) {
              await new Promise(resolve => setTimeout(resolve, 3000));
          }

          const taskChunk = fetchTasks.slice(i, i + SYMBOL_CHUNK_SIZE);
          const chunkPromises = [];
          
          for (const task of taskChunk) {
            let mtfInterval = task.interval === '15m' ? '1h' : (task.interval === '1h' ? '4h' : '1d');
            let macroInterval = task.interval === '1w' ? '1d' : task.interval;

            const taskPromise = Promise.all([
              memoizedFetch(`symbol=${task.symbol}&interval=${task.interval}&limit=250`),
              fetchWithTimeout(`https://fapi.binance.com/futures/data/takerlongshortRatio?symbol=${task.symbol}&period=${macroInterval}&limit=1`),
              fetchWithTimeout(`https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=${task.symbol}&period=${macroInterval}&limit=1`),
              memoizedFetch(`symbol=${task.symbol}&interval=${mtfInterval}&limit=250`),
              memoizedFetch(`symbol=${task.symbol}&interval=1d&limit=250`)
            ]).then(([klines, takerData, lsData, klinesMTF, klinesHTF]) => ({
              symbol: task.symbol,
              interval: task.interval,
              klines,
              klinesMTF, 
              klinesHTF,
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
            const { symbol: targetSymbol, interval: targetInterval, klines, klinesMTF, klinesHTF, localTakerRatio, localLsRatio } = result.value;

            let closesMTF = Array.isArray(klinesMTF) && klinesMTF.length >= 50 ? klinesMTF.map(d => parseFloat(d[4])) : klines.map(d => parseFloat(d[4]));
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

            let dir = l1.includes('Trend Up') ? 'LONG' : 'SHORT'; 
            let execType = 'LIMIT';
            if (l1 === 'Range' || l2 === 'Extreme') {
                if (rsi < 45) { dir = "LONG"; }
                else if (rsi > 55) { dir = "SHORT"; }
                else { dir = cmf > 0 ? "LONG" : "SHORT"; }
                execType = 'MARKET'; 
            }

            let cRegime = 1.0; let tHold = 3;
            if (l1.includes('Trend')) { cRegime = 1.2; tHold = 9; }
            else if (l2 === 'Extreme') { cRegime = 0.5; tHold = 1; }
            else { cRegime = 0.8; tHold = 2; }

            const localObi = realtimeMetrics[targetSymbol]?.obi !== undefined ? realtimeMetrics[targetSymbol].obi : 0.5;
            
            const localSfpLong = QuantMath.detectSFP_Advanced(highs, lows, closes, quoteVolumes, avgVolume20, 'LONG');
            const localSfpShort = QuantMath.detectSFP_Advanced(highs, lows, closes, quoteVolumes, avgVolume20, 'SHORT');

            const { tpMult, slMult, strategyName } = QuantMath.dynamicAsymmetricTargets(
                bbwRank, bbwSlopeLocal, (dir === 'LONG' ? localSfpLong : localSfpShort), 
                (atr14/price)*100, localObi, dir
            );

            let suggestedEntry = price;
            if (!(l1 === 'Range' || l2 === 'Extreme')) {
                suggestedEntry = dir === 'LONG' ? price - (0.5 * atr14) : price + (0.5 * atr14);
            }
            const entry = suggestedEntry;
            const sl = dir === 'LONG' ? entry - (slMult * atr14) : entry + (slMult * atr14);
            const tp1 = dir === 'LONG' ? entry + (tpMult * atr14) : entry - (tpMult * atr14);

            const riskDiffTech = Math.abs(entry - sl);
            const realSpread = realtimeMetrics[targetSymbol]?.spread || 0.05;
            const realFunding = realtimeMetrics[targetSymbol]?.funding || 0.0002;
            
            const activeMakerFee = tradeFeesRef.current?.maker || 0.0002;
            const activeTakerFee = tradeFeesRef.current?.taker || 0.0004;
            
            const costDragLoss = QuantMath.costDrag(entry, 'FUTURES', dir, execType, 'MARKET', realFunding, realSpread, tHold, activeMakerFee, activeTakerFee, targetInterval, localObi);
            const costDragWin = QuantMath.costDrag(entry, 'FUTURES', dir, execType, 'LIMIT', realFunding, realSpread, tHold, activeMakerFee, activeTakerFee, targetInterval, localObi);
            const rewardDiff = Math.abs(tp1 - entry);
            
            let simulatedRR = riskDiffTech > 0 ? ((rewardDiff - costDragWin) / (riskDiffTech + costDragLoss)) : 0;
            if (isNaN(simulatedRR) || !isFinite(simulatedRR) || simulatedRR < 0) simulatedRR = 0;

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

            let w = { s1: 2.0, s2: 1.5, s3: 1.5, s4: 1.0, s5: 1.0, s6: 1.5, s7: 1.0, s8: 1.5 }; 
            if (l1 === 'Range') { w = { s1: 0, s2: 1.5, s3: 4.0, s4: 2.0, s5: 1.5, s6: 1.0, s7: 1.0, s8: 1.0 }; } 
            else if (l2 === 'Extreme') { w = { s1: 0, s2: 1.0, s3: 3.5, s4: 2.5, s5: 1.5, s6: 2.0, s7: 1.5, s8: 0.5 }; } 
            else if (l1.includes('Trend') && l2 === 'Expansion') { w = { s1: 3.0, s2: 2.5, s3: 0, s4: 1.0, s5: 1.0, s6: 2.5, s7: 1.0, s8: 2.0 }; }

            const checkS1 = dir === (l1.includes('Trend Up') ? 'LONG' : 'SHORT');
            const checkS2 = dir === 'LONG' ? cmf > 0.05 : cmf < -0.05;
            const checkS3 = dir === 'LONG' ? localSfpLong : localSfpShort;
            const checkS4 = dir === 'LONG' ? (l1.includes('Trend') ? rsi < 65 : rsi < 40) : (l1.includes('Trend') ? rsi > 35 : rsi > 60); 
            const checkS5 = dir === 'LONG' ? localLsRatio < 1.0 : localLsRatio > 1.0; 
            
            if (l2 === 'Compression' && bbwSlopeLocal > 10) embeddedScore += 2.0;
            if (l2 === 'Compression' && ((dir === 'LONG' && localObi > 0.7 && checkS6) || (dir === 'SHORT' && localObi < 0.3 && checkS6))) embeddedScore += 2.0;
            if (l2 === 'Compression' && checkS2 && checkS6) embeddedScore += 2.0;
            if (l2 === 'Extreme' && checkS3 && checkS4) embeddedScore += 2.0;
            if (localVolSpike && !checkS5 && checkS6) embeddedScore += 1.5;

            const isApproved = (simulatedRR >= (bbwRank > 80 ? 1.5 : 1.2)) && (l1 !== 'Transition' && l2 !== 'Compression') && isVolSafe && isSLSafe;
            if (!isApproved) continue; 

            scanResultsPool.push({
              symbol: targetSymbol, interval: targetInterval, direction: dir,
              entry: parseFloat(entry.toFixed(4)), slTech: parseFloat(sl.toFixed(4)), tp1: parseFloat(tp1.toFixed(4)),
              theoreticalRR: simulatedRR.toFixed(2), positionSizeUSD: (liveCapitalRef.current * 0.01 / (riskDiffTech/entry)).toFixed(2),
              suggestedLeverage: Math.max(1, Math.ceil(liveCapitalRef.current / 100)), rsi: rsi.toFixed(1), cmf: cmf.toFixed(2), overrideTag: strategyName !== "TIÊU CHUẨN (ADAPTIVE)" ? strategyName : ''
            });
          } catch (innerErr) { continue; }
        }

        scanResultsPool.sort((a, b) => parseFloat(b.theoreticalRR) - parseFloat(a.theoreticalRR));
        if (isMounted) setScannedTopSetups(scanResultsPool.length === 0 ? [{ isEmpty: true }] : scanResultsPool.slice(0, 10));
      } catch (err) {
        if (isMounted) setScannedTopSetups([{ isEmpty: true, isError: true, msg: "Lỗi mạng" }]);
      } finally {
        if (isMounted) setIsScanningBackground(false);
      }
    };

    runCrossAssetScan();
    const scanTimer = setInterval(runCrossAssetScan, 40000); 
    return () => { isMounted = false; clearInterval(scanTimer); };
  }, []); 

  return { scannedTopSetups, isScanningBackground, sonarEnabled, setSonarEnabled };
}