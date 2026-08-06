// 待ち時間ボード - フロントエンドロジック
//
// 「現在の待ち時間一覧」は themeparks.wiki の /live エンドポイントを
// ブラウザから直接呼び出して、常に最新の状態を表示する。
// 「推移グラフ」は GitHub Actions が data/YYYY-MM-DD.json に蓄積した
// 記録データを読み込んで表示する。

const DESTINATION_ID = "faff60df-c766-4470-8adb-dee78e813f42"; // Tokyo Disney Resort
const LIVE_API_URL = `https://api.themeparks.wiki/v1/entity/${DESTINATION_ID}/live`;

const PARK_NAMES = {
  "3cc919f1-d16d-43e0-8c3f-1dd269bd1a42": "TDL",
  "67b290d5-3478-4f23-b601-2f8fb71ba803": "TDS",
};

const STATUS_LABEL = {
  OPERATING: null,
  CLOSED: "営業時間外",
  DOWN: "運休",
  REFURBISHMENT: "改装中",
};

const state = {
  park: "TDL",
  view: "list",
  sortMode: "default", // 'default' | 'wait'
  liveAttractions: [], // 直近取得した現在の待ち時間一覧
  attractionsMeta: {}, // id -> { name, park } (一覧・グラフ選択の両方で使う)
  selectedAttractionId: null,
  showSingleRider: false,
  showPriorityPass: false,
  chart: null,
};

// ---- ユーティリティ ----

function jstTodayString() {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(new Date());
  // "sv-SE" ロケールは YYYY-MM-DD 形式を返すための簡易テクニック
}

function formatJstTime(isoString) {
  return new Date(isoString).toLocaleTimeString("ja-JP", {
    timeZone: "Asia/Tokyo",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatJstDateTime(isoString) {
  return new Date(isoString).toLocaleString("ja-JP", {
    timeZone: "Asia/Tokyo",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ---- 現在の待ち時間一覧 ----

async function fetchLiveList() {
  const listStatus = document.getElementById("list-updated");
  listStatus.textContent = "読み込み中…";
  try {
    const res = await fetch(LIVE_API_URL, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    const attractions = [];
    for (const entry of data.liveData ?? []) {
      if (entry.entityType !== "ATTRACTION") continue;
      const park = PARK_NAMES[entry.parkId];
      if (!park) continue;
      attractions.push({
        id: entry.id,
        name: entry.name,
        park,
        status: entry.status,
        standbyWaitTime: entry.queue?.STANDBY?.waitTime ?? null,
        lastUpdated: entry.lastUpdated,
      });
      state.attractionsMeta[entry.id] = { name: entry.name, park };
    }

    state.liveAttractions = attractions;
    listStatus.textContent = `最終更新: ${formatJstDateTime(new Date().toISOString())}`;
    renderList();
    populateAttractionSelect();
  } catch (err) {
    listStatus.textContent = "取得に失敗しました。時間をおいて更新してください。";
    console.error(err);
  }
}

function renderList() {
  const ul = document.getElementById("attraction-list");
  ul.innerHTML = "";

  let items = state.liveAttractions.filter((a) => a.park === state.park);
  if (state.sortMode === "wait") {
    items = [...items].sort((a, b) => {
      const aw = a.status === "OPERATING" ? a.standbyWaitTime ?? -1 : -2;
      const bw = b.status === "OPERATING" ? b.standbyWaitTime ?? -1 : -2;
      return bw - aw;
    });
  }

  for (const a of items) {
    const li = document.createElement("li");
    li.className = "attraction-card";

    const left = document.createElement("div");
    left.innerHTML = `<div class="attraction-card__name">${escapeHtml(a.name)}</div>
      <div class="attraction-card__park">${a.park}</div>`;

    const wait = document.createElement("div");
    if (a.status === "OPERATING") {
      if (a.standbyWaitTime === null || a.standbyWaitTime === undefined) {
        wait.className = "attraction-card__wait is-closed";
        wait.textContent = "案内なし";
      } else {
        wait.className = "attraction-card__wait";
        wait.innerHTML = `${a.standbyWaitTime}<span class="unit">分</span>`;
      }
    } else if (a.status === "DOWN") {
      wait.className = "attraction-card__wait is-down";
      wait.textContent = STATUS_LABEL.DOWN;
    } else if (a.status === "REFURBISHMENT") {
      wait.className = "attraction-card__wait is-refurb";
      wait.textContent = STATUS_LABEL.REFURBISHMENT;
    } else {
      wait.className = "attraction-card__wait is-closed";
      wait.textContent = STATUS_LABEL[a.status] ?? a.status ?? "-";
    }

    li.append(left, wait);
    ul.appendChild(li);
  }

  if (items.length === 0) {
    const li = document.createElement("li");
    li.className = "status-text";
    li.textContent = "データがありません";
    ul.appendChild(li);
  }
}

// ---- 推移グラフ ----

function populateAttractionSelect() {
  const select = document.getElementById("attraction-select");
  const prev = state.selectedAttractionId;
  select.innerHTML = "";

  const ids = Object.entries(state.attractionsMeta)
    .filter(([, meta]) => meta.park === state.park)
    .sort((a, b) => a[1].name.localeCompare(b[1].name, "ja"));

  for (const [id, meta] of ids) {
    const opt = document.createElement("option");
    opt.value = id;
    opt.textContent = meta.name;
    select.appendChild(opt);
  }

  if (ids.some(([id]) => id === prev)) {
    select.value = prev;
  } else if (ids.length > 0) {
    select.value = ids[0][0];
  }
  state.selectedAttractionId = select.value || null;
}

async function loadGraphForSelectedDate() {
  const statusEl = document.getElementById("graph-status");
  const dateStr = document.getElementById("date-picker").value;
  if (!state.selectedAttractionId || !dateStr) return;

  statusEl.textContent = "読み込み中…";
  try {
    const res = await fetch(`data/${dateStr}.json`, { cache: "no-store" });
    if (!res.ok) {
      statusEl.textContent = "データがありません";
      renderChart([]);
      return;
    }
    const dayData = await res.json();
    statusEl.textContent = "";
    renderChart(dayData.records ?? []);
  } catch (err) {
    statusEl.textContent = "データがありません";
    renderChart([]);
    console.error(err);
  }
}

function renderChart(records) {
  const attractionId = state.selectedAttractionId;
  const labels = [];
  const standby = [];
  const downPoints = [];
  const singleRider = [];
  const priorityPass = [];

  for (const rec of records) {
    const a = (rec.attractions ?? []).find((x) => x.id === attractionId);
    labels.push(formatJstTime(rec.timestamp));

    if (!a) {
      standby.push(null);
      downPoints.push(null);
      singleRider.push(null);
      priorityPass.push(null);
      continue;
    }

    standby.push(a.status === "OPERATING" ? a.standbyWaitTime ?? null : null);
    downPoints.push(a.status === "DOWN" ? 0 : null);
    singleRider.push(a.status === "OPERATING" ? a.singleRiderWaitTime ?? null : null);

    if (a.priorityPass) {
      priorityPass.push(a.priorityPass.state === "AVAILABLE" ? 1 : 0);
    } else {
      priorityPass.push(null);
    }
  }

  const datasets = [
    {
      label: "通常待ち時間(分)",
      data: standby,
      borderColor: "#f2a93b",
      backgroundColor: "#f2a93b",
      spanGaps: false,
      tension: 0.25,
      pointRadius: 2,
      yAxisID: "y",
    },
    {
      label: "運休(DOWN)",
      data: downPoints,
      showLine: false,
      pointStyle: "triangle",
      pointRadius: 5,
      borderColor: "#e2574c",
      backgroundColor: "#e2574c",
      yAxisID: "y",
    },
  ];

  if (state.showSingleRider) {
    datasets.push({
      label: "シングルライダー(分)",
      data: singleRider,
      borderColor: "#6fbf8b",
      backgroundColor: "#6fbf8b",
      spanGaps: false,
      tension: 0.25,
      pointRadius: 2,
      yAxisID: "y",
    });
  }

  if (state.showPriorityPass) {
    datasets.push({
      label: "プライオリティパス(利用可=1)",
      data: priorityPass,
      showLine: false,
      pointStyle: "rectRot",
      pointRadius: 4,
      borderColor: "#8fa0b8",
      backgroundColor: "#8fa0b8",
      yAxisID: "y1",
    });
  }

  const ctx = document.getElementById("wait-chart");
  if (state.chart) {
    state.chart.destroy();
  }
  state.chart = new Chart(ctx, {
    type: "line",
    data: { labels, datasets },
    options: {
      responsive: true,
      interaction: { mode: "index", intersect: false },
      scales: {
        y: {
          beginAtZero: true,
          title: { display: true, text: "分" },
          grid: { color: "rgba(255,255,255,0.06)" },
          ticks: { color: "#8fa0b8" },
        },
        y1: {
          display: false,
          min: 0,
          max: 1,
        },
        x: {
          grid: { display: false },
          ticks: { color: "#8fa0b8", maxTicksLimit: 12 },
        },
      },
      plugins: {
        legend: { labels: { color: "#f5f1e8" } },
      },
    },
  });
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

// ---- タブ・操作系イベント ----

function switchPark(park) {
  state.park = park;
  document.querySelectorAll(".park-tab").forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.park === park);
  });
  renderList();
  populateAttractionSelect();
  if (state.view === "graph") loadGraphForSelectedDate();
}

function switchView(view) {
  state.view = view;
  document.querySelectorAll(".view-tab").forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.view === view);
  });
  document.getElementById("view-list").classList.toggle("is-active", view === "list");
  document.getElementById("view-graph").classList.toggle("is-active", view === "graph");
  if (view === "graph") loadGraphForSelectedDate();
}

function init() {
  document.getElementById("date-picker").value = jstTodayString();

  document.querySelectorAll(".park-tab").forEach((btn) => {
    btn.addEventListener("click", () => switchPark(btn.dataset.park));
  });
  document.querySelectorAll(".view-tab").forEach((btn) => {
    btn.addEventListener("click", () => switchView(btn.dataset.view));
  });

  document.getElementById("list-refresh").addEventListener("click", fetchLiveList);

  const sortBtn = document.getElementById("sort-toggle");
  sortBtn.addEventListener("click", () => {
    state.sortMode = state.sortMode === "default" ? "wait" : "default";
    document.getElementById("sort-toggle-label").textContent =
      state.sortMode === "wait" ? "待ち時間順" : "エントリー順";
    renderList();
  });

  document.getElementById("attraction-select").addEventListener("change", (e) => {
    state.selectedAttractionId = e.target.value;
    loadGraphForSelectedDate();
  });
  document.getElementById("date-picker").addEventListener("change", loadGraphForSelectedDate);
  document.getElementById("show-single-rider").addEventListener("change", (e) => {
    state.showSingleRider = e.target.checked;
    loadGraphForSelectedDate();
  });
  document.getElementById("show-priority-pass").addEventListener("change", (e) => {
    state.showPriorityPass = e.target.checked;
    loadGraphForSelectedDate();
  });

  fetchLiveList();
}

document.addEventListener("DOMContentLoaded", init);
