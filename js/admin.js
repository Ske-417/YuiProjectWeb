// admin.js — 管理者向け画面（/admin.html）
// Supabase settings: reuse same project and anon key (RLS + admins table must be configured)
const SUPABASE_URL = 'https://laomhooyupangbkkhouw.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imxhb21ob295dXBhbmdia2tob3V3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjI3MzA3MzgsImV4cCI6MjA3ODMwNjczOH0.rm8wf8EjIGnABfeCDPVBtpMWQoxVrjZGrp8ZwphPlxw';

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const adminDateInput = document.getElementById('adminDate');
const loadDayBtn = document.getElementById('loadDayBtn');
const adminListWrap = document.getElementById('adminListWrap');
const adminStatus = document.getElementById('adminStatus');
const adminUserArea = document.getElementById('adminUserArea');

let currentUser = null;
let isAdmin = false;

// Helpers
function startOfDayTs(dateStr){
  const d = new Date(dateStr);
  d.setHours(0,0,0,0);
  return d.getTime();
}
function endOfDayTs(dateStr){
  const d = new Date(dateStr);
  d.setHours(23,59,59,999);
  return d.getTime();
}
function fmtTime(ms){ return new Date(ms).toLocaleString(); }
function fmtDurationSeconds(sec){ sec = Math.floor(sec||0); const h=Math.floor(sec/3600); const m=Math.floor((sec%3600)/60); const s=sec%60; return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`; }

// Check session and admin status
async function init(){
  const s = await supabaseClient.auth.getSession();
  currentUser = s?.data?.session?.user ?? null;
  adminUserArea.textContent = currentUser ? `ログイン: ${currentUser.email}` : '未ログイン';
  // check admin table: call select on admins for this user
  if(currentUser){
    const { data, error } = await supabaseClient.from('admins').select('id').eq('user_id', currentUser.id).limit(1);
    if(error) console.error('admin check error', error);
    isAdmin = Array.isArray(data) && data.length > 0;
  }
  adminStatus.textContent = isAdmin ? '（管理者として表示）' : '（管理者ではありません）';
}

// Load shifts for given date range
async function loadShiftsForDate(dateStr){
  if(!dateStr){ alert('日付を選んでください'); return; }
  adminListWrap.innerHTML = '';
  adminStatus.textContent = '読み込み中...';
  const start = startOfDayTs(dateStr);
  const end = endOfDayTs(dateStr);

  // Query histories between start and end (we stored start_at/end_at as bigint ms)
  // also include user_email column for display
  const { data, error } = await supabaseClient
    .from('histories')
    .select('*')
    .gte('start_at', start)
    .lte('end_at', end)
    .order('start_at', { ascending: true });

  if(error){
    console.error('loadShiftsForDate error', error);
    adminStatus.textContent = '読み込みに失敗しました';
    return;
  }
  adminStatus.textContent = `読み込み ${data.length} 件`;

  if(data.length === 0){
    adminListWrap.innerHTML = '<p class="muted">該当日の勤務記録はありません。</p>';
    return;
  }

  // Group by user_email
  const byUser = {};
  data.forEach(r => {
    const email = r.user_email || r.user_id || 'unknown';
    if(!byUser[email]) byUser[email] = [];
    byUser[email].push(r);
  });

  // Render table for each user
  Object.keys(byUser).forEach(email => {
    const rows = byUser[email];
    const container = document.createElement('div');
    container.className = 'admin-user-block';
    container.innerHTML = `<h3>${email}</h3>`;
    const table = document.createElement('table');
    table.className = 'admin-table';
    const thead = document.createElement('thead');
    thead.innerHTML = '<tr><th>開始</th><th>終了</th><th>合計</th><th>業務内訳 (JSON)</th><th>操作</th></tr>';
    table.appendChild(thead);
    const tbody = document.createElement('tbody');
    rows.forEach(r => {
      const tr = document.createElement('tr');
      const startTd = document.createElement('td'); startTd.textContent = fmtTime(Number(r.start_at));
      const endTd = document.createElement('td'); endTd.textContent = fmtTime(Number(r.end_at));
      const totalTd = document.createElement('td'); totalTd.textContent = fmtDurationSeconds(Number(r.total_sec));
      const perTaskTd = document.createElement('td');
      const perTaskTextarea = document.createElement('textarea');
      perTaskTextarea.className = 'json-editor';
      perTaskTextarea.value = JSON.stringify(r.per_task || {}, null, 2);
      perTaskTextarea.readOnly = !isAdmin;
      if(isAdmin) perTaskTextarea.classList.add('editable');
      perTaskTd.appendChild(perTaskTextarea);

      const actionTd = document.createElement('td');
      const saveBtn = document.createElement('button'); saveBtn.textContent = '保存'; saveBtn.className = 'small';
      saveBtn.disabled = !isAdmin;
      const editTimesBtn = document.createElement('button'); editTimesBtn.textContent = '編集'; editTimesBtn.className = 'small';
      editTimesBtn.disabled = !isAdmin;

      // When edit times clicked, replace start/end td with inputs
      editTimesBtn.addEventListener('click', ()=>{
        if(!isAdmin) return;
        const sInput = document.createElement('input'); sInput.type = 'datetime-local';
        const eInput = document.createElement('input'); eInput.type = 'datetime-local';
        // convert ms to local ISO without seconds
        function toLocalDatetimeValue(ms){
          const d = new Date(Number(ms));
          const pad = n => String(n).padStart(2,'0');
          const yyyy = d.getFullYear();
          const mm = pad(d.getMonth()+1);
          const dd = pad(d.getDate());
          const hh = pad(d.getHours());
          const min = pad(d.getMinutes());
          return `${yyyy}-${mm}-${dd}T${hh}:${min}`;
        }
        sInput.value = toLocalDatetimeValue(r.start_at);
        eInput.value = toLocalDatetimeValue(r.end_at);
        startTd.innerHTML = ''; startTd.appendChild(sInput);
        endTd.innerHTML = ''; endTd.appendChild(eInput);

        // Save handler will read these inputs
      });

      saveBtn.addEventListener('click', async ()=>{
        if(!isAdmin) return;
        try{
          adminStatus.textContent = '保存中...';
          // read perTask JSON
          let parsed = {};
          try { parsed = JSON.parse(perTaskTextarea.value); } catch(e){ alert('業務内訳は有効なJSONである必要があります'); adminStatus.textContent = 'JSONエラー'; return; }

          // read start/end if inputs exist, otherwise keep original
          const sNode = startTd.querySelector('input[type="datetime-local"]');
          const eNode = endTd.querySelector('input[type="datetime-local"]');
          const newStart = sNode ? new Date(sNode.value).getTime() : Number(r.start_at);
          const newEnd = eNode ? new Date(eNode.value).getTime() : Number(r.end_at);

          // update total_sec based on new times (in seconds)
          const newTotal = Math.floor((newEnd - newStart)/1000);

          const updates = {
            start_at: newStart,
            end_at: newEnd,
            total_sec: newTotal,
            per_task: parsed
          };

          const { data, error } = await supabaseClient
            .from('histories')
            .update(updates)
            .eq('id', r.id)
            .select()
            .single();

          if(error){
            console.error('admin save error', error);
            alert('保存に失敗しました（コンソール参照）');
            adminStatus.textContent = '保存失敗';
            return;
          }
          adminStatus.textContent = '保存完了';
          // update UI values
          startTd.textContent = fmtTime(newStart);
          endTd.textContent = fmtTime(newEnd);
          totalTd.textContent = fmtDurationSeconds(newTotal);
        }catch(e){
          console.error(e);
          alert('保存中にエラーが発生しました');
          adminStatus.textContent = '保存エラー';
        }
      });

      actionTd.appendChild(editTimesBtn);
      actionTd.appendChild(saveBtn);

      tr.appendChild(startTd);
      tr.appendChild(endTd);
      tr.appendChild(totalTd);
      tr.appendChild(perTaskTd);
      tr.appendChild(actionTd);
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    container.appendChild(table);
    adminListWrap.appendChild(container);
  });
}

loadDayBtn.addEventListener('click', async ()=>{
  if(!adminDateInput.value){ alert('日付を選択してください'); return; }
  await init();
  if(!currentUser){ alert('管理者としてログインしてください'); return; }
  if(!isAdmin){ if(!confirm('あなたは管理者ではありません。この画面は閲覧専用になります。続けますか？')) return; }
  await loadShiftsForDate(adminDateInput.value);
});

// init on load
(async ()=>{ await init(); })();
