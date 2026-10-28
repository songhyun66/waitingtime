import {
  supabase, config, TABLE, SUPABASE_URL, TEST_REASON_ID,
  classifyError, describeError, describeRealtimeError,
} from "./supabase.js";

// 학생, 교사 화면이 읽고 쓰는 컬럼 전부. 하나라도 없으면 읽기 단계에서 오류가 납니다.
const COLUMNS = "id,created_at,student_id,student_name,reason_id,reason_label,wait_minutes,status,completed_at";

const KEY_TYPE_LABEL = {
  "publishable":    "Publishable 키 (권장)",
  "legacy-anon":    "legacy anon 키 (2026년 말 폐기 예정)",
  "secret":         "Secret 키 (브라우저 사용 금지)",
  "legacy-service": "legacy service_role 키 (브라우저 사용 금지)",
  "unknown":        "알 수 없음",
};

const stepsEl = document.getElementById("steps");
const rerunBtn = document.getElementById("rerunBtn");
const writeBtn = document.getElementById("writeBtn");

function addStep(title){
  const li = document.createElement("li");
  li.className = "step pending";
  li.innerHTML = `<div class="icon"></div><div><strong></strong><p class="detail">확인 중...</p></div>`;
  li.querySelector("strong").textContent = title;
  stepsEl.appendChild(li);
  return {
    set(level, detail){
      li.className = `step ${level}`;
      li.querySelector(".detail").textContent = detail;
    },
  };
}

// ---- 실시간 이벤트 대기 도우미 ----
let channel = null;
let realtimeOk = false;
let events = [];
let waiters = [];

function pushEvent(payload){
  events.push(payload);
  waiters = waiters.filter(w => {
    if (w.pred(payload)){ w.resolve(payload); return false; }
    return true;
  });
}
function waitForEvent(pred, ms){
  return new Promise(resolve => {
    const hit = events.find(pred);
    if (hit) return resolve(hit);
    const w = { pred, resolve };
    waiters.push(w);
    setTimeout(() => { waiters = waiters.filter(x => x !== w); resolve(null); }, ms);
  });
}

// ---- 점검 ----
async function run(){
  rerunBtn.disabled = true;
  writeBtn.disabled = true;
  stepsEl.innerHTML = "";
  realtimeOk = false;
  events = [];
  if (channel && supabase){ await supabase.removeChannel(channel); channel = null; }

  // 1. 설정값
  const s1 = addStep("1. 설정값 (js/config.js)");
  const lines = [
    `URL: ${SUPABASE_URL}`,
    `키: ${config.keyPreview}`,
    `키 종류: ${KEY_TYPE_LABEL[config.keyType]}`,
    ...config.issues.map(i => `${i.level === "error" ? "✕" : "!"} ${i.msg}`),
  ];
  s1.set(!config.ok ? "error" : config.issues.length ? "warn" : "ok", lines.join("\n"));

  const s2 = addStep("2. 서버 연결과 API 키");
  const s3 = addStep(`3. ${TABLE} 테이블 읽기`);
  const s4 = addStep("4. 실시간(Realtime) 구독");

  if (!config.ok){
    [s2, s3, s4].forEach(s => s.set("skip", "설정값부터 고쳐주세요."));
    rerunBtn.disabled = false;
    return;
  }

  // 2, 3. 서버 연결 + 테이블 읽기 (한 번의 요청으로 함께 판단)
  let readOk = false;
  const { count, error, status } = await supabase
    .from(TABLE)
    .select(COLUMNS, { count: "exact" })
    .limit(1);

  if (error){
    const kind = classifyError(error, status);
    const msg = describeError(error, status);
    console.error("[연결 점검]", error);
    if (kind === "network" || kind === "auth"){
      s2.set("error", msg);
      s3.set("skip", "서버 연결부터 해결해야 해요.");
      s4.set("skip", "서버 연결부터 해결해야 해요.");
      rerunBtn.disabled = false;
      return;
    }
    s2.set("ok", `서버가 키를 받아들였어요. (HTTP ${status})`);
    s3.set("error", msg);
  } else {
    readOk = true;
    s2.set("ok", `서버가 키를 받아들였어요. (HTTP ${status})`);
    if (count === 0){
      s3.set("warn", "읽기는 성공했지만 보이는 행이 0건이에요.\n아직 접수가 없거나, RLS에 select 정책이 없어 행이 숨겨진 것일 수 있어요. 아래 쓰기 테스트로 구분할 수 있어요.");
    } else {
      s3.set("ok", `읽기 성공, 보이는 행 ${count}건. 코드가 쓰는 컬럼도 모두 있어요.`);
    }
  }

  // 4. Realtime
  s4.set("pending", "구독 시도 중... (최대 12초)");
  const rt = await new Promise(resolve => {
    let done = false;
    const finish = (r) => { if (!done){ done = true; resolve(r); } };
    channel = supabase
      .channel(`health_queue_check_${Date.now()}`)
      .on("postgres_changes", { event: "*", schema: "public", table: TABLE }, pushEvent)
      .subscribe((st, err) => {
        if (st === "SUBSCRIBED") finish({ ok: true });
        else if (st === "CHANNEL_ERROR" || st === "TIMED_OUT" || st === "CLOSED"){
          if (err) console.error("[연결 점검 Realtime]", st, err);
          finish({ ok: false, msg: describeRealtimeError(st, err) });
        }
      });
    setTimeout(() => finish({ ok: false, msg: describeRealtimeError("TIMED_OUT") }), 12000);
  });
  realtimeOk = rt.ok;
  s4.set(rt.ok ? "ok" : "error",
    rt.ok ? "구독 성공. 변경 알림이 실제로 오는지는 아래 쓰기 테스트에서 확인돼요." : rt.msg);

  writeBtn.disabled = !readOk;
  rerunBtn.disabled = false;
}

// ---- 쓰기 왕복 테스트 ----
async function writeTest(){
  writeBtn.disabled = true;
  rerunBtn.disabled = true;
  const s5 = addStep("5. 쓰기 왕복 테스트 (접수 → 실시간 알림 → 진료 완료)");
  const lines = [];

  const { data: ins, error: insErr, status: insStatus } = await supabase
    .from(TABLE)
    .insert({
      student_id: "0000",
      student_name: "연결 테스트",
      reason_id: TEST_REASON_ID,
      reason_label: "연결 테스트",
      wait_minutes: 0,
      status: "waiting",
    })
    .select("id");

  if (insErr || !ins?.length){
    const reason = insErr ? describeError(insErr, insStatus) : "넣은 행을 다시 읽지 못했어요. RLS select 정책을 확인해주세요.";
    s5.set("error", `✕ 접수(insert) 실패: ${reason}`);
    if (insErr) console.error("[연결 점검 insert]", insErr);
    writeBtn.disabled = false;
    rerunBtn.disabled = false;
    return;
  }
  const id = ins[0].id;
  lines.push("✓ 접수(insert) 성공");

  if (realtimeOk){
    const ev = await waitForEvent(p => p.eventType === "INSERT" && String(p.new?.id) === String(id), 8000);
    lines.push(ev
      ? "✓ 실시간 알림 수신"
      : "✕ 8초 안에 실시간 알림이 오지 않았어요. 테이블이 Realtime에 등록됐는지, select 정책이 있는지 확인해주세요.");
  } else {
    lines.push("- 실시간 구독이 안 돼서 알림 수신 확인은 건너뛰었어요.");
  }

  const { data: upd, error: updErr, status: updStatus } = await supabase
    .from(TABLE)
    .update({ status: "done", completed_at: new Date().toISOString() })
    .eq("id", id)
    .select("id");

  if (updErr){
    lines.push(`✕ 진료 완료(update) 실패: ${describeError(updErr, updStatus)}`);
    console.error("[연결 점검 update]", updErr);
  } else if (!upd?.length){
    lines.push("✕ 진료 완료(update)가 0행에 적용됐어요. RLS에 update 정책이 없으면 오류 없이 이렇게 조용히 실패해요.");
  } else {
    lines.push("✓ 진료 완료(update) 성공");
  }

  const level = lines.some(l => l.startsWith("✕")) ? "error"
              : lines.some(l => l.startsWith("-")) ? "warn" : "ok";
  lines.push(`(테스트 행 id ${id}는 reason_id가 "${TEST_REASON_ID}"라서 학생, 교사 화면에는 표시되지 않아요.)`);
  s5.set(level, lines.join("\n"));

  writeBtn.disabled = false;
  rerunBtn.disabled = false;
}

rerunBtn.addEventListener("click", run);
writeBtn.addEventListener("click", writeTest);
run();
