import fs from 'fs';
import path from 'path';

// 1. Chỉ định thẳng thư mục root 'src', 'api' và các file cấu hình cốt lõi của hệ thống
const targetPaths = [
    'src', 
    'api', 
    'package.json', 
    'vite.config.js', 
    'tailwind.config.js', 
    'index.html'
];
const outputFile = 'AI_CODEBASE.md';

// Đóng dấu TimeStamp vào đầu file để LLM phân biệt các phiên bản code
const now = new Date();
const timeString = now.toLocaleString('en-US', { month: 'short', day: '2-digit', year: 'numeric', hour: '2-digit', minute:'2-digit' });
let outputContent = `--- START OF FILE Paste ${timeString} ---\n\n`;

// 2. Mở rộng bộ lọc định dạng file để AI đọc được cả CSS, JSON, HTML
const allowedExtensions = ['.js', '.jsx', '.json', '.html', '.css'];

function readFilesRecursively(dir) {
    if (!fs.existsSync(dir)) {
        console.warn(`⚠️ Bỏ qua: Không tìm thấy đường dẫn '${dir}'`);
        return;
    }
    
    const stat = fs.statSync(dir);
    
    if (stat.isFile()) {
        const ext = path.extname(dir);
        const fileName = path.basename(dir);
        
        // Lọc file theo đuôi mở rộng, CẤM package-lock.json để tránh làm nổ Context của LLM
        if ((allowedExtensions.includes(ext) || fileName === '.env.example') && fileName !== 'package-lock.json') {
            const content = fs.readFileSync(dir, 'utf8');
            outputContent += `=========================================\n`;
            outputContent += `/// FILE: ${dir}\n`;
            outputContent += `=========================================\n\n`;
            outputContent += content;
            outputContent += `\n\n`;
        }
    } else if (stat.isDirectory()) {
        // 3. Chốt chặn an toàn: Bỏ qua các thư mục sinh tự động hoặc thư viện
        const ignoredDirs = ['node_modules', '.git', 'dist', '.vercel', 'build'];
        if (ignoredDirs.includes(path.basename(dir))) return;

        const files = fs.readdirSync(dir);
        files.forEach(file => readFilesRecursively(path.join(dir, file)));
    }
}

// Chạy thuật toán đệ quy cho từng target
targetPaths.forEach(p => readFilesRecursively(p));

// Xuất file
fs.writeFileSync(outputFile, outputContent);
console.log(`✅ Đã gom toàn bộ mã nguồn (Src, API, Configurations) vào file ${outputFile}`);