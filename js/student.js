import {
  supabase, config, TABLE, isTestRow,
  describeError, ConnectionMonitor, watchTable, logConfigIssues,
} from "./supabase.js";
import { escapeHtml } from "./util.js";

// ====== 이용 사유 목록 ======
const REASONS = [
  { id:"medicine", label:"약 복용",   desc:"상비약 복용",         minutes:2, color:"#1F6F63" },
  { id:"temp",     label:"체온 측정", desc:"발열 여부 확인",       minutes:2, color:"#1F6F63" },
  { id:"injury",   label:"외상 처치", desc:"찰과상 · 타박상 등",   minutes:3, color:"#3E8E7E" },
  { id:"pain",     label:"복통 · 두통", desc:"통증 호소",           minutes:3, color:"#3E8E7E" },
  { id:"rest",     label:"휴식",       desc:"컨디션 난조로 안정",   minutes:5, color:"#E3A23A" },
  { id:"consult",  label:"상담",       desc:"마음 건강 상담",       minutes:7, color:"#E0604B" },
  { id:"etc",      label:"기타",       desc:"그 외 사유",           minutes:5, color:"#8CA39D" },
];

// ====== 상태 ======
const state = {
  studentId: "",
  name: "",
  reason: null,
};

// ====== DOM ======
const $ = (id) => document.getElementById(id);
const waitNumberEl = $("waitNumber");
const waitCountEl  = $("waitCount");
const overlay = $("overlay");
const openBtn = $("openBtn");
const connStatusEl = $("connStatus");
const connTextEl = $("connText");

const stepStudentId = $("stepStudentId");
const stepName = $("stepName");
const stepReason = $("stepReason");
const stepDone = $("stepDone");

const idDisplay = $("idDisplay");
const idError = $("idError");
const keypad = $("keypad");
const idCancelBtn = $("idCancelBtn");
const idNextBtn = $("idNextBtn");

const nameInput = $("nameInput");
const nameBackBtn = $("nameBackBtn");
const nameNextBtn = $("nameNextBtn");

const reasonsGrid = $("reasonsGrid");
const reasonBackBtn = $("reasonBackBtn");
const reasonSubmitBtn = $("reasonSubmitBtn");

const doneSummary = $("doneSummary");
const doneCloseBtn = $("doneCloseBtn");

const ID_MAX_LEN = 6;
const ID_MIN_LEN = 4;

// ====== 연결 상태 표시 ======
const monitor = new ConnectionMonitor();
monitor.onChange((s) => {
  connStatusEl.className = `conn-status ${s.level}`;
  connTextEl.textContent = s.text;
  connStatusEl.title = s.detail || "";
  if (s.detail) console.warn(`[보건실] ${s.text}: ${s.detail}`);
});
logConfigIssues();

if (!config.ok){
  openBtn.disabled = true;
  openBtn.textContent = "서버 설정이 필요해요";
}

// ====== 대기시간 조회 ======
async function refreshWaitTime(){
  if (!supabase) return;
  const { data, error, status } = await supabase
    .from(TABLE)
    .select("wait_minutes, reason_id")
    .eq("status", "waiting");

  if (error){
    console.error(error);
    monitor.setRest("error", describeError(error, status));
    return;
  }
  monitor.setRest("ok");

  const rows = data.filter(r => !isTestRow(r));
  const total = rows.reduce((sum, row) => sum + row.wait_minutes, 0);
  waitNumberEl.textContent = total;
  waitCountEl.textContent = rows.length;
}

// ====== 모달 열기/닫기 ======
function openModal(){
  resetFlow();
  overlay.classList.remove("hidden");
  goToStep("id");
}
function closeModal(){
  overlay.classList.add("hidden");
}
function resetFlow(){
  state.studentId = "";
  state.name = "";
  state.reason = null;
  renderIdDisplay();
  nameInput.value = "";
  nameNextBtn.disabled = true;
  idError.style.display = "none";
  [...reasonsGrid.children].forEach(b => b.classList.remove("selected"));
  reasonSubmitBtn.disabled = true;
}
function goToStep(step){
  stepStudentId.classList.toggle("hidden", step !== "id");
  stepName.classList.toggle("hidden", step !== "name");
  stepReason.classList.toggle("hidden", step !== "reason");
  stepDone.classList.toggle("hidden", step !== "done");
  if (step === "name") setTimeout(() => nameInput.focus(), 50);
}

openBtn.addEventListener("click", openModal);
idCancelBtn.addEventListener("click", closeModal);

// ====== Step 1: 학번 키패드 ======
function renderIdDisplay(){
  idDisplay.innerHTML = "";
  const len = Math.max(state.studentId.length, ID_MIN_LEN);
  for (let i = 0; i < len; i++){
    const d = document.createElement("div");
    const ch = state.studentId[i];
    d.className = "digit" + (ch === undefined ? " empty" : "");
    d.textContent = ch === undefined ? "" : ch;
    idDisplay.appendChild(d);
  }
}

function buildKeypad(){
  const keys = ["1","2","3","4","5","6","7","8","9","clear","0","back"];
  keypad.innerHTML = "";
  keys.forEach(k => {
    const btn = document.createElement("button");
    if (k === "clear"){ btn.textContent = "전체삭제"; btn.classList.add("func"); }
    else if (k === "back"){ btn.textContent = "지우기"; btn.classList.add("func"); }
    else { btn.textContent = k; }
    btn.addEventListener("click", () => handleKey(k));
    keypad.appendChild(btn);
  });
}
function handleKey(k){
  idError.style.display = "none";
  if (k === "clear"){ state.studentId = ""; }
  else if (k === "back"){ state.studentId = state.studentId.slice(0, -1); }
  else if (state.studentId.length < ID_MAX_LEN){ state.studentId += k; }
  renderIdDisplay();
}
buildKeypad();

idNextBtn.addEventListener("click", () => {
  if (state.studentId.length < ID_MIN_LEN){
    idError.style.display = "block";
    return;
  }
  goToStep("name");
});

// ====== Step 2: 이름 ======
nameInput.addEventListener("input", () => {
  state.name = nameInput.value.trim();
  nameNextBtn.disabled = state.name.length === 0;
});
nameBackBtn.addEventListener("click", () => goToStep("id"));
nameNextBtn.addEventListener("click", () => {
  if (!state.name) return;
  buildReasonsGrid();
  goToStep("reason");
});

// ====== Step 3: 사유 ======
function buildReasonsGrid(){
  reasonsGrid.innerHTML = "";
  REASONS.forEach(r => {
    const btn = document.createElement("button");
    btn.className = "reason-btn";
    btn.style.setProperty("--tag-color", r.color);
    btn.innerHTML = `
      <div class="txt"><strong>${r.label}</strong><span>${r.desc}</span></div>
      <div class="mins">${r.minutes}분</div>
    `;
    btn.addEventListener("click", () => {
      state.reason = r;
      [...reasonsGrid.children].forEach(b => b.classList.remove("selected"));
      btn.classList.add("selected");
      reasonSubmitBtn.disabled = false;
    });
    reasonsGrid.appendChild(btn);
  });
}
reasonBackBtn.addEventListener("click", () => goToStep("name"));

reasonSubmitBtn.addEventListener("click", async () => {
  if (!state.reason || !supabase) return;
  reasonSubmitBtn.disabled = true;
  reasonSubmitBtn.textContent = "접수 중...";

  const { error, status } = await supabase.from(TABLE).insert({
    student_id: state.studentId,
    student_name: state.name,
    reason_id: state.reason.id,
    reason_label: state.reason.label,
    wait_minutes: state.reason.minutes,
    status: "waiting",
  });

  reasonSubmitBtn.textContent = "접수 완료";

  if (error){
    console.error(error);
    alert(`접수하지 못했어요. 다시 시도해주세요.\n(${describeError(error, status)})`);
    reasonSubmitBtn.disabled = false;
    return;
  }

  doneSummary.innerHTML = `
    <b>${escapeHtml(state.name)}</b> 학생 (학번 ${escapeHtml(state.studentId)})<br/>
    사유: <b>${escapeHtml(state.reason.label)}</b> · 예상 소요시간 <b>${state.reason.minutes}분</b><br/>
    대기 순서대로 이름을 불러드릴게요.
  `;
  goToStep("done");
  refreshWaitTime();
});

// ====== Step 4: 완료 ======
doneCloseBtn.addEventListener("click", closeModal);

// ====== 초기화 ======
if (supabase){
  refreshWaitTime();
  watchTable({ monitor, channelName: "health_queue_student", refresh: refreshWaitTime });
}
