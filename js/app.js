// Yui - 修正版：カスタム仕事内容を追加してボタン化（ローカル保存）
// Supabase credentials (you provided)
const SUPABASE_URL = 'https://laomhooyupangbkkhouw.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imxhb21ob295dXBhbmdia2tob3V3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjI3MzA3MzgsImV4cCI6MjA3ODMwNjczOH0.rm8wf8EjIGnABfeCDPVBtpMWQoxVrjZGrp8ZwphPlxw';

// Ensure supabase UMD global exists, then create client.
if (typeof window === 'undefined' || typeof window.supabase === 'undefined') {
  console.error('Supabase SDK が読み込まれていません。index.html で <script src=".../supabase.min.js"> があることを確認してください。');
}
const supabaseClient = window?.supabase?.createClient
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;

// --- DOM ---
const loginView = document.getElementById('loginView');
const mainView = document.getElementById('mainView');

const emailInput = document.getElementById('emailInput');
const sendMagicBtn = document.getElementById('sendMagicBtn');
const guestBtn = document.getElementById('guestBtn');
const loginHint = document.getElementById('loginHint');

const signOutBtn = document.getElementById('signOutBtn');
const userEmailSpan = document.getElementById('userEmail');

const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const statusText = document.getElementById('statusText');
const currentTaskEl = document.getElementById('currentTask');
const elapsedEl = document.getElementById('elapsed');
const taskButtonsDiv = document.getElementById('taskButtons');
const historyList = document.getElementById('historyList');
const exportCsvBtn = document.getElementById('exportCsv');
const clearHistoryBtn = document.getElementById('clearHistory');

const newTaskInput = document.getElementById('newTaskInput');
const addTaskBtn = document.getElementById('addTaskBtn');
const clearCustomBtn = document.getElementById('clearCustomBtn');

const syncUploadBtn = document.getElementById('syncUpload');
const syncDownloadBtn = document.getElementById('syncDownload');
const syncStatusSpan = document.getElementById('syncStatus');

const chartModal = document.getElementById('chartModal');
const closeChartBtn = document.getElementById('closeChart');
const chartCanvas = document.getElementById('chartCanvas');
const chartLegend = document.getElementById('chartLegend');

let chartInstance = null;

// --- Tasks: defaults + custom storage keys ---
const DEFAULT_TASKS = ["観察","投薬","記録","介助","移送","待機"];
const KEY_CUSTOM_TASKS = 'yui_custom_tasks_v1';

// local state
let customTasks = []; // user-added tasks (strings)
let currentUser = null; // null = not logged in; {id,email} when logged in
let guestMode = false;

let timerId = null;
let shiftState = {
  working: false,
  startAt: null,
  currentTask: null,
  taskStartAt: null,
  taskRecords: []
};
let history = [];

const KEY_STATE = 'yui_shift_state_v1';
const KEY_HISTORY = 'yui_history_v1';

// --- local storage helpers ---
function saveStateLocal(){ localStorage.setItem(KEY_STATE, JSON.stringify(shiftState)); }
function loadStateLocal(){
  try{
    const s = localStorage.getItem(KEY_STATE);
    if(s) shiftState = JSON.parse(s);
    const h = localStorage.getItem(KEY_HISTORY);
    if(h) history = JSON.parse(h);
    const c = localStorage.getItem(KEY_CUSTOM_TASKS);
    if(c) customTasks = JSON.parse(c);
  }catch(e){ console.error(e); }
}
function saveHistoryLocal(){ localStorage.setItem(KEY_HISTORY, JSON.stringify(history)); }
function saveCustomTasks(){ localStorage.setItem(KEY_CUSTOM_TASKS, JSON.stringify(customTasks)); }

// --- utility ---
function pad(n){ return n.toString().padStart(2,'0'); }
function fmtDurationSeconds(sec){ sec = Math.floor(sec||0); const h=Math.floor(sec/3600); const m=Math.floor((sec%3600)/60); const s=sec%60; return `${pad(h)}:${pad(m)}:${pad(s)}`; }
function fmtTime(ms){ return new Date(ms).toLocaleString(); }
function now(){ return Date.now(); }
function cryptoRandomId(){ return 'id-'+Math.random().toString(36).slice(2,10); }

// --- Task buttons rendering (uses DEFAULT_TASKS + customTasks) ---
function getAllTasks(){
  // custom tasks should appear after defaults
  return DEFAULT_TASKS.concat(customTasks);
}
function initTaskButtons(){
  taskButtonsDiv.innerHTML = '';
  const all = getAllTasks();
  all.forEach(t=>{
    const b = document.createElement('button');
    b.type='button';
    b.textContent = t;
    b.dataset.task = t;
    // mark custom tasks for styling if needed
    if(customTasks.find(ct => ct.toLowerCase() === (t||'').toLowerCase())){
      b.dataset.custom = '1';
    }
    b.addEventListener('click', ()=> { if(!shiftState.working) return; switchTask(t); });
    taskButtonsDiv.appendChild(b);
  });
}

// --- Timer & UI updates ---
function startTimer(){
  if(timerId) clearInterval(timerId);
  timerId = setInterval(()=>{
    if(shiftState.working && shiftState.startAt){
      const elapsedSec = Math.floor((now()-shiftState.startAt)/1000);
      elapsedEl.textContent = fmtDurationSeconds(elapsedSec);
    } else {
      elapsedEl.textContent = '00:00:00';
    }
  },500);
}

function showLoginView(){
  loginView.classList.remove('hidden');
  mainView.classList.add('hidden');
  loginView.setAttribute('aria-hidden','false');
  mainView.setAttribute('aria-hidden','true');
}
function showMainView(){
  loginView.classList.add('hidden');
  mainView.classList.remove('hidden');
  loginView.setAttribute('aria-hidden','true');
  mainView.setAttribute('aria-hidden','false');
}

function updateAuthUI(){
  if(currentUser){
    userEmailSpan.textContent = currentUser.email || '';
    signOutBtn.classList.remove('hidden');
    showMainView();
  } else if(guestMode){
    userEmailSpan.textContent = '(ゲストモード)';
    signOutBtn.classList.remove('hidden');
    showMainView();
  } else {
    userEmailSpan.textContent = '';
    signOutBtn.classList.add('hidden');
    showLoginView();
  }
}

function updateUI(){
  statusText.textContent = shiftState.working ? '出勤中' : '未出勤';
  currentTaskEl.textContent = shiftState.currentTask || '-';
  startBtn.disabled = shiftState.working;
  stopBtn.disabled = !shiftState.working;

  const buttons = taskButtonsDiv.querySelectorAll('button');
  buttons.forEach(b=>{
    b.disabled = !shiftState.working;
    if(shiftState.currentTask && b.dataset.task === shiftState.currentTask) b.classList.add('active'); else b.classList.remove('active');
  });

  renderHistory();
  updateAuthUI();
}

// --- shift/task logic ---
function switchTask(taskName){
  const tnow = now();
  if(shiftState.currentTask && shiftState.taskStartAt){
    shiftState.taskRecords.push({ task: shiftState.currentTask, start: shiftState.taskStartAt, end: tnow });
  }
  shiftState.currentTask = taskName;
  shiftState.taskStartAt = tnow;
  saveStateLocal();
  updateUI();
}

function startShift(){
  shiftState.working = true;
  shiftState.startAt = now();
  shiftState.currentTask = null;
  shiftState.taskStartAt = null;
  shiftState.taskRecords = [];
  saveStateLocal();
  startTimer();
  updateUI();
}

async function stopShift(){
  const tnow = now();
  if(shiftState.currentTask && shiftState.taskStartAt){
    shiftState.taskRecords.push({ task: shiftState.currentTask, start: shiftState.taskStartAt, end: tnow });
  }
  const totalSec = Math.floor((tnow - shiftState.startAt)/1000);
  const perTask = {};
  shiftState.taskRecords.forEach(r => {
    const sec = Math.floor((r.end - r.start)/1000);
    perTask[r.task] = (perTask[r.task] || 0) + sec;
  });

  const entry = {
    id: cryptoRandomId(),
    startAt: shiftState.startAt,
    endAt: tnow,
    totalSec,
    perTask,
    savedAt: now()
  };

  history.unshift(entry);
  saveHistoryLocal();

  showChart(entry);

  // auto upload if logged in (not guest)
  if(currentUser){
    try{
      await saveHistoryToSupabase(entry);
      syncStatusSpan.textContent = 'クラウドに保存しました';
    }catch(e){
      console.error('Supabase save failed', e);
      syncStatusSpan.textContent = 'クラウド保存に失敗';
    }
  }else{
    syncStatusSpan.textContent = guestMode ? 'ゲストモード：クラウド未保存' : '未ログイン';
  }

  // reset
  shiftState.working = false;
  shiftState.startAt = null;
  shiftState.currentTask = null;
  shiftState.taskStartAt = null;
  shiftState.taskRecords = [];
  saveStateLocal();
  updateUI();
}

// --- history render & CSV ---
function renderHistory(){
  historyList.innerHTML = '';
  if(history.length === 0){ historyList.innerHTML = '<p class="muted">まだ記録がありません。</p>'; return; }
  history.forEach(h=>{
    const div = document.createElement('div'); div.className='entry';
    const header = document.createElement('h3');
    header.textContent = `${fmtTime(h.startAt)} 〜 ${fmtTime(h.endAt)} （合計 ${fmtDurationSeconds(h.totalSec)}）`;
    div.appendChild(header);

    const table = document.createElement('table'); table.className='task-table';
    const thead = document.createElement('thead'); thead.innerHTML = '<tr><th>業務</th><th>秒数</th><th>時間表示</th></tr>';
    table.appendChild(thead);
    const tbody = document.createElement('tbody');

    const keys = Object.keys(h.perTask || {}).sort((a,b)=> (h.perTask[b]||0) - (h.perTask[a]||0));
    if(keys.length === 0){
      const tr = document.createElement('tr'); tr.innerHTML = '<td colspan="3" class="muted">業務記録なし</td>'; tbody.appendChild(tr);
    } else {
      keys.forEach(k=>{
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${k}</td><td>${h.perTask[k]}</td><td>${fmtDurationSeconds(h.perTask[k])}</td>`;
        tbody.appendChild(tr);
      });
    }

    table.appendChild(tbody); div.appendChild(table);

    const btn = document.createElement('button'); btn.textContent='内訳を見る'; btn.className='small'; btn.style.marginTop='8px';
    btn.addEventListener('click', ()=> showChart(h));
    div.appendChild(btn);

    historyList.appendChild(div);
  });
}

function exportCsv(){
  const rows = []; rows.push(['shift_start','shift_end','total_seconds','task','task_seconds'].join(','));
  history.slice().reverse().forEach(h=>{
    const start = new Date(h.startAt).toISOString();
    const end = new Date(h.endAt).toISOString();
    const total = h.totalSec;
    const keys = Object.keys(h.perTask || {});
    if(keys.length === 0){
      rows.push([start,end,total,'',0].join(','));
    } else {
      keys.forEach(k=> rows.push([start,end,total, `"${k}"`, h.perTask[k]].join(',')));
    }
  });
  const blob = new Blob([rows.join('\n')], {type:'text/csv'});
  const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href=url; a.download='yui_shift_history.csv'; document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}
function clearHistory(){ if(!confirm('履歴を完全に削除します。よろしいですか？')) return; history=[]; saveHistoryLocal(); renderHistory(); }

// --- chart ---
function showChart(entry){
  const labels = Object.keys(entry.perTask || {});
  const data = labels.map(l => entry.perTask[l] || 0);
  const colors = generatePalette(labels.length);
  if(chartInstance){ chartInstance.destroy(); chartInstance = null; chartLegend.innerHTML = ''; }
  chartInstance = new Chart(chartCanvas.getContext('2d'), {
    type:'pie',
    data:{ labels, datasets:[{ data, backgroundColor: colors, borderColor:'#fff', borderWidth:2 }]},
    options:{
      plugins:{
        tooltip:{
          callbacks:{
            label: function(context){
              const sec = context.raw || 0;
              const pct = (entry.totalSec>0) ? (sec/entry.totalSec*100).toFixed(1) : '0.0';
              return `${context.label}: ${fmtDurationSeconds(sec)} (${pct}%)`;
            }
          }
        }
      }
    }
  });

  labels.forEach((l,i)=>{
    const item = document.createElement('div'); item.className='legend-item';
    const box = document.createElement('span'); box.className='legend-color'; box.style.background = colors[i];
    const txt = document.createElement('span'); const sec = entry.perTask[l]||0; const pct = (entry.totalSec>0)?((sec/entry.totalSec*100).toFixed(1)):'0.0';
    txt.textContent = `${l} — ${fmtDurationSeconds(sec)} (${pct}%)`;
    item.appendChild(box); item.appendChild(txt); chartLegend.appendChild(item);
  });

  chartModal.classList.remove('hidden');
}
function generatePalette(n){
  const base = ['#4f46e5','#06b6d4','#f97316','#10b981','#ef4444','#8b5cf6','#f59e0b','#3b82f6','#06b6d4','#a78bfa'];
  const out = []; for(let i=0;i<n;i++) out.push(base[i%base.length]); return out;
}

// --- Supabase integration (auth & storage) ---

async function sendMagicLink(email){
  if(!email){ alert('メールアドレスを入力してください'); return; }
  if(!supabaseClient){ console.error('Supabase client not initialized'); loginHint.textContent = '内部エラー: Supabase が初期化されていません'; return; }
  try{
    sendMagicBtn.disabled = true;
    loginHint.textContent = '送信中... メールを確認してください（受信に数分かかることがあります）';
    const redirectTo = window.location.origin + window.location.pathname;
    const { data, error } = await supabaseClient.auth.signInWithOtp({ email, options: { emailRedirectTo: redirectTo } });
    if(error){
      console.error('sendMagicLink error', error);
      loginHint.textContent = '送信に失敗しました。コンソールを確認してください。';
      return;
    }
    loginHint.textContent = 'ログインリンクを送信しました。メールのリンクを開いて戻ってください。';
  }catch(e){
    console.error(e);
    loginHint.textContent = '送信中にエラーが発生しました。';
  }finally{
    sendMagicBtn.disabled = false;
  }
}

async function signOut(){
  if(!supabaseClient){ currentUser = null; guestMode = false; updateUI(); return; }
  await supabaseClient.auth.signOut();
  currentUser = null;
  guestMode = false;
  updateUI();
}

// save one entry
async function saveHistoryToSupabase(entry){
  if(!currentUser) throw new Error('未ログインです');
  if(!supabaseClient) throw new Error('Supabase client not initialized');
  const payload = { user_id: currentUser.id, start_at: entry.startAt, end_at: entry.endAt, total_sec: entry.totalSec, per_task: entry.perTask };
  const { data, error } = await supabaseClient.from('histories').insert([payload]);
  if(error) throw error;
  return data;
}

// upload all (dedupe)
async function uploadAllHistoryToSupabase(){
  if(!currentUser) throw new Error('未ログインです');
  if(!supabaseClient) throw new Error('Supabase client not initialized');
  syncStatusSpan.textContent = '同期中...';
  const { data: remote = [], error: rErr } = await supabaseClient.from('histories').select('start_at,end_at').eq('user_id', currentUser.id);
  if(rErr){ syncStatusSpan.textContent='同期失敗'; throw rErr; }
  const remoteMap = new Set(remote.map(r => `${r.start_at}-${r.end_at}`));
  const toUpload = history.filter(h => !remoteMap.has(`${h.startAt}-${h.endAt}`)).map(h => ({ user_id: currentUser.id, start_at: h.startAt, end_at: h.endAt, total_sec: h.totalSec, per_task: h.perTask }));
  if(toUpload.length===0){ syncStatusSpan.textContent='アップロードする新規データはありません'; return; }
  const { data, error } = await supabaseClient.from('histories').insert(toUpload);
  if(error){ syncStatusSpan.textContent='同期失敗'; throw error; }
  syncStatusSpan.textContent = `アップロード ${toUpload.length} 件`;
  return data;
}

// load remote and merge
async function loadHistoryFromSupabase(){
  if(!currentUser) throw new Error('未ログインです');
  if(!supabaseClient) throw new Error('Supabase client not initialized');
  syncStatusSpan.textContent = '読み込み中...';
  const { data, error } = await supabaseClient.from('histories').select('*').eq('user_id', currentUser.id).order('start_at', { ascending: false });
  if(error){ syncStatusSpan.textContent='読み込み失敗'; throw error; }
  const remote = data || [];
  const remoteEntries = remote.map(r => ({ id: r.id || cryptoRandomId(), startAt: Number(r.start_at), endAt: Number(r.end_at), totalSec: Number(r.total_sec), perTask: r.per_task || {}, savedAt: (new Date(r.created_at)).getTime() }));
  const seen = new Set(); const merged = [];
  remoteEntries.forEach(e=>{ const k = `${e.startAt}-${e.endAt}`; if(!seen.has(k)){ seen.add(k); merged.push(e); } });
  history.forEach(e=>{ const k = `${e.startAt}-${e.endAt}`; if(!seen.has(k)){ seen.add(k); merged.push(e); } });
  merged.sort((a,b)=>b.startAt - a.startAt); history = merged; saveHistoryLocal();
  syncStatusSpan.textContent = `読み込み ${remoteEntries.length} 件`;
  renderHistory();
  return history;
}

// --- Auth state handling ---
if (supabaseClient && supabaseClient.auth && typeof supabaseClient.auth.onAuthStateChange === 'function') {
  supabaseClient.auth.onAuthStateChange((event, session) => {
    currentUser = session?.user ?? null;
    if(currentUser){
      loginHint.textContent = `ログイン済み: ${currentUser.email || currentUser.id}`;
      // auto-load remote history and merge
      loadHistoryFromSupabase().catch(e => { console.error('ロード失敗', e); syncStatusSpan.textContent = '読み込み失敗'; });
    }
    updateUI();
  });
}

// initial check for session (returns session if magic link returned)
(async ()=>{
  loadStateLocal();
  initTaskButtons();
  // check existing session
  try{
    if (supabaseClient && supabaseClient.auth && typeof supabaseClient.auth.getSession === 'function') {
      const s = await supabaseClient.auth.getSession();
      currentUser = s?.data?.session?.user ?? null;
      if(currentUser) {
        // if logged in, load remote
        loadHistoryFromSupabase().catch(e=>console.error(e));
      }
    } else {
      console.warn('supabaseClient.auth.getSession is not available');
      currentUser = null;
    }
  }catch(e){
    console.warn('getSession failed', e);
    currentUser = null;
  }
  updateUI();
  startTimer();
})();

// --- event bindings ---
// login
sendMagicBtn.addEventListener('click', ()=> sendMagicLink(emailInput.value.trim()));
guestBtn.addEventListener('click', ()=>{
  guestMode = true;
  currentUser = null;
  updateUI();
  alert('ゲストモードで開始します。クラウド同期はできません。');
});
signOutBtn.addEventListener('click', ()=> signOut());

// basic app actions
startBtn.addEventListener('click', ()=> startShift());
stopBtn.addEventListener('click', ()=> stopShift());
exportCsvBtn.addEventListener('click', ()=> exportCsv());
clearHistoryBtn.addEventListener('click', ()=> clearHistory());

// sync actions
syncUploadBtn.addEventListener('click', async ()=>{
  if(!currentUser){ alert('クラウドに保存するにはログインしてください'); return; }
  try{ await uploadAllHistoryToSupabase(); }catch(e){ console.error(e); alert('同期に失敗しました（コンソール参照）'); }
});
syncDownloadBtn.addEventListener('click', async ()=>{
  if(!currentUser){ alert('クラウドから読み込むにはログインしてください'); return; }
  try{ await loadHistoryFromSupabase(); }catch(e){ console.error(e); alert('読み込みに失敗しました（コンソール参照）'); }
});

// chart modal close
closeChartBtn.addEventListener('click', ()=> {
  chartModal.classList.add('hidden');
  if(chartInstance){ chartInstance.destroy(); chartInstance = null; chartLegend.innerHTML = ''; }
});

// --- Custom task UI handlers ---
// Add custom task (from input)
function normalizeTaskName(name){ return (name || '').trim(); }
function isDuplicateTask(name){
  if(!name) return true;
  const lower = name.toLowerCase();
  return getAllTasks().some(t => (t||'').toLowerCase() === lower);
}

addTaskBtn.addEventListener('click', ()=>{
  const raw = newTaskInput.value || '';
  const name = normalizeTaskName(raw);
  if(!name){ alert('仕事内容を入力してください'); return; }
  if(isDuplicateTask(name)){ alert('同じ名前の仕事内容が既にあります'); return; }
  customTasks.push(name);
  saveCustomTasks();
  initTaskButtons();
  newTaskInput.value = '';
  // optionally select it immediately
  if(shiftState.working) switchTask(name);
  updateUI();
});

// Enterキーで追加
newTaskInput.addEventListener('keypress', (e)=>{
  if(e.key === 'Enter'){ e.preventDefault(); addTaskBtn.click(); }
});

// Clear custom tasks
clearCustomBtn.addEventListener('click', ()=>{
  if(!confirm('追加したカスタム仕事内容をすべて削除します。よろしいですか？')) return;
  customTasks = [];
  saveCustomTasks();
  initTaskButtons();
  updateUI();
});
