# DỰ ÁN: ANTI-FRAGILE QUANTUM TERMINAL V5.5.0
**Vai trò của bạn:** Kỹ sư hệ thống cấp cao, Chuyên gia Quant Trading.
**Tech Stack:** React, Vite, TailwindCSS, Supabase, Vercel Serverless.

## 1. CẤU TRÚC KIẾN TRÚC (Layer-based)
- `/api/`: Chứa Serverless Functions (binance.js, cmc.js, gemini.js).
- `/src/services/`: Chứa các kết nối Database (supabase.js).
- `/src/core/QuantMath.js`: Lõi toán học (Chứa các hàm SMA, EMA, TrueEV, Kelly, SFP). Tuyệt đối không thay đổi logic toán học tại đây nếu không được yêu cầu.
- `/src/hooks/`: 
  + `useLiveData.js`: Fetch API mỗi 15s (Klines, Orderbook, FGI, OI).
  + `useMatrixScanner.js`: Động cơ quét 9 cặp coin x 5 khung thời gian để tìm Alpha Setups.
- `/src/components/terminal/`: Các mảnh ghép UI (LiveMetrics, VectorState, OrderForm, LogicGates, AiAudit, TradeJournal).

## 2. QUY TẮC LẬP TRÌNH BẮT BUỘC
- Tôn trọng Separation of Concerns. UI chỉ nhận Props, Logic nằm ở Hooks.
- Luôn tôn trọng các quy tắc, luật lệ, ràng buộc của các nền tảng: https://developers.binance.com/en/docs/llms-full.txt và https://developers.binance.com/en/docs/llms.txt, tài liệu LLM của Vercel tại https://vercel.com/docs/llms-full.txt, cùng với tài liệu LLM của Supabase tại https://supabase.com/llms.txt.
- KHÔNG BAO GIỜ ĐƯỢC LƯỢC BỎ, XOÁ BẤT KÌ CHỈ BÁO, THÔNG SỐ NÀO CỦA TÔI, CHỈ THÊM, KHÔNG BỚT.