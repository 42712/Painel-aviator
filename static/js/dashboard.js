'use strict';

// ============ STATE ============
let allRounds = [];
let currentUser = null;
let currentCasa = '';
let currentDate = new Date().toISOString().split('T')[0];
let activeTab = 'tab-principal';

// Chart state
let chartMode = 'line';
let smoothAmount = 3;
let graphLimit = 200;
let chartScaleX = 1;
let chartOffsetX = 0;
let chartScaleY = 1;
let chartOffsetY = 0;
let chartDragging = false;
let dragStartX = 0, dragStartY = 0, dragStartOffsetX = 0, dragStartOffsetY = 0;
let crosshairIndex = -1;

// ============ CLOCK ============
function updateClock() {
  const now = new Date();
  document.getElementById('clockBox').textContent =
    now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
setInterval(updateClock, 1000);
updateClock();

// ============ TAB NAVIGATION ============
document.querySelectorAll('.tabBtn[data-tab]').forEach(btn => {
  btn.addEventListener('click', () => {
    activeTab = btn.dataset.tab;
    document.querySelectorAll('.tabBtn[data-tab]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('.tabPage').forEach(p => p.classList.remove('active'));
    const page = document.getElementById(activeTab);
    if (page) page.classList.add('active');
    loadActiveTab();
  });
});

// ============ DATA LOADING ============
async function fetchRounds(params = {}) {
  const qs = new URLSearchParams();
  if (params.limit) qs.set('limit', params.limit);
  if (params.offset) qs.set('offset', params.offset);
  if (params.date_from) qs.set('date_from', params.date_from);
  if (params.date_to) qs.set('date_to', params.date_to);
  if (currentCasa) qs.set('casa', currentCasa);

  const res = await fetch(`/api/rounds?${qs.toString()}`);
  const data = await res.json();
  return data.rows || [];
}

async function loadUser() {
  try {
    const res = await fetch('/api/auth/me');
    const data = await res.json();
    if (data.ok) {
      currentUser = data.user;
      updateLicenseUI();
    } else {
      location.href = '/login';
    }
  } catch (e) {
    location.href = '/login';
  }
}

async function loadCasas() {
  try {
    const res = await fetch('/api/casas');
    const data = await res.json();
    const sel = document.getElementById('casaSelect');
    data.casas.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c;
      opt.textContent = c;
      sel.appendChild(opt);
    });
    sel.addEventListener('change', () => {
      currentCasa = sel.value;
      loadActiveTab();
    });
  } catch (e) { }
}

function updateLicenseUI() {
  if (!currentUser) return;
  const badge = document.getElementById('licenseBadge');
  const overlay = document.getElementById('licenseOverlay');

  if (!currentUser.licenca_valida) {
    overlay.style.display = 'flex';
    badge.textContent = 'Licença: EXPIRADA';
    badge.style.background = '#7f1d1d';
  } else {
    overlay.style.display = 'none';
    badge.textContent = `Licença: ${currentUser.plano.toUpperCase()} (${currentUser.dias_restantes}d)`;
  }
}

// ============ LICENSE ============
document.getElementById('licenseBtn').addEventListener('click', async () => {
  const key = document.getElementById('licenseKey').value.trim();
  const msg = document.getElementById('licenseMsg');
  if (!key) { msg.textContent = 'Digite uma chave de licença.'; return; }
  // In this standalone version, license management is simplified
  msg.textContent = 'Para ativar licença, contate o suporte.';
  msg.classList.add('licenseOk');
});

document.getElementById('tabLicenseBtn').addEventListener('click', () => {
  document.getElementById('licenseOverlay').style.display = 'flex';
});

document.getElementById('licenseLogout').addEventListener('click', async () => {
  await fetch('/api/auth/logout', { method: 'POST' });
  location.href = '/login';
});

// ============ PRINCIPAL TAB ============
async function loadPrincipal() {
  const limit = parseInt(document.getElementById('mainLimit').value) || 100;
  const date = document.getElementById('mainDate').value || currentDate;
  const rows = await fetchRounds({ limit, date_from: date, date_to: date });
  allRounds = rows;

  document.getElementById('mainCount').textContent = `Exibindo ${rows.length} multiplicadores`;

  const grid = document.getElementById('multGrid');
  grid.innerHTML = '';

  if (rows.length === 0) {
    grid.innerHTML = '<div class="empty">Nenhum multiplicador encontrado</div>';
    return;
  }

  let lastDate = '';
  rows.forEach((r, idx) => {
    const d = (r.captured_at || '').split('T')[0];
    if (d && d !== lastDate) {
      lastDate = d;
      const sep = document.createElement('div');
      sep.className = 'mainDateSep';
      sep.textContent = d.split('-').reverse().join('/');
      grid.appendChild(sep);
    }

    const m = r.multiplier;
    let colorClass = 'mBlue';
    if (m >= 10) colorClass = 'mPink';
    else if (m >= 2) colorClass = 'mPurple';

    const box = document.createElement('div');
    box.className = `multBox ${colorClass}`;
    let mClass = '';
    if (m >= 100) mClass = ' multXL';
    else if (m >= 10) mClass = ' multLong';

    box.innerHTML = `
      <div class="multMain${mClass}">${m.toFixed(2)}x</div>
      <div class="multBottom">
        <div class="multTime">${r.time_label}</div>
        <div class="multId">#${r.round_id}</div>
      </div>`;
    grid.appendChild(box);
  });
}

document.getElementById('mainApplyBtn').addEventListener('click', loadPrincipal);
document.getElementById('mainDate').value = currentDate;

// ============ GRAFICO TAB ============
function drawChart() {
  const canvas = document.getElementById('chartCanvas');
  const wrap = document.getElementById('chartWrap');
  canvas.width = wrap.clientWidth;
  canvas.height = wrap.clientHeight;

  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  if (allRounds.length === 0) {
    ctx.fillStyle = '#94a3b8';
    ctx.font = '16px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('Carregue dados na aba Principal primeiro', w / 2, h / 2);
    return;
  }

  const margin = { top: 30, right: 20, bottom: 40, left: 60 };
  const plotW = (w - margin.left - margin.right) * chartScaleX;
  const plotH = (h - margin.top - margin.bottom) * chartScaleY;

  const values = allRounds.map(r => r.multiplier);
  let smoothValues = values;
  if (smoothAmount > 1) {
    smoothValues = [];
    for (let i = 0; i < values.length; i++) {
      let sum = 0, count = 0;
      for (let j = Math.max(0, i - Math.floor(smoothAmount / 2));
        j <= Math.min(values.length - 1, i + Math.floor(smoothAmount / 2)); j++) {
        sum += values[j]; count++;
      }
      smoothValues.push(sum / count);
    }
  }

  const globalMin = Math.min(...values) * 0.95;
  const globalMax = Math.max(...values) * 1.05;
  const range = globalMax - globalMin || 1;

  function xPos(i) { return margin.left + (i / Math.max(1, values.length - 1)) * plotW + chartOffsetX; }
  function yPos(v) { return margin.top + plotH - ((v - globalMin) / range) * plotH + chartOffsetY; }

  ctx.save();
  ctx.beginPath();
  ctx.rect(margin.left, margin.top, w - margin.left - margin.right, h - margin.top - margin.bottom);
  ctx.clip();

  // Grid
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 5; i++) {
    const y = margin.top + (plotH / 5) * i + chartOffsetY;
    ctx.beginPath(); ctx.moveTo(margin.left, y); ctx.lineTo(w - margin.right, y); ctx.stroke();
  }

  // Y axis labels
  ctx.fillStyle = '#94a3b8';
  ctx.font = '11px Arial';
  ctx.textAlign = 'right';
  for (let i = 0; i <= 5; i++) {
    const val = globalMin + (range / 5) * (5 - i);
    const y = margin.top + (plotH / 5) * i + chartOffsetY;
    if (y >= margin.top - 20 && y <= h - margin.bottom + 20) {
      ctx.fillText(val.toFixed(1) + 'x', margin.left - 8, y + 4);
    }
  }

  if (chartMode === 'line') {
    ctx.strokeStyle = '#60a5fa';
    ctx.lineWidth = 2;
    ctx.shadowColor = '#60a5fa';
    ctx.shadowBlur = 6;
    ctx.beginPath();
    for (let i = 0; i < smoothValues.length; i++) {
      const x = xPos(i), y = yPos(smoothValues[i]);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Points
    for (let i = 0; i < values.length; i++) {
      const x = xPos(i), y = yPos(values[i]);
      if (x >= margin.left && x <= w - margin.right && y >= margin.top && y <= h - margin.bottom) {
        ctx.fillStyle = values[i] >= 10 ? '#ff2f92' : values[i] >= 2 ? '#7b2ce6' : '#1c6aa3';
        ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill();
      }
    }
  } else {
    // Bar mode
    const barW = Math.max(1, plotW / values.length * 0.8);
    for (let i = 0; i < values.length; i++) {
      const x = xPos(i) - barW / 2, y = yPos(values[i]);
      const barH = yPos(globalMin) - y;
      if (x + barW >= margin.left && x <= w - margin.right) {
        ctx.fillStyle = values[i] >= 10 ? '#ff2f92' : values[i] >= 2 ? '#7b2ce6' : '#1c6aa3';
        ctx.fillRect(x, y, barW, Math.max(1, barH));
      }
    }
  }

  // Crosshair
  if (crosshairIndex >= 0 && crosshairIndex < values.length) {
    const cx = xPos(crosshairIndex);
    ctx.strokeStyle = '#22d3ee';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(cx, margin.top); ctx.lineTo(cx, margin.top + plotH + chartOffsetY); ctx.stroke();
    ctx.setLineDash([]);
  }

  ctx.restore();

  // Axis
  ctx.strokeStyle = '#555860';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(margin.left, margin.top); ctx.lineTo(margin.left, h - margin.bottom);
  ctx.lineTo(w - margin.right, h - margin.bottom); ctx.stroke();

  // X labels
  ctx.fillStyle = '#94a3b8';
  ctx.font = '10px Arial';
  ctx.textAlign = 'center';
  const labelStep = Math.max(1, Math.floor(values.length / 10));
  for (let i = 0; i < values.length; i += labelStep) {
    const x = xPos(i);
    if (x >= margin.left && x <= w - margin.right) {
      ctx.fillText(allRounds[i].time_label, x, h - margin.bottom + 16);
    }
  }
}

function updateStats() {
  if (allRounds.length === 0) return;
  const last20 = allRounds.slice(-20);

  // Minimos
  const mins = last20.slice(0, 5).map(r => ({ v: r.multiplier, id: r.round_id }));
  document.getElementById('minBoxes').innerHTML = mins.map(m =>
    `<div class="miniBox"><div class="miniRef">${m.id.slice(-3)}</div><div class="miniVal minVal">${m.v.toFixed(1)}</div></div>`
  ).join('');

  // Repetições
  const reps = countRepetitions(last20, 2.0);
  document.getElementById('repBoxes').innerHTML = reps.slice(0, 6).map(r =>
    `<div class="miniBox repBox"><div class="miniRef">${r.count}x</div><div class="miniVal repVal">${r.value.toFixed(1)}</div></div>`
  ).join('');

  // IDs recentes
  document.getElementById('idBoxes').innerHTML = last20.slice(0, 5).map(r =>
    `<div class="miniBox"><div class="miniRef">ID</div><div class="miniVal idVal">${r.round_id.slice(-4)}</div></div>`
  ).join('');

  // Proximo / media
  const avg = last20.reduce((a, b) => a + b.multiplier, 0) / last20.length;
  document.getElementById('proxVal').textContent = avg.toFixed(2) + 'x';

  // Ultimos 10
  document.getElementById('last10Box').innerHTML = last20.slice(0, 10).map(r => {
    let cls = 'mBlue'; if (r.multiplier >= 10) cls = 'mPink'; else if (r.multiplier >= 2) cls = 'mPurple';
    return `<div class="recentBox ${cls}"><div class="recentMult">${r.multiplier.toFixed(2)}x</div><div class="recentTime">${r.time_label}</div><div class="recentId">#${r.round_id.slice(-4)}</div></div>`;
  }).join('');

  // Elapsed
  updateElapsed();

  // Recent wrap
  document.getElementById('recentWrap').innerHTML = last20.slice(0, 4).map(r => {
    let cls = 'mBlue'; if (r.multiplier >= 10) cls = 'mPink'; else if (r.multiplier >= 2) cls = 'mPurple';
    return `<div class="recentBox ${cls}"><div class="recentMult">${r.multiplier.toFixed(2)}x</div><div class="recentTime">${r.time_label}</div><div class="recentId">#${r.round_id.slice(-4)}</div></div>`;
  }).join('');
}

function countRepetitions(rounds, minX) {
  const result = [];
  for (let i = 0; i < rounds.length; i++) {
    if (rounds[i].multiplier >= minX) {
      let count = 1;
      for (let j = i + 1; j < rounds.length; j++) {
        if (rounds[j].multiplier >= minX) count++;
        else break;
      }
      result.push({ value: rounds[i].multiplier, count });
    }
  }
  return result.slice(0, 6);
}

function updateElapsed() {
  if (allRounds.length === 0) return;
  let pinkSince = 0, purpleSince = 0, blueSince = 0;
  let pinkCount = 0, purpleCount = 0, blueCount = 0;

  for (let i = allRounds.length - 1; i >= 0; i--) {
    const m = allRounds[i].multiplier;
    if (m >= 10) { pinkSince = allRounds.length - 1 - i; pinkCount++; }
    if (m >= 2 && m < 10) purpleCount++;
    if (m < 2) blueCount++;
  }

  const formatElapsed = (count) => {
    const min = Math.floor(count / 3); // approximate 20s per round -> 3 per minute
    const sec = (count % 3) * 20;
    return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  };

  document.getElementById('elapsedPink').textContent = formatElapsed(pinkSince);
  document.getElementById('elapsedPinkCount').textContent = pinkCount;
  document.getElementById('elapsedPurple').textContent = formatElapsed(0);
  document.getElementById('elapsedPurpleCount').textContent = purpleCount;
  document.getElementById('elapsedBlue').textContent = formatElapsed(0);
  document.getElementById('elapsedBlueCount').textContent = blueCount;
}

function loadGrafico() {
  drawChart();
  updateStats();
}

// Chart interactivity
document.getElementById('chartCanvas').addEventListener('mousedown', (e) => {
  chartDragging = true;
  dragStartX = e.clientX; dragStartY = e.clientY;
  dragStartOffsetX = chartOffsetX; dragStartOffsetY = chartOffsetY;
});

document.addEventListener('mousemove', (e) => {
  if (!chartDragging) return;
  chartOffsetX = dragStartOffsetX + (e.clientX - dragStartX);
  chartOffsetY = dragStartOffsetY + (e.clientY - dragStartY);
  drawChart();
});

document.addEventListener('mouseup', () => { chartDragging = false; });

document.getElementById('chartCanvas').addEventListener('wheel', (e) => {
  e.preventDefault();
  const factor = e.deltaY < 0 ? 1.1 : 0.9;
  chartScaleX *= factor;
  chartScaleY *= factor;
  drawChart();
});

document.getElementById('chartCanvas').addEventListener('mousemove', (e) => {
  if (chartDragging) return;
  const canvas = document.getElementById('chartCanvas');
  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  if (allRounds.length > 0) {
    const margin = { left: 60 };
    const plotW = (canvas.width - margin.left - 20) * chartScaleX;
    const idx = Math.round(((x - margin.left - chartOffsetX) / plotW) * (allRounds.length - 1));
    if (idx >= 0 && idx < allRounds.length) {
      crosshairIndex = idx;
      const info = document.getElementById('crossInfo');
      const r = allRounds[idx];
      info.style.display = 'block';
      info.textContent = `${r.time_label} | #${r.round_id} | ${r.multiplier.toFixed(2)}x | ${r.casa}`;
      drawChart();
      return;
    }
  }
  crosshairIndex = -1;
  document.getElementById('crossInfo').style.display = 'none';
});

// Graph controls
document.getElementById('btnLine').addEventListener('click', () => {
  chartMode = 'line';
  document.getElementById('btnLine').classList.add('active');
  document.getElementById('btnBar').classList.remove('active');
  drawChart();
});

document.getElementById('btnBar').addEventListener('click', () => {
  chartMode = 'bar';
  document.getElementById('btnBar').classList.add('active');
  document.getElementById('btnLine').classList.remove('active');
  drawChart();
});

document.getElementById('btnApplyGraph').addEventListener('click', () => {
  smoothAmount = parseInt(document.getElementById('smoothInput').value) || 0;
  drawChart();
});

document.getElementById('btnFullscreen').addEventListener('click', () => {
  const wrap = document.getElementById('chartWrap');
  if (document.fullscreenElement) {
    document.exitFullscreen();
  } else {
    wrap.requestFullscreen();
  }
});

document.getElementById('graphLimit').addEventListener('change', () => {
  graphLimit = parseInt(document.getElementById('graphLimit').value) || 200;
  loadPrincipal().then(() => loadGrafico());
});

// ============ HISTORICO TAB ============
async function loadHistorico() {
  const date = document.getElementById('historyDate').value || currentDate;
  const minX = parseFloat(document.getElementById('historyMinX').value) || 2.0;
  const rows = await fetchRounds({ limit: 5000, date_from: date, date_to: date });

  document.getElementById('historyInfo').textContent = `${rows.length} velas em ${date.split('-').reverse().join('/')}`;

  // Summary - top 5 por hora
  const hours = {};
  rows.forEach(r => {
    const h = (r.time_label || '').split(':')[0] || '00';
    if (!hours[h]) hours[h] = [];
    hours[h].push(r);
  });

  const summaryCols = document.getElementById('historySummary');
  summaryCols.innerHTML = '';
  const hourKeys = Object.keys(hours).sort();
  hourKeys.forEach(h => {
    const col = document.createElement('div');
    col.className = 'historySummaryCol';
    col.innerHTML = `<div class="historySummaryHead">${h}h</div>`;
    const top5 = hours[h].sort((a, b) => b.multiplier - a.multiplier).slice(0, 5);
    top5.forEach(r => {
      const item = document.createElement('div');
      item.className = 'historySummaryItem' + (r.multiplier >= minX ? ' hit' : '');
      item.textContent = r.multiplier.toFixed(2) + 'x';
      col.appendChild(item);
    });
    while (col.children.length < 6) {
      const empty = document.createElement('div');
      empty.className = 'historySummaryItem';
      empty.textContent = '-';
      col.appendChild(empty);
    }
    summaryCols.appendChild(col);
  });

  // Grid by hour
  const grid = document.getElementById('historyGrid');
  grid.innerHTML = '';

  // Headers
  const hourHeader = document.createElement('div');
  hourHeader.className = 'historyHeader historyHour';
  hourHeader.textContent = 'Min';
  grid.appendChild(hourHeader);

  const now = new Date();
  const currentHourStr = String(now.getHours()).padStart(2, '0');
  const currentMin = now.getMinutes();

  for (let i = 0; i < 6; i++) {
    const h = String(now.getHours() - 5 + i).padStart(2, '0');
    const header = document.createElement('div');
    header.className = 'historyHeader';
    header.textContent = `${h}h`;
    grid.appendChild(header);
  }

  // Minutes 0-59
  for (let min = 0; min < 60; min++) {
    const minLabel = document.createElement('div');
    minLabel.className = 'historyHour';
    minLabel.textContent = String(min).padStart(2, '0') + 'min';
    grid.appendChild(minLabel);

    for (let col = 0; col < 6; col++) {
      const cell = document.createElement('div');
      cell.className = 'historyCell';
      const h = String(now.getHours() - 5 + col).padStart(2, '0');
      const hStr = String(parseInt(h) % 24).padStart(2, '0');

      if (hStr === currentHourStr && min <= currentMin && min >= currentMin - 10) {
        cell.classList.add('current');
      }

      const cellData = (hours[hStr] || []).filter(r => {
        const m = parseInt((r.time_label || '').split(':')[1] || '99');
        return m === min;
      });

      cellData.forEach(r => {
        let cls = 'mBlue';
        if (r.multiplier >= 10) cls = 'mPink';
        else if (r.multiplier >= 2) cls = 'mPurple';
        const block = document.createElement('div');
        block.className = `historyBlock ${cls}`;
        block.innerHTML = `<div class="historyBlockMult">${r.multiplier.toFixed(2)}x</div><div class="historyBlockTime">${r.time_label}</div>`;
        cell.appendChild(block);
      });

      if (cell.children.length === 0) {
        cell.style.justifyContent = 'center';
        cell.style.alignItems = 'center';
        cell.innerHTML = '<span style="color:#555">-</span>';
      }

      grid.appendChild(cell);
    }
  }
}

document.getElementById('historyApplyBtn').addEventListener('click', loadHistorico);
document.getElementById('historyDate').value = currentDate;

// ============ REPETICOES TAB ============
async function loadRepeticoes() {
  const minX = parseFloat(document.getElementById('repMinX').value) || 2.0;
  const rows = await fetchRounds({ limit: 1000 });
  allRounds = rows;

  const multiplers = {};
  rows.forEach(r => {
    const key = Math.floor(r.multiplier * 10) / 10;
    if (!multiplers[key]) multiplers[key] = 0;
    if (r.multiplier >= minX) multiplers[key]++;
  });

  const table = document.getElementById('repTable');
  table.innerHTML = '<tr><th>Multiplicador</th><th>Ocorrências</th><th>%</th></tr>';
  const total = Object.values(multiplers).reduce((a, b) => a + b, 0);

  Object.entries(multiplers)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 30)
    .forEach(([m, count]) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${parseFloat(m).toFixed(1)}x</td><td>${count}</td><td>${((count / total) * 100).toFixed(1)}%</td>`;
      table.appendChild(tr);
    });

  document.getElementById('repInfo').textContent = `Total ≥ ${minX}x: ${total} ocorrências`;
}

document.getElementById('repApplyBtn').addEventListener('click', loadRepeticoes);

// ============ MINUTOS TAB ============
async function loadMinutos() {
  const minX = parseFloat(document.getElementById('minMinX').value) || 2.0;
  const rows = await fetchRounds({ limit: 1000 });

  const minuteMap = {};
  rows.forEach(r => {
    const minute = (r.time_label || '').substring(0, 5);
    if (!minuteMap[minute]) minuteMap[minute] = { total: 0, hit: 0 };
    minuteMap[minute].total++;
    if (r.multiplier >= minX) minuteMap[minute].hit++;
  });

  const table = document.getElementById('minTable');
  table.innerHTML = '<tr><th>Minuto</th><th>Total Velas</th><th>≥ ' + minX + 'x</th><th>%</th></tr>';

  Object.entries(minuteMap)
    .sort((a, b) => b[1].hit - a[1].hit)
    .slice(0, 40)
    .forEach(([min, data]) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${min}</td><td>${data.total}</td><td>${data.hit}</td><td>${((data.hit / data.total) * 100).toFixed(1)}%</td>`;
      table.appendChild(tr);
    });

  document.getElementById('minInfo').textContent = `${Object.keys(minuteMap).length} minutos analisados`;
}

document.getElementById('minApplyBtn').addEventListener('click', loadMinutos);

// ============ RODADA TAB ============
async function loadRodada() {
  const minX = parseFloat(document.getElementById('rodadaMinX').value) || 2.0;
  const rows = await fetchRounds({ limit: 500 });

  const table = document.getElementById('rodadaTable');
  table.innerHTML = '';

  // Headers
  const cols = 10;
  let headerHTML = '<tr><th>Rod #</th>';
  for (let i = 1; i <= cols; i++) headerHTML += `<th>R${i}</th>`;
  headerHTML += '</tr>';
  table.innerHTML = headerHTML;

  for (let row = 0; row < Math.ceil(rows.length / cols); row++) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${row * cols + 1}-${Math.min((row + 1) * cols, rows.length)}</td>`;
    for (let col = 0; col < cols; col++) {
      const idx = row * cols + col;
      if (idx < rows.length) {
        const r = rows[idx];
        const cls = r.multiplier >= minX ? 'rodadaActive' : '';
        tr.innerHTML += `<td class="${cls}">${r.multiplier.toFixed(2)}x</td>`;
      } else {
        tr.innerHTML += '<td class="rodadaEmpty">-</td>';
      }
    }
    table.appendChild(tr);
  }

  document.getElementById('rodadaInfo').textContent = `${rows.length} rodadas`;
}

document.getElementById('rodadaApplyBtn').addEventListener('click', loadRodada);

// ============ GRAFICO MEDIA TAB ============
let mediaChartState = {};

async function loadMediaGrafico() {
  const limit = parseInt(document.getElementById('mediaGraphLimit').value) || 60;
  const rows = await fetchRounds({ limit: Math.max(limit * 3, 200) });

  // Group by minute
  const mins = {};
  rows.forEach(r => {
    const key = (r.time_label || '').substring(0, 5);
    if (!mins[key]) mins[key] = [];
    mins[key].push(r.multiplier);
  });

  const averages = [];
  Object.entries(mins).forEach(([min, vals]) => {
    const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
    averages.push({ minute: min, avg: parseFloat(avg.toFixed(2)), count: vals.length });
  });
  averages.sort((a, b) => a.minute.localeCompare(b.minute));

  document.getElementById('mediaGraphInfo').textContent = `${averages.length} minutos analisados`;

  // Draw chart
  const canvas = document.getElementById('mediaChartCanvas');
  const box = document.getElementById('mediaChartBox');
  canvas.width = box.clientWidth;
  canvas.height = box.clientHeight;
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;

  ctx.clearRect(0, 0, w, h);

  if (averages.length === 0) return;

  const margin = { top: 40, right: 20, bottom: 60, left: 60 };
  const maxAvg = Math.max(...averages.map(a => a.avg)) * 1.1;
  const minAvg = 0;

  // Grid
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  for (let i = 0; i <= 5; i++) {
    const y = margin.top + ((h - margin.top - margin.bottom) / 5) * i;
    ctx.beginPath(); ctx.moveTo(margin.left, y); ctx.lineTo(w - margin.right, y); ctx.stroke();
  }

  // Line
  ctx.strokeStyle = '#22d3ee';
  ctx.lineWidth = 2;
  ctx.beginPath();
  averages.forEach((a, i) => {
    const x = margin.left + (i / Math.max(1, averages.length - 1)) * (w - margin.left - margin.right);
    const y = margin.top + (h - margin.top - margin.bottom) * (1 - a.avg / maxAvg);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.stroke();

  // Dots
  averages.forEach((a, i) => {
    const x = margin.left + (i / Math.max(1, averages.length - 1)) * (w - margin.left - margin.right);
    const y = margin.top + (h - margin.top - margin.bottom) * (1 - a.avg / maxAvg);
    ctx.fillStyle = a.avg >= 2 ? '#f59e0b' : '#60a5fa';
    ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill();
  });

  // Y labels
  ctx.fillStyle = '#94a3b8';
  ctx.font = '11px Arial';
  ctx.textAlign = 'right';
  for (let i = 0; i <= 5; i++) {
    const val = (maxAvg / 5) * (5 - i);
    const y = margin.top + ((h - margin.top - margin.bottom) / 5) * i;
    ctx.fillText(val.toFixed(1) + 'x', margin.left - 8, y + 4);
  }

  // X labels
  ctx.textAlign = 'center';
  const step = Math.max(1, Math.floor(averages.length / 15));
  for (let i = 0; i < averages.length; i += step) {
    const x = margin.left + (i / Math.max(1, averages.length - 1)) * (w - margin.left - margin.right);
    ctx.fillText(averages[i].minute, x, h - margin.bottom + 16);
  }

  // Axis
  ctx.strokeStyle = '#555860';
  ctx.beginPath();
  ctx.moveTo(margin.left, margin.top); ctx.lineTo(margin.left, h - margin.bottom);
  ctx.lineTo(w - margin.right, h - margin.bottom); ctx.stroke();

  // Recent
  document.getElementById('mediaRecent').innerHTML = rows.slice(0, 5).map(r => {
    let cls = 'mBlue'; if (r.multiplier >= 10) cls = 'mPink'; else if (r.multiplier >= 2) cls = 'mPurple';
    return `<div class="recentBox ${cls}"><div class="recentMult">${r.multiplier.toFixed(2)}x</div><div class="recentTime">${r.time_label}</div></div>`;
  }).join('');
}

document.getElementById('mediaGraphApplyBtn').addEventListener('click', loadMediaGrafico);

// ============ VELAS TAB ============
async function loadVelas() {
  const rows = await fetchRounds({ limit: 1000 });

  // High multipliers groups: 2-5x, 5-10x, 10-25x, 25-50x, 50-100x, 100-250x, 250-500x, 500-1000x
  const ranges = [
    { label: '2x - 5x', min: 2, max: 5 },
    { label: '5x - 10x', min: 5, max: 10 },
    { label: '10x - 25x', min: 10, max: 25 },
    { label: '25x - 50x', min: 25, max: 50 },
    { label: '50x - 100x', min: 50, max: 100 },
    { label: '100x - 250x', min: 100, max: 250 },
    { label: '250x - 500x', min: 250, max: 500 },
  ];

  const wrap = document.getElementById('velaWrap');
  wrap.innerHTML = '';

  ranges.forEach(range => {
    const block = document.createElement('div');
    block.className = 'velaBlock';
    block.innerHTML = `<div class="velaBlockTitle">${range.label}</div>`;

    const filtered = rows.filter(r => r.multiplier >= range.min && r.multiplier < range.max);
    const tbl = document.createElement('div');
    tbl.className = 'velaTableWrap';

    if (filtered.length === 0) {
      tbl.innerHTML = '<div style="padding:20px;text-align:center;color:#555">Nenhuma vela neste intervalo</div>';
    } else {
      let html = '<table class="velaTable"><tr><th>Hora</th><th>ID</th><th>Multiplicador</th></tr>';
      filtered.slice(0, 20).forEach(r => {
        html += `<tr><td>${r.time_label}</td><td>#${r.round_id}</td><td style="color:var(--yellow)">${r.multiplier.toFixed(2)}x</td></tr>`;
      });
      html += '</table>';
      tbl.innerHTML = html;
    }

    block.appendChild(tbl);
    wrap.appendChild(block);
  });

  document.getElementById('velaInfo').textContent = `${rows.length} velas analisadas`;
}

// ============ AFASTAMENTO TAB ============
async function loadAfastamento() {
  const rows = await fetchRounds({ limit: 1000 });

  const pinkRows = rows.filter(r => r.multiplier >= 10);
  const gaps = [];
  for (let i = 1; i < pinkRows.length; i++) {
    let gap = 0;
    for (let j = 0; j < rows.length; j++) {
      if (rows[j].round_id === pinkRows[i - 1].round_id) break;
      gap++;
    }
    for (let j = 0; j < rows.length; j++) {
      if (rows[j].round_id === pinkRows[i].round_id) break;
      gap--;
    }
    gaps.push({
      from: pinkRows[i - 1],
      to: pinkRows[i],
      gap: Math.abs(gap)
    });
  }

  const wrap = document.getElementById('afastWrap');
  wrap.innerHTML = '';

  const block = document.createElement('div');
  block.className = 'afastBlock';
  block.innerHTML = '<div class="afastBlockTitle">Afastamento entre velas ≥ 10x</div>';

  const tbl = document.createElement('div');
  tbl.className = 'afastTableWrap';

  if (gaps.length === 0) {
    tbl.innerHTML = '<div style="padding:20px;text-align:center;color:#555">Dados insuficientes</div>';
  } else {
    let html = '<table class="afastTable"><tr><th>De</th><th>Para</th><th>Intervalo (velas)</th><th>Tempo Est.</th></tr>';
    gaps.slice(0, 30).forEach(g => {
      const estSec = g.gap * 20;
      const min = Math.floor(estSec / 60);
      const sec = estSec % 60;
      html += `<tr>
        <td>${g.from.multiplier.toFixed(2)}x (${g.from.time_label})</td>
        <td>${g.to.multiplier.toFixed(2)}x (${g.to.time_label})</td>
        <td>${g.gap} velas</td>
        <td>${min}min ${sec}s</td>
      </tr>`;
    });
    html += '</table>';
    tbl.innerHTML = html;
  }

  block.appendChild(tbl);
  wrap.appendChild(block);

  document.getElementById('afastInfo').textContent = `${pinkRows.length} velas ≥ 10x | ${gaps.length} intervalos`;
}

// ============ LOAD ACTIVE TAB ============
function loadActiveTab() {
  switch (activeTab) {
    case 'tab-principal': loadPrincipal(); break;
    case 'tab-grafico': loadGrafico(); break;
    case 'tab-historico': loadHistorico(); break;
    case 'tab-repeticoes': loadRepeticoes(); break;
    case 'tab-minutos': loadMinutos(); break;
    case 'tab-rodada': loadRodada(); break;
    case 'tab-grafmedia': loadMediaGrafico(); break;
    case 'tab-velas': loadVelas(); break;
    case 'tab-afastamento': loadAfastamento(); break;
  }
}

// ============ INIT ============
async function init() {
  await loadUser();
  await loadCasas();
  await loadPrincipal();
  loadGrafico();
}

// Handle window resize for charts
window.addEventListener('resize', () => {
  if (activeTab === 'tab-grafico') {
    const canvas = document.getElementById('chartCanvas');
    const wrap = document.getElementById('chartWrap');
    canvas.width = wrap.clientWidth;
    canvas.height = wrap.clientHeight;
    drawChart();
  }
  if (activeTab === 'tab-grafmedia') {
    loadMediaGrafico();
  }
});

init();
