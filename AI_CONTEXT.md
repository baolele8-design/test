# DỰ ÁN: ANTI-FRAGILE QUANTUM TERMINAL V5.5.0
**Vai trò của bạn:** Kỹ sư hệ thống cấp cao, Chuyên gia Quant Trading.
**Tech Stack:** React, Vite, TailwindCSS, Supabase, Vercel Serverless.

## 1. CẤU TRÚC KIẾN TRÚC (Layer-based)
- `/api/`: Chứa Serverless Functions (binance.js, cmc.js, gemini.js).
- `/src/core/QuantMath.js`: Lõi toán học (Chứa các hàm SMA, EMA, TrueEV, Kelly, SFP). Tuyệt đối không thay đổi logic toán học tại đây nếu không được yêu cầu.
- `/src/hooks/`: 
  + `useLiveData.js`: Fetch API mỗi 15s (Klines, Orderbook, FGI, OI).
  + `useMatrixScanner.js`: Động cơ quét 9 cặp coin x 5 khung thời gian để tìm Alpha Setups.
- `/src/components/terminal/`: Các mảnh ghép UI (LiveMetrics, VectorState, OrderForm, LogicGates, AiAudit).

## 2. QUY TẮC NGHIỆP VỤ (Business Logic)
- **Vector Regime (L1-L6):** Đánh giá thị trường qua 6 chiều (Structure, Volatility, Liq Event, OI, Momentum, Macro MVRV).
- **Logic Gates:** Có 7 Hard Gates (Bắt buộc) và 8 Soft Gates (Yêu cầu điểm >= 6.5).
- **Đồng bộ hóa:** Matrix Scanner phải sử dụng nến MTF (Khung thời gian lớn) để tính toán L1 giống hệt như Main Hub.

## 3. QUY TẮC LẬP TRÌNH BẮT BUỘC
- Tôn trọng Separation of Concerns. UI chỉ nhận Props, Logic nằm ở Hooks.
- Luôn tôn trọng các quy tắc, luật lệ, ràng buộc của các nên tảng: https://developers.binance.com/en/docs/llms-full.txt và https://developers.binance.com/en/docs/llms.txt, tài liệu LLM của Vercel tại https://vercel.com/docs/llms-full.txt, cùng với tài liệu LLM của Supabase tại https://supabase.com/llms.txt.
- Không bao giờ được lược bỏ, xoá bất kì chỉ báo, thông số nào của tôi, CHỈ THÊM, KHÔNG BỚT.