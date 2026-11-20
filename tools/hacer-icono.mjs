// Genera los iconos de la web (y el de Android) a partir del diseño E1: cinco velas en gradiente sobre fondo oscuro.
//   node tools/hacer-icono.mjs [carpeta-salida-extra]
import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const G = '#43E8C0', R = '#ff6b6b', Y = '#FFD36E';
const C = (x, top, h, wt, wb, fill, wick, w = 50) =>
  `<line x1="${x + w / 2}" y1="${wt}" x2="${x + w / 2}" y2="${wb}" stroke="${wick}" stroke-width="12" stroke-linecap="round"/><rect x="${x}" y="${top}" width="${w}" height="${h}" rx="${w * 0.26}" fill="${fill}"/>`;
const candles = `${C(48, 230, 90, 190, 360, 'url(#r1)', R)}${C(138, 290, 80, 250, 400, 'url(#g1)', G)}${C(228, 200, 110, 150, 350, 'url(#r1)', R)}${C(318, 160, 120, 110, 320, 'url(#g1)', G)}${C(408, 70, 150, 40, 260, 'url(#y1)', Y)}`;
const defs = `<defs><linearGradient id="g1" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7bf5d7"/><stop offset="1" stop-color="#1bb894"/></linearGradient>
<linearGradient id="r1" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff9a9a"/><stop offset="1" stop-color="#e0454d"/></linearGradient>
<linearGradient id="y1" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffe49a"/><stop offset="1" stop-color="#f0b429"/></linearGradient>
<radialGradient id="bg1" cx=".5" cy=".15" r=".9"><stop offset="0" stop-color="#1c3b38"/><stop offset="1" stop-color="#0A1214"/></radialGradient></defs>`;
// scale: 1 = ocupa todo; 0.8 = zona segura del icono "maskable" / adaptable de Android
const svg = (rx, scale) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">${defs}
<rect width="512" height="512" rx="${rx}" fill="url(#bg1)"/><g transform="translate(256 256) scale(${scale}) translate(-256 -256)">${candles}</g></svg>`;
const fg = scale => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">${defs}<g transform="translate(256 256) scale(${scale}) translate(-256 -256)">${candles}</g></svg>`;

const jobs = [
  ['icon-512.png', 512, svg(112, 0.92), true], ['icon-192.png', 192, svg(112, 0.92), true],
  ['icon-180.png', 180, svg(0, 0.86), false], ['icon-maskable.png', 512, svg(0, 0.7), false],
  ['_fg-android.png', 432, fg(0.62), true], ['_bg-android.png', 432, svg(0, 0) , false]
];
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(p => fs.existsSync(p));
const b = await puppeteer.launch({ executablePath: CHROME, headless: true });
const pg = await b.newPage();
for (const [name, size, markup, transparent] of jobs) {
  await pg.setViewport({ width: size, height: size, deviceScaleFactor: 1 });
  await pg.setContent(`<body style="margin:0;background:transparent"><div style="width:${size}px;height:${size}px">${markup.replace('width="512" height="512"', `width="${size}" height="${size}"`)}</div></body>`);
  await pg.screenshot({ path: path.join(root, 'tools', name.startsWith('_') ? name : '../' + name), omitBackground: transparent });
  console.log('OK', name);
}
await b.close();
