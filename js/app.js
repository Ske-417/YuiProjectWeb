// Yui - 完全版 JS (勤務トラッカー + Supabase 同期 + Chart.js)
// Supabase credentials (you provided these values)
// NOTE: you supplied these; keep them secret if you don't want others to use your project.
// If you prefer, replace with placeholders before committing.
const SUPABASE_URL = 'https://laomhooyupangbkkhouw.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imxhb21ob295dXBhbmdia2tob3V3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjI3MzA3MzgsImV4cCI6MjA3ODMwNjczOH0.rm8wf8EjIGnABfeCDPVBtpMWQoxVrjZGrp8ZwphPlxw';

// --- Supabase client (UMD global "supabase")
const supabase = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Tasks list
const TASKS = ["観察","投薬","記録","介助","移送","待機"];

// UI elements
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const statusText = document.getElementById('statusText');
const currentTaskEl = document.getElementById('currentTask');
const elapsedEl = document.getElementById('elapsed');
const taskButtonsDiv = document.getElementById('taskButtons');
const historyList = document.getElementById('historyList');
const exportCsvBtn = document.getElementById('exportCsv');
const clearHistoryBtn = document.getElementById('clearHistory');

const emailInput = document.getElementById('emailInput');
const sendMagicBtn = document.getElementById('sendMagicBtn');
const signOutBtn = document.getElementById('signOutBtn');
const userEmailSpan = document.getElementById('userEmail');
const syncUploadBtn = document.getElementById('syncUpload');
const syncDownloadBtn = document.getElementById('syncDownload');
const syncStatusSpan = document.getElementById('syncStatus');

const chartModal = document.getElementById('chartModal');
const closeChartBtn = document.getElementById('closeChart');
const chartCanvas = document.getElementById('chartCanvas');
const chartLegend = document.getElementById('chartLegend');

let chartInstance = null;

// State
let timerId = null;
let currentUser = null; // supabase user object when logged in
let shiftState = {
  working: false,
  startAt: null,
  currentTask: null,
  taskStartAt: null,
  taskRecords: []
};
let history = []; // local history cache (same shape stored locally and in supabase)

const KEY_STATE = 'yui_shift_state_v1';
const KEY_HISTORY = 'yui_history_v1';

// ---------------- Storage helpers ----------------
function saveStateLocal(){
  localStorage.setItem(KEY_STATE, JSON.stringify(shiftState));
}
function loadStateLocal(){
  try{
    const s = localStorage.getItem(KEY_STATE);
    if(s) shiftState = JSON.parse(s);
    const h = localStorage.getItem(KEY_HISTORY);
    if(h) history = JSON.parse(h);
  }catch(e){ console.error(e); }
}
function saveHistoryLocal(){
  localStorage.setItem(KEY_HISTORY, JSON.stringify(history));
}

// ---------------- Utilities ----------------
function pad(n){ return n.toString().padStart(2,'0'); }
function fmtDurationSeconds(sec){
  sec = Math.floor(sec || 0);
  const h = Math.floor(sec/3600);
  const m = Math.floor((sec%3600)/60);
  const s = sec%60;
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}
function fmtTime(ms){ return new Date(ms).toLocaleString(); }
function now(){ return Date.now(); }

// ---------------- UI init ----------------
function initTaskButtons(){
  taskButtonsDiv.innerHTML = '';
  TASKS.forEach(t => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = t;
    b.dataset.task = t;
    b.addEventListener('click', () => {
      if(!shiftState.working) return;
      switchTask(t);
    });
    taskButtonsDiv.appendChild(b);
  });
}

// ---------------- Timer & UI update ----------------
function startTimer(){
  if(timerId) clearInterval(timerId);
  timerId = setInterval(()=>{
    if(shiftState.working && shiftState.startAt){
      const elapsedSec = Math.floor((now() - shiftState.startAt)/1000);
      elapsedEl.textContent = fmtDurationSeconds(elapsedSec);
    } else {
      elapsedEl.textContent = '00:00:00';
    }
  }, 500);
}

function updateUI(){
  statusText.textContent = shiftState.working ? '出勤中' : '未出勤';
  currentTaskEl.textContent = shiftState.currentTask || '-';
  startBtn.disabled = shiftState.working;
  stopBtn.disabled = !shiftState.working;

  const buttons = taskButtonsDiv.querySelectorAll('button');
  buttons.forEach(b=>{
    b.disabled = !shiftState.working;
    if(shiftState.currentTask && b.dataset.task === shiftState.currentTask) b.classList.add('active');
    else b.classList.remove('active');
  });

  renderHistory();
  // auth UI
  if(currentUser){
    emailInput.classList.add('hidden');
    sendMagicBtn.classList.add('hidden');
    signOutBtn.classList.remove('hidden');
    userEmailSpan.textContent = currentUser.email || '';
  } else {
    emailInput.classList.remove('hidden');
    sendMagicBtn.classList.remove('hidden');
    signOutBtn.classList.add('hidden');
    userEmailSpan.textContent = '';
  }
}

// ---------------- Shift & Task logic ----------------
function switchTask(taskName){
  const tnow = now();
  if(shiftState.currentTask && shiftState.taskStartAt){
    shiftState.taskRecords.push({
      task: shiftState.currentTask,
      start: shiftState.taskStartAt,
      end: tnow
    });
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
    shiftState.taskRecords.push({
      task: shiftState.currentTask,
      start: shiftState.taskStartAt,
      end: tnow
    });
  }

  const totalSec = Math.floor((tnow - shiftState.startAt)/1000);
  const perTask = {};
  shiftState.taskRecords.forEach(r=>{
    const sec = Math.floor((r.end - r.start)/1000);
    perTask[r.task] = (perTask[r.task] || 0) + sec;
  });

  const entry = {
    id: cryptoRandomId(), // local id for dedupe; Supabase will have its own id
    startAt: shiftState.startAt,
    endAt: tnow,
    totalSec,
    perTask,
    savedAt: now()
  };

  // save locally (newest first)
  history.unshift(entry);
  saveHistoryLocal();

  // show chart modal for this shift
  showChart(entry);

  // try to save to Supabase automatically if logged in
  if(currentUser){
    try{
      await saveHistoryToSupabase(entry);
      syncStatusSpan.textContent = 'クラウドに保存しました';
      // mark entry as uploaded (optional)
    }catch(e){
      console.error('Supabase save failed', e);
      syncStatusSpan.textContent = 'クラウド保存に失敗';
    }
  }

  // reset shift state
  shiftState.working = false;
  shiftState.startAt = null;
  shiftState.currentTask = null;
  shiftState.taskStartAt = null;
  shiftState.taskRecords = [];
  saveStateLocal();
  updateUI();
}

// ---------------- History rendering & CSV ----------------
function renderHistory(){
  historyList.innerHTML = '';
  if(history.length === 0){
    historyList.innerHTML = '<p class="muted">まだ記録がありません。</p>';
    return;
  }
  history.forEach((h, idx)=>{
    const div = document.createElement('div');
    div.className = 'entry';
    const header = document.createElement('h3');
    header.textContent = `${fmtTime(h.startAt)} 〜 ${fmtTime(h.endAt)} （合計 ${fmtDurationSeconds(h.totalSec)}）`;
    div.appendChild(header);

    const table = document.createElement('table');
    table.className = 'task-table';
    const thead = document.createElement('thead');
    thead.innerHTML = '<tr><th>業務</th><th>秒数</th><th>時間表示</th></tr>';
    table.appendChild(thead);
    const tbody = document.createElement('tbody');

    const keys = Object.keys(h.perTask || {}).sort((a,b)=> (h.perTask[b]||0) - (h.perTask[a]||0));
    if(keys.length === 0){
      const tr = document.createElement('tr');
      tr.innerHTML = '<td colspan="3" class="muted">業務記録なし</td>';
      tbody.appendChild(tr);
    } else {
      keys.forEach(k=>{
        const tr = document.createElement('tr');
        const td1 = document.createElement('td'); td1.textContent = k;
        const td2 = document.createElement('td'); td2.textContent = h.perTask[k];
        const td3 = document.createElement('td'); td3.textContent = fmtDurationSeconds(h.perTask[k]);
        tr.appendChild(td1); tr.appendChild(td2); tr.appendChild(td3);
        tbody.appendChild(tr);
      });
    }

    table.appendChild(tbody);
    div.appendChild(table);

    // button: show chart for this entry
    const btn = document.createElement('button');
    btn.textContent = '内訳を見る';
    btn.className = 'small';
    btn.style.marginTop = '8px';
    btn.addEventListener('click', ()=> showChart(h));
    div.appendChild(btn);

    historyList.appendChild(div);
  });
}

function exportCsv(){
  const rows = [];
  rows.push(['shift_start','shift_end','total_seconds','task','task_seconds'].join(','));
  history.slice().reverse().forEach(h=>{
    const start = new Date(h.startAt).toISOString();
    const end = new Date(h.endAt).toISOString();
    const total = h.totalSec;
    const keys = Object.keys(h.perTask || {});
    if(keys.length === 0){
      rows.push([start,end,total,'',0].join(','));
    } else {
      keys.forEach(k=>{
        rows.push([start,end,total, `"${k}"`, h.perTask[k]].join(','));
      });
    }
  });
  const blob = new Blob([rows.join('\n')], {type:'text/csv'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'yui_shift_history.csv'; document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

function clearHistory(){
  if(!confirm('履歴を完全に削除します。よろしいですか？')) return;
  history = [];
  saveHistoryLocal();
  renderHistory();
}

// ---------------- Simple ID helper ----------------
function cryptoRandomId(){
  // small unique id for local dedupe
  return 'id-' + Math.random().toString(36).slice(2,10);
}

// ---------------- Chart (Chart.js) ----------------
function showChart(entry){
  const labels = Object.keys(entry.perTask || {});
  const data = labels.map(l=> entry.perTask[l]);
  const colors = generatePalette(labels.length);

  // destroy previous
  if(chartInstance) { chartInstance.destroy(); chartInstance = null; chartLegend.innerHTML = ''; }

  chartInstance = new Chart(chartCanvas.getContext('2d'), {
    type: 'pie',
    data: {
      labels,
      datasets: [{
        data,
        backgroundColor: colors,
        borderColor: '#ffffff',
        borderWidth: 2
      }]
    },
    options: {
      plugins: {
        tooltip: {
          callbacks: {
            label: function(context){
              const sec = context.raw || 0;
              const pct = (entry.totalSec > 0) ? (sec / entry.totalSec * 100).toFixed(1) : '0.0';
              return `${context.label}: ${fmtDurationSeconds(sec)} (${pct}%)`;
            }
          }
        }
      }
    }
  });

  // legend
  labels.forEach((l,i)=>{
    const item = document.createElement('div');
    item.className = 'legend-item';
    const box = document.createElement('span');
    box.className = 'legend-color';
    box.style.background = colors[i];
    const txt = document.createElement('span');
    const sec = entry.perTask[l] || 0;
    const pct = (entry.totalSec>0) ? ((sec/entry.totalSec*100).toFixed(1)) : '0.0';
    txt.textContent = `${l} — ${fmtDurationSeconds(sec)} (${pct}%)`;
    item.appendChild(box);
    item.appendChild(txt);
    chartLegend.appendChild(item);
  });

  chartModal.classList.remove('hidden');
}

function generatePalette(n){
  const base = [
    '#4f46e5','#06b6d4','#f97316','#10b981','#ef4444','#8b5cf6','#f59e0b','#3b82f6','#06b6d4','#a78bfa'
  ];
  const out = [];
  for(let i=0;i<n;i++) out.push(base[i % base.length]);
  return out;
}

// ---------------- Supabase integration ----------------

// Save single entry to Supabase (histories table) - user must be logged in
async function saveHistoryToSupabase(entry){
  if(!currentUser) throw new Error('未ログインです');
  // match the SQL table described in instructions:
  // id (supabase side), user_id, start_at (bigint), end_at (bigint), total_sec, per_task (jsonb), created_at
  const payload = {
    user_id: currentUser.id,
    start_at: entry.startAt,
    end_at: entry.endAt,
    total_sec: entry.totalSec,
    per_task: entry.perTask
  };
  const { data, error } = await supabase.from('histories').insert([payload]);
  if(error) throw error;
  return data;
}

// Upload entire local history (dedup aware)
async function uploadAllHistoryToSupabase(){
  if(!currentUser) throw new Error('未ログインです');
  syncStatusSpan.textContent = '同期中...';
  // Fetch remote entries (by start_at & end_at) to avoid duplicates
  const { data: remote = [], error: rErr } = await supabase
    .from('histories')
    .select('start_at,end_at')
    .eq('user_id', currentUser.id);

  if(rErr) {
    syncStatusSpan.textContent = '同期失敗';
    throw rErr;
  }
  const remoteMap = new Set(remote.map(r => `${r.start_at}-${r.end_at}`));
  const toUpload = history.filter(h => !remoteMap.has(`${h.startAt}-${h.endAt}`)).map(h => ({
    user_id: currentUser.id,
    start_at: h.startAt,
    end_at: h.endAt,
    total_sec: h.totalSec,
    per_task: h.perTask
  }));

  if(toUpload.length === 0){
    syncStatusSpan.textContent = 'アップロード済みのデータのみです';
    return;
  }
  const { data, error } = await supabase.from('histories').insert(toUpload);
  if(error) {
    syncStatusSpan.textContent = '同期失敗';
    throw error;
  }
  syncStatusSpan.textContent = `アップロード ${toUpload.length} 件`;
  return data;
}

// Load remote history for current user and merge into local
async function loadHistoryFromSupabase(){
  if(!currentUser) throw new Error('未ログインです');
  syncStatusSpan.textContent = '読み込み中...';
  const { data, error } = await supabase
    .from('histories')
    .select('*')
    .eq('user_id', currentUser.id)
    .order('start_at', { ascending: false });
  if(error) {
    syncStatusSpan.textContent = '読み込み失敗';
    throw error;
  }
  const remote = data || [];
  // convert remote items to local entry shape and dedupe by start/end
  const remoteEntries = remote.map(r => ({
    id: r.id || cryptoRandomId(),
    startAt: Number(r.start_at),
    endAt: Number(r.end_at),
    totalSec: Number(r.total_sec),
    perTask: r.per_task || {},
    savedAt: (new Date(r.created_at)).getTime()
  }));

  // merge: keep unique by start-end pair
  const seen = new Set();
  const merged = [];
  // start with remote to prefer server canonical entries
  remoteEntries.forEach(e => {
    const k = `${e.startAt}-${e.endAt}`;
    if(!seen.has(k)){ seen.add(k); merged.push(e); }
  });
  // then local
  history.forEach(e=>{
    const k = `${e.startAt}-${e.endAt}`;
    if(!seen.has(k)){ seen.add(k); merged.push(e); }
  });

  // sort newest first
  merged.sort((a,b)=>b.startAt - a.startAt);
  history = merged;
  saveHistoryLocal();
  syncStatusSpan.textContent = `読み込み ${remoteEntries.length} 件`;
  renderHistory();
  return history;
}

// ---------------- Auth helpers ----------------
async function sendMagicLink(email){
  if(!email) { alert('メールアドレスを入力してください'); return; }
  syncStatusSpan.textContent = '送信中...';
  const { data, error } = await supabase.auth.signInWithOtp({ email });
  if(error){
    alert('ログインリンク送信に失敗しました（コンソール参照）。');
    console.error(error);
    syncStatusSpan.textContent = '送信失敗';
    return;
  }
  alert('ログイン用リンクをメールに送信しました。メール内のリンクをクリックして戻ってきてください。');
  syncStatusSpan.textContent = 'メール送信済み';
}

async function signOut(){
  await supabase.auth.signOut();
  currentUser = null;
  updateUI();
}

// Listen to auth changes
supabase.auth.onAuthStateChange((event, session) => {
  // event examples: 'SIGNED_IN', 'SIGNED_OUT', 'USER_UPDATED'
  currentUser = session?.user ?? null;
  if(currentUser){
    syncStatusSpan.textContent = `ログイン: ${currentUser.email || currentUser.id}`;
    // load remote history automatically (merge)
    loadHistoryFromSupabase().catch(e => {
      console.error('ロード失敗', e);
      syncStatusSpan.textContent = '読み込み失敗';
    });
  } else {
    syncStatusSpan.textContent = '';
  }
  updateUI();
});

// initial: check current session
(async ()=>{
  try{
    const s = await supabase.auth.getSession();
    currentUser = s?.data?.session?.user ?? null;
  }catch(e){
    currentUser = null;
  }
})();

// ---------------- Event bindings ----------------
startBtn.addEventListener('click', ()=> startShift());
stopBtn.addEventListener('click', ()=> stopShift());
exportCsvBtn.addEventListener('click', ()=> exportCsv());
clearHistoryBtn.addEventListener('click', ()=> clearHistory());

syncUploadBtn.addEventListener('click', async ()=>{
  if(!currentUser){ alert('クラウドに保存するにはログインしてください'); return; }
  try{
    await uploadAllHistoryToSupabase();
  }catch(e){
    console.error(e);
    alert('同期に失敗しました（コンソール参照）');
  }
});

syncDownloadBtn.addEventListener('click', async ()=>{
  if(!currentUser){ alert('クラウドから読み込むにはログインしてください'); return; }
  try{
    await loadHistoryFromSupabase();
  }catch(e){
    console.error(e);
    alert('読み込みに失敗しました（コンソール参照）');
  }
});

// Auth UI
sendMagicBtn.addEventListener('click', ()=> sendMagicLink(emailInput.value.trim()));
signOutBtn.addEventListener('click', ()=> signOut());

// Chart modal close
closeChartBtn.addEventListener('click', ()=> {
  chartModal.classList.add('hidden');
  if(chartInstance){ chartInstance.destroy(); chartInstance = null; chartLegend.innerHTML = ''; }
});

// initialize UI and load local data
loadStateLocal();
initTaskButtons();
updateUI();
startTimer();
