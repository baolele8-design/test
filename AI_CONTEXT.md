# AI_CONTEXT: ANTI-FRAGILE QUANTUM TERMINAL V5.5.0

## 1. TỔNG QUAN KIẾN TRÚC (LAYER-BASED ARCHITECTURE)
Dự án được xây dựng trên Tech Stack: **React (Vite), TailwindCSS, Vercel Serverless (Node.js), Supabase (PostgreSQL), Gemini API**. 
Hệ thống tuân thủ nghiêm ngặt nguyên tắc **Separation of Concerns**: UI chỉ nhận Props để render, Core chứa logic toán học bất biến, Hooks xử lý vòng đời dữ liệu, và API Routes (Serverless) làm Proxy an toàn.

### Layer 1: Core Math & Models (`/src/core/`)
- **`QuantMath.js`**: Trái tim toán học của hệ thống. Chứa các thuật toán không được phép tự ý thay đổi: 
  + *Indicators*: SMA, EMA, ATR, ADX, RSI, Bollinger Bands, Percentile Rank, OBV, CMF.
  + *Risk & EV*: Cost Drag (tính ma sát phí/funding/spread), True Expected Value (True EV), Tiêu chuẩn Kelly (Kelly Criterion).
  + *Smart Money Concepts*: Phát hiện SFP (Swing Failure Pattern), Ước tính thanh lý (Liquidation Brackets).

### Layer 2: Data Engines (Custom Hooks - `/src/hooks/`)
- **`useLiveData.js`**: Động cơ Fetch Data đa chu kỳ (15s, 60s, 5m). 
  + Lấy nến Klines đa khung thời gian (MTF/HTF).
  + Lấy Orderflow: OI, Funding, Taker Buy/Sell, Long/Short Ratio.
  + *(Quan trọng)*: **Cross-Symbol Binding**: Quét toàn bộ `positionRisk` trên Binance (không lọc cứng symbol) để hỗ trợ quản lý đa vị thế.
- **`useMatrixScanner.js`**: Radar ngầm quét 9 cặp coin (BTC, ETH, SOL, BNB, LINK, XRP, ADA, DASH, AVAX) x 5 khung thời gian. Phát hiện các setup vượt 6.5 điểm Logic Gates.

### Layer 3: Giao diện Hệ thống (Terminal Components - `/src/components/`)
- **`MatrixScanner`**: Hiển thị các Setup được Radar tìm thấy.
- **`LiveMetrics` & `VectorState`**: Hiển thị bảng điều khiển 6 chiều không gian thị trường (L1-L6) và các chỉ số vi mô (RSI, ADX, CMF, Orderflow).
- **`OrderForm` & `LogicGates`**: Bảng điều khiển kích cỡ lệnh (Position Sizing), tính toán Min Notional, Kelly, True EV và 15 cổng kiểm duyệt (7 Hard, 8 Soft, 3 Overrides).
- **`AiAudit`**: Hội đồng 5 đặc vụ AI (Gemini 3.1 Flash-Lite) và Giám đốc Rủi ro (Gemini 3.5 Flash) thẩm định lệnh dựa trên Bayesian.
- **`TradeJournal`**: Sổ tay lượng tử hiển thị log, PnL thực (Live) và cảnh báo lệnh `GHOST_BINANCE`.

### Layer 4: Serverless API (Vercel - `/api/`)
- **`binance.js`**: Proxy an toàn giấu API Keys. Hỗ trợ tạo Order, BatchOrders và kéo dữ liệu REST API (fapi/vapi). Bọc lỗi toàn diện.
- **`cmc.js`**: Kéo vĩ mô (BTC Dominance, Total Marketcap, FGI) để lách luật CORS của Browser.
- **`gemini.js`**: Gọi Google Gemini Interactions API.

### Layer 5: Database & ML Dataset (Supabase PostgreSQL - `/src/services/`)
- **Bảng `trade_logs`**: Lưu nhật ký giao dịch phục vụ Machine Learning.
- Cơ sở dữ liệu sử dụng Realtime Postgres Changes. 
- *(Quan trọng)*: Sở hữu cột `meta_data` (JSONB) lưu trữ **TOÀN BỘ sinh trắc học hệ thống tại thời điểm vào lệnh** (Vector, Data, Math, Macro) để huấn luyện AI.

---

## 2. QUY TẮC NGHIỆP VỤ & WORKFLOWS (BUSINESS LOGIC)

### 2.1. Vòng đời Lệnh 3 Pha (3-Phase Lifecycle) & Cross-Symbol Binding
Vòng đời của một lệnh đi qua 3 trạng thái để tránh sai lệch dữ liệu PnL:
1. **`PENDING`**: Lệnh vượt qua Cửa Logic -> Nhấn *Lưu Sổ Tay* -> Đẩy vào Supabase với trạng thái PENDING.
2. **`OPEN` (Kích hoạt Auto-Sync)**: Người dùng lên Binance đặt lệnh thật. Động cơ `syncBinanceToSupabase` quét API `positionRisk`, tự động khớp Symbol có vị thế thật trên sàn với lệnh PENDING trên DB -> Đổi thành OPEN, ghi nhận giá Entry thật, cập nhật Live PnL, MFE/MAE (Max Favorable/Adverse Excursion).
3. **`CLOSED` (`WIN`/`LOSS`)**: Khi vị thế trên Binance biến mất (bằng 0), hệ thống tự động bốc giá đóng cửa và tính PnL cuối cùng để kết thúc vòng đời.
* Ngoại lệ: Lệnh **`GHOST_BINANCE`**: Cảnh báo rực lửa trên UI nếu phát hiện vị thế trên Binance nhưng không có trong Database (Chống vô kỷ luật).

### 2.2. Lõi Lọc Lệnh (Logic Gates)
- **7 Hard Gates**: Bắt buộc 100% Pass (Chống nhiễu, Regime Lock, Đệm thanh lý >30%, Không vi phạm rủi ro sinh tồn >5%).
- **8 Soft Gates**: Yêu cầu tổng điểm >= 6.5/10.0. Đánh giá Cấu trúc, Dòng tiền, SFP, RSI, Tâm lý, Volume Taker, Squeeze, Macro HTF.
- **Overrides (Đặc quyền bẻ cổng Hard Gates)**:
  + `GOLDEN TICKET`: Setup đạt >= 8.5 điểm, Synergy cực mạnh. Vượt lỗi Regime.
  + `SNIPER SFP`: Setup có cấu trúc SFP rõ ràng, đạt >= 7.0 điểm. Vượt lỗi SL mỏng.
  + `ASYMMETRIC PAYOFF`: Setup có tỷ lệ True R:R siêu cao (>= 2.5), đạt >= 7.0 điểm. Vượt lỗi Volume cạn.

### 2.3. Trí tuệ Nhân tạo & Bayesian Updating
- Tự động thống kê `winRate` và `historicalRR` của 30 lệnh đóng gần nhất (Prior Bayesian).
- Bơm toàn bộ dữ liệu này cùng chỉ số thanh lý, ma sát giao dịch, và 6 chiều không gian vào Master Prompt của AI để AI hiểu được thói quen và "sức khỏe" của tài khoản, qua đó đưa ra phán quyết "DUYỆT" hoặc "ĐỨNG NGOÀI" sát với thực tế nhất.

---

## 3. QUY TẮC LẬP TRÌNH (BẮT BUỘC)
- KHÔNG ĐƯỢC PHÉP lược bỏ, xoá, hay làm hỏng logic của Toán học (`QuantMath.js`), cấu trúc Vector 6 chiều, Logic Gates, và Cột `meta_data` JSONB. QUY TẮC: CHỈ THÊM, KHÔNG BỚT.
- Tôn trọng quy luật, cách thức dùng, và giới hạn API từ các tài liệu mới nhất từ các nền tảng: Binance tại https://developers.binance.com/en/docs/llms-full.txt và https://developers.binance.com/en/docs/llms.txt, tài liệu LLM của Vercel tại https://vercel.com/docs/llms-full.txt, cùng với tài liệu LLM của Supabase tại https://supabase.com/llms.txt.
- Khi có thay đổi liên quan đến `useLiveData.js` hoặc Vercel API, không được phép bóp hẹp lại tầm nhìn (phải duy trì quét toàn sàn thay vì khóa cứng một `symbol`).