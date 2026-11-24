'use strict';
// Print an offline browser fixture for evaluate_script. No real API or storage is used.
const fs = require('node:fs');
const path = require('node:path');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const tools = read('chrome/src/core/maintenance-tools.js');
const maintenance = read('chrome/src/features/maintenance.js');
const options = read('chrome/options/maintenance.js');
const defaults = read('chrome/options/options.js').match(/const DEFAULTS = \{[\s\S]*?\n\};/)[0];
const html = read('chrome/options/options.html');
const start = html.indexOf('      <section class="tab-panel maintenance-panel" data-tab-panel="maintenance">');
const end = html.indexOf('      <section class="footer-meta">', start);
if (start === -1 || end === -1) throw new Error('maintenance panel not found in options.html');
const panel = html.slice(start, end);
process.stdout.write(`async () => {
const checks=[];const check=(name,condition)=>{if(!condition)throw new Error(name);checks.push(name)};
${tools}
{
const FeatureSet={enable_extension:true,prefer_chinese_readme:true,enable_readme_translation:true};
const window={location:{origin:'https://github.com',hostname:'github.com',pathname:'/owner/repo',href:'https://github.com/owner/repo'},setTimeout:globalThis.setTimeout.bind(globalThis),clearTimeout:globalThis.clearTimeout.bind(globalThis)};
const getCurrentRepoInfo=()=>({fullName:'owner/repo'});const isReadmePage=()=>true;
const getReadmeRootElement=()=>document.getElementById('original');let scheduled=0;const scheduleReadmeTranslation=()=>scheduled++;
let requests=0,mode='success',finish;
const response={ok:true,url:'https://github.com/owner/repo/blob/main/README.zh-CN.md',text:async()=>'<article class="markdown-body"><p>这是项目的中文说明。</p><a href="./guide.md">指南</a><a href="javascript:alert(1)">bad</a><img src="./logo.png" onerror="alert(1)"><svg onload="alert(1)"></svg><script>alert(1)<\\/script></article>'};
const fetch=async(url,config)=>{requests++;check('same-origin credentials',config.credentials==='same-origin');if(mode==='fail')throw new Error('offline test');if(mode==='pending')return new Promise(resolve=>finish=resolve);return {...response,url};};
${maintenance}
const mount=(href='/owner/repo/blob/main/README.zh-CN.md',body='<p>Original English README.</p>')=>{document.body.innerHTML='<main><article id="original" class="markdown-body">'+body+'<a id="language">简体中文</a></article></main>';document.getElementById('language').setAttribute('href',href);};
mount();const root=getReadmeRootElement();check('native README selected',await preferChineseReadme());
check('native copy and preserved original',root.hidden&&chineseReadme.state.copy.textContent.includes('中文说明'));
check('unsafe nodes stripped',!chineseReadme.state.copy.querySelector('script,svg,[onerror],[href^="javascript:"]'));
check('relative links resolved',chineseReadme.state.copy.querySelector('a').href==='https://github.com/owner/repo/blob/main/guide.md');
chineseReadme.state.controls.querySelector('button').click();check('original toggle',!root.hidden&&chineseReadme.state.copy.hidden);
chineseReadme.state.controls.querySelector('button').click();check('native toggle',root.hidden&&!chineseReadme.state.copy.hidden);
await preferChineseReadme();check('native cache avoids repeat request',requests===1);
chineseReadme.state.controls.querySelectorAll('button')[1].click();check('API fallback restores original',!root.hidden&&!chineseReadme.state&&scheduled===1);
check('API preference retained for root',!await preferChineseReadme());
mount('/other/repo/blob/main/README.zh-CN.md');const count=requests;check('other repository rejected',!await preferChineseReadme()&&requests===count);
mount('/owner/repo/blob/main/README.zh-TW.md','<p>这是仓库自带的完整简体中文说明文档，已经无需再次替换。</p>');check('already-Chinese README skipped',!await preferChineseReadme()&&requests===count);
window.location.pathname='/owner/repo/blob/main/CONTRIBUTING.md';mount();check('non-README blob skipped',!await preferChineseReadme()&&requests===count);
window.location.pathname='/owner/repo';
mount('/owner/repo/blob/error/README.zh-CN.md');mode='fail';await preferChineseReadme();const failedCount=requests;
check('failure preserves original',!getReadmeRootElement().hidden);await preferChineseReadme();check('failure backoff',requests===failedCount);
mount('/owner/repo/blob/slow/README.zh-CN.md');mode='pending';const pending=preferChineseReadme();window.location.href='https://github.com/owner/other';mount();finish(response);
check('navigation cancels obsolete render',!await pending&&!chineseReadme.state);
}
{
${defaults}
const store={local:{},sync:{readme_openai_api_key:'existing-secret'}};let reloads=0;
const location={reload:()=>reloads++};const confirm=()=>true;
const area=name=>({get:async query=>typeof query==='string'?{[query]:store[name][query]}:Object.fromEntries(Object.entries(query).map(([key,value])=>[key,store[name][key]??value])),set:async values=>Object.assign(store[name],values)});
const chrome={storage:{local:area('local'),sync:area('sync')},runtime:{sendMessage:(message,callback)=>{store.local[GhcnMaintenance.MISS_KEY]=[];callback({ok:true});}}};
document.body.innerHTML=${JSON.stringify(panel)};
${options}
document.dispatchEvent(new Event('DOMContentLoaded'));const tick=()=>new Promise(resolve=>setTimeout(resolve,20));await tick();
const el=id=>document.getElementById(id);check('privacy defaults',!el('collect_ui_misses').checked&&!el('backupSecrets').checked&&el('prefer_chinese_readme').checked);
el('newEntrySource').value='New UI label';el('newEntryTarget').value='自定义译文';el('addCustomEntry').click();await tick();
check('custom entry persists',store.local[GhcnMaintenance.DATA_KEY].entries[0].target==='自定义译文');
el('customEntryList').querySelectorAll('input')[2].value='修改后的译文';el('customEntryList').querySelector('button').click();await tick();check('inline edit persists',store.local[GhcnMaintenance.DATA_KEY].entries[0].target==='修改后的译文');
el('newEntrySource').value='New UI label';el('newEntryTarget').value='重复';el('addCustomEntry').click();await tick();check('duplicate rejected',store.local[GhcnMaintenance.DATA_KEY].entries.length===1&&el('maintenanceStatus').textContent.includes('重复'));
el('entrySearch').value='not present';el('entrySearch').dispatchEvent(new Event('input'));check('search filters entries',el('customEntryList').children.length===0);
el('excludedPaths').value='github.com/owner/repo/*';el('saveExcluded').click();await tick();check('excluded paths persist',store.local[GhcnMaintenance.DATA_KEY].excluded[0]==='github.com/owner/repo/*');
el('collect_ui_misses').checked=true;el('collect_ui_misses').dispatchEvent(new Event('change'));await tick();check('collection opt-in persists',store.sync.collect_ui_misses===true);
const fileInput=el('importBackup');const transfer=new DataTransfer();transfer.items.add(new File([JSON.stringify({format:'ghcn-backup',version:1,settings:{readme_openai_api_key:'new-secret',prefer_chinese_readme:false},data:{entries:[],excluded:[]}})],'backup.json',{type:'application/json'}));fileInput.files=transfer.files;fileInput.dispatchEvent(new Event('change'));await tick();
check('backup restored after confirmation',reloads===1&&store.sync.prefer_chinese_readme===false&&store.local[GhcnMaintenance.DATA_KEY].entries.length===0);
check('backup preserves excluded secret',store.sync.readme_openai_api_key==='existing-secret');
}
return {passed:checks.length,checks};
}`);
