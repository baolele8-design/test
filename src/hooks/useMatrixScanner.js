import { useState, useEffect } from 'react';
import { supabase } from '../services/supabase';

export default function useMatrixScanner({ showToast, sonarEnabled }) {
  const [scannedTopSetups, setScannedTopSetups] = useState([]);
  const [isScanningBackground, setIsScanningBackground] = useState(true);

  useEffect(() => {
    let isMounted = true;

    if (!supabase) {
        console.error("⚠️ Supabase Client chưa khởi tạo. Kiểm tra biến môi trường VITE_SUPABASE_URL!");
        return;
    }

    const fetchSignals = async () => {
      const { data, error } = await supabase
        .from('matrix_signals')
        .select('*')
        .order('theoretical_rr', { ascending: false });

      if (isMounted) {
        if (!error && data && data.length > 0) {
            const mappedData = data.map(d => ({
                symbol: d.symbol, interval: d.interval, direction: d.direction,
                entry: d.entry, slTech: d.sl_tech, tp1: d.tp_1,
                theoreticalRR: d.theoretical_rr, positionSizeUSD: d.position_size_usd,
                suggestedLeverage: d.suggested_leverage, rsi: d.rsi, cmf: d.cmf, overrideTag: d.override_tag
            }));
            setScannedTopSetups(mappedData);
        } else {
            setScannedTopSetups([{ isEmpty: true }]);
        }
        setIsScanningBackground(false);
      }
    };

    // Lấy dữ liệu lần đầu
    fetchSignals();

    // Subscribe nhận tín hiệu Realtime từ Local Daemon gửi lên[cite: 6]
    const subscription = supabase.channel('public:matrix_signals')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'matrix_signals' }, (payload) => {
          fetchSignals(); 
          if (sonarEnabled && showToast) {
             try {
                const audio = new Audio('https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3');
                audio.volume = 0.6; audio.play().catch(() => {});
             } catch(e) {}
             showToast("🎯 RADAR PING: Tín hiệu mới từ Local Daemon!");
          }
      }).subscribe();

    return () => { isMounted = false; supabase.removeChannel(subscription); };
  }, [sonarEnabled, showToast]);

  return { scannedTopSetups, isScanningBackground, sonarEnabled, setSonarEnabled };
}