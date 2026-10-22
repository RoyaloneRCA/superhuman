const babel = require('@babel/core');
const fs = require('fs');

const jsx = fs.readFileSync('src/superhuman_v3.jsx', 'utf8');
const stripped = jsx.replace(/^import\s+.*?;\s*$/gm, '');

const result = babel.transformSync(stripped, {
  presets: [
    ['@babel/preset-react', {
      runtime: 'classic'  // use React.createElement, not jsx-runtime
    }]
  ],
  filename: 'superhuman_v3.jsx'
});

fs.mkdirSync('build',{recursive:true});
fs.writeFileSync('build/app.js', result.code);
const lines = result.code.split('\n');
console.log('Done. Size:', result.code.length, 'chars');
console.log('React.createElement calls:', (result.code.match(/React\.createElement/g)||[]).length);
console.log('First 3 lines:', lines.slice(0,3).join('\n'));
