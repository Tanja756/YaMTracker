(function () {
  'use strict';

  const orders = new Map();
  const messageMap = new Map();

  const ROW_SELECTOR = '.yamb-message-row';
  const TEXT_SELECTOR = '.yamb-message-text span.text';
  const REPLY_SELECTOR = '.yamb-message-reply';
  const REPLY_DESC_SELECTOR = '.yamb-message-reply__description';
  const CONTENT_SELECTOR = '.yamb-message-content';
  const USER_NAME_SELECTOR = '.yamb-message-user__name';
  const USER_SELECTOR = '.yamb-message-user';

  // ----- Безопасное приведение к строке -----
  function safeStr(value) {
    if (value === null || value === undefined) return '';
    return String(value);
  }

  // ----- Нормализация текста: только русские буквы, нижний регистр -----
  function normalizeText(text) {
    return safeStr(text).replace(/[^а-яё]/gi, '').toLowerCase();
  }

  // ----- Извлечение номера -----
  function extractNumber(text) {
    const m = safeStr(text).match(/(ХК-\d{6}|ЗНО-\d{6})/i);
    return m ? m[0].toUpperCase() : null;
  }

  // ----- Извлечение имени автора -----
  function extractAuthor(row) {
    const nameEl = row.querySelector(USER_NAME_SELECTOR);
    if (nameEl) return nameEl.innerText.trim();
    const userEl = row.querySelector(USER_SELECTOR);
    if (userEl) {
      const aria = userEl.getAttribute('aria-label');
      if (aria) return aria.trim();
    }
    return 'Неизвестно';
  }

  // ----- Обработка строки сообщения -----
  function processRow(row) {
    if (row.dataset.orderProcessed) return;
    row.dataset.orderProcessed = 'true';

    const contentEl = row.querySelector(CONTENT_SELECTOR);
    const tsStr = contentEl ? contentEl.dataset.timestamp : null;
    if (!tsStr) return;
    const timestamp = parseInt(tsStr, 10);
    if (isNaN(timestamp)) return;

    const textEl = row.querySelector(TEXT_SELECTOR);
    const replyEl = row.querySelector(REPLY_SELECTOR);

    const msgText = textEl ? textEl.innerText.trim() : '';
    let replyText = '';
    if (replyEl) {
      const descEl = replyEl.querySelector(REPLY_DESC_SELECTOR);
      replyText = descEl ? descEl.innerText.trim() : '';
    }

    const msgDate = new Date(timestamp / 1000);
    const author = extractAuthor(row);

    messageMap.set(tsStr, {
      timestamp: tsStr,
      text: msgText,
      replyText,
      date: msgDate,
      author,
      row
    });
  }

  // ----- Построение связей с нормализацией текста -----
  function buildReplyLinks() {
    for (const [ts, msg] of messageMap) {
      if (!msg.replyText) continue;

      const normalizedReply = normalizeText(msg.replyText);
      if (!normalizedReply) continue;

      let parentTs = null;
      for (const [pts, pmsg] of messageMap) {
        if (pts === ts) continue;
        if (pmsg.replyText) continue;
        if (pmsg.date >= msg.date) continue;

        const normalizedParent = normalizeText(pmsg.text);
        if (normalizedParent.startsWith(normalizedReply)) {
          if (!parentTs || pmsg.date > messageMap.get(parentTs).date) {
            parentTs = pts;
          }
        }
      }
      msg.parentTimestamp = parentTs || null;
    }
  }

  function collectChain(timestamp, visited = new Set()) {
    if (!messageMap.has(timestamp) || visited.has(timestamp)) return [];
    visited.add(timestamp);
    const msg = messageMap.get(timestamp);
    const children = [];
    for (const [ts, m] of messageMap) {
      if (m.parentTimestamp === timestamp) {
        children.push(ts);
      }
    }
    let chain = [msg];
    for (const childTs of children) {
      chain = chain.concat(collectChain(childTs, visited));
    }
    return chain;
  }

  function updateOrderFromChain(orderNumber) {
    const order = orders.get(orderNumber);
    if (!order || !order.rootTimestamp) return;
    const chain = collectChain(order.rootTimestamp);
    if (chain.length === 0) return;
    let latestMsg = null;
    let latestDate = null;
    for (const msg of chain) {
      if (!latestDate || msg.date > latestDate) {
        latestDate = msg.date;
        latestMsg = msg;
      }
    }
    if (latestMsg) {
      order.closeDate = latestMsg.date;
      order.closeText = latestMsg.text;
      order.closeAuthor = latestMsg.author;
    }
  }

  function tryParseOrder(text, timestamp) {
    if (!/Пятерочка/i.test(text)) return false;
    const number = extractNumber(text);
    if (!number) return false;
    const msg = messageMap.get(timestamp);
    if (!msg) return false;

    const data = {
      number,
      rootTimestamp: timestamp,
      inc: '',
      object: '',
      text: text,            // исходный текст заявки
      rootDate: msg.date,
      deadline: null,
      closeDate: null,
      closeText: '',
      closeAuthor: ''
    };
    const incMatch = text.match(/ИНЦ-\d+(?:-\d+)?|ЗНО-\d{6}/i);
    data.inc = incMatch ? incMatch[0] : '';
    const objMatch = text.match(/Объект обслуживания:\s*(.+?)\s*\|/);
    data.object = objMatch ? objMatch[1].trim() : '';

    const dateMatch = text.match(/Срок:\s*(\d{2}\.\d{2}\.\d{4})\s/);
    if (dateMatch) {
      const parts = dateMatch[1].split('.');
      data.deadline = new Date(parts[2], parts[1] - 1, parts[0]);
    }
    orders.set(number, data);
    return true;
  }

  function analyzeAll() {
    document.querySelectorAll(ROW_SELECTOR).forEach(r => delete r.dataset.orderProcessed);
    messageMap.clear();
    orders.clear();
    document.querySelectorAll(ROW_SELECTOR).forEach(processRow);
    buildReplyLinks();

    for (const [ts, msg] of messageMap) {
      if (!msg.replyText && msg.text) {
        tryParseOrder(msg.text, ts);
      }
    }
    for (const number of orders.keys()) {
      updateOrderFromChain(number);
    }
    renderTable();
  }

  const observer = new MutationObserver(mutations => {
    let needRebuild = false;
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (node.nodeType !== 1) continue;
        if (node.matches && node.matches(ROW_SELECTOR)) {
          processRow(node);
          needRebuild = true;
        }
        if (node.querySelectorAll) {
          const rows = node.querySelectorAll(ROW_SELECTOR);
          if (rows.length) {
            rows.forEach(processRow);
            needRebuild = true;
          }
        }
      }
    }
    if (needRebuild) {
      buildReplyLinks();
      for (const [ts, msg] of messageMap) {
        if (!msg.replyText && msg.text && ![...orders.values()].some(o => o.rootTimestamp === ts)) {
          tryParseOrder(msg.text, ts);
        }
      }
      for (const number of orders.keys()) {
        updateOrderFromChain(number);
      }
      renderTable();
    }
  });

  // ----- UI -----
  let panelVisible = false;
  let selectedMonth = new Date().getMonth();
  let selectedYear = new Date().getFullYear();

  const MONTH_NAMES = [
    'Январь','Февраль','Март','Апрель','Май','Июнь',
    'Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'
  ];

  function createPanel() {
    if (document.getElementById('yamb-orders-panel')) return;
    const panel = document.createElement('div');
    panel.id = 'yamb-orders-panel';
    panel.innerHTML = `
      <style>
        #yamb-orders-panel {
          position: fixed; top: 0; right: 0; width: 780px; height: 100vh;
          background: #fff; box-shadow: -2px 0 10px rgba(0,0,0,0.2);
          z-index: 999999; display: none; flex-direction: column;
          font-family: 'YS Text', sans-serif; font-size: 13px;
          color: #333; overflow-y: auto;
        }
        #yamb-orders-panel.visible { display: flex; }
        #yamb-orders-header {
          padding: 12px 16px; background: #f5f5f5; border-bottom: 1px solid #ddd;
          display: flex; justify-content: space-between; align-items: center;
        }
        #yamb-orders-header button {
          padding: 4px 8px; border: 1px solid #ccc; border-radius: 4px;
          background: white; font-size: 13px; cursor: pointer;
        }
        #yamb-orders-table-wrapper { flex: 1; overflow-y: auto; padding: 8px; }
        table { width: 100%; border-collapse: collapse; font-size: 12px; }
        th, td { padding: 6px 8px; border-bottom: 1px solid #eee; text-align: left; }
        th { background: #fafafa; font-weight: 500; position: sticky; top: 0; }
        .hk { font-weight: 700; white-space: nowrap; }
        .overdue { color: #e53935; }
        .slow-row { background-color: #fff3e0; }
        .close-text { max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; cursor: help; }
        .month-nav { display: flex; align-items: center; gap: 8px; user-select: none; }
        .month-nav span { min-width: 100px; text-align: center; font-weight: 500; }
      </style>
      <div id="yamb-orders-header">
        <strong>📋 Заявки (${orders.size})</strong>
        <div style="display: flex; gap: 8px; align-items: center;">
          <button id="yamb-export-csv">📥 CSV</button>
          <div class="month-nav">
            <button id="yamb-month-prev">◀</button>
            <span id="yamb-month-label">${MONTH_NAMES[selectedMonth]} ${selectedYear}</span>
            <button id="yamb-month-next">▶</button>
          </div>
          <button id="yamb-close-panel">✕</button>
        </div>
      </div>
      <div id="yamb-orders-table-wrapper" style="overflow-y: scroll; max-height: 90vh;">
+++++++
REPLACE

    `;
    document.body.appendChild(panel);

    panel.querySelector('#yamb-close-panel').onclick = () => togglePanel(false);
    panel.querySelector('#yamb-export-csv').onclick = exportCSV;
    panel.querySelector('#yamb-month-prev').onclick = () => changeMonth(-1);
    panel.querySelector('#yamb-month-next').onclick = () => changeMonth(1);
  }

  function changeMonth(delta) {
    selectedMonth += delta;
    if (selectedMonth < 0) {
      selectedMonth = 11;
      selectedYear--;
    } else if (selectedMonth > 11) {
      selectedMonth = 0;
      selectedYear++;
    }
    const label = document.getElementById('yamb-month-label');
    if (label) label.textContent = `${MONTH_NAMES[selectedMonth]} ${selectedYear}`;
    renderTable();
  }

  function togglePanel(visible) {
    panelVisible = visible;
    const panel = document.getElementById('yamb-orders-panel');
    if (panel) panel.classList.toggle('visible', visible);
  }

  function formatDateTime(date) {
    if (!date) return '';
    const dd = String(date.getDate()).padStart(2, '0');
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const yyyy = date.getFullYear();
    const hh = String(date.getHours()).padStart(2, '0');
    const min = String(date.getMinutes()).padStart(2, '0');
    return `${dd}.${mm}.${yyyy} ${hh}:${min}`;
  }

  function calcSpeedHours(order) {
    if (!order.closeDate || !order.rootDate) return null;
    const diffMs = order.closeDate - order.rootDate;
    if (isNaN(diffMs)) return null;
    const hours = diffMs / 3600000;
    return hours.toFixed(2);
  }

  function calcSpeedMinutes(order) {
    if (!order.closeDate || !order.rootDate) return null;
    const diffMs = order.closeDate - order.rootDate;
    if (isNaN(diffMs)) return null;
    return Math.round(diffMs / 60000);
  }

  function isSlow(order) {
    if (!order.closeDate || !order.rootDate) return false;
    const hours = (order.closeDate - order.rootDate) / 3600000;
    return hours > 8;
  }

  function escapeCSV(text) {
    const str = safeStr(text);
    return '"' + str.replace(/"/g, '""') + '"';
  }

  function exportCSV() {
    console.log('[Export] Начало экспорта...');
    try {
      const filtered = Array.from(orders.values()).filter(o =>
        o.rootDate.getMonth() === selectedMonth && o.rootDate.getFullYear() === selectedYear
      );
      console.log('[Export] Найдено заявок:', filtered.length);
      filtered.sort((a, b) => a.rootDate - b.rootDate);

      const header = ['Номер', 'ИНЦ/ЗНО', 'Объект', 'Дата заявки', 'Дата закрытия', 'Скорость (часы)', 'Скорость (мин)', 'Текст закрытия', 'Автор'];

      const rows = filtered.map((o, idx) => {
        try {
          const row = [
            o.number,
            o.inc,
            o.object,
            formatDateTime(o.rootDate),
            o.closeDate ? formatDateTime(o.closeDate) : '',
            calcSpeedHours(o) || '',
            calcSpeedMinutes(o) || '',
            o.closeText,
            o.closeAuthor
          ];
          // Логируем типы для диагностики
          console.log(`[Export] Row ${idx} types:`, row.map(v => typeof v));
          return row.map(escapeCSV).join(',');
        } catch (e) {
          console.error(`[Export] Ошибка при обработке заявки ${o.number}:`, e);
          return '';
        }
      });

      const csv = [header.join(','), ...rows].join('\n');
      const blob = new Blob(['\uFEFF' + csv], {type: 'text/csv;charset=utf-8;'});
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'export.csv';
      a.click();
      URL.revokeObjectURL(url);
      console.log('[Export] Экспорт успешно завершён');
    } catch (e) {
      console.error('[Export] Ошибка при экспорте:', e);
    }
  }

  function renderTable() {
    createPanel();
    const wrapper = document.getElementById('yamb-orders-table-wrapper');
    if (!wrapper) return;
    const filtered = Array.from(orders.values()).filter(o =>
      o.rootDate.getMonth() === selectedMonth && o.rootDate.getFullYear() === selectedYear
    );
    filtered.sort((a, b) => a.rootDate - b.rootDate);
    const html = filtered.length === 0
      ? '<div style="padding:16px;text-align:center;color:#888;">Нет заявок за выбранный месяц</div>'
      : `<table>
          <thead><tr>
            <th>Номер</th><th>ИНЦ/ЗНО</th><th>Объект</th><th>Дата заявки</th><th>Дата закрытия</th><th>Скорость (часы)</th><th>Скорость (мин)</th><th>Текст закрытия</th><th>Автор</th>
          </tr></thead>
          <tbody>
            ${filtered.map(o => {
              const overdue = o.deadline && o.deadline < new Date() && !o.closeDate;
              const slowClass = isSlow(o) ? 'slow-row' : '';
              return `<tr class="${slowClass}">
                <td class="hk">${o.number}</td>
                <td>${o.inc}</td>
                <td>${o.object}</td>
                <td>${formatDateTime(o.rootDate)}</td>
                <td>${o.closeDate ? formatDateTime(o.closeDate) : '—'}</td>
                <td>${calcSpeedHours(o) !== null ? calcSpeedHours(o) : '—'}</td>
                <td>${calcSpeedMinutes(o) !== null ? calcSpeedMinutes(o) : '—'}</td>
                <td class="close-text" title="${escapeHtml(o.closeText)}">${escapeHtml(safeStr(o.closeText).substring(0, 80)) || '—'}</td>
                <td>${escapeHtml(o.closeAuthor) || '—'}</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>`;
    wrapper.innerHTML = html;
    document.getElementById('yamb-orders-header').querySelector('strong').textContent = `📋 Заявки (${orders.size})`;
  }

  function escapeHtml(text) {
    const str = safeStr(text);
    const div = document.createElement('div');
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
  }

  // ----- Связь с фоном -----
  browser.runtime.onMessage.addListener(msg => {
    if (msg.action === 'togglePanel') togglePanel(!panelVisible);
  });

  // ----- Старт -----
  function init() {
    analyzeAll();
    observer.observe(document.body, { childList: true, subtree: true });
    createPanel();
    renderTable();
    setInterval(renderTable, 2000);
  }

  const check = setInterval(() => {
    if (document.querySelector(ROW_SELECTOR)) {
      clearInterval(check);
      init();
    }
  }, 500);
})();