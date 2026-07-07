import fs from 'fs';
import path from 'path';

// Các thư mục/file muốn AI đọc
const targetPaths = ['src/core', 'src/hooks', 'src/config', 'src/components', 'src/App.jsx', 'api'];
const outputFile = 'AI_CODEBASE.txt';

let outputContent = '';

function readFilesRecursively(dir) {
    if (!fs.existsSync(dir)) return;
    const stat = fs.statSync(dir);
    if (stat.isFile()) {
        if (dir.endsWith('.js') || dir.endsWith('.jsx')) {
            const content = fs.readFileSync(dir, 'utf8');
            outputContent += `\n\n=========================================\n`;
            outputContent += `/// FILE: ${dir}\n`;
            outputContent += `=========================================\n\n`;
            outputContent += content;
        }
    } else if (stat.isDirectory()) {
        const files = fs.readdirSync(dir);
        files.forEach(file => readFilesRecursively(path.join(dir, file)));
    }
}

targetPaths.forEach(p => readFilesRecursively(p));
fs.writeFileSync(outputFile, outputContent);
console.log(`Đã gom toàn bộ mã nguồn vào file ${outputFile}`);