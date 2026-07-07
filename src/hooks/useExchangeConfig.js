// FILE: src/hooks/useExchangeConfig.js
import { useState, useEffect } from 'react';
import { POOL_SYMBOLS, MIN_NOTIONALS } from '../config/constants';

export default function useExchangeConfig() {
  const [dynamicMinNotionals, setDynamicMinNotionals] = useState(MIN_NOTIONALS);
  const [dynamicPool, setDynamicPool] = useState(POOL_SYMBOLS);

  useEffect(() => {
    let isMounted = true;
    const fetchExchangeData = async () => {
      try {
        const ts = Date.now();
        // 1. Fetch Min Notional trực tiếp từ Binance
        const exRes = await fetch(`/api/binance?path=/fapi/v1/exchangeInfo&t=${ts}`);
        const exData = await exRes.json();

        // 2. Fetch Ticker 24h để tìm Coin đang biến động mạnh (Dành cho Vốn nhỏ)
        const tickerRes = await fetch(`/api/binance?path=/fapi/v1/ticker/24hr&t=${ts}`);
        const tickerData = await tickerRes.json();

        if (!isMounted || !exData.symbols || !Array.isArray(tickerData)) return;

        // Xử lý Min Notional
        const newNotionals = { ...MIN_NOTIONALS };
        exData.symbols.forEach(sym => {
          const notionalFilter = sym.filters.find(f => f.filterType === 'MIN_NOTIONAL');
          if (notionalFilter) {
            newNotionals[sym.symbol] = parseFloat(notionalFilter.notional || 5);
          }
        });

        // Xử lý Thêm Coin Tự Động: Chọn Top 15 Coin USDT có Volume > 50M$ và Biến động % mạnh nhất
        const validTickers = tickerData
          .filter(t => t.symbol.endsWith('USDT') && !POOL_SYMBOLS.includes(t.symbol) && parseFloat(t.quoteVolume) > 50000000)
          .sort((a, b) => Math.abs(parseFloat(b.priceChangePercent)) - Math.abs(parseFloat(a.priceChangePercent)));
        
        const topVolatileCoins = validTickers.slice(0, 15).map(t => t.symbol);
        
        // Gộp 9 coin gốc và các coin mới (Chỉ thêm, không xóa)
        const mergedPool = [...new Set([...POOL_SYMBOLS, ...topVolatileCoins])];

        setDynamicMinNotionals(newNotionals);
        setDynamicPool(mergedPool);
      } catch (e) {
        console.error("⚠️ Lỗi Đồng bộ Dữ liệu Exchange Info:", e);
      }
    };

    fetchExchangeData();
    // Tự động cập nhật danh sách coin nóng mỗi 4 tiếng
    const timer = setInterval(fetchExchangeData, 14400000);
    return () => { isMounted = false; clearInterval(timer); };
  }, []);

  return { dynamicMinNotionals, dynamicPool };
}