// Checks every internal link, anchor and image in ../site/, and that no build placeholder is left.
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const SITE=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../site');
const files=[]; (function walk(d){for(const f of fs.readdirSync(d)){const p=path.join(d,f); if(fs.statSync(p).isDirectory()) walk(p); else if(p.endsWith('.html')) files.push(p);}})(SITE);
const ids=f=>new Set([...fs.readFileSync(f,'utf8').matchAll(/\sid="([^"]+)"/g)].map(m=>m[1]));
let bad=0, n=0;
for(const f of files){ const h=fs.readFileSync(f,'utf8');
  for(const m of h.matchAll(/\s(?:href|src)="([^"]+)"/g)){ const u=m[1]; if(/^(https?:|mailto:)/.test(u)) continue; n++;
    const [p,a]=u.split('#'); const t=p?path.resolve(path.dirname(f),p):f;
    if(!fs.existsSync(t)){console.log('MISSING',path.relative(SITE,f),u);bad++;continue;}
    if(a && t.endsWith('.html') && !ids(t).has(a)){console.log('NOANCHOR',path.relative(SITE,f),u);bad++;}
  }
  if(/\{\{TS|\{R\}|undefined/.test(h)) {console.log('PLACEHOLDER LEFT', f); bad++;}
}
console.log('checked',n,'links in',files.length,'pages; problems:',bad);
process.exitCode = bad ? 1 : 0;
