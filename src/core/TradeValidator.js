/// FILE: src/core/TradeValidator.js

export const TradeValidator = {
  // 1. HỆ THỐNG CHẤM ĐIỂM (SCORING & PENALTY ENGINE)
  evaluateScore: (autoData, apiMacro, vectorDetails, direction, mvrvZScore, symbol) => {
    if (!autoData || !apiMacro || !vectorDetails) return { score: 0, synergyText: "", penaltyText: "", checks: {}, w: {} };
    
    const { l1, l2, l6, isAltcoinBleeding, isAltcoinSeason } = vectorDetails;
    let w = { s1: 2.0, s2: 2.0, s3: 1.5, s4: 0.5, s5: 1.0, s6: 1.5, s7: 1.0, s8: 1.5 }; 
    if (l1 === 'Range') { w = { s1: 0, s2: 2.0, s3: 4.0, s4: 1.0, s5: 1.5, s6: 1.0, s7: 1.0, s8: 1.0 }; } 
    else if (l2 === 'Extreme') { w = { s1: 0, s2: 1.5, s3: 3.5, s4: 1.0, s5: 1.5, s6: 2.0, s7: 1.5, s8: 0.5 }; } 
    else if (l1.includes('Trend') && l2 === 'Expansion') { w = { s1: 3.0, s2: 2.5, s3: 0, s4: 0.5, s5: 1.0, s6: 2.5, s7: 1.0, s8: 2.0 }; }

    const isVolSpikeHUD = autoData.lastClosedVolume > (autoData.avgVolume20 * 2.5);

    const checkS1 = direction === (l1 === 'Trend Up' ? 'LONG' : 'SHORT');
    const checkS2 = direction === 'LONG' ? autoData.cmf > 0.05 : autoData.cmf < -0.05;
    const checkS3 = direction === 'LONG' ? autoData.isBullishSFP : autoData.isBearishSFP;
    const checkS4 = direction === 'LONG' ? (l1.includes('Trend') ? autoData.rsi < 65 : autoData.rsi < 40) : (l1.includes('Trend') ? autoData.rsi > 35 : autoData.rsi > 60); 
    const checkS5 = direction === 'LONG' ? apiMacro.longShortRatio < 1.0 : apiMacro.longShortRatio > 1.0; 
    const checkS6 = direction === 'LONG' ? (apiMacro.takerBuySellRatio > 1.05 && !autoData.isObvBearDivergence) : (apiMacro.takerBuySellRatio < 0.95 && !autoData.isObvBullDivergence);
    const checkS7 = direction === 'LONG' ? (autoData.fundingRate < 0 && isVolSpikeHUD) : (autoData.fundingRate > 0 && isVolSpikeHUD);
    const checkS8 = direction === 'LONG' ? (autoData.currentPrice > autoData.htfSma200 && autoData.ema200.slope > 0) : (autoData.currentPrice < autoData.htfSma200 && autoData.ema200.slope < 0);

    let score = 0; 
    if (checkS1) score += w.s1; if (checkS2) score += w.s2; if (checkS3) score += w.s3; if (checkS4) score += w.s4; 
    if (checkS5) score += w.s5; if (checkS6) score += w.s6; if (checkS7) score += w.s7; if (checkS8) score += w.s8;

    let synergyText = "";
    if (l2 === 'Compression' && checkS2 && checkS6) { score += 2.0; synergyText += "[💣 The Spring] "; }
    if (l2 === 'Extreme' && checkS3 && checkS4) { score += 2.0; synergyText += "[🩸 Capitulation Sweep] "; }
    if (isVolSpikeHUD && !checkS5 && checkS6) { score += 1.5; synergyText += "[🪤 Smart Money Trap] "; }
    if (direction === 'LONG' && isAltcoinSeason) { score += 1.0; synergyText += "[🌊 Altcoin Season] "; }

    const isTripleTrendBull = autoData.ema20.slope > 0 && autoData.ema50.slope > 0 && autoData.ema200.slope > 0;
    const isTripleTrendBear = autoData.ema20.slope < 0 && autoData.ema50.slope < 0 && autoData.ema200.slope < 0;
    if ((direction === 'LONG' && isTripleTrendBull) || (direction === 'SHORT' && isTripleTrendBear)) { score += 1.5; synergyText += "[🚅 Triple-Engine] "; }
    if (autoData.adx > 35 && checkS6) { score += 1.5; synergyText += "[🌪️ ADX Squeeze] "; }
    if ((direction === 'LONG' && mvrvZScore < 1.0 && checkS3) || (direction === 'SHORT' && mvrvZScore > 2.5 && checkS3)) { score += 1.5; synergyText += "[💎 Deep Value Sweep] "; }
    if (l2 === 'Compression' && autoData.bbwSlope > 10) { score += 2.0; synergyText += "[🧨 Vol Expansion] "; }
    if (l2 === 'Compression' && ((direction === 'LONG' && autoData.obi > 0.7 && checkS6) || (direction === 'SHORT' && autoData.obi < 0.3 && checkS6))) { score += 2.0; synergyText += "[🐳 Whale Accumulation] "; }

    let penaltyText = "";
    if (direction === 'LONG' && isAltcoinBleeding) { score -= 2.0; penaltyText += "[-2.0 Altcoins Bleeding] "; }
    if (direction === 'LONG' && l6.includes('Overvaluation')) { score -= 1.5; penaltyText += "[-1.5 MVRV Overvalue] "; }
    if (direction === 'SHORT' && l6.includes('Undervaluation')) { score -= 1.5; penaltyText += "[-1.5 MVRV Undervalue] "; }
    
    if (autoData.adx > 55) { score -= 1.5; penaltyText += "[-1.5 ADX Exhaustion] "; }
    if (apiMacro.tradingSession === 'NEW_YORK' && l1.includes('Trend')) { score -= 1.5; penaltyText += "[-1.5 NY Session Trap] "; }

    return { score, synergyText, penaltyText, checks: { checkS1, checkS2, checkS3, checkS4, checkS5, checkS6, checkS7, checkS8 }, w };
  },

  // 2. HỆ THỐNG MÀNG LỌC VÀ OVERRIDES (LOGIC GATES ENGINE)
  evaluateGates: (autoData, apiMacro, vectorDetails, mathCore, direction, tradeType, entry, slTech, systemScore, tradeLogs, symbol) => {
    const { l1, l2, l3 } = vectorDetails;
    const { score, synergyText, penaltyText, checks, w } = systemScore;
    const requiredRR = autoData.bbwRank > 80 ? 2.0 : 1.8;

    const recentLossSameDirection = tradeLogs && tradeLogs.some(log => 
        log.symbol === symbol && 
        log.direction === direction && 
        log.status === 'LOSS' &&
        (Date.now() - new Date(log.close_time).getTime()) < 2 * 60 * 60 * 1000 
    );

    const hardGates = [
      { id: 'h_cd', passed: !recentLossSameDirection, text: `COOLDOWN: Không nhồi lệnh cùng hướng ${direction} sau khi bị SL trong 2H qua.` },
      { id: 'h1', passed: apiMacro.realSpreadPct < 0.2 && slTech > 0 && Math.abs(entry - slTech) > (autoData.atr14 * 0.4), text: `CHỐNG NHIỄU: Khoảng cách SL > 0.4 ATR` },
      { id: 'h2', passed: parseFloat(mathCore.theoreticalRR) >= requiredRR, text: `KỲ VỌNG EV: R:R ròng >= ${requiredRR}` },
      { id: 'h3_1', passed: l1 !== 'Transition', text: `REGIME LOCK: Xu hướng rõ ràng` },
      { id: 'h3_2', passed: l2 !== 'Compression', text: `VOLATILITY: Không giao dịch trong vùng Nén` },
      { id: 'h4', passed: tradeType === 'SPOT' || (mathCore.liqEstimate && !mathCore.leverageExceedsExchangeCap && mathCore.liqSafetyMargin >= 1.3), text: `ĐỆM THANH LÝ: An toàn Margin` },
      { id: 'h5', passed: !mathCore.hasMinNotionalError, text: `MIN NOTIONAL: Risk bị ép <= 2.5% Vốn` },
      { id: 'h6', passed: autoData.lastClosedVolume >= (autoData.avgVolume20 * 0.4), text: `VOL DEADZONE: Thanh khoản ổn định` }
    ];

    const softGates = [
      { id: 's1', passed: checks.checkS1, weight: w.s1, text: `CẤU TRÚC L1 (+${w.s1})` },
      { id: 's2', passed: checks.checkS2, weight: w.s2, text: `DÒNG TIỀN CMF (+${w.s2})` },
      { id: 's3', passed: checks.checkS3, weight: w.s3, text: `SĂN THANH KHOẢN (+${w.s3})` },
      { id: 's4', passed: checks.checkS4, weight: w.s4, text: `ĐỘNG LƯỢNG (+${w.s4})` },
      { id: 's5', passed: checks.checkS5, weight: w.s5, text: `TÂM LÝ (+${w.s5})` },
      { id: 's6', passed: checks.checkS6, weight: w.s6, text: `ORDER FLOW (+${w.s6})` },
      { id: 's7', passed: checks.checkS7, weight: w.s7, text: `SQUEEZE (+${w.s7})` },
      { id: 's8', passed: checks.checkS8, weight: w.s8, text: `HỢP LƯU VĨ MÔ (+${w.s8})` }
    ];

    if (synergyText) softGates.push({ id: 's_syn', passed: true, weight: 0, text: `🔥 SYNERGY BONUS: ${synergyText}` });
    if (penaltyText) softGates.push({ id: 's_pen', passed: false, weight: 0, text: `⚠️ MACRO PENALTY: ${penaltyText}` });

    const hardPassed = hardGates.every(g => g.passed);
    const failedGates = hardGates.filter(g => !g.passed);

    const isOnlyRegimeFailed = failedGates.length > 0 && failedGates.every(g => g.id === 'h3_1' || g.id === 'h3_2');
    const isSafeFromKnife = direction === 'LONG' ? (autoData.cmf > 0.15 && autoData.rsi > 35) : (autoData.cmf < -0.15 && autoData.rsi < 65);
    const isGoldenOverride = isOnlyRegimeFailed && synergyText !== "" && isSafeFromKnife;
    
    const isOnlySLFailed = failedGates.length > 0 && failedGates.every(g => g.id === 'h1');
    const isSniperOverride = isOnlySLFailed && checks.checkS3;

    // BẢN VÁ: R:R >= 2.5 LÀ VUA. 
    // Hệ thống sẽ cho phép duyệt lệnh miễn là KHÔNG vi phạm Min Notional (Rủi ro cháy tài khoản).
    const isHighRROverride = parseFloat(mathCore.theoreticalRR) >= 2.5 && !mathCore.hasMinNotionalError && !failedGates.some(g => g.id === 'h_cd');

    const isNanoCapSniper = parseFloat(mathCore.theoreticalRR) >= 2.5 && (l2 === 'Compression' || l3.includes('SFP') || l3.includes('Squeeze Imminent') || (direction === 'LONG' && autoData.obi > 0.7) || (direction === 'SHORT' && autoData.obi < 0.3)) && !mathCore.hasMinNotionalError;
    const isNanoOverride = failedGates.length > 0 && failedGates.every(g => g.id === 'h3_1' || g.id === 'h6') && isNanoCapSniper;

    // BẢN VÁ DẤU NGOẶC ĐƠN QUAN TRỌNG NHẤT: Đưa điều kiện Score vào kẹp chung với từng Override
    // Bây giờ, nếu lệnh có R:R siêu ngạch (>=2.5), nó chỉ cần Score đạt 4.5 là Pass!
    const isApproved = (hardPassed && score >= 6.5) || 
                       (isGoldenOverride && score >= 7.0) || 
                       (isSniperOverride && score >= 6.0) || 
                       (isHighRROverride && score >= 4.5) || 
                       (isNanoOverride && score >= 4.5); 
    
    return { hardGates, softGates, softScore: score, isApproved, isGoldenOverride, isSniperOverride, isHighRROverride, isNanoOverride };
  }
};