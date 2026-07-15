export const config = {
  runtime: 'edge', // Bắt buộc chạy trên Edge Network để giảm độ trễ[cite: 7]
};

async function hmacSha256(key, message) {
  const encoder = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey('raw', encoder.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(message));
  return Array.from(new Uint8Array(signature)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export default async function handler(req) {
  const API_KEY = process.env.BINANCE_API_KEY;
  const API_SECRET = process.env.BINANCE_API_SECRET;

  // LƯU Ý BẢO MẬT KỸ THUẬT: Chặn mọi request GET. Mọi dữ liệu quét phải chạy ở Local.[cite: 7]
  if (req.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Zero-Polling Architecture. Lõi Scanner đang chạy tại Local Daemon.' }), { status: 405 });
  }

  try {
    if (!API_KEY || !API_SECRET) return new Response(JSON.stringify({ error: 'Missing API Keys.' }), { status: 500 });
    const body = await req.json();

    // Endpoin duy nhất được phép chạy trên Vercel: Ký và Gửi lệnh Trading[cite: 5, 7]
    if (body.action === 'SIGN_TRADFI') {
      const params = new URLSearchParams();
      params.append('timestamp', Date.now().toString());
      params.append('recvWindow', '5000');
      
      const queryString = params.toString();
      const signature = await hmacSha256(API_SECRET, queryString);
      const targetUrl = `https://fapi.binance.com/fapi/v1/stock/contract?${queryString}&signature=${signature}`;
      
      const binanceRes = await fetch(targetUrl, {
        method: 'POST',
        headers: { 'X-MBX-APIKEY': API_KEY, 'Content-Type': 'application/x-www-form-urlencoded' }
      });
      const textRaw = await binanceRes.text();
      let data; try { data = JSON.parse(textRaw); } catch(e) { data = { msg: textRaw }; }
      if (!binanceRes.ok) return new Response(JSON.stringify({ error: 'TradFi Sign Failed', details: data }), { status: binanceRes.status });
      return new Response(JSON.stringify(data), { status: 200 });
    }
    
    return new Response(JSON.stringify({ error: 'Unknown Action' }), { status: 400 });

  } catch (error) {
    return new Response(JSON.stringify({ error: 'Edge Server Error', message: error.message }), { status: 500 });
  }
}