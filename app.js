const CATEGORIES = ['買菜', '日用品', '醫療', '交通', '水電', '餐飲', '其他'];
const STORE_KEY = 'mama-ledger.entries.v1';
const META_KEY = 'mama-ledger.meta.v1';
let entries = safeParse(localStorage.getItem(STORE_KEY), []);
let meta = safeParse(localStorage.getItem(META_KEY), { lastBackupAt: null });
let category = '買菜';
let recorder;
let audioChunks = [];
let pendingAudio;
let deferredInstall;

function openAudioDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('mama-ledger-audio', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('audio');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function audioPut(id, blob) { const db=await openAudioDb(); return new Promise((resolve,reject)=>{const tx=db.transaction('audio','readwrite');tx.objectStore('audio').put(blob,id);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);}); }
async function audioGet(id) { const db=await openAudioDb(); return new Promise((resolve,reject)=>{const req=db.transaction('audio').objectStore('audio').get(id);req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);}); }
async function audioDelete(id) { const db=await openAudioDb(); return new Promise((resolve,reject)=>{const tx=db.transaction('audio','readwrite');tx.objectStore('audio').delete(id);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);}); }

function safeParse(value, fallback) { try { return value ? JSON.parse(value) : fallback; } catch { return fallback; } }
function persist() { localStorage.setItem(STORE_KEY, JSON.stringify(entries)); localStorage.setItem(META_KEY, JSON.stringify(meta)); }
function isoDay() { return new Date().toISOString().slice(0, 10); }
function monthKey() { return new Date().toISOString().slice(0, 7); }
function money(value) { return `$${Number(value || 0).toLocaleString('zh-TW')}`; }
function escapeHtml(value) { return String(value).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }

function switchView(name) {
  document.querySelectorAll('.view').forEach(el => el.classList.toggle('active', el.id === `view-${name}`));
  document.querySelectorAll('.nav-button').forEach(el => el.classList.toggle('active', el.dataset.view === name));
  if (name === 'report') renderReport();
}

function renderCategories() {
  document.querySelector('#category-list').innerHTML = CATEGORIES.map(item => `<button class="chip ${item === category ? 'active' : ''}" data-category="${item}">${item}</button>`).join('');
}

function renderRecent() {
  const target = document.querySelector('#recent-entries');
  if (!entries.length) { target.className = 'empty'; target.textContent = '還沒有帳目'; return; }
  target.className = '';
  target.innerHTML = entries.slice().sort((a,b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 8).map(entry => `
    <div class="entry-row"><div>${escapeHtml(entry.note)}<small>${entry.occurredAt}・${entry.category}${entry.audio ? '・有原音' : ''}</small></div><strong>${money(entry.amount)}</strong></div>`).join('');
}

function renderReport() {
  const month = monthKey();
  const totals = Object.fromEntries(CATEGORIES.map(item => [item, 0]));
  entries.filter(e => e.occurredAt.startsWith(month) && !['income','transfer'].includes(e.transactionKind)).forEach(e => totals[e.category] += Number(e.amount));
  document.querySelector('#report-month').textContent = month;
  document.querySelector('#report-total').textContent = money(Object.values(totals).reduce((a,b) => a+b, 0));
  document.querySelector('#report-rows').innerHTML = CATEGORIES.map(item => `<div class="report-row"><span>${item}</span><strong>${money(totals[item])}</strong></div>`).join('');
  const scheduled = entries.filter(e => e.occurredAt.startsWith(month) && e.audioDeleteAfter);
  document.querySelector('#cancel-deletion').hidden = !scheduled.length;
  document.querySelector('#deletion-message').textContent = scheduled.length ? `已有 ${scheduled.length} 段音檔排定於 ${new Date(scheduled[0].audioDeleteAfter).toLocaleDateString('zh-TW')} 後刪除。` : '確認後有7天可以取消。';
}

async function startOrStopRecording() {
  const button = document.querySelector('#record-button');
  if (recorder?.state === 'recording') { recorder.stop(); return; }
  if (!navigator.mediaDevices?.getUserMedia) { alert('這個瀏覽器不支援錄音。請使用Safari開啟。'); return; }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioChunks = [];
    recorder = new MediaRecorder(stream);
    recorder.ondataavailable = event => audioChunks.push(event.data);
    recorder.onstop = () => {
      pendingAudio = new Blob(audioChunks, { type: recorder.mimeType || 'audio/mp4' });
      stream.getTracks().forEach(track => track.stop());
      button.textContent = '● 重新錄音'; button.classList.remove('recording');
      document.querySelector('#audio-message').hidden = false;
    };
    recorder.start(); button.textContent = '■ 停止錄音'; button.classList.add('recording');
  } catch { alert('無法使用麥克風，請檢查Safari權限。'); }
}

async function saveEntry() {
  const amount = Number(document.querySelector('#amount').value);
  const note = document.querySelector('#note').value.trim() || category;
  if (!Number.isFinite(amount) || amount <= 0) { alert('請輸入正確金額。'); return; }
  const id=crypto.randomUUID(), audioId=pendingAudio?`audio-${id}`:null;
  if (pendingAudio) await audioPut(audioId,pendingAudio);
  entries.unshift({ id, occurredAt: isoDay(), amount, note, category, transactionKind: 'expense', audio: Boolean(pendingAudio), audioId, createdAt: new Date().toISOString() });
  persist(); pendingAudio = null;
  document.querySelector('#amount').value = ''; document.querySelector('#note').value = '';
  document.querySelector('#audio-message').hidden = true; document.querySelector('#record-button').textContent = '● 錄下原始語音';
  renderRecent(); alert(`已記下：${note} ${money(amount)}`);
}

function scheduleDeletion() {
  const month = monthKey();
  const deleteAt = new Date(Date.now() + 7*86400000).toISOString();
  entries = entries.map(e => e.occurredAt.startsWith(month) && e.audio ? {...e, audioDeleteAfter: deleteAt} : e);
  persist(); renderReport();
}
function cancelDeletion() { const month=monthKey(); entries=entries.map(e=>e.occurredAt.startsWith(month)?{...e,audioDeleteAfter:null}:e); persist(); renderReport(); }
async function deleteDueAudio() {
  const now=new Date(), due=entries.filter(e=>e.audioDeleteAfter&&new Date(e.audioDeleteAfter)<=now);
  for(const entry of due) if(entry.audioId) await audioDelete(entry.audioId);
  entries=entries.map(e=>e.audioDeleteAfter&&new Date(e.audioDeleteAfter)<=now?{...e,audio:false,audioId:null,audioDeleteAfter:null}:e); persist();
}

async function deriveKey(password, salt, usage) {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({name:'PBKDF2', salt, iterations:250000, hash:'SHA-256'}, material, {name:'AES-GCM', length:256}, false, usage);
}
async function exportBackup() {
  const password = document.querySelector('#backup-password').value;
  if (password.length < 8) { showBackup('密碼至少需要8個字元。'); return; }
  const salt=crypto.getRandomValues(new Uint8Array(16)), iv=crypto.getRandomValues(new Uint8Array(12));
  const key=await deriveKey(password,salt,['encrypt']);
  const audio={};
  for(const entry of entries){if(entry.audioId){const blob=await audioGet(entry.audioId);if(blob)audio[entry.audioId]=await blobToDataUrl(blob);}}
  const payload=new TextEncoder().encode(JSON.stringify({version:2,createdAt:new Date().toISOString(),entries,audio}));
  const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,payload);
  const pack={format:'mama-ledger-backup',salt:b64(salt),iv:b64(iv),data:b64(new Uint8Array(encrypted))};
  const blob=new Blob([JSON.stringify(pack)],{type:'application/json'}), url=URL.createObjectURL(blob), a=document.createElement('a');
  a.href=url; a.download=`媽媽記帳備份-${isoDay()}.mabackup`; a.click(); URL.revokeObjectURL(url);
  meta.lastBackupAt=new Date().toISOString(); persist(); showBackup('加密備份已產生。請在下載選單中選擇「儲存到檔案」→ iCloud Drive。'); updateStorageStatus();
}
async function restoreBackup(file) {
  const password=document.querySelector('#backup-password').value;
  if (!password) { showBackup('請先輸入這份備份原本使用的密碼。'); return; }
  try {
    const pack=JSON.parse(await file.text());
    if (pack.format!=='mama-ledger-backup') throw new Error();
    const key=await deriveKey(password,fromB64(pack.salt),['decrypt']);
    const decrypted=await crypto.subtle.decrypt({name:'AES-GCM',iv:fromB64(pack.iv)},key,fromB64(pack.data));
    const restored=JSON.parse(new TextDecoder().decode(decrypted));
    if (!Array.isArray(restored.entries)) throw new Error();
    if (!confirm(`將以備份中的 ${restored.entries.length} 筆資料取代目前資料，確定嗎？`)) return;
    for(const [id,dataUrl] of Object.entries(restored.audio||{})) await audioPut(id,dataUrlToBlob(dataUrl));
    entries=restored.entries; persist(); renderRecent(); renderReport(); showBackup('復原完成。');
  } catch { showBackup('無法解密：密碼錯誤或檔案損壞。'); }
}
function b64(bytes){return btoa(String.fromCharCode(...bytes));}
function fromB64(text){return Uint8Array.from(atob(text),c=>c.charCodeAt(0));}
function blobToDataUrl(blob){return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(blob);});}
function dataUrlToBlob(dataUrl){const [meta,data]=dataUrl.split(',');const mime=meta.match(/data:(.*?);/)?.[1]||'application/octet-stream';const bytes=fromB64(data);return new Blob([bytes],{type:mime});}
function showBackup(text){document.querySelector('#backup-message').textContent=text;}
function updateStorageStatus(){document.querySelector('#storage-status').textContent=meta.lastBackupAt?`上次備份：${new Date(meta.lastBackupAt).toLocaleDateString('zh-TW')}`:'資料只存在這台手機';}

document.addEventListener('click', event => {
  const nav=event.target.closest('[data-view]'); if(nav) switchView(nav.dataset.view);
  const chip=event.target.closest('[data-category]'); if(chip){category=chip.dataset.category;renderCategories();}
});
document.querySelector('#record-button').addEventListener('click', startOrStopRecording);
document.querySelector('#save-entry').addEventListener('click', saveEntry);
document.querySelector('#confirm-report').addEventListener('click', () => confirm('確認報表正確，並排定7天後刪除原始音檔？') && scheduleDeletion());
document.querySelector('#cancel-deletion').addEventListener('click', cancelDeletion);
document.querySelector('#export-backup').addEventListener('click', exportBackup);
document.querySelector('#restore-file').addEventListener('change', e => e.target.files[0] && restoreBackup(e.target.files[0]));
document.querySelector('#statement-file').addEventListener('change', e => {
  const file=e.target.files[0]; if(!file)return;
  document.querySelector('#import-preview').innerHTML=`<strong>已選擇：</strong>${escapeHtml(file.name)}<br><small>帳單辨識需逐筆確認；圖片OCR將在後續免費版本加入。</small>`;
});
window.addEventListener('beforeinstallprompt', event=>{event.preventDefault();deferredInstall=event;document.querySelector('#install-button').hidden=false;});
document.querySelector('#install-button').addEventListener('click',async()=>{if(deferredInstall){deferredInstall.prompt();deferredInstall=null;}else alert('iPhone請按Safari分享按鈕，再選「加入主畫面」。');});
if('serviceWorker'in navigator) navigator.serviceWorker.register('./sw.js');
deleteDueAudio().then(()=>{renderRecent();renderReport();}); renderCategories(); renderRecent(); updateStorageStatus();
