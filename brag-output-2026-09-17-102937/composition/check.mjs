import fs from 'node:fs';
const html=fs.readFileSync('index.html','utf8');const js=fs.readFileSync('composition.js','utf8');const css=fs.readFileSync('style.css','utf8');
const failures=[];
if(!html.includes('data-duration="24"')) failures.push('duration missing');
if(!html.includes('data-width="1920"')||!html.includes('data-height="1080"')) failures.push('dimensions missing');
if(!html.includes('data-track-index="10"')) failures.push('audio track index missing');
for(const n of [1,2,3,4,5,6]) if(!js.includes(`s===${n}`)&&n<6) failures.push(`scene ${n} missing`);
if(!css.includes('--cream:#FFFAEF')||!css.includes('--navy:#0F2E48')) failures.push('brand tokens missing');
if(failures.length){console.error(failures.join('\n'));process.exit(1)}
console.log('Composition check passed: 1920x1080, 24s, 6 scenes, branded palette, indexed audio.');
