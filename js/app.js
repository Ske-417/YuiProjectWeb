(() => {
  const TASKS = ["観察","投薬","記録","介助","移送","待機"];

  // UI
  const startBtn = document.getElementById('startBtn');
  const stopBtn = document.getElementById('stopBtn');
  const statusText = document.getElementById('statusText');
  const currentTaskEl = document.getElementById('currentTask');
  const elapsedEl = document.getElementById('elapsed');
  const taskButtonsDiv = document.getElementById('taskButtons');
  const historyList = document.getElementById('historyList');
  const exportCsvBtn = document.getElementById('exportCsv');
  const clearHistoryBtn = document.getElementById('clearHistory');

  // State
  let timerId = null;
  let shiftState = {
    working: false,
    startAt: null,
    currentTask: null,
    taskStartAt: null,
    taskRecords: []
  };
  let history = [];

  // Storage keys
  const KEY_STATE = 'shiftTracker_state_v1';
  const KEY_HISTORY = 'shiftTracker_history_v1';

  function saveState(){
    localStorage.setItem(KEY_STATE, JSON.stringify(shiftState));
  }
  function loadState(){
    try{
      const s = localStorage.getItem(KEY_STATE);
      if(s) shiftState = JSON.parse(s);
      const h = localStorage.getItem(KEY_HISTORY);
      if(h) history = JSON.parse(h);
    }catch(e){
      console.error(e);
    }
  }
  function saveHistory(){
    localStorage.setItem(KEY_HISTORY, JSON.stringify(history));
  }

  function fmtTime(ms){
    const d = new Date(ms);
    return d.toLocaleString();
  }
  function pad(n){ return n.toString().padStart(2,'0'); }
  function fmtDurationSeconds(sec){
    sec = Math.floor(sec);
    const h = Math.floor(sec/3600);
    const m = Math.floor((sec%3600)/60);
    const s = sec%60;
    return `${pad(h)}:${pad(m)}:${pad(s)}`;
  }
  function now(){ return Date.now(); }

  function updateUI(){
    statusText.textContent = shiftState.working ? '出勤中' : '未出勤';
    currentTaskEl.textContent = shiftState.currentTask || '-';
    startBtn.disabled = shiftState.working;
    stopBtn.disabled = !shiftState.working;

    const buttons = taskButtonsDiv.querySelectorAll('button');
    buttons.forEach(b => {
      b.disabled = !shiftState.working;
      if(shiftState.currentTask && b.dataset.task === shiftState.currentTask){
        b.classList.add('active');
      } else {
        b.classList.remove('active');
      }
    });

    renderHistory();
  }

  function startTimer(){
    if(timerId) clearInterval(timerId);
    timerId = setInterval(() => {
      if(shiftState.working && shiftState.startAt){
        const elapsedSec = (now() - shiftState.startAt) / 1000;
        elapsedEl.textContent = fmtDurationSeconds(elapsedSec);
      } else {
        elapsedEl.textContent = '00:00:00';
      }
    }, 500);
  }

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
    saveState();
    updateUI();
  }

  function startShift(){
    shiftState.working = true;
    shiftState.startAt = now();
    shiftState.currentTask = null;
    shiftState.taskStartAt = null;
    shiftState.taskRecords = [];
    saveState();
    startTimer();
    updateUI();
  }

  function stopShift(){
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
    shiftState.taskRecords.forEach(r => {
      const sec = Math.floor((r.end - r.start)/1000);
      perTask[r.task] = (perTask[r.task] || 0) + sec;
    });
    const entry = {
      startAt: shiftState.startAt,
      endAt: tnow,
      totalSec,
      perTask
    };
    history.unshift(entry);
    saveHistory();

    shiftState.working = false;
    shiftState.startAt = null;
    shiftState.currentTask = null;
    shiftState.taskStartAt = null;
    shiftState.taskRecords = [];
    saveState();
    updateUI();
  }

  function renderHistory(){
    historyList.innerHTML = '';
    if(history.length === 0){
      historyList.innerHTML = '<p class="footer-note">まだ記録がありません。</p>';
      return;
    }
    history.forEach((h, idx) => {
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

      const keys = Object.keys(h.perTask).sort((a,b)=>h.perTask[b]-h.perTask[a]);
      keys.forEach(k => {
        const tr = document.createElement('tr');
        const td1 = document.createElement('td'); td1.textContent = k;
        const td2 = document.createElement('td'); td2.textContent = h.perTask[k];
        const td3 = document.createElement('td'); td3.textContent = fmtDurationSeconds(h.perTask[k]);
        tr.appendChild(td1); tr.appendChild(td2); tr.appendChild(td3);
        tbody.appendChild(tr);
      });

      table.appendChild(tbody);
      div.appendChild(table);
      historyList.appendChild(div);
    });
  }

  function exportCsv(){
    const rows = [];
    rows.push(['shift_start','shift_end','total_seconds','task','task_seconds'].join(','));
    history.slice().reverse().forEach(h => {
      const start = new Date(h.startAt).toISOString();
      const end = new Date(h.endAt).toISOString();
      const total = h.totalSec;
      const keys = Object.keys(h.perTask);
      if(keys.length === 0){
        rows.push([start,end,total,'',0].join(','));
      }else{
        keys.forEach(k => {
          rows.push([start,end,total, `"${k}"`, h.perTask[k]].join(','));
        });
      }
    });
    const blob = new Blob([rows.join('\n')], {type: 'text/csv'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'shift_history.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function clearHistory(){
    if(!confirm('履歴を完全に削除します。よろしいですか？')) return;
    history = [];
    saveHistory();
    renderHistory();
  }

  function initTaskButtons(){
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

  startBtn.addEventListener('click', () => {
    startShift();
  });
  stopBtn.addEventListener('click', () => {
    stopShift();
  });
  exportCsvBtn.addEventListener('click', exportCsv);
  clearHistoryBtn.addEventListener('click', clearHistory);

  loadState();
  initTaskButtons();
  updateUI();
  startTimer();

})();