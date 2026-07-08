// FILE: src/hooks/useExchangeConfig.js
import { useState, useEffect } from 'react';
import { POOL_SYMBOLS, MIN_NOTIONALS } from '../config/constants';

export default function useExchangeConfig() {
  const [dynamicMinNotionals, setDynamicMinNotionals] = useState(MIN_NOTIONALS);
  const [dynamicPool, setDynamicPool] = useState(POOL_SYMBOLS);
  const [stepSizes, setStepSizes] = useState({});
  const [tickSizes, setTickSizes] = useState({});

  useEffect(() => {
    let isMounted = true;
    const fetchExchangeData = async () => {
      try {
        const ts = Date.now();
        const exRes = await fetch(`/api/binance?path=/fapi/v1/exchangeInfo&t=${ts}`);
        const exData = await exRes.json();

        const tickerRes = await fetch(`/api/binance?path=/fapi/v1/ticker/24hr&t=${ts}`);
        const tickerData = await tickerRes.json();

        if (!isMounted || !exData.symbols || !Array.isArray(tickerData)) return;

        const newNotionals = { ...MIN_NOTIONALS };
        const newStepSizes = {};
        const newTickSizes = {};

        exData.symbols.forEach(sym => {
          const notionalFilter = sym.filters.find(f => f.filterType === 'MIN_NOTIONAL');
          if (notionalFilter) newNotionals[sym.symbol] = parseFloat(notionalFilter.notional || 5);
          
          const lotSize = sym.filters.find(f => f.filterType === 'LOT_SIZE');
          if (lotSize) newStepSizes[sym.symbol] = parseFloat(lotSize.stepSize);
          
          const priceFilter = sym.filters.find(f => f.filterType === 'PRICE_FILTER');
          if (priceFilter) newTickSizes[sym.symbol] = parseFloat(priceFilter.tickSize);
        });

        const validTickers = tickerData
          .filter(t => t.symbol.endsWith('USDT') && !POOL_SYMBOLS.includes(t.symbol) && parseFloat(t.quoteVolume) > 30000000)
          .sort((a, b) => Math.abs(parseFloat(b.priceChangePercent)) - Math.abs(parseFloat(a.priceChangePercent)));
        
        const topVolatileCoins = validTickers.slice(0, 15).map(t => t.symbol);
        const mergedPool = [...new Set([...POOL_SYMBOLS, ...topVolatileCoins])];

        setDynamicMinNotionals(newNotionals);
        setStepSizes(newStepSizes);
        setTickSizes(newTickSizes);
        setDynamicPool(mergedPool);
      } catch (e) {
        console.error("⚠️ Lỗi Đồng bộ Dữ liệu Exchange Info:", e);
      }
    };

    fetchExchangeData();
    const timer = setInterval(fetchExchangeData, 600000); // ĐÃ FIX: 10 phút cập nhật dòng tiền 1 lần
    return () => { isMounted = false; clearInterval(timer); };
  }, []);

  return { dynamicMinNotionals, dynamicPool, stepSizes, tickSizes };
}