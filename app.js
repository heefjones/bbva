const DEFAULT_TEAMS = 12;
const MIN_TEAMS = 2;
const MAX_TEAMS = 20;
const POSITION_ORDER = ["QB", "RB", "WR", "TE"];
const DRAFT_CAPS = {
  QB: 36,
  RB: 72,
  WR: 96,
  TE: 36
};
const ROSTER_MAX = {
  QB: 4,
  RB: 6,
  WR: 7,
  TE: 4,
  FLEX: 4,
  SFLEX: 4
};
const PRESETS = {
  underdog: {
    scoring: "half-ppr",
    teams: 12,
    roster: { QB: 1, RB: 2, WR: 3, TE: 1, FLEX: 1, SFLEX: 0 }
  },
  "underdog-sflex": {
    scoring: "half-ppr",
    teams: 12,
    roster: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, SFLEX: 1 }
  },
  draftkings: {
    scoring: "ppr",
    teams: 12,
    roster: { QB: 1, RB: 2, WR: 3, TE: 1, FLEX: 1, SFLEX: 0 }
  }
};

const state = {
  scoring: "half-ppr",
  sourceData: null,
  board: null,
  filtersCollapsed: false,
  teams: DEFAULT_TEAMS,
  roster: {
    QB: 1,
    RB: 2,
    WR: 3,
    TE: 1,
    FLEX: 1,
    SFLEX: 0
  },
  years: {
    min: 2021,
    max: 2025
  }
};

const els = {
  infoButton: document.getElementById("infoButton"),
  infoModal: document.getElementById("infoModal"),
  infoModalClose: document.getElementById("infoModalClose"),
  filtersCard: document.getElementById("filtersCard"),
  filtersCollapseButton: document.getElementById("filtersCollapseButton"),
  filtersGrid: document.getElementById("filtersGrid"),
  presetButtons: Array.from(document.querySelectorAll(".preset-button[data-preset]")),
  scoringSelect: document.getElementById("scoringSelect"),
  draftBoard: document.getElementById("draftBoard"),
  rosterControls: document.getElementById("rosterControls"),
  slotQB: document.getElementById("slotQB"),
  slotRB: document.getElementById("slotRB"),
  slotWR: document.getElementById("slotWR"),
  slotTE: document.getElementById("slotTE"),
  slotFLEX: document.getElementById("slotFLEX"),
  slotSFLEX: document.getElementById("slotSFLEX"),
  numTeamsValue: document.getElementById("numTeamsValue"),
  minYearSelect: document.getElementById("minYearSelect"),
  maxYearSelect: document.getElementById("maxYearSelect"),
  seasonRangeValue: document.getElementById("seasonRangeValue")
};

init();

async function init() {
  bindEvents();
  syncFilterControls();
  setLoadingState("Loading fantasy_data.csv...");
  await loadSourceData();
  hydrateYearControls();
  recalculateBoardAndRender();
}

function bindEvents() {
  els.scoringSelect.addEventListener("change", () => {
    const nextScoring = els.scoringSelect.value;
    if (nextScoring !== "half-ppr" && nextScoring !== "ppr") {
      syncScoringToggle();
      return;
    }

    if (state.scoring === nextScoring) {
      return;
    }

    state.scoring = nextScoring;
    syncFilterControls();
    recalculateBoardAndRender();
  });

  els.filtersCard.addEventListener("click", (event) => {
    const collapseButton = event.target.closest("#filtersCollapseButton");
    if (collapseButton) {
      state.filtersCollapsed = !state.filtersCollapsed;
      renderFiltersCollapseState();
      return;
    }

    const presetButton = event.target.closest(".preset-button[data-preset]");
    if (presetButton) {
      applyPreset(presetButton.dataset.preset);
      return;
    }

    const button = event.target.closest("button.stepper-btn[data-action]");
    if (!button) {
      return;
    }

    const stepper = button.closest(".stepper[data-pos]");
    if (!stepper) {
      return;
    }

    const position = stepper.dataset.pos;
    const action = button.dataset.action;

    if (position === "TEAMS") {
      const delta = action === "increase" ? 1 : -1;
      state.teams = clamp(state.teams + delta, MIN_TEAMS, MAX_TEAMS);
      syncFilterControls();
      recalculateBoardAndRender();
      return;
    }

    if (!state.roster[position]) {
      state.roster[position] = 0;
    }

    if (action === "increase") {
      state.roster[position] = clamp(state.roster[position] + 1, 0, ROSTER_MAX[position] || 8);
    }

    if (action === "decrease") {
      state.roster[position] = clamp(state.roster[position] - 1, 0, ROSTER_MAX[position] || 8);
    }

    syncFilterControls();
    recalculateBoardAndRender();
  });

  els.minYearSelect.addEventListener("change", () => {
    const nextMin = Number.parseInt(els.minYearSelect.value, 10);
    const currentMax = Number.parseInt(els.maxYearSelect.value, 10);
    state.years.min = Math.min(nextMin, currentMax);
    state.years.max = Math.max(nextMin, currentMax);
    syncYearRangeUi();
    recalculateBoardAndRender();
  });

  els.maxYearSelect.addEventListener("change", () => {
    const nextMax = Number.parseInt(els.maxYearSelect.value, 10);
    const currentMin = Number.parseInt(els.minYearSelect.value, 10);
    state.years.min = Math.min(currentMin, nextMax);
    state.years.max = Math.max(currentMin, nextMax);
    syncYearRangeUi();
    recalculateBoardAndRender();
  });

  els.infoButton.addEventListener("click", openInfoModal);
  els.infoModalClose.addEventListener("click", closeInfoModal);
  els.infoModal.addEventListener("click", (event) => {
    if (event.target === els.infoModal) {
      closeInfoModal();
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !els.infoModal.classList.contains("hidden")) {
      closeInfoModal();
    }
  });
}

function applyPreset(presetName) {
  const preset = PRESETS[presetName];
  if (!preset) {
    return;
  }

  state.scoring = preset.scoring;
  state.teams = preset.teams;
  state.roster = { ...preset.roster };

  syncFilterControls();
  recalculateBoardAndRender();
}

async function loadSourceData() {
  try {
    const rows = await loadCsvRowsWithFallback(["./fantasy_data.csv", "../fantasy_data.csv"]);
    state.sourceData = buildSourceData(rows);
  } catch {
    state.sourceData = null;
  }
}

async function loadCsvRowsWithFallback(paths) {
  let lastError = null;

  for (const path of paths) {
    try {
      return await loadCsvRows(path);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error("Failed to load fantasy data CSV");
}

async function loadCsvRows(path) {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`Failed to load ${path}`);
  }

  const csv = await response.text();
  return parseCsv(csv);
}

function buildSourceData(rawRows) {
  const byYear = new Map();

  rawRows.forEach((row) => {
    const year = Number.parseInt(row.year, 10);
    const position = (row.pos || "").trim().toUpperCase();

    if (!Number.isInteger(year) || !POSITION_ORDER.includes(position)) {
      return;
    }

    if (!byYear.has(year)) {
      byYear.set(year, {
        QB: { "half-ppr": [], ppr: [] },
        RB: { "half-ppr": [], ppr: [] },
        WR: { "half-ppr": [], ppr: [] },
        TE: { "half-ppr": [], ppr: [] }
      });
    }

    const halfRank = Number.parseInt(row["points_pos_rank_half-ppr"], 10);
    const halfPoints = Number.parseFloat(row["points_half-ppr"]);
    const pprRank = Number.parseInt(row["points_pos_rank_ppr"], 10);
    const pprPoints = Number.parseFloat(row.points_ppr);

    if (Number.isInteger(halfRank) && halfRank > 0 && Number.isFinite(halfPoints)) {
      byYear.get(year)[position]["half-ppr"].push({ posRank: halfRank, points: halfPoints });
    }

    if (Number.isInteger(pprRank) && pprRank > 0 && Number.isFinite(pprPoints)) {
      byYear.get(year)[position].ppr.push({ posRank: pprRank, points: pprPoints });
    }
  });

  byYear.forEach((positionData) => {
    POSITION_ORDER.forEach((position) => {
      positionData[position]["half-ppr"].sort((a, b) => a.posRank - b.posRank);
      positionData[position].ppr.sort((a, b) => a.posRank - b.posRank);
    });
  });

  const years = Array.from(byYear.keys()).sort((a, b) => a - b);
  return {
    byYear,
    years,
    minYear: years[0],
    maxYear: years[years.length - 1]
  };
}

function hydrateYearControls() {
  if (!state.sourceData || !state.sourceData.years.length) {
    return;
  }

  const { minYear, maxYear } = state.sourceData;

  state.years.min = clamp(state.years.min, minYear, maxYear);
  state.years.max = clamp(state.years.max, state.years.min, maxYear);

  const yearOptions = [];
  for (let year = minYear; year <= maxYear; year += 1) {
    yearOptions.push(`<option value="${year}">${year}</option>`);
  }

  const optionsHtml = yearOptions.join("");
  els.minYearSelect.innerHTML = optionsHtml;
  els.maxYearSelect.innerHTML = optionsHtml;

  els.minYearSelect.value = String(state.years.min);
  els.maxYearSelect.value = String(state.years.max);
  syncYearRangeUi();
}

function syncYearRangeUi() {
  els.minYearSelect.value = String(state.years.min);
  els.maxYearSelect.value = String(state.years.max);

  const totalSeasons = Math.max(0, state.years.max - state.years.min + 1);
  const seasonLabel = totalSeasons === 1 ? "season" : "seasons";
  els.seasonRangeValue.textContent = `${state.years.min} to ${state.years.max} (${totalSeasons} ${seasonLabel})`;
}

function recalculateBoardAndRender() {
  if (!state.sourceData || !state.sourceData.years.length) {
    state.board = null;
    renderBoard();
    return;
  }

  const selectedYears = getSelectedYears(state.years.min, state.years.max);
  const averageRows = getAverageTrends(state.sourceData, selectedYears, state.scoring);

  if (!averageRows.length) {
    state.board = null;
    renderBoard();
    return;
  }

  const replacement = getReplacementLevels(averageRows, state.roster, state.teams);
  const withBbva = addBbva(averageRows, replacement);
  const rankedRows = addOverallRank(withBbva);

  state.board = buildBoardData(rankedRows, state.teams);
  renderBoard();
}

function getSelectedYears(minYear, maxYear) {
  const years = [];
  for (let year = minYear; year <= maxYear; year += 1) {
    years.push(year);
  }
  return years;
}

function getAverageTrends(sourceData, years, scoring) {
  const result = [];

  POSITION_ORDER.forEach((position) => {
    const cap = DRAFT_CAPS[position];
    const aggregate = new Map();

    years.forEach((year) => {
      const seasonData = sourceData.byYear.get(year);
      if (!seasonData) {
        return;
      }

      const rows = seasonData[position]?.[scoring] || [];
      const cappedRows = rows.slice(0, cap);

      // Use ordinal slot index per season so tie ranks in source data do not
      // create gaps (for example, duplicate QB8 with no QB9).
      cappedRows.forEach((row, index) => {
        const slotRank = index + 1;

        if (!aggregate.has(slotRank)) {
          aggregate.set(slotRank, { sum: 0, count: 0 });
        }

        const entry = aggregate.get(slotRank);
        entry.sum += row.points;
        entry.count += 1;
      });
    });

    Array.from(aggregate.entries())
      .sort((a, b) => a[0] - b[0])
      .forEach(([posRank, value]) => {
        if (!value.count) {
          return;
        }

        result.push({
          pos: position,
          posRank,
          points: value.sum / value.count
        });
      });
  });

  return result;
}

function getReplacementLevels(rows, roster, teamCount) {
  const replacement = {
    QB: Math.max(0, roster.QB * teamCount),
    RB: Math.max(0, roster.RB * teamCount),
    WR: Math.max(0, roster.WR * teamCount),
    TE: Math.max(0, roster.TE * teamCount)
  };

  const sortedRows = rows
    .filter((row) => Number.isFinite(row.points))
    .slice()
    .sort((a, b) => b.points - a.points);

  const remaining = sortedRows.filter((row) => {
    const cutoff = replacement[row.pos] || 0;
    if (!cutoff) {
      return true;
    }
    return row.posRank > cutoff;
  });

  const flexSlots = Math.max(0, roster.FLEX * teamCount);
  const flexPool = remaining
    .filter((row) => row.pos === "RB" || row.pos === "WR" || row.pos === "TE")
    .slice(0, flexSlots);

  flexPool.forEach((row) => {
    replacement[row.pos] += 1;
  });

  const usedFlex = new Set(flexPool.map((row) => `${row.pos}-${row.posRank}`));
  const remainingAfterFlex = remaining.filter((row) => !usedFlex.has(`${row.pos}-${row.posRank}`));

  const sflexSlots = Math.max(0, roster.SFLEX * teamCount);
  const superflexPool = remainingAfterFlex.slice(0, sflexSlots);
  superflexPool.forEach((row) => {
    replacement[row.pos] += 1;
  });

  return replacement;
}

function addBbva(rows, replacement) {
  const rowsByPos = {
    QB: [],
    RB: [],
    WR: [],
    TE: []
  };

  rows.forEach((row) => {
    if (rowsByPos[row.pos]) {
      rowsByPos[row.pos].push(row);
    }
  });

  POSITION_ORDER.forEach((position) => {
    rowsByPos[position].sort((a, b) => a.posRank - b.posRank);
  });

  return rows
    .filter((row) => (replacement[row.pos] || 0) > 0)
    .map((row) => {
      const positionRows = rowsByPos[row.pos] || [];
      const baseline = findBaselinePoints(positionRows, replacement[row.pos] || 0);

      return {
        ...row,
        vorp: row.points - baseline
      };
    });
}

function findBaselinePoints(positionRows, baselineRank) {
  if (!positionRows.length) {
    return 0;
  }

  if (baselineRank <= 0) {
    return 0;
  }

  const exact = positionRows.find((row) => row.posRank === baselineRank);
  if (exact) {
    return exact.points;
  }

  const lower = positionRows
    .filter((row) => row.posRank <= baselineRank)
    .sort((a, b) => b.posRank - a.posRank)[0];

  if (lower) {
    return lower.points;
  }

  return positionRows[0].points;
}

function addOverallRank(rows) {
  return rows
    .slice()
    .sort((a, b) => {
      const vorpDelta = b.vorp - a.vorp;
      if (Math.abs(vorpDelta) > 1e-9) {
        return vorpDelta;
      }

      const positionDelta = POSITION_ORDER.indexOf(a.pos) - POSITION_ORDER.indexOf(b.pos);
      if (positionDelta !== 0) {
        return positionDelta;
      }

      return a.posRank - b.posRank;
    })
    .map((row, index) => ({
      ...row,
      ovrRank: index + 1
    }));
}

function buildBoardData(rows, teamCount) {
  const byOverallRank = new Map();
  const positionCounts = {
    QB: 0,
    RB: 0,
    WR: 0,
    TE: 0
  };
  let maxPick = 0;

  rows.forEach((row) => {
    if (!Number.isInteger(row.ovrRank) || row.ovrRank <= 0) {
      return;
    }

    const displayPosRank = (positionCounts[row.pos] || 0) + 1;
    positionCounts[row.pos] = displayPosRank;

    byOverallRank.set(row.ovrRank, {
      ...row,
      displayPosRank
    });
    if (row.ovrRank > maxPick) {
      maxPick = row.ovrRank;
    }
  });

  const rounds = Math.ceil(maxPick / teamCount);
  const totalBoardPicks = rounds * teamCount;
  const picks = [];

  for (let pick = 1; pick <= totalBoardPicks; pick += 1) {
    picks.push(byOverallRank.get(pick) || null);
  }

  return { rounds, picks };
}

function renderBoard() {
  const board = state.board;
  const teamCount = state.teams;

  if (!board || !board.rounds) {
    els.draftBoard.innerHTML = '<div class="board-empty-state">No board data available for the current filters.</div>';
    return;
  }

  const parts = [];
  parts.push(`<div class="draft-board"><div class="draft-board-grid" style="grid-template-columns: 70px repeat(${teamCount}, minmax(106px, 1fr));">`);
  parts.push('<div class="board-header">Rnd</div>');

  for (let team = 1; team <= teamCount; team += 1) {
    parts.push(`<div class="board-header team-header">Team ${team}</div>`);
  }

  for (let round = 1; round <= board.rounds; round += 1) {
    parts.push(`<div class="board-round">${round}</div>`);

    for (let team = 1; team <= teamCount; team += 1) {
      const overallPick = getOverallPick(round, team, teamCount);
      const row = board.picks[overallPick - 1];

      if (!row) {
        parts.push(`<div class="board-cell empty"><div class="board-pick"><div></div><div class="board-pick-number">${overallPick}</div></div></div>`);
        continue;
      }

      const positionClass = getPositionClass(row.pos);
      const rankLabel = `${row.pos}${row.displayPosRank || row.posRank}`;
      const pointsLabel = Number.isFinite(row.points) ? row.points.toFixed(1) : "-";
      const vorpLabel = Number.isFinite(row.vorp) ? row.vorp.toFixed(1) : "-";

      parts.push(`
        <div class="board-cell ${positionClass}">
          <div class="board-pick">
            <div>
              <div class="board-player-rank">${escapeHtml(rankLabel)}</div>
              <div class="board-metric-line"><span>PTS</span><span>${escapeHtml(pointsLabel)}</span></div>
              <div class="board-metric-line board-vorp"><span>BBVA</span><span>${escapeHtml(vorpLabel)}</span></div>
            </div>
            <div class="board-pick-number">${overallPick}</div>
          </div>
        </div>
      `);
    }
  }

  parts.push("</div></div>");
  els.draftBoard.innerHTML = parts.join("");
}

function renderRosterValues() {
  els.slotQB.textContent = String(state.roster.QB);
  els.slotRB.textContent = String(state.roster.RB);
  els.slotWR.textContent = String(state.roster.WR);
  els.slotTE.textContent = String(state.roster.TE);
  els.slotFLEX.textContent = String(state.roster.FLEX);
  els.slotSFLEX.textContent = String(state.roster.SFLEX);
}

function renderTeamValue() {
  els.numTeamsValue.textContent = String(state.teams);
}

function syncFilterControls() {
  syncScoringToggle();
  renderRosterValues();
  renderTeamValue();
  renderPresetButtons();
  renderFiltersCollapseState();
}

function renderPresetButtons() {
  els.presetButtons.forEach((button) => {
    const preset = PRESETS[button.dataset.preset];
    const isActive = Boolean(preset) && matchesPreset(preset);
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
  });
}

function matchesPreset(preset) {
  return (
    preset.scoring === state.scoring &&
    preset.teams === state.teams &&
    ["QB", "RB", "WR", "TE", "FLEX", "SFLEX"].every((position) => preset.roster[position] === state.roster[position])
  );
}

function renderFiltersCollapseState() {
  const isCollapsed = state.filtersCollapsed;
  els.filtersGrid.classList.toggle("hidden", isCollapsed);
  if (isCollapsed) {
    els.filtersGrid.setAttribute("hidden", "");
  } else {
    els.filtersGrid.removeAttribute("hidden");
  }
  els.filtersCollapseButton.textContent = isCollapsed ? "+" : "−";
  els.filtersCollapseButton.setAttribute("aria-expanded", String(!isCollapsed));
  els.filtersCollapseButton.setAttribute("aria-label", isCollapsed ? "Expand filters" : "Collapse filters");
}

function openInfoModal() {
  els.infoModal.classList.remove("hidden");
  els.infoModal.setAttribute("aria-hidden", "false");
  document.body.classList.add("modal-open");
  els.infoModalClose.focus();
}

function closeInfoModal() {
  if (els.infoModal.contains(document.activeElement)) {
    document.activeElement.blur();
  }
  els.infoModal.classList.add("hidden");
  els.infoModal.setAttribute("aria-hidden", "true");
  document.body.classList.remove("modal-open");
  els.infoButton.focus();
}

function setLoadingState(message) {
  els.draftBoard.innerHTML = `<div class="board-empty-state">${escapeHtml(message)}</div>`;
}

function getOverallPick(round, team, teamCount) {
  if (round % 2 === 1) {
    return (round - 1) * teamCount + team;
  }

  return round * teamCount - team + 1;
}

function syncScoringToggle() {
  els.scoringSelect.value = state.scoring;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function getPositionClass(position) {
  if (position === "QB") return "qb";
  if (position === "RB") return "rb";
  if (position === "WR") return "wr";
  if (position === "TE") return "te";
  return "";
}

function parseCsv(csvText) {
  const lines = csvText
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0);

  if (!lines.length) {
    return [];
  }

  const headers = parseCsvLine(lines[0]);
  const rows = [];

  for (let i = 1; i < lines.length; i += 1) {
    const values = parseCsvLine(lines[i]);
    const row = {};

    headers.forEach((header, idx) => {
      row[header] = values[idx] || "";
    });

    rows.push(row);
  }

  return rows;
}

function parseCsvLine(line) {
  const result = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];

    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += char;
    }
  }

  result.push(current);
  return result;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
