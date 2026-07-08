/// FILE: api/binance.js

export const config = {
  runtime: 'edge', // Bắt buộc chạy trên Edge Network toàn cầu của Vercel
};

// Hàm mã hóa HMAC SHA-256 tương thích Edge (Web Crypto API)
async function hmacSha256(key, message) {
  const encoder = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(message));
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export default async function handler(req) {
  const API_KEY = process.env.BINANCE_API_KEY;
  const API_SECRET = process.env.BINANCE_API_SECRET;
  const url = new URL(req.url);

  try {
    // =========================================================================
    // 1. LUỒNG ĐẶT LỆNH (POST) - HỖ TRỢ ĐƠN LỆNH & CỤM LỆNH (BATCH)
    // =========================================================================
    if (req.method === 'POST') {
      if (!API_KEY || !API_SECRET) {
        return new Response(JSON.stringify({ error: 'Missing API Keys on Backend.' }), { status: 500 });
      }

      const body = await req.json();

      // ---------------------------------------------------------------------
      // Bypass Ký hợp đồng TradFi (Vàng, Bạc, Ngoại hối)
      // ---------------------------------------------------------------------
      if (body.action === 'SIGN_TRADFI') {
        const params = new URLSearchParams();
        params.append('timestamp', Date.now().toString());
        params.append('recvWindow', '5000');
        
        const queryString = params.toString();
        const signature = await hmacSha256(API_SECRET, queryString);
        
        const targetUrl = `https://fapi.binance.com/fapi/v1/stock/contract?${queryString}&signature=${signature}`;
        
        const binanceRes = await fetch(targetUrl, {
          method: 'POST',
          headers: {
            'X-MBX-APIKEY': API_KEY,
            'Content-Type': 'application/x-www-form-urlencoded'
          }
        });

        const textRaw = await binanceRes.text();
        let data;
        try { data = JSON.parse(textRaw); } catch(e) { data = { msg: textRaw } };

        if (!binanceRes.ok) return new Response(JSON.stringify({ error: 'TradFi Sign Failed', details: data }), { status: binanceRes.status });
        return new Response(JSON.stringify(data), { status: 200 });
      }

      // ---------------------------------------------------------------------
      // Logic Batch Orders
      // ---------------------------------------------------------------------
      if (body.batchOrders) {
        const params = new URLSearchParams();
        params.append('batchOrders', JSON.stringify(body.batchOrders));
        params.append('timestamp', Date.now().toString());
        params.append('recvWindow', '5000');
        
        const queryString = params.toString();
        const signature = await hmacSha256(API_SECRET, queryString);
        
        const targetUrl = `https://fapi.binance.com/fapi/v1/batchOrders?${queryString}&signature=${signature}`;
        
        const binanceRes = await fetch(targetUrl, {
          method: 'POST',
          headers: {
            'X-MBX-APIKEY': API_KEY,
            'Content-Type': 'application/x-www-form-urlencoded'
          }
        });

        const headers = new Headers({ 'Content-Type': 'application/json' });
        const weight1m = binanceRes.headers.get('x-mbx-used-weight-1m');
        if (weight1m) {
            headers.set('x-mbx-used-weight-1m', weight1m);
            headers.set('Access-Control-Expose-Headers', 'x-mbx-used-weight-1m');
        }

        const textRaw = await binanceRes.text();
        let data;
        try { data = JSON.parse(textRaw); } catch(e) { data = { msg: textRaw } };

        if (!binanceRes.ok) return new Response(JSON.stringify({ error: 'Binance Batch Rejected', details: data }), { status: binanceRes.status, headers });
        return new Response(JSON.stringify(data), { status: 200, headers });
      }

      // ---------------------------------------------------------------------
      // Logic Single Order (LIMIT/MARKET)
      // ---------------------------------------------------------------------
      const { symbol, side, type, quantity, price } = body;
      if (!symbol || !side || !type || !quantity) {
        return new Response(JSON.stringify({ error: 'Payload thiếu tham số bắt buộc.' }), { status: 400 });
      }

      const params = new URLSearchParams({
        symbol, side, type, quantity, 
        timestamp: Date.now().toString(), 
        recvWindow: '5000'
      });

      if (type === 'LIMIT') {
        if (!price) return new Response(JSON.stringify({ error: "Lệnh LIMIT bắt buộc phải có giá (price)." }), { status: 400 });
        params.append('price', price.toString());
        params.append('timeInForce', 'GTC');
      }

      const queryString = params.toString();
      const signature = await hmacSha256(API_SECRET, queryString);
      const finalQueryString = `${queryString}&signature=${signature}`;
      
      const binanceRes = await fetch(`https://fapi.binance.com/fapi/v1/order?${finalQueryString}`, {
        method: 'POST',
        headers: {
          'X-MBX-APIKEY': API_KEY,
          'Content-Type': 'application/json'
        }
      });

      const responseHeaders = new Headers({ 'Content-Type': 'application/json' });
      const weight1m = binanceRes.headers.get('x-mbx-used-weight-1m');
      if (weight1m) {
          responseHeaders.set('x-mbx-used-weight-1m', weight1m);
          responseHeaders.set('Access-Control-Expose-Headers', 'x-mbx-used-weight-1m');
      }

      const textRaw = await binanceRes.text();
      let data;
      try { data = JSON.parse(textRaw); } catch(e) { data = { msg: textRaw } };

      if (!binanceRes.ok) return new Response(JSON.stringify({ error: 'Binance Rejected', details: data }), { status: binanceRes.status, headers: responseHeaders });
      return new Response(JSON.stringify(data), { status: 200, headers: responseHeaders });
    }

    // =========================================================================
    // 2. LUỒNG LẤY DỮ LIỆU (GET) - TÍCH HỢP MULTI-TIER CACHING
    // =========================================================================
    if (req.method === 'GET') {
      const path = url.searchParams.get('path');
      const isPrivate = url.searchParams.get('isPrivate');
      
      if (!path) {
        return new Response(JSON.stringify({ error: 'Missing path parameter' }), { status: 400 });
      }

      let baseUrl = 'https://api.binance.com';
      if (path.startsWith('/fapi') || path.startsWith('/futures')) {
        baseUrl = 'https://fapi.binance.com';
      }

      const params = new URLSearchParams();
      for (const [key, value] of url.searchParams.entries()) {
         if (key !== 'path' && key !== 'isPrivate' && key !== 't' && value !== '') {
             params.append(key, value);
         }
      }
      
      let queryString = params.toString();
      let headers = new Headers({ 'Content-Type': 'application/json' });

      if (isPrivate === 'true') {
        if (!API_KEY || !API_SECRET) return new Response(JSON.stringify({ error: 'Missing API Keys for Private Data' }), { status: 500 });
        
        const timestamp = Date.now().toString();
        queryString += (queryString ? '&' : '') + `timestamp=${timestamp}&recvWindow=5000`;
        const signature = await hmacSha256(API_SECRET, queryString);
        queryString += `&signature=${signature}`;
        
        headers.set('X-MBX-APIKEY', API_KEY);
      }

      const targetUrl = `${baseUrl}${path}${queryString ? '?' + queryString : ''}`;
      
      const binanceRes = await fetch(targetUrl, { headers });
      
      const responseHeaders = new Headers({ 'Content-Type': 'application/json' });
      const weight1m = binanceRes.headers.get('x-mbx-used-weight-1m');
      if (weight1m) {
          responseHeaders.set('x-mbx-used-weight-1m', weight1m);
          responseHeaders.set('Access-Control-Expose-Headers', 'x-mbx-used-weight-1m');
      }

      // THÊM CACHE CHO CÁC API PUBLIC (SWR: Lưu cache 15s tại Edge)
      if (isPrivate !== 'true') {
          responseHeaders.set('Cache-Control', 's-maxage=15, stale-while-revalidate=30');
      }

      const textRaw = await binanceRes.text();
      let data;
      try {
        data = JSON.parse(textRaw);
      } catch (err) {
        return new Response(JSON.stringify({ error: 'Invalid JSON from Binance', content: textRaw.substring(0, 200) }), { status: 502 });
      }

      return new Response(JSON.stringify(data), { status: binanceRes.status, headers: responseHeaders });
    }

    return new Response(JSON.stringify({ error: 'Method Not Allowed' }), { status: 405 });

  } catch (error) {
    console.error('🔥 Edge Server Error:', error);
    return new Response(JSON.stringify({ error: 'Internal Edge Server Error', message: error.message }), { status: 500 });
  }
}