import {
  supabase, config, TABLE, isTestRow,
  describeError, ConnectionMonitor, watchTable, logConfigIssues,
} from "./supabase.js";
import { escapeHtml, formatTime } from "./util.js";

const URGENT_THRESHOLD_MIN = 15; // 접수 후 이만큼 지나면 강조 표시

let waitingRows = [];
let completedRows = [];

const $ = (id) => document.getElementById(id);
const queueListEl = $("queueList");
const completedListEl = $("completedList");
const completedToggle = $("completedToggle");
const completedCountEl = $("completedCount");
const totalWaitEl = $("totalWait");
const waitCountEl = $("waitCount");
const todayTotalEl = $("todayTotal");
const connEl = $("conn");
const connText = $("connText");
const noticeEl = $("notice");
const clockEl = $("clock");

// ====== 연결 상태 표시 ======
const monitor = new ConnectionMonitor();
monitor.onChange((s) => {
  connEl.className = `conn ${s.level}`;
  connText.textContent = s.text;
  connEl.title = s.detail ? `${s.detail}\n(눌러서 연결 점검 페이지 열기)` : "연결 점검 페이지 열기";
  renderNotice(s);
});
logConfigIssues();

function renderNotice(summary){
  const lines = [];
  let level = null;

  if (summary.level === "error" || summary.level === "warn"){
    level = summary.level;
    lines.push(summary.detail ? `${summary.text}: ${summary.detail}` : summary.text);
  }
  // 설정 경고(legacy 키 사용 등)는 오류가 없어도 계속 보여줍니다.
  const warns = config.issues.filter(i => i.level === "warn").map(i => i.msg);
  if (warns.length){
    level = level ?? "warn";
    lines.push(...warns);
  }

  if (!lines.length){
    noticeEl.className = "notice";
    noticeEl.innerHTML = "";
    return;
  }
  noticeEl.className = `notice show ${level}`;
  noticeEl.innerHTML =
    lines.map(l => `<p>${escapeHtml(l)}</p>`).join("") +
    `<p><a href="check.html">연결 점검 페이지에서 자세히 보기</a></p>`;
}

// ====== 데이터 ======
function todayStartISO(){
  const d = new Date();
  d.setHours(0,0,0,0);
  return d.toISOString();
}

let loadSeq = 0;
async function loadAll(){
  if (!supabase) return;
  const mySeq = ++loadSeq;

  const { data, error, status } = await supabase
    .from(TABLE)
    .select("*")
    .gte("created_at", todayStartISO())
    .order("created_at", { ascending: true });

  if (mySeq !== loadSeq) return; // 더 나중에 시작한 조회가 있으면 이 결과는 버림

  if (error){
    console.error(error);
    monitor.setRest("error", describeError(error, status));
    return;
  }
  monitor.setRest("ok");

  const rows = data.filter(r => !isTestRow(r));
  waitingRows = rows.filter(r => r.status === "waiting");
  completedRows = rows.filter(r => r.status === "done").reverse();

  render();
}

function elapsedMinutes(createdAt){
  return Math.floor((Date.now() - new Date(createdAt).getTime()) / 60000);
}

function render(){
  // Summary
  const totalWait = waitingRows.reduce((s,r) => s + r.wait_minutes, 0);
  totalWaitEl.textContent = totalWait;
  waitCountEl.textContent = waitingRows.length;
  todayTotalEl.textContent = waitingRows.length + completedRows.length;

  // Queue list
  if (waitingRows.length === 0){
    queueListEl.innerHTML = `<div class="empty-state">현재 대기 중인 학생이 없습니다</div>`;
  } else {
    queueListEl.innerHTML = "";
    waitingRows.forEach((r, idx) => {
      const mins = elapsedMinutes(r.created_at);
      const urgent = mins >= URGENT_THRESHOLD_MIN;
      const row = document.createElement("div");
      row.className = "row" + (urgent ? " urgent" : "");
      row.innerHTML = `
        <div class="seq">${idx + 1}</div>
        <div class="who">
          <strong>${escapeHtml(r.student_name)}</strong>
          <span>학번 ${escapeHtml(r.student_id)}</span>
        </div>
        <div class="reason-tag">${escapeHtml(r.reason_label)}</div>
        <div class="mins">${r.wait_minutes}<span>분 소요 예상</span></div>
        <div class="elapsed">접수 <b>${formatTime(r.created_at)}</b> · 대기 ${mins}분째</div>
        <button class="done-btn" data-id="${escapeHtml(r.id)}">진료 완료</button>
      `;
      queueListEl.appendChild(row);
    });

    queueListEl.querySelectorAll(".done-btn").forEach(btn => {
      btn.addEventListener("click", () => markDone(btn.dataset.id, btn));
    });
  }

  // Completed list
  completedCountEl.textContent = completedRows.length;
  completedListEl.innerHTML = completedRows.map(r => `
    <div class="crow">
      <div><strong>${escapeHtml(r.student_name)}</strong> · 학번 ${escapeHtml(r.student_id)}</div>
      <div>${escapeHtml(r.reason_label)} (${r.wait_minutes}분)</div>
      <div>접수 ${formatTime(r.created_at)}</div>
      <div>완료 ${r.completed_at ? formatTime(r.completed_at) : "-"}</div>
    </div>
  `).join("");
}

async function markDone(id, btn){
  btn.disabled = true;
  btn.textContent = "처리 중...";

  // .select()를 붙여야 실제로 바뀐 행이 돌아옵니다.
  // RLS에 update 정책이 없으면 오류 없이 0행만 바뀌므로, 이걸로 조용한 실패를 잡아냅니다.
  const { data, error, status } = await supabase
    .from(TABLE)
    .update({ status: "done", completed_at: new Date().toISOString() })
    .eq("id", id)
    .select("id");

  if (error || !data?.length){
    const reason = error
      ? describeError(error, status)
      : "바뀐 행이 없어요. RLS에 update 정책이 없거나, 이미 다른 화면에서 처리된 접수일 수 있어요.";
    console.error("[보건실] 진료 완료 처리 실패", error ?? "0 rows updated");
    alert(`진료 완료 처리에 실패했어요.\n(${reason})`);
    btn.disabled = false;
    btn.textContent = "진료 완료";
    return;
  }

  // 실시간 연결이 끊겨 있어도 화면이 바로 바뀌도록 직접 다시 불러옵니다.
  loadAll();
}

completedToggle.addEventListener("click", () => {
  completedToggle.classList.toggle("open");
  completedListEl.classList.toggle("open");
});

function tickClock(){
  clockEl.textContent = new Date().toLocaleTimeString("ko-KR");
}
setInterval(tickClock, 1000);
tickClock();

// 대기시간(경과분) 표시를 위해 주기적으로 다시 그리기
setInterval(render, 30000);

if (supabase){
  loadAll();
  watchTable({ monitor, channelName: "health_queue_teacher", refresh: loadAll });
}
