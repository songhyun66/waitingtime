// Supabase 클라이언트 생성, 키 형식 검사, 오류 설명, 실시간 구독과 연결 상태 관리를 한곳에 모은 모듈입니다.
// 학생 화면, 교사 화면, 연결 점검 페이지가 모두 이 파일을 공유합니다.

import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, TABLE } from "./config.js";

export { TABLE, SUPABASE_URL };

// 연결 점검 페이지가 넣는 테스트 행 표시. 학생, 교사 화면은 이 행을 무시합니다.
export const TEST_REASON_ID = "test";
export const isTestRow = (r) => r.reason_id === TEST_REASON_ID;

// ---------------------------------------------------------------------------
// 1. 설정값 검사
// ---------------------------------------------------------------------------

function decodeJwtPayload(token){
  try{
    const part = token.split(".")[1];
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64.padEnd(Math.ceil(b64.length / 4) * 4, "=");
    return JSON.parse(atob(padded));
  }catch{
    return null;
  }
}

function maskKey(key){
  if (!key) return "(비어 있음)";
  return key.length > 26 ? `${key.slice(0, 20)}...${key.slice(-4)}` : key;
}

/**
 * config.js 값을 검사합니다.
 * keyType: "publishable" | "legacy-anon" | "secret" | "legacy-service" | "unknown"
 * issues : [{ level: "error" | "warn", msg }]
 */
export function inspectConfig(url = SUPABASE_URL, key = SUPABASE_PUBLISHABLE_KEY){
  const issues = [];
  let keyType = "unknown";
  let projectRef = null;

  // URL
  if (!url || /YOUR_/.test(url)){
    issues.push({ level: "error", msg: "js/config.js의 SUPABASE_URL이 아직 채워지지 않았어요." });
  } else {
    let u = null;
    try { u = new URL(url); }
    catch { issues.push({ level: "error", msg: `SUPABASE_URL 형식이 올바르지 않아요: ${url}` }); }
    if (u){
      const isLocal = /^(localhost|127\.0\.0\.1)$/.test(u.hostname);
      if (u.protocol !== "https:" && !isLocal){
        issues.push({ level: "error", msg: "SUPABASE_URL은 https://로 시작해야 해요." });
      }
      if (u.pathname && u.pathname !== "/"){
        issues.push({ level: "warn", msg: `SUPABASE_URL 뒤의 경로(${u.pathname})는 빼고 https://xxxx.supabase.co 까지만 넣어주세요.` });
      }
      const m = u.hostname.match(/^([a-z0-9]+)\.supabase\.co$/);
      if (m) projectRef = m[1];
    }
  }

  // Key
  if (!key || /YOUR_/.test(key)){
    issues.push({ level: "error", msg: "js/config.js의 SUPABASE_PUBLISHABLE_KEY가 아직 채워지지 않았어요." });
  } else if (key.startsWith("sb_publishable_")){
    keyType = "publishable";
  } else if (key.startsWith("sb_secret_")){
    keyType = "secret";
    issues.push({ level: "error", msg: "Secret 키(sb_secret_...)가 들어 있어요. 이 키는 RLS를 무시하는 관리자 키라 브라우저 코드에 넣으면 안 돼요. 대시보드에서 이 키를 삭제(폐기)하고 Publishable 키(sb_publishable_...)를 넣어주세요." });
  } else if (key.startsWith("eyJ")){
    const p = decodeJwtPayload(key);
    if (p?.role === "anon"){
      keyType = "legacy-anon";
      issues.push({ level: "warn", msg: "legacy anon 키(eyJ...로 시작하는 긴 키)를 쓰고 있어요. 지금은 동작하지만 Supabase가 2026년 말까지 폐기할 예정이니 Publishable 키(sb_publishable_...)로 바꿔주세요." });
      if (projectRef && p.ref && p.ref !== projectRef){
        issues.push({ level: "error", msg: `이 키는 다른 프로젝트(${p.ref})의 키예요. URL의 프로젝트(${projectRef})와 맞지 않아요.` });
      }
    } else if (p?.role === "service_role"){
      keyType = "legacy-service";
      issues.push({ level: "error", msg: "legacy service_role 키가 들어 있어요. RLS를 무시하는 관리자 키라 브라우저에 넣으면 안 돼요. 이미 GitHub에 올렸다면 노출된 것으로 보고 키를 교체해야 해요." });
    } else {
      issues.push({ level: "error", msg: "키 내용을 해석할 수 없어요. 대시보드의 Publishable key를 그대로 복사해 넣어주세요." });
    }
  } else {
    issues.push({ level: "error", msg: "알 수 없는 키 형식이에요. 대시보드의 Publishable key(sb_publishable_...)를 그대로 복사해 넣어주세요." });
  }

  return {
    ok: !issues.some(i => i.level === "error"),
    keyType,
    keyPreview: maskKey(key),
    projectRef,
    issues,
  };
}

export const config = inspectConfig();

// 설정에 치명적인 문제가 있으면 클라이언트를 만들지 않습니다 (특히 Secret 키가 브라우저에서 쓰이는 것을 막기 위해).
export const supabase = config.ok ? createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY) : null;

// ---------------------------------------------------------------------------
// 2. 오류 설명
// ---------------------------------------------------------------------------

/** 오류 종류: "network" | "auth" | "table" | "column" | "permission" | "other" */
export function classifyError(error, status){
  const msg = String(error?.message ?? error ?? "");
  const code = String(error?.code ?? "");
  if (/Failed to fetch|NetworkError|Load failed|fetch failed/i.test(msg)) return "network";
  // RLS 위반도 anon 요청에는 HTTP 401로 오므로, 상태 코드보다 오류 코드를 먼저 봅니다.
  if (code === "42501" || /row-level security|permission denied/i.test(msg)) return "permission";
  if (code === "PGRST205" || code === "42P01" || /Could not find the table|relation .* does not exist/i.test(msg)) return "table";
  if (code === "42703" || code === "PGRST204" || /column/i.test(msg)) return "column";
  if (/Invalid API key|No API key|apikey/i.test(msg) || (status === 401 && !code)) return "auth";
  return "other";
}

export function describeError(error, status){
  if (!error) return "";
  const msg = String(error.message ?? error);
  switch (classifyError(error, status)){
    case "network":
      return "Supabase 서버에 닿지 못했어요. URL 오타, 인터넷 연결, 프로젝트가 일시정지(Paused) 상태인지 확인해주세요.";
    case "auth":
      return "API 키가 거부됐어요. 이 프로젝트의 Publishable 키가 맞는지, 대시보드에서 키가 삭제되거나 비활성화되지 않았는지 확인해주세요.";
    case "table":
      return `${TABLE} 테이블을 찾지 못했어요. supabase/schema.sql을 SQL Editor에서 실행했는지 확인해주세요.`;
    case "column":
      return `테이블 컬럼이 코드와 맞지 않아요. supabase/schema.sql의 컬럼 구성과 비교해주세요. (${msg})`;
    case "permission":
      return "권한이 없어 거부됐어요. RLS 정책이나 테이블 권한(grant)을 확인해주세요.";
    default:
      return msg || `알 수 없는 오류 (HTTP ${status ?? "?"})`;
  }
}

export function describeRealtimeError(status, err){
  const msg = String(err?.message ?? "");
  if (/Unable to subscribe to changes|Realtime is enabled/i.test(msg)){
    return `${TABLE} 테이블이 Realtime에 등록되어 있지 않아요. supabase/schema.sql의 Realtime 부분을 실행해주세요.`;
  }
  if (/token|jwt|api key|unauthori[sz]ed/i.test(msg)){
    return `실시간 서버가 키를 거부했어요. (${msg})`;
  }
  if (status === "TIMED_OUT"){
    return "실시간 서버 응답이 없어요(시간 초과). 네트워크나 방화벽을 확인해주세요. 학교 와이파이가 웹소켓을 막는 경우도 있어요.";
  }
  if (status === "CLOSED") return "실시간 연결이 닫혔어요.";
  return msg || `실시간 연결 실패 (${status})`;
}

// ---------------------------------------------------------------------------
// 3. 연결 상태 관리
// ---------------------------------------------------------------------------

export const POLL_MS = 15000;

/**
 * 데이터 조회(REST)와 실시간 구독(Realtime) 두 가지 상태를 모아
 * 화면에 보여줄 한 줄 요약({ level, text, detail })으로 만들어 줍니다.
 */
export class ConnectionMonitor {
  #rest = { state: "pending", detail: "" };
  #realtime = { state: "pending", detail: "" };
  #listeners = new Set();
  #last = "";

  setRest(state, detail = ""){ this.#rest = { state, detail }; this.#emit(); }
  setRealtime(state, detail = ""){ this.#realtime = { state, detail }; this.#emit(); }

  onChange(fn){
    this.#listeners.add(fn);
    fn(this.summary());
  }

  #emit(){
    const s = this.summary();
    const key = JSON.stringify(s);
    if (key === this.#last) return;
    this.#last = key;
    this.#listeners.forEach(fn => fn(s));
  }

  summary(){
    if (!config.ok){
      const detail = config.issues.filter(i => i.level === "error").map(i => i.msg).join(" ");
      return { level: "error", text: "설정 오류", detail };
    }
    if (this.#rest.state === "error") return { level: "error", text: "서버 연결 오류", detail: this.#rest.detail };
    if (this.#rest.state === "pending") return { level: "pending", text: "연결 확인 중", detail: "" };
    if (this.#realtime.state === "live") return { level: "ok", text: "실시간 연결됨", detail: "" };
    if (this.#realtime.state === "polling"){
      return { level: "warn", text: `실시간 끊김 (${POLL_MS / 1000}초마다 새로고침)`, detail: this.#realtime.detail };
    }
    return { level: "pending", text: "실시간 연결 중", detail: "" };
  }
}

/**
 * 테이블 변경을 실시간으로 구독합니다.
 * 구독이 실패하거나 끊기면 pollMs 간격으로 refresh를 대신 호출하고,
 * 다시 연결되면 폴링을 멈추고 한 번 새로 불러옵니다.
 */
export function watchTable({ monitor, channelName, refresh, pollMs = POLL_MS }){
  if (!supabase) return null;
  let timer = null;
  const startPolling = () => { if (!timer) timer = setInterval(refresh, pollMs); };
  const stopPolling = () => { if (timer){ clearInterval(timer); timer = null; } };

  return supabase
    .channel(channelName)
    .on("postgres_changes", { event: "*", schema: "public", table: TABLE }, () => refresh())
    .subscribe((status, err) => {
      if (status === "SUBSCRIBED"){
        stopPolling();
        monitor.setRealtime("live");
        refresh(); // 끊겨 있던 동안 놓친 변경 반영
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED"){
        startPolling();
        monitor.setRealtime("polling", describeRealtimeError(status, err));
        if (err) console.error("[보건실 Realtime]", status, err);
      }
    });
}

/** 콘솔에 설정 경고와 오류를 한 번 출력합니다. */
export function logConfigIssues(){
  config.issues.forEach(i => {
    (i.level === "error" ? console.error : console.warn)(`[보건실 설정] ${i.msg}`);
  });
}
