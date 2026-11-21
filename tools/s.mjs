import puppeteer from 'puppeteer-core';import http from 'http';import fs from 'fs';import path from 'path';
const root=path.resolve('..');const srv=http.createServer((q,r)=>{const p=path.join(root,decodeURIComponent(q.url.split('?')[0]));if(!fs.existsSync(p)||fs.statSync(p).isDirectory()){r.writeHead(404);return r.end()}r.writeHead(200,{'Content-Type':p.endsWith('.html')?'text/html':p.endsWith('.json')?'application/json':'text/javascript'});fs.createReadStream(p).pipe(r)});
await new Promise(r=>srv.listen(0,r));
const b=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const pg=await b.newPage();await pg.setViewport({width:390,height:844,isMobile:true,hasTouch:true});
await pg.goto(`http://127.0.0.1:${srv.address().port}/test.html${process.argv[3]||''}`);await new Promise(r=>setTimeout(r,2500));
const w=ms=>new Promise(r=>setTimeout(r,ms));const o=process.argv[2];
const shot=async n=>{await w(500);await pg.screenshot({path:`${o}/${n}.png`,fullPage:true});};
await shot('u_cartera');
for (const t of ['dividendos','calendario','analisis']) {await pg.evaluate(t=>document.querySelector(`[data-tab=${t}]`).click(),t);await shot('u_'+t);}
await pg.evaluate(()=>document.querySelector('#setBtn').click());await shot('u_ajustes');
await b.close();srv.close();
