import fs from 'fs';
import path from 'path';

// Bổ sung 'src/services' để AI đọc được cấu hình Supabase
const targetPaths = ['src/core', 'src/services', 'src/hooks', 'src/config', 'src/components', 'src/App.jsx', 'api'];
const outputFile = 'AI_CODEBASE.txt';

// Đóng dấu TimeStamp vào đầu file để LLM phân biệt các phiên bản code
const now = new Date();
const timeString = now.toLocaleString('en-US', { month: 'short', day: '2-digit', year: 'numeric', hour: '2-digit', minute:'2-digit' });
let outputContent = `--- START OF FILE Paste ${timeString} ---\n\n`;

function readFilesRecursively(dir) {
    if (!fs.existsSync(dir)) return;
    const stat = fs.statSync(dir);
    if (stat.isFile()) {
        if (dir.endsWith('.js') || dir.endsWith('.jsx')) {
            const content = fs.readFileSync(dir, 'utf8');
            outputContent += `=========================================\n`;
            outputContent += `/// FILE: ${dir}\n`;
            outputContent += `=========================================\n\n`;
            outputContent += content;
            outputContent += `\n\n`;
        }
    } else if (stat.isDirectory()) {
        const files = fs.readdirSync(dir);
        files.forEach(file => readFilesRecursively(path.join(dir, file)));
    }
}

targetPaths.forEach(p => readFilesRecursively(p));
fs.writeFileSync(outputFile, outputContent);
console.log(`✅ Đã gom toàn bộ mã nguồn vào file ${outputFile}`);