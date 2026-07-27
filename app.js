const CATEGORIES = ['買菜', '日用品', '醫療', '交通', '水電', '餐飲', '其他'];
const ACCOUNT_KEY = 'mama-ledger.payment-accounts.v1';
const STORE_KEY = 'mama-ledger.entries.v1';
const META_KEY = 'mama-ledger.meta.v1';
const PLANNER_KEY = 'mama-ledger.planner.v1';
let entries = safeParse(localStorage.getItem(STORE_KEY), []);
let meta = safeParse(localStorage.getItem(META_KEY), { lastBackupAt: null });
let category = '買菜';
let paymentAccounts = safeParse(localStorage.getItem(ACCOUNT_KEY), ['現金', '悠遊卡']);
let paymentAccount = '現金';
let plannerItems = safeParse(localStorage.getItem(PLANNER_KEY), []);
if (!Array.isArray(plannerItems)) plannerItems = [];
let plannerKind = 'todo';
let selectedPlannerDate = isoDay();
let plannerCursor = new Date();
plannerCursor = new Date(plannerCursor.getFullYear(), plannerCursor.getMonth(), 1, 12);
let recorder;
let audioChunks = [];
let pendingAudio;
let pendingAudioUrl;
let speechRecognition;
let finalTranscript = '';
let activeAudio;
let activeAudioButton;
const savedAudioUrls = new Map();
const savedAudioLoads = new Map();
let assistantTimer;
let pendingImports = [];
let deferredInstall;
let redactionSourceFile;
let redactionImage;
let redactionStrokes = [];
let activeRedactionStroke;

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
function persistPlanner() { localStorage.setItem(PLANNER_KEY, JSON.stringify(plannerItems)); }
function localDateParts(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return { day: `${year}-${month}-${day}`, month: `${year}-${month}` };
}
function isoDay() { return localDateParts().day; }
function monthKey() { return localDateParts().month; }
function money(value) { return `$${Number(value || 0).toLocaleString('zh-TW')}`; }
function escapeHtml(value) { return String(value).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }

function switchView(name) {
  document.querySelectorAll('.view').forEach(el => el.classList.toggle('active', el.id === `view-${name}`));
  document.querySelectorAll('.nav-button').forEach(el => el.classList.toggle('active', el.dataset.view === name));
  if (name === 'report') renderReport();
  if (name === 'planner') renderPlanner();
}

function plannerDate(value) {
  const [year, month, day] = String(value).split('-').map(Number);
  return new Date(year, month - 1, day, 12);
}

function plannerDateLabel(value, includeYear = false) {
  return new Intl.DateTimeFormat('zh-TW', {
    ...(includeYear ? { year: 'numeric' } : {}),
    month: 'long',
    day: 'numeric',
    weekday: 'short'
  }).format(plannerDate(value));
}

function plannerItemHtml(item, showDate = false) {
  const kindLabel = item.kind === 'shopping' ? '要買用品' : '待辦事項';
  const dateLabel = showDate ? `・${plannerDateLabel(item.date, true)}` : '';
  return `
    <div class="planner-item ${item.done ? 'done' : ''}">
      <button class="planner-check" type="button" data-planner-toggle="${item.id}" aria-label="${item.done ? '改成尚未完成' : '標示完成'}">${item.done ? '✓' : '○'}</button>
      <div class="planner-text">
        <strong>${escapeHtml(item.title)}</strong>
        <small><span class="planner-badge">${kindLabel}</span>${dateLabel}</small>
      </div>
      <button class="planner-delete" type="button" data-planner-delete="${item.id}" aria-label="刪除">×</button>
    </div>`;
}

function renderCalendar() {
  const year = plannerCursor.getFullYear();
  const monthIndex = plannerCursor.getMonth();
  const month = String(monthIndex + 1).padStart(2, '0');
  const prefix = `${year}-${month}`;
  const firstWeekday = new Date(year, monthIndex, 1, 12).getDay();
  const daysInMonth = new Date(year, monthIndex + 1, 0, 12).getDate();
  const unfinishedCounts = new Map();

  plannerItems.filter(item => item.date?.startsWith(prefix) && !item.done).forEach(item => {
    unfinishedCounts.set(item.date, (unfinishedCounts.get(item.date) || 0) + 1);
  });

  const cells = Array.from({ length: firstWeekday }, () => '<span class="calendar-day blank" aria-hidden="true"></span>');
  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = `${prefix}-${String(day).padStart(2, '0')}`;
    const count = unfinishedCounts.get(date) || 0;
    const classes = [
      'calendar-day',
      date === isoDay() ? 'today' : '',
      date === selectedPlannerDate ? 'selected' : '',
      count ? 'has-items' : ''
    ].filter(Boolean).join(' ');
    cells.push(`<button class="${classes}" type="button" data-calendar-date="${date}" aria-label="${plannerDateLabel(date, true)}${count ? `，${count}項尚未完成` : ''}">${day}${count ? `<span class="calendar-count">${count}</span>` : ''}</button>`);
  }

  document.querySelector('#calendar-month').textContent = `${year}年${monthIndex + 1}月`;
  document.querySelector('#calendar-grid').innerHTML = cells.join('');
}

function renderPlanner() {
  document.querySelectorAll('[data-planner-kind]').forEach(button => {
    const active = button.dataset.plannerKind === plannerKind;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });

  renderCalendar();
  const selectedLabel = plannerDateLabel(selectedPlannerDate, true);
  document.querySelector('#selected-date-label').textContent = `目前選擇：${selectedLabel}`;
  document.querySelector('#day-list-title').textContent = `${selectedLabel}的事項`;

  const dayItems = plannerItems
    .filter(item => item.date === selectedPlannerDate)
    .sort((a, b) => Number(a.done) - Number(b.done) || String(a.createdAt).localeCompare(String(b.createdAt)));
  const dayTarget = document.querySelector('#planner-day-list');
  if (!dayItems.length) {
    dayTarget.className = 'empty';
    dayTarget.textContent = '這一天還沒有安排';
  } else {
    dayTarget.className = 'planner-list';
    dayTarget.innerHTML = dayItems.map(item => plannerItemHtml(item)).join('');
  }

  const shoppingItems = plannerItems
    .filter(item => item.kind === 'shopping' && !item.done)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.createdAt).localeCompare(String(b.createdAt)));
  const shoppingTarget = document.querySelector('#shopping-open-list');
  if (!shoppingItems.length) {
    shoppingTarget.className = 'empty';
    shoppingTarget.textContent = '目前沒有待買用品';
  } else {
    shoppingTarget.className = 'planner-list';
    shoppingTarget.innerHTML = shoppingItems.map(item => plannerItemHtml(item, true)).join('');
  }
}

function addPlannerItem() {
  const input = document.querySelector('#planner-title');
  const title = input.value.trim();
  const message = document.querySelector('#planner-message');
  if (!title) {
    message.textContent = '請先輸入待辦事項或要買的用品。';
    input.focus();
    return;
  }
  plannerItems.push({
    id: crypto.randomUUID(),
    date: selectedPlannerDate,
    title,
    kind: plannerKind,
    done: false,
    createdAt: new Date().toISOString()
  });
  persistPlanner();
  input.value = '';
  message.textContent = `已加到${plannerDateLabel(selectedPlannerDate)}。`;
  renderPlanner();
}

function togglePlannerItem(id) {
  plannerItems = plannerItems.map(item => item.id === id ? { ...item, done: !item.done } : item);
  persistPlanner();
  renderPlanner();
}

function deletePlannerItem(id) {
  const item = plannerItems.find(candidate => candidate.id === id);
  if (!item || !confirm(`要刪除「${item.title}」嗎？`)) return;
  plannerItems = plannerItems.filter(candidate => candidate.id !== id);
  persistPlanner();
  renderPlanner();
}

function changePlannerMonth(offset) {
  plannerCursor = new Date(plannerCursor.getFullYear(), plannerCursor.getMonth() + offset, 1, 12);
  selectedPlannerDate = localDateParts(plannerCursor).day;
  document.querySelector('#planner-message').textContent = '';
  renderPlanner();
}

function renderCategories() {
  document.querySelector('#category-list').innerHTML = CATEGORIES.map(item => `<button class="chip ${item === category ? 'active' : ''}" data-category="${item}">${item}</button>`).join('');
}

function renderPaymentAccounts() {
  if (!paymentAccounts.includes(paymentAccount)) paymentAccount = paymentAccounts[0] || '現金';
  document.querySelector('#payment-account-list').innerHTML = paymentAccounts.map(item => `<button class="chip ${item === paymentAccount ? 'active' : ''}" data-payment-account="${escapeHtml(item)}">${escapeHtml(item)}</button>`).join('');
  document.querySelector('#payment-account-settings').value = paymentAccounts.join('\n');
}

function savePaymentAccounts() {
  const values = document.querySelector('#payment-account-settings').value.split('\n').map(value => value.trim()).filter(Boolean);
  paymentAccounts = [...new Set(values)];
  if (!paymentAccounts.length) { document.querySelector('#account-settings-message').textContent = '至少保留一個帳戶。'; return; }
  localStorage.setItem(ACCOUNT_KEY, JSON.stringify(paymentAccounts));
  renderPaymentAccounts();
  document.querySelector('#account-settings-message').textContent = `已儲存 ${paymentAccounts.length} 個帳戶，只存在這台手機。`;
}

function renderRecent() {
  const target = document.querySelector('#recent-entries');
  if (!entries.length) { target.className = 'empty'; target.textContent = '還沒有帳目'; prepareSavedAudioButtons(); return; }
  target.className = '';
  target.innerHTML = entries.slice().sort((a,b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 8).map(entry => `
    <div class="entry-row"><div>${escapeHtml(entry.note)}<small>${entry.occurredAt}・${entry.category}・${escapeHtml(entry.paymentAccount || '未指定')}${entry.audio ? '・有原音' : ''}</small>${entry.transcript ? `<small>逐字稿：${escapeHtml(entry.transcript)}</small>` : ''}${entry.audioId ? `<button class="play-audio" data-audio-id="${entry.audioId}" aria-busy="true" disabled>音檔準備中…</button>` : ''}</div><strong>${money(entry.amount)}</strong></div>`).join('');
  prepareSavedAudioButtons();
}

function startSpeechRecognition() {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const status = document.querySelector('#speech-status');
  finalTranscript = '';
  document.querySelector('#transcript').value = '';
  if (!Recognition) {
    status.textContent = '這台手機瀏覽器不支援自動逐字稿；原音仍會保存，可手動輸入文字。';
    return;
  }
  try {
    speechRecognition = new Recognition();
    speechRecognition.lang = 'zh-TW';
    speechRecognition.continuous = true;
    speechRecognition.interimResults = true;
    speechRecognition.onresult = event => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const text = event.results[i][0].transcript;
        if (event.results[i].isFinal) finalTranscript += `${text} `;
        else interim += text;
      }
      document.querySelector('#transcript').value = `${finalTranscript}${interim}`.trim();
      status.textContent = '正在產生國語逐字稿；台語或口音請在錄完後修正。';
    };
    speechRecognition.onerror = () => { status.textContent = '這次未能產生逐字稿；原音已照常保存，可手動輸入文字。'; };
    speechRecognition.start();
  } catch { status.textContent = '無法啟動自動逐字稿；原音仍會保存。'; }
}

function stopSpeechRecognition() {
  try { speechRecognition?.stop(); } catch {}
  speechRecognition = null;
}

function speak(text) {
  if (!('speechSynthesis' in window)) return;
  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'zh-TW';
  utterance.rate = 0.9;
  speechSynthesis.speak(utterance);
}

function inferCategory(text) {
  const rules = [
    ['餐飲', /早餐|午餐|晚餐|便當|外送|餐廳|咖啡|飲料|吃|飯|麵|Uber\s*Eats|foodpanda/i],
    ['買菜', /市場|買菜|蔬菜|水果|肉|魚|全聯|家樂福/i],
    ['交通', /計程車|車資|捷運|公車|火車|高鐵|加油|停車|Uber/i],
    ['醫療', /醫院|診所|看醫生|藥局|藥品|掛號/i],
    ['水電', /水費|電費|瓦斯|電話費|網路費/i],
    ['日用品', /日用品|衛生紙|洗衣|清潔|生活用品/i]
  ];
  return rules.find(([, pattern]) => pattern.test(text))?.[0] || null;
}

function analyzeAndConfirmSpeech() {
  const text = document.querySelector('#transcript').value.trim();
  const status = document.querySelector('#speech-status');
  if (!text) {
    status.textContent = '沒有取得逐字稿。請重錄，或直接輸入金額與用途。';
    speak('我沒有聽清楚。請問花了多少錢？');
    return;
  }
  const numbers = [...text.matchAll(/(?:\$|＄)?\s*(\d[\d,]*(?:\.\d{1,2})?)/g)]
    .map(match => Number(match[1].replaceAll(',', '')))
    .filter(number => Number.isFinite(number) && number > 0);
  const uniqueNumbers = [...new Set(numbers)];
  const inferred = inferCategory(text);
  if (inferred) { category = inferred; renderCategories(); }
  if (uniqueNumbers.length === 1) document.querySelector('#amount').value = uniqueNumbers[0];
  if (!document.querySelector('#note').value.trim()) {
    const cleaned = text.replace(/(?:\$|＄)?\s*\d[\d,]*(?:\.\d{1,2})?/g, '').replace(/元/g, '').trim();
    if (cleaned) document.querySelector('#note').value = cleaned;
  }
  if (uniqueNumbers.length === 0) {
    status.textContent = '智慧追問：沒有聽到金額，請說明或輸入花多少錢。';
    speak('我沒有聽到金額。請問花了多少錢？');
  } else if (uniqueNumbers.length > 1) {
    status.textContent = `智慧追問：聽到多個數字（${uniqueNumbers.join('、')}），請確認哪一個是金額。`;
    speak(`我聽到${uniqueNumbers.join('和')}，哪一個才是金額？請在金額欄確認。`);
  } else {
    const selectedCategory = inferred || category;
    status.textContent = `智慧確認：${uniqueNumbers[0]}元・${selectedCategory}。請確認後再記下。`;
    speak(`我聽到${uniqueNumbers[0]}元，分類${selectedCategory}。請確認對不對。`);
  }
}

function showPendingAudio(blob) {
  const player = document.querySelector('#pending-audio-player');
  const button = document.querySelector('#play-pending');
  if (pendingAudioUrl) URL.revokeObjectURL(pendingAudioUrl);
  pendingAudioUrl = URL.createObjectURL(blob);
  const currentUrl = pendingAudioUrl;
  let failed = false;
  button.disabled = true;
  button.textContent = '音檔準備中…';
  const markReady = () => {
    if (pendingAudioUrl !== currentUrl || failed) return;
    button.disabled = false;
    button.textContent = '▶ 立即重聽';
  };
  let readyScheduled = false;
  const scheduleReady = () => {
    if (readyScheduled) return;
    readyScheduled = true;
    window.setTimeout(markReady, 180);
  };
  player.onloadedmetadata = scheduleReady;
  player.oncanplay = scheduleReady;
  player.onerror = () => {
    if (pendingAudioUrl !== currentUrl) return;
    failed = true;
    button.disabled = true;
    button.textContent = '音檔無法播放，請重新錄音';
  };
  player.src = currentUrl;
  player.load();
  document.querySelector('#audio-preview').hidden = false;
  window.setTimeout(markReady, 1000);
}

function playPendingAudio() {
  const player = document.querySelector('#pending-audio-player');
  const button = document.querySelector('#play-pending');
  if (!pendingAudio || !player.src || button.disabled) return;
  window.speechSynthesis?.cancel();
  if (!player.paused) { player.pause(); button.textContent = '▶ 立即重聽'; return; }
  try { player.currentTime = 0; } catch {}
  player.defaultMuted = false;
  player.muted = false;
  player.volume = 1;
  button.textContent = '■ 停止播放';
  player.onended = () => { button.textContent = '▶ 再聽一次'; };
  const playback = player.play();
  playback?.catch(async () => {
    await new Promise(resolve => window.setTimeout(resolve, 180));
    try {
      player.muted = false;
      player.volume = 1;
      await player.play();
    } catch {
      button.textContent = '▶ 再試一次';
      alert('播放未啟動。請確認iPhone音量及藍牙喇叭後再試。');
    }
  });
}

async function ensureSavedAudioUrl(audioId) {
  if (savedAudioUrls.has(audioId)) return savedAudioUrls.get(audioId);
  if (savedAudioLoads.has(audioId)) return savedAudioLoads.get(audioId);
  const loading = audioGet(audioId).then(blob => {
    if (!blob) return null;
    const url = URL.createObjectURL(blob);
    savedAudioUrls.set(audioId, url);
    return url;
  }).finally(() => savedAudioLoads.delete(audioId));
  savedAudioLoads.set(audioId, loading);
  return loading;
}

function prepareSavedAudioButtons() {
  const liveIds = new Set(entries.map(entry => entry.audioId).filter(Boolean));
  for (const [audioId, url] of savedAudioUrls) {
    if (liveIds.has(audioId)) continue;
    URL.revokeObjectURL(url);
    savedAudioUrls.delete(audioId);
  }
  document.querySelectorAll('[data-audio-id]').forEach(async button => {
    const audioId = button.dataset.audioId;
    const url = await ensureSavedAudioUrl(audioId).catch(() => null);
    if (!button.isConnected || button.dataset.audioId !== audioId) return;
    if (!url) {
      button.disabled = true;
      button.removeAttribute('aria-busy');
      button.textContent = '原音已刪除';
      return;
    }
    button.disabled = false;
    button.setAttribute('aria-busy', 'false');
    button.textContent = '▶ 重聽原音';
  });
}

function stopSavedAudio() {
  const player = document.querySelector('#saved-audio-player');
  player.pause();
  try { player.currentTime = 0; } catch {}
  if (activeAudioButton?.isConnected) activeAudioButton.textContent = '▶ 重聽原音';
  activeAudio = null;
  activeAudioButton = null;
}

function playSavedAudio(audioId, button) {
  const url = savedAudioUrls.get(audioId);
  if (!url) {
    button.disabled = true;
    button.textContent = '音檔準備中…';
    prepareSavedAudioButtons();
    return;
  }
  const player = document.querySelector('#saved-audio-player');
  if (activeAudio === player && activeAudioButton === button && !player.paused) {
    stopSavedAudio();
    return;
  }
  window.speechSynthesis?.cancel();
  stopSavedAudio();
  player.src = url;
  player.defaultMuted = false;
  player.muted = false;
  player.volume = 1;
  activeAudio = player;
  activeAudioButton = button;
  button.textContent = '■ 停止播放';
  player.onended = stopSavedAudio;
  player.onerror = () => {
    stopSavedAudio();
    alert('無法播放這段原音。');
  };
  const playback = player.play();
  playback?.catch(async () => {
    await new Promise(resolve => window.setTimeout(resolve, 180));
    if (activeAudio !== player || activeAudioButton !== button) return;
    try {
      player.muted = false;
      player.volume = 1;
      await player.play();
    } catch {
      stopSavedAudio();
      alert('播放未啟動。請確認iPhone音量及藍牙喇叭後再試。');
    }
  });
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
  if (recorder?.state === 'recording') { stopSpeechRecognition(); recorder.stop(); return; }
  if (!navigator.mediaDevices?.getUserMedia) { alert('這個瀏覽器不支援錄音。請使用Safari開啟。'); return; }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioChunks = [];
    recorder = new MediaRecorder(stream);
    recorder.ondataavailable = event => audioChunks.push(event.data);
    recorder.onstop = () => {
      pendingAudio = new Blob(audioChunks, { type: recorder.mimeType || 'audio/mp4' });
      stream.getTracks().forEach(track => track.stop());
      recorder = null;
      button.textContent = '● 重新錄音'; button.classList.remove('recording');
      document.querySelector('#audio-message').hidden = false;
      window.setTimeout(() => showPendingAudio(pendingAudio), 250);
      window.clearTimeout(assistantTimer);
      assistantTimer = window.setTimeout(analyzeAndConfirmSpeech, 900);
    };
    recorder.start(); startSpeechRecognition(); button.textContent = '■ 停止錄音'; button.classList.add('recording');
  } catch { alert('無法使用麥克風，請檢查Safari權限。'); }
}

async function saveEntry() {
  const amount = Number(document.querySelector('#amount').value);
  const note = document.querySelector('#note').value.trim() || category;
  const transcript = document.querySelector('#transcript').value.trim();
  if (!Number.isFinite(amount) || amount <= 0) { alert('請輸入正確金額。'); return; }
  const id=crypto.randomUUID(), audioId=pendingAudio?`audio-${id}`:null;
  if (pendingAudio) await audioPut(audioId,pendingAudio);
  entries.unshift({ id, occurredAt: isoDay(), amount, note, category, paymentAccount, transcript, transactionKind: 'expense', audio: Boolean(pendingAudio), audioId, createdAt: new Date().toISOString() });
  persist(); pendingAudio = null;
  document.querySelector('#amount').value = ''; document.querySelector('#note').value = ''; document.querySelector('#transcript').value = '';
  document.querySelector('#audio-message').hidden = true; document.querySelector('#record-button').textContent = '● 錄下原始語音';
  const pendingPlayer = document.querySelector('#pending-audio-player');
  pendingPlayer.pause(); pendingPlayer.removeAttribute('src'); pendingPlayer.load();
  const pendingButton = document.querySelector('#play-pending');
  pendingButton.disabled = true; pendingButton.textContent = '音檔準備中…';
  document.querySelector('#audio-preview').hidden = true;
  if (pendingAudioUrl) URL.revokeObjectURL(pendingAudioUrl); pendingAudioUrl = null;
  document.querySelector('#speech-status').textContent = '國語辨識為輔助功能；台語腔調可能需要手動修正。';
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

function normalizeImportedDate(value) {
  const match = String(value || '').match(/(20\d{2})[\/-](\d{1,2})[\/-](\d{1,2})/);
  return match ? `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}` : null;
}

function classifyImportedTransaction(note, income = false) {
  if (income || /回饋金|退款|退貨|利息|存入/.test(note)) return 'income';
  if (/轉帳|轉帳提|信用卡扣款|繳款|還款|行動網/.test(note)) return 'transfer';
  return 'expense';
}

function importedCategory(note) {
  return inferCategory(note) || (/手續費/.test(note) ? '其他' : '其他');
}

function redactionCanvasPoint(event) {
  const canvas = document.querySelector('#redaction-canvas');
  const rect = canvas.getBoundingClientRect();
  return {
    x: (event.clientX - rect.left) * (canvas.width / rect.width),
    y: (event.clientY - rect.top) * (canvas.height / rect.height)
  };
}

function drawRedactionStroke(stroke, fromIndex = 1) {
  const canvas = document.querySelector('#redaction-canvas');
  const context = canvas.getContext('2d');
  const points = stroke.points;
  if (!points.length) return;
  context.save();
  context.strokeStyle = '#111111';
  context.fillStyle = '#111111';
  context.lineWidth = stroke.width;
  context.lineCap = 'round';
  context.lineJoin = 'round';
  if (points.length === 1) {
    context.beginPath();
    context.arc(points[0].x, points[0].y, stroke.width / 2, 0, Math.PI * 2);
    context.fill();
  } else {
    const start = Math.max(1, fromIndex);
    context.beginPath();
    context.moveTo(points[start - 1].x, points[start - 1].y);
    for (let index = start; index < points.length; index += 1) context.lineTo(points[index].x, points[index].y);
    context.stroke();
  }
  context.restore();
}

function redrawRedactionCanvas() {
  const canvas = document.querySelector('#redaction-canvas');
  const context = canvas.getContext('2d');
  context.clearRect(0, 0, canvas.width, canvas.height);
  if (redactionImage) context.drawImage(redactionImage, 0, 0, canvas.width, canvas.height);
  redactionStrokes.forEach(stroke => drawRedactionStroke(stroke));
}

function beginRedaction(event) {
  if (!redactionImage) return;
  event.preventDefault();
  const canvas = document.querySelector('#redaction-canvas');
  const rect = canvas.getBoundingClientRect();
  const displayWidth = Number(document.querySelector('#redaction-brush-size').value);
  activeRedactionStroke = {
    pointerId: event.pointerId,
    width: displayWidth * (canvas.width / rect.width),
    points: [redactionCanvasPoint(event)]
  };
  redactionStrokes.push(activeRedactionStroke);
  canvas.setPointerCapture?.(event.pointerId);
  drawRedactionStroke(activeRedactionStroke);
  document.querySelector('#redaction-message').textContent = '正在遮蔽；可以按「復原一筆」重畫。';
}

function moveRedaction(event) {
  if (!activeRedactionStroke || event.pointerId !== activeRedactionStroke.pointerId) return;
  event.preventDefault();
  activeRedactionStroke.points.push(redactionCanvasPoint(event));
  drawRedactionStroke(activeRedactionStroke, activeRedactionStroke.points.length - 1);
}

function endRedaction(event) {
  if (!activeRedactionStroke || event.pointerId !== activeRedactionStroke.pointerId) return;
  document.querySelector('#redaction-canvas').releasePointerCapture?.(event.pointerId);
  activeRedactionStroke = null;
}

async function openRedactionEditor(file) {
  const editor = document.querySelector('#redaction-editor');
  const canvas = document.querySelector('#redaction-canvas');
  const message = document.querySelector('#redaction-message');
  const imageUrl = URL.createObjectURL(file);
  const image = new Image();
  message.textContent = '正在準備照片…';
  try {
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = reject;
      image.src = imageUrl;
    });
    redactionSourceFile = file;
    redactionImage = image;
    redactionStrokes = [];
    activeRedactionStroke = null;
    const maxDimension = 2600;
    const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight));
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    redrawRedactionCanvas();
    document.querySelector('#redaction-file-name').textContent = `目前照片：${file.name}`;
    message.textContent = '請用手指在個人資料上來回塗黑。';
    editor.hidden = false;
    editor.scrollIntoView({ behavior: 'smooth', block: 'start' });
    document.querySelector('#import-preview').className = 'empty';
    document.querySelector('#import-preview').textContent = '完成遮蔽後，才會讀取這張照片。';
  } catch {
    closeRedactionEditor();
    document.querySelector('#import-status').textContent = '無法開啟這張照片，請改用 JPG、PNG 或螢幕截圖。';
  } finally {
    URL.revokeObjectURL(imageUrl);
  }
}

function closeRedactionEditor() {
  document.querySelector('#redaction-editor').hidden = true;
  document.querySelector('#redaction-file-name').textContent = '';
  document.querySelector('#redaction-message').textContent = '';
  document.querySelector('#statement-file').value = '';
  redactionSourceFile = null;
  redactionImage = null;
  redactionStrokes = [];
  activeRedactionStroke = null;
}

function redactedImageFile() {
  const canvas = document.querySelector('#redaction-canvas');
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => {
      if (!blob) { reject(new Error('image')); return; }
      const sourceName = redactionSourceFile?.name || '帳單照片';
      const baseName = sourceName.replace(/\.[^.]+$/, '');
      resolve(new File([blob], `${baseName}-已遮蔽.png`, { type: 'image/png', lastModified: Date.now() }));
    }, 'image/png');
  });
}

async function finishRedaction() {
  if (!redactionSourceFile) return;
  if (!redactionStrokes.length && !confirm('目前沒有塗黑任何資料，仍要直接辨識嗎？')) return;
  const message = document.querySelector('#redaction-message');
  try {
    message.textContent = '正在產生已遮蔽的新圖片…';
    const file = await redactedImageFile();
    closeRedactionEditor();
    await processStatementFile(file);
  } catch {
    message.textContent = '無法產生遮蔽圖片，請重試一次。';
  }
}

async function shareRedactedImage() {
  if (!redactionSourceFile) return;
  if (!redactionStrokes.length) {
    document.querySelector('#redaction-message').textContent = '還沒有遮蔽任何資料。';
    return;
  }
  const message = document.querySelector('#redaction-message');
  try {
    const file = await redactedImageFile();
    if (navigator.share && navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: '已遮蔽個資的帳單照片' });
      message.textContent = '已開啟分享選單；請選擇「儲存到檔案」或要傳送的位置。';
    } else {
      const url = URL.createObjectURL(file);
      const link = document.createElement('a');
      link.href = url;
      link.download = file.name;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      message.textContent = '已下載已遮蔽的圖片。';
    }
  } catch (error) {
    if (error?.name !== 'AbortError') message.textContent = '未能儲存圖片，請再試一次。';
  }
}

async function skipRedaction() {
  if (!redactionSourceFile) return;
  const file = redactionSourceFile;
  closeRedactionEditor();
  await processStatementFile(file);
}

function parseCtbcText(text) {
  const results = [];
  for (const rawLine of text.split(/\n+/)) {
    const line = rawLine.replace(/\s+/g, ' ').trim();
    const dates = [...line.matchAll(/20\d{2}[\/-]\d{2}[\/-]\d{2}/g)];
    if (!dates.length) continue;
    const transactionDate = normalizeImportedDate(dates[0][0]);
    const afterDates = line.slice((dates[1] || dates[0]).index + (dates[1] || dates[0])[0].length)
      .replace(/20\d{2}[\/-]\d{2}[\/-]\d{2}/g, '')
      .replace(/\d+\s*[／/]\s*\d+\s*期/g, '')
      .trim();
    const amounts = [...afterDates.matchAll(/(?<!\d)(\d{1,3}(?:,\d{3})*|\d+)(?:\.(\d{2}))?(?!\d)/g)]
      .map(match => ({ value: Number(`${match[1].replaceAll(',', '')}.${match[2] || '00'}`), index: match.index, raw: match[0] }))
      .filter(item => Number.isFinite(item.value) && item.value > 0);
    if (!amounts.length) continue;
    const firstAmount = amounts[0];
    let note = afterDates.slice(0, firstAmount.index).replace(/^\S*\*+\S*\s*/, '').trim();
    if (!note || /帳戶餘額|貸款本金|貸款餘額|合計/.test(note)) continue;
    const income = /回饋金|退款|退貨|存入/.test(note);
    const amount = income && amounts.length > 1 ? amounts[1].value : firstAmount.value;
    const kind = classifyImportedTransaction(note, income);
    results.push({ occurredAt: transactionDate, amount, note, category: importedCategory(note), transactionKind: kind, paymentAccount: '中信存款帳戶', selected: true });
  }
  return results;
}

function parseCsvLine(line) {
  const values = []; let value = ''; let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"' && line[i + 1] === '"') { value += '"'; i += 1; }
    else if (char === '"') quoted = !quoted;
    else if (char === ',' && !quoted) { values.push(value.trim()); value = ''; }
    else value += char;
  }
  values.push(value.trim()); return values;
}

function parseCsv(text) {
  const rows = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter(Boolean).map(parseCsvLine);
  if (rows.length < 2) return [];
  const headers = rows[0].map(value => value.replace(/\s/g, ''));
  const find = names => headers.findIndex(header => names.some(name => header.includes(name)));
  const dateIndex = find(['交易日', '日期']);
  const noteIndex = find(['摘要', '說明', '店家', '交易內容']);
  const expenseIndex = find(['支出', '扣款', '金額']);
  const incomeIndex = find(['存入', '收入']);
  if (dateIndex < 0 || expenseIndex < 0) return [];
  return rows.slice(1).map(row => {
    const occurredAt = normalizeImportedDate(row[dateIndex]);
    const expense = Number(String(row[expenseIndex] || '').replaceAll(',', '')) || 0;
    const income = incomeIndex >= 0 ? Number(String(row[incomeIndex] || '').replaceAll(',', '')) || 0 : 0;
    const note = row[noteIndex] || '帳單交易';
    const amount = income || expense;
    return occurredAt && amount ? { occurredAt, amount, note, category: importedCategory(note), transactionKind: classifyImportedTransaction(note, income > 0), paymentAccount: '帳單匯入', selected: true } : null;
  }).filter(Boolean);
}

async function extractPdfText(file) {
  const pdfjs = await import('https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs';
  const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const lines = [];
  for (let number = 1; number <= pdf.numPages; number += 1) {
    const page = await pdf.getPage(number);
    const content = await page.getTextContent();
    const grouped = new Map();
    for (const item of content.items) {
      const y = Math.round(item.transform[5] / 3) * 3;
      if (!grouped.has(y)) grouped.set(y, []);
      grouped.get(y).push({ x: item.transform[4], text: item.str });
    }
    [...grouped.entries()].sort((a, b) => b[0] - a[0]).forEach(([, items]) => lines.push(items.sort((a, b) => a.x - b.x).map(item => item.text).join(' ')));
  }
  return lines.join('\n');
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) { if (window.Tesseract) resolve(); else existing.addEventListener('load', resolve, { once: true }); return; }
    const script = document.createElement('script'); script.src = src; script.onload = resolve; script.onerror = reject; document.head.appendChild(script);
  });
}

async function extractImageText(file) {
  const status = document.querySelector('#import-status');
  await loadScript('https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js');
  const worker = await window.Tesseract.createWorker('chi_tra+eng', 1, { logger: message => {
    if (message.status === 'recognizing text') status.textContent = `本機辨識中：${Math.round(message.progress * 100)}%`;
  }});
  const result = await worker.recognize(file);
  await worker.terminate();
  return result.data.text;
}

function importFingerprint(item) { return `${item.occurredAt}|${item.amount}|${item.note}|${item.paymentAccount}`; }

function renderImportPreview() {
  const target = document.querySelector('#import-preview');
  if (!pendingImports.length) { target.className = 'empty'; target.textContent = '沒有辨識到可匯入的交易，請改用清楚圖片、原始 PDF 或 CSV。'; document.querySelector('#confirm-import').hidden = true; return; }
  target.className = 'import-list';
  target.innerHTML = pendingImports.map((item, index) => `<label class="import-item"><input type="checkbox" data-import-index="${index}" ${item.selected ? 'checked' : ''}><span>${escapeHtml(item.note)}<small>${item.occurredAt}・${escapeHtml(item.paymentAccount)}・${item.category}</small><span class="import-kind">${item.transactionKind === 'expense' ? '支出' : item.transactionKind === 'income' ? '收入／退款' : '轉帳（不計支出）'}</span></span><strong>${money(item.amount)}</strong></label>`).join('');
  document.querySelector('#confirm-import').hidden = false;
}

async function processStatementFile(file) {
  const status = document.querySelector('#import-status');
  const preview = document.querySelector('#import-preview');
  preview.className = 'empty'; preview.textContent = `正在讀取：${file.name}`; status.textContent = '資料只在這台手機處理，不會上傳帳單。';
  try {
    let text;
    if (/csv/i.test(file.type) || file.name.toLowerCase().endsWith('.csv')) pendingImports = parseCsv(await file.text());
    else {
      text = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf') ? await extractPdfText(file) : await extractImageText(file);
      pendingImports = parseCtbcText(text);
    }
    const localCtbcAccount = paymentAccounts.find(name => /中信.*金融卡/.test(name)) || paymentAccounts.find(name => name.includes('中信'));
    if (localCtbcAccount && !/csv/i.test(file.type) && !file.name.toLowerCase().endsWith('.csv')) {
      pendingImports = pendingImports.map(item => ({ ...item, paymentAccount: localCtbcAccount }));
    }
    status.textContent = `辨識完成：找到 ${pendingImports.length} 筆。請逐筆勾選後確認。`;
    renderImportPreview();
  } catch (error) {
    console.error(error); pendingImports = []; renderImportPreview(); status.textContent = '辨識失敗。請確認網路後重試，或改用原始 PDF／CSV。';
  }
}

function confirmImport() {
  document.querySelectorAll('[data-import-index]').forEach(box => { pendingImports[Number(box.dataset.importIndex)].selected = box.checked; });
  const existing = new Set(entries.map(importFingerprint));
  const selected = pendingImports.filter(item => item.selected);
  const fresh = selected.filter(item => !existing.has(importFingerprint(item)));
  const now = new Date().toISOString();
  entries.unshift(...fresh.map(item => ({ ...item, id: crypto.randomUUID(), audio: false, audioId: null, transcript: '', importedAt: now, createdAt: now })));
  persist(); renderRecent(); renderReport();
  document.querySelector('#import-status').textContent = `已匯入 ${fresh.length} 筆；重複或未勾選 ${pendingImports.length - fresh.length} 筆。`;
  pendingImports = []; document.querySelector('#confirm-import').hidden = true;
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
  const payload=new TextEncoder().encode(JSON.stringify({version:4,createdAt:new Date().toISOString(),entries,audio,paymentAccounts,plannerItems}));
  const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,payload);
  const pack={format:'mama-ledger-backup',salt:b64(salt),iv:b64(iv),data:b64(new Uint8Array(encrypted))};
  const blob=new Blob([JSON.stringify(pack)],{type:'application/octet-stream'}), url=URL.createObjectURL(blob), a=document.createElement('a');
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
    entries=restored.entries;
    if (Array.isArray(restored.paymentAccounts) && restored.paymentAccounts.length) {
      paymentAccounts=restored.paymentAccounts; localStorage.setItem(ACCOUNT_KEY,JSON.stringify(paymentAccounts)); renderPaymentAccounts();
    }
    if (Array.isArray(restored.plannerItems)) {
      plannerItems=restored.plannerItems; persistPlanner(); renderPlanner();
    }
    persist(); renderRecent(); renderReport(); showBackup('復原完成。');
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
  const account=event.target.closest('[data-payment-account]'); if(account){paymentAccount=account.dataset.paymentAccount;renderPaymentAccounts();}
  const plannerType=event.target.closest('[data-planner-kind]');
  if(plannerType){plannerKind=plannerType.dataset.plannerKind;document.querySelector('#planner-message').textContent='';renderPlanner();}
  const calendarDate=event.target.closest('[data-calendar-date]');
  if(calendarDate){selectedPlannerDate=calendarDate.dataset.calendarDate;document.querySelector('#planner-message').textContent='';renderPlanner();}
  const plannerToggle=event.target.closest('[data-planner-toggle]'); if(plannerToggle) togglePlannerItem(plannerToggle.dataset.plannerToggle);
  const plannerDelete=event.target.closest('[data-planner-delete]'); if(plannerDelete) deletePlannerItem(plannerDelete.dataset.plannerDelete);
  const play=event.target.closest('[data-audio-id]');
  if(play && !play.disabled) playSavedAudio(play.dataset.audioId, play);
});
document.querySelector('#record-button').addEventListener('click', startOrStopRecording);
document.querySelector('#play-pending').addEventListener('click', playPendingAudio);
document.querySelector('#smart-review').addEventListener('click', analyzeAndConfirmSpeech);
document.querySelector('#save-entry').addEventListener('click', saveEntry);
document.querySelector('#confirm-report').addEventListener('click', () => confirm('確認報表正確，並排定7天後刪除原始音檔？') && scheduleDeletion());
document.querySelector('#cancel-deletion').addEventListener('click', cancelDeletion);
document.querySelector('#export-backup').addEventListener('click', exportBackup);
document.querySelector('#restore-file').addEventListener('change', e => e.target.files[0] && restoreBackup(e.target.files[0]));
document.querySelector('#save-payment-accounts').addEventListener('click', savePaymentAccounts);
document.querySelector('#statement-file').addEventListener('change', event => {
  const file = event.target.files[0];
  if (!file) return;
  const isImage = file.type.startsWith('image/') || /\.(png|jpe?g|webp|heic|heif)$/i.test(file.name);
  if (isImage) openRedactionEditor(file);
  else processStatementFile(file);
});
document.querySelector('#confirm-import').addEventListener('click', confirmImport);
document.querySelector('#redaction-canvas').addEventListener('pointerdown', beginRedaction);
document.querySelector('#redaction-canvas').addEventListener('pointermove', moveRedaction);
document.querySelector('#redaction-canvas').addEventListener('pointerup', endRedaction);
document.querySelector('#redaction-canvas').addEventListener('pointercancel', endRedaction);
document.querySelector('#redaction-undo').addEventListener('click', () => {
  redactionStrokes.pop();
  activeRedactionStroke = null;
  redrawRedactionCanvas();
  document.querySelector('#redaction-message').textContent = redactionStrokes.length ? '已復原最後一筆。' : '目前沒有遮蔽筆跡。';
});
document.querySelector('#redaction-reset').addEventListener('click', () => {
  if (redactionStrokes.length && !confirm('要清除目前所有遮蔽筆跡，重新塗嗎？')) return;
  redactionStrokes = [];
  activeRedactionStroke = null;
  redrawRedactionCanvas();
  document.querySelector('#redaction-message').textContent = '已清除遮蔽筆跡，可以重新塗。';
});
document.querySelector('#redaction-finish').addEventListener('click', finishRedaction);
document.querySelector('#redaction-save').addEventListener('click', shareRedactedImage);
document.querySelector('#redaction-skip').addEventListener('click', skipRedaction);
document.querySelector('#redaction-cancel').addEventListener('click', closeRedactionEditor);
document.querySelector('#calendar-prev').addEventListener('click', () => changePlannerMonth(-1));
document.querySelector('#calendar-next').addEventListener('click', () => changePlannerMonth(1));
document.querySelector('#planner-save').addEventListener('click', addPlannerItem);
document.querySelector('#planner-title').addEventListener('keydown', event => {
  if (event.key === 'Enter') { event.preventDefault(); addPlannerItem(); }
});
window.addEventListener('beforeinstallprompt', event=>{event.preventDefault();deferredInstall=event;document.querySelector('#install-button').hidden=false;});
document.querySelector('#install-button').addEventListener('click',async()=>{if(deferredInstall){deferredInstall.prompt();deferredInstall=null;}else alert('iPhone請按Safari分享按鈕，再選「加入主畫面」。');});
if('serviceWorker'in navigator) navigator.serviceWorker.register('./sw.js');
deleteDueAudio().then(()=>{renderRecent();renderReport();}); renderCategories(); renderPaymentAccounts(); renderRecent(); renderPlanner(); updateStorageStatus();
