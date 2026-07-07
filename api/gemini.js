// File: api/gemini.js
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Chỉ hỗ trợ phương thức POST' });
  }

  // Lấy key từ Environment Variables của Vercel
  const apiKey = process.env.GEMINI_API_KEY; 

  // Endpoint Interactions API mới nhất
  const targetUrl = "https://generativelanguage.googleapis.com/v1beta/interactions"; //

  try {
    const response = await fetch(targetUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json', //
        'x-goog-api-key': apiKey //
      },
      body: JSON.stringify(req.body) // Trực tiếp truyền body từ Frontend
    });

    const data = await response.json();
    
    if (!response.ok) {
      return res.status(response.status).json(data);
    }

    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ error: 'Lỗi server nội bộ', details: error.message });
  }
}