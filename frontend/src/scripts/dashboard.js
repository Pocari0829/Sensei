// ─────────────────────────────────────────────
// 프로필 화면 아래의 대시보드 3개를 그린다. (profile.js 가 store.getProfileStats() 결과를 넘겨준다)
//   학습 잔디      GitHub 잔디처럼 최근 13주(약 3개월) 달력에, 하쿠에게 설명한 날을 칠한다. + 연속 학습 일수
//   퀴즈 정답률    채점한 시험지 문제 중 맞힌 비율 (원형 게이지)
//   다시 볼 개념   틀리거나 "더 쉽게" 를 누른 횟수가 많은 주제 Top 3. 누르면 그 주제의 시험지로 간다.
//
// 그래프는 ApexCharts(외부 라이브러리)로 그린다. 프로필 화면을 열 때만 CDN 에서 불러온다.
//   3.54.1 을 쓰는 이유: 설정 방법이 확실히 알려진 안정 버전. (CDN 에는 8.x 까지 있다)
// 인터넷이 끊겨 라이브러리를 못 불러와도 숫자와 목록은 그대로 보이고, 그래프 자리에만 안내 문구가 뜬다.
// ─────────────────────────────────────────────

import { dayKey } from "./store.js";

const APEXCHARTS_URL = "https://cdn.jsdelivr.net/npm/apexcharts@3.54.1/+esm";

// 잔디에 보여줄 주 수. 13주면 칸이 거의 정사각형으로 한 줄에 들어간다.
const WEEKS = 13;
const DAY_NAMES = ["일", "월", "화", "수", "목", "금", "토"];
const DAY_MS = 24 * 60 * 60 * 1000;

const activityChartEl = document.getElementById("activity-chart");
const activitySummaryEl = document.getElementById("activity-summary");
const streakEl = document.getElementById("streak");
const accuracyBodyEl = document.getElementById("accuracy-body");
const accuracyChartEl = document.getElementById("accuracy-chart");
const accuracyCorrectEl = document.getElementById("accuracy-correct");
const accuracyGradedEl = document.getElementById("accuracy-graded");
const accuracyMessageEl = document.getElementById("accuracy-message");
const accuracyEmptyEl = document.getElementById("accuracy-empty");
const gapListEl = document.getElementById("gap-list");
const gapEmptyEl = document.getElementById("gap-empty");

/** style.css 의 색 변수(:root). 그래프 색을 화면 디자인과 같은 값으로 맞춘다. */
function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

let apexPromise = null;
/** ApexCharts 를 한 번만 불러온다. 실패하면 null. */
function loadApexCharts() {
  apexPromise ??= import(APEXCHARTS_URL)
    .then((module) => module.default)
    .catch((err) => {
      console.warn("그래프 라이브러리를 불러오지 못했어요:", err);
      return null;
    });
  return apexPromise;
}

function showChartError(el) {
  el.innerHTML = `<p class="dash-fallback">그래프를 불러오지 못했어요. 인터넷 연결을 확인해 주세요.</p>`;
}

// ─────────────────────────────────────────────
// 학습 잔디
// ─────────────────────────────────────────────

/**
 * 오늘부터 거꾸로 이어서 설명한 날 수. 오늘 아직 안 했으면 어제부터 센다. (오늘 하면 이어지므로)
 */
function countStreak(activity) {
  const day = new Date();
  if (!activity[dayKey(day)]) day.setDate(day.getDate() - 1);
  let streak = 0;
  while (activity[dayKey(day)]) {
    streak += 1;
    day.setDate(day.getDate() - 1);
  }
  return streak;
}

/**
 * 잔디 칸 만들기. 열 = 주(왼쪽이 옛날), 행 = 요일(일~토). 이번 주의 남은 날(미래)은 -1.
 * 돌려주는 것: {weeks: [{label}], rows: [[{x, y, date}] × 13주] × 7요일}
 */
function buildCalendar(activity) {
  const today = new Date();
  today.setHours(12, 0, 0, 0); // 서머타임 등으로 하루가 23/25시간이어도 날짜가 밀리지 않게 정오 기준
  const thisSunday = new Date(today.getTime() - today.getDay() * DAY_MS);
  const firstDay = new Date(thisSunday.getTime() - (WEEKS - 1) * 7 * DAY_MS);
  const todayKey = dayKey(today);

  const weeks = [];
  const rows = DAY_NAMES.map(() => []);
  for (let w = 0; w < WEEKS; w++) {
    const weekStart = new Date(firstDay.getTime() + w * 7 * DAY_MS);
    // GitHub 처럼 그 주의 첫날(일요일)이 새 달에 들어가는 주에 "10월" 처럼 달을 적는다.
    const month = weekStart.getMonth();
    const label = w === 0 || month !== weeks[w - 1].month ? `${month + 1}월` : "";
    for (let d = 0; d < 7; d++) {
      const date = new Date(weekStart.getTime() + d * DAY_MS);
      const key = dayKey(date);
      const future = key > todayKey;
      rows[d].push({ x: `w${w}`, y: future ? -1 : (activity[key] ?? 0), date: key });
    }
    weeks.push({ month, label });
  }
  // 맨 왼쪽 주만 이전 달이고 바로 다음 주부터 새 달이면, 두 이름이 붙어서 겹치므로 왼쪽 것은 지운다.
  if (weeks[1].label) weeks[0].label = "";
  return { weeks, rows };
}

/** "2026-10-24" → "10월 24일 (토)" */
function formatDay(key) {
  const [y, m, d] = key.split("-").map(Number);
  const day = new Date(y, m - 1, d).getDay();
  return `${m}월 ${d}일 (${DAY_NAMES[day]})`;
}

async function renderActivity(activity) {
  const streak = countStreak(activity);
  streakEl.hidden = streak === 0;
  streakEl.textContent = `${streak}일 연속`;

  const { weeks, rows } = buildCalendar(activity);
  const activeDays = rows.flat().filter((cell) => cell.y > 0).length;
  activitySummaryEl.textContent =
    activeDays > 0 ? `최근 3개월 동안 ${activeDays}일 공부했어요` : "하쿠에게 설명한 날마다 칸이 채워져요";

  const ApexCharts = await loadApexCharts();
  if (!ApexCharts) {
    showChartError(activityChartEl);
    return;
  }

  const muted = cssVar("--muted-fg");
  const primary = cssVar("--primary");
  // ApexCharts 히트맵은 첫 번째 줄을 맨 아래에 그리므로, 일요일이 맨 위에 오게 거꾸로 넣는다.
  const series = DAY_NAMES.map((name, d) => ({ name, data: rows[d] })).reverse();

  const chart = new ApexCharts(activityChartEl, {
    chart: {
      type: "heatmap",
      height: 196,
      fontFamily: getComputedStyle(document.body).fontFamily,
      toolbar: { show: false },
      parentHeightOffset: 0,
      animations: { enabled: true, speed: 500 },
    },
    series,
    dataLabels: { enabled: false },
    legend: { show: false },
    // 칸 사이 틈: 카드 배경색(흰색) 선으로 칸을 띄운다.
    stroke: { width: 3, colors: [cssVar("--card")] },
    plotOptions: {
      heatmap: {
        radius: 4,
        enableShades: false,
        colorScale: {
          // 하루에 보낸 설명 수로 진하기를 정한다. 아래 범례(.dash-legend)의 색과 같다.
          ranges: [
            { from: -1, to: -1, color: cssVar("--card") }, // 아직 오지 않은 날: 안 보이게
            { from: 0, to: 0, color: "#e8eef8" },
            { from: 1, to: 2, color: "#b3d4f7" },
            { from: 3, to: 5, color: "#5aa4ee" },
            { from: 6, to: 100000, color: primary },
          ],
        },
      },
    },
    states: {
      hover: { filter: { type: "darken", value: 0.88 } },
      active: { filter: { type: "none" } },
    },
    xaxis: {
      labels: {
        formatter: (value) => weeks[Number(String(value).slice(1))]?.label ?? "",
        style: { colors: muted, fontSize: "10px" },
        rotate: 0,
        hideOverlappingLabels: false,
      },
      axisBorder: { show: false },
      axisTicks: { show: false },
      tooltip: { enabled: false },
    },
    yaxis: {
      // GitHub 처럼 월 · 수 · 금만 적는다. 글자 자리(minWidth)를 잡아 둬야 왼쪽이 잘리지 않고,
      // 왼쪽으로 조금 옮겨야(offsetX) 첫 칸이 글자 끝을 덮지 않는다.
      labels: {
        formatter: (name) => (["월", "수", "금"].includes(name) ? name : ""),
        style: { colors: [muted], fontSize: "10px" },
        minWidth: 16,
        offsetX: -6,
      },
    },
    // 칸 뒤의 가로 줄(격자)은 숨긴다. padding 은 위아래 빈 공간을 줄이는 값.
    grid: { show: false, padding: { top: -18, right: 2, bottom: -6, left: 0 } },
    tooltip: {
      custom: ({ seriesIndex, dataPointIndex, w }) => {
        const cell = w.config.series[seriesIndex].data[dataPointIndex];
        if (cell.y < 0) return "";
        const text = cell.y > 0 ? `설명 ${cell.y}번` : "공부 안 한 날";
        return `<div class="dash-tip"><span>${formatDay(cell.date)}</span><strong>${text}</strong></div>`;
      },
    },
  });
  chart.render();
}

// ─────────────────────────────────────────────
// 퀴즈 정답률
// ─────────────────────────────────────────────

function accuracyMessage(percent) {
  if (percent >= 80) return "아주 잘하고 있어요!";
  if (percent >= 50) return "조금만 더 하면 완벽해요.";
  return "아래 다시 볼 개념부터 복습해 봐요.";
}

async function renderAccuracy({ graded, correct }) {
  if (graded === 0) {
    accuracyBodyEl.hidden = true;
    accuracyEmptyEl.hidden = false;
    return;
  }
  const percent = Math.round((correct / graded) * 100);
  accuracyCorrectEl.textContent = correct;
  accuracyGradedEl.textContent = graded;
  accuracyMessageEl.textContent = accuracyMessage(percent);

  const ApexCharts = await loadApexCharts();
  if (!ApexCharts) {
    // 그래프 없이 숫자만 크게 보여준다.
    accuracyChartEl.innerHTML = `<p class="dash-fallback-number">${percent}%</p>`;
    return;
  }

  const chart = new ApexCharts(accuracyChartEl, {
    chart: {
      type: "radialBar",
      // 원 지름은 높이로 정해진다 (150 → 약 105px). 원 위아래에 남는 빈 공간은 style.css 의 음수 margin 으로 잘라낸다.
      height: 150,
      fontFamily: getComputedStyle(document.body).fontFamily,
      sparkline: { enabled: true },
      animations: { enabled: true, speed: 700 },
    },
    series: [percent],
    labels: ["정답률"],
    colors: [cssVar("--primary")],
    plotOptions: {
      radialBar: {
        hollow: { size: "62%" },
        track: { background: cssVar("--surface-tint"), strokeWidth: "100%" },
        dataLabels: {
          name: { offsetY: 20, fontSize: "11px", fontWeight: 500, color: cssVar("--muted-fg") },
          value: {
            offsetY: -10,
            fontSize: "24px",
            fontWeight: 700,
            color: cssVar("--foreground"),
            formatter: (value) => `${Math.round(value)}%`,
          },
        },
      },
    },
    fill: {
      type: "gradient",
      gradient: { shade: "light", type: "horizontal", gradientToColors: ["#5aa4ee"], stops: [0, 100] },
    },
    stroke: { lineCap: "round" },
  });
  chart.render();
}

// ─────────────────────────────────────────────
// 다시 볼 개념
// ─────────────────────────────────────────────

function renderGaps(gaps) {
  gapEmptyEl.hidden = gaps.length > 0;
  gapListEl.innerHTML = gaps
    .map((gap, i) => {
      const meta = [gap.wrong > 0 ? `틀림 ${gap.wrong}번` : "", gap.easy > 0 ? `더 쉽게 ${gap.easy}번` : ""]
        .filter(Boolean)
        .join(" · ");
      const body = `
        <span class="gap-item__rank">${i + 1}</span>
        <span class="gap-item__body">
          <span class="gap-item__topic">${escapeHtml(gap.concept)}</span>
          <span class="gap-item__meta">${meta}</span>
        </span>`;
      // 그 주제로 대화한 세션이 남아 있으면 시험지로 바로 간다. (삭제했으면 링크 없이 보여주기만)
      if (!gap.sessionId) return `<li class="gap-item"><div class="gap-item__row">${body}</div></li>`;
      const href = `./quiz.html?${new URLSearchParams({ session: gap.sessionId, topic: gap.concept })}`;
      return `
        <li class="gap-item">
          <a class="gap-item__row" href="${escapeHtml(href)}" aria-label="${escapeHtml(gap.concept)} 시험지 풀기">
            ${body}
            <svg class="gap-item__go" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
              <path d="m9 18 6-6-6-6" />
            </svg>
          </a>
        </li>`;
    })
    .join("");
}

/** 대시보드 3개를 그린다. stats 가 null 이면(기록을 못 불러옴) 안내만 띄운다. */
export function renderDashboard(stats) {
  if (!stats) {
    activitySummaryEl.textContent = "기록을 불러오지 못했어요. 잠시 후 새로고침해 주세요.";
    accuracyBodyEl.hidden = true;
    gapEmptyEl.hidden = true;
    return;
  }
  renderGaps(stats.gaps);
  renderActivity(stats.activity);
  renderAccuracy(stats.quiz);
}
