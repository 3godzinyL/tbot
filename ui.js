// ui.js
import winston from 'winston';
import { readIndicatorDB, readTPDB } from './db.js';

// -- LOGGER --
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ timestamp, level, message }) => `${timestamp} ${level}: ${message}`)
  ),
  transports: [
    new winston.transports.File({ filename: 'monitor-error.log', level: 'error' }),
    new winston.transports.File({ filename: 'monitor-combined.log' }),
    new winston.transports.Console(),
  ],
});

// Globalna zmienna – instancja strony Puppeteer
let pageInstance = null;

console.log('Injecting Bot UI...'); // Debug log

/**
 * Funkcja do wstrzykiwania interfejsu UI bota bezpośrednio do strony (przez evaluate).
 * @param {import("puppeteer").Page} page - Instancja strony Puppeteer
 */
export async function injectBotUI(page) {
  pageInstance = page;

  // Nasłuchiwanie logów w konsoli (debug)
  pageInstance.on('console', (msg) => {
    for (let i = 0; i < msg.args().length; ++i) {
      console.log(`PAGE LOG: ${msg.args()[i]}`);
    }
  });

  // Wstrzyknięcie kodu do strony
  await pageInstance.evaluate(() => {

    // Tworzymy globalny obiekt window.indicatorStats (jeśli nie istnieje)
    if (!window.indicatorStats) {
      window.indicatorStats = {
        easy_entry: {},
        ut_bot: {},
        eci_long: {},      // agregat ECI
        eci_long_subv: {   // statystyki sub-wersji (A–E)
          A: {},
          B: {},
          C: {},
          D: {},
          E: {},
        },
        tp: {},
      };
    }

    // Adres serwera (ngrok) – dopasuj do siebie
    window.NGROK_URL = 'https://twoj-ngrok-url.ngrok-free.app';

    // Usuwamy poprzedni przycisk robota (jeśli istniał)
    const oldBtn = document.getElementById('bot-toggle-button');
    if (oldBtn) oldBtn.remove();

    // === Przycisk robocik (otwiera panel główny) ===
    const botBtn = document.createElement('div');
    botBtn.id = 'bot-toggle-button';
    Object.assign(botBtn.style, {
      position: 'fixed',
      top: '10px',
      right: '60px',
      width: '40px',
      height: '40px',
      backgroundColor: '#ffcc00',
      borderRadius: '50%',
      cursor: 'pointer',
      zIndex: '10001',
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      fontSize: '24px',
      color: '#000',
    });
    botBtn.innerText = '🤖';
    document.body.appendChild(botBtn);

    // === Przycisk FUTURES (💹) ===
    const futuresBtn = document.createElement('div');
    futuresBtn.id = 'futures-toggle-button';
    Object.assign(futuresBtn.style, {
      position: 'fixed',
      top: '60px',
      right: '60px',
      width: '40px',
      height: '40px',
      backgroundColor: '#00cc66',
      borderRadius: '50%',
      cursor: 'pointer',
      zIndex: '10001',
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      fontSize: '24px',
      color: '#000',
    });
    futuresBtn.innerText = '💹';
    document.body.appendChild(futuresBtn);

    // === Panel główny (Bot Management) ===
    const mainPanel = document.createElement('div');
    mainPanel.id = 'bot-main-panel';
    Object.assign(mainPanel.style, {
      position: 'fixed',
      top: '60px',
      right: '10px',
      width: '350px',
      height: '700px',
      backgroundColor: '#121212',
      color: 'white',
      zIndex: '10000',
      padding: '20px',
      borderRadius: '10px',
      boxShadow: '0 4px 8px rgba(0,0,0,0.2)',
      fontFamily: 'Arial, sans-serif',
      overflowY: 'auto',
      display: 'none', // ukryty na start
      flexDirection: 'column',
      gap: '15px',
    });

    const panelTitle = document.createElement('h2');
    panelTitle.innerText = 'Bot Management Panel';
    panelTitle.style.color = '#4CAF50';
    panelTitle.style.textAlign = 'center';
    mainPanel.appendChild(panelTitle);

    document.body.appendChild(mainPanel);

    // Klik w robocika – toggle widoczności panelu
    botBtn.addEventListener('click', () => {
      if (mainPanel.style.display === 'none' || mainPanel.style.display === '') {
        mainPanel.style.display = 'flex';
      } else {
        mainPanel.style.display = 'none';
      }
    });

    // === Sekcja statystyk globalnych (db.json) ===
    const statsSection = document.createElement('div');
    statsSection.id = 'stats-section';
    statsSection.innerHTML = `
      <h3 style="color: #4CAF50; margin-bottom: 10px;">Global Statistics</h3>
      <div id="stats-container" style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
        <div>Total Trades:</div><div id="total-trades">0</div>
        <div>Wins:</div><div id="wins">0</div>
        <div>Losses:</div><div id="losses">0</div>
        <div>Win Rate:</div><div id="win-rate">0.00%</div>
        <div>Total Profit:</div><div id="total-profit">0.00</div>
        <div>Avg Win:</div><div id="avg-win">0.00</div>
        <div>Avg Loss:</div><div id="avg-loss">0.00</div>
        <div>Avg Duration:</div><div id="avg-duration">0.00s</div>
        <div>Total Fees:</div><div id="total-fees">0.00</div>
        <div>Avg Fee:</div><div id="avg-fee">0.00</div>
        <div>Total % Profit:</div><div id="total-percent-profit">0.00</div>
        <div>Avg % Profit:</div><div id="avg-percent-profit">0.00</div>
        <div>Combined Balance:</div><div id="combined-balance" style="color:lime;font-weight:bold;">0.00</div>
        <div>Used Margin:</div><div id="used-margin">0.00</div>
        <div>Margin Usage:</div><div id="margin-usage">0.00%</div>
      </div>
    `;
    mainPanel.appendChild(statsSection);

    // === Open Trades (otwarte transakcje) ===
    const openTradesSection = document.createElement('div');
    openTradesSection.id = 'open-trades-section';
    openTradesSection.innerHTML = `
      <h3 style="color: #4CAF50;">Open Trades</h3>
      <div id="open-trades" style="border: 1px solid #4CAF50; border-radius: 5px; padding: 10px; max-height: 200px; overflow-y: auto; background-color: #1e1e1e;"></div>
    `;
    mainPanel.appendChild(openTradesSection);

    // === Closed Trades (history) ===
    const historySection = document.createElement('div');
    historySection.id = 'history-section';
    historySection.innerHTML = `
      <h3 style="color: #4CAF50;">Trade History (Closed)</h3>
      <div id="trade-history" style="border: 1px solid #4CAF50; border-radius: 5px; padding: 10px; max-height: 200px; overflow-y: auto; background-color: #1e1e1e;"></div>
    `;
    mainPanel.appendChild(historySection);

    // === Kontener do wyboru wskaźnika (Indicator) ===
    const indicatorContainer = document.createElement('div');
    Object.assign(indicatorContainer.style, {
      display: 'flex',
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    });
    indicatorContainer.innerHTML = `<label style="color:white;">Indicator:</label>`;

    const indicatorSelect = document.createElement('select');
    indicatorSelect.id = 'indicator-select';
    Object.assign(indicatorSelect.style, {
      width: '150px',
      backgroundColor: '#333',
      color: '#fff',
      border: '1px solid #4CAF50',
      borderRadius: '5px',
      padding: '2px 5px',
    });

    // Opcje w select
    const opt1 = document.createElement('option');
    opt1.value = 'easy_entry';
    opt1.innerText = 'Easy Entry';
    indicatorSelect.appendChild(opt1);

    const opt2 = document.createElement('option');
    opt2.value = 'ut_bot';
    opt2.innerText = 'UT Bot';
    indicatorSelect.appendChild(opt2);

    const opt3 = document.createElement('option');
    opt3.value = 'eci_long';
    opt3.innerText = 'ECI-Long';
    indicatorSelect.appendChild(opt3);

    indicatorContainer.appendChild(indicatorSelect);

    // Przycisk "🗔" – otwiera okno easy/ut
    const createWindowBtn = document.createElement('button');
    createWindowBtn.innerText = '🗔';
    createWindowBtn.title = 'Open new window for indicator';
    Object.assign(createWindowBtn.style, {
      cursor: 'pointer',
      backgroundColor: '#4CAF50',
      border: 'none',
      color: '#fff',
      borderRadius: '5px',
      padding: '2px 5px',
      marginLeft: '5px',
    });
    indicatorContainer.appendChild(createWindowBtn);

    // Przycisk "📈" – otwiera TP panel
    const tpWindowBtn = document.createElement('button');
    tpWindowBtn.innerText = '📈';
    tpWindowBtn.title = 'Open TP window';
    Object.assign(tpWindowBtn.style, {
      cursor: 'pointer',
      backgroundColor: '#4CAF50',
      border: 'none',
      color: '#fff',
      borderRadius: '5px',
      padding: '2px 5px',
      marginLeft: '5px',
    });
    indicatorContainer.appendChild(tpWindowBtn);

    // Przycisk "Szczegóły ECI" (tylko gdy indicator=eci_long)
    const eciDetailsBtn = document.createElement('button');
    eciDetailsBtn.innerText = 'Szczegóły ECI';
    Object.assign(eciDetailsBtn.style, {
      cursor: 'pointer',
      backgroundColor: '#777',
      border: 'none',
      color: '#fff',
      borderRadius: '5px',
      padding: '2px 5px',
      marginLeft: '5px',
      display: 'none',
    });
    indicatorContainer.appendChild(eciDetailsBtn);

    // Po zmianie select => pokaz/ukryj "Szczegóły ECI"
    indicatorSelect.addEventListener('change', () => {
      if (indicatorSelect.value === 'eci_long') {
        eciDetailsBtn.style.display = 'inline-block';
      } else {
        eciDetailsBtn.style.display = 'none';
      }
    });

    mainPanel.appendChild(indicatorContainer);

    // ========== PANEL FUTURES (💹) ==========
    const futuresPanel = document.createElement('div');
    futuresPanel.id = 'futures-panel';
    Object.assign(futuresPanel.style, {
      position: 'fixed',
      top: '120px',
      right: '10px',
      width: '350px',
      height: '400px',
      backgroundColor: '#0a0a0a',
      color: 'white',
      zIndex: '10000',
      padding: '20px',
      borderRadius: '10px',
      boxShadow: '0 4px 8px rgba(0,0,0,0.2)',
      fontFamily: 'Arial, sans-serif',
      overflowY: 'auto',
      display: 'none',
      flexDirection: 'column',
      gap: '10px',
    });
    document.body.appendChild(futuresPanel);

    const futTitle = document.createElement('h2');
    futTitle.innerText = 'Futures Trade Panel';
    futTitle.style.color = '#00cc66';
    futTitle.style.textAlign = 'center';
    futuresPanel.appendChild(futTitle);

    // Przycisk "Połącz z giełdą"
    const connectBtn = document.createElement('button');
    connectBtn.innerText = 'Połącz z giełdą (Binance Futures)';
    Object.assign(connectBtn.style, {
      backgroundColor: '#4CAF50',
      border: 'none',
      padding: '10px',
      borderRadius: '5px',
      color: 'white',
    });
    futuresPanel.appendChild(connectBtn);

    const futuresBalInfo = document.createElement('div');
    futuresBalInfo.innerText = 'Saldo Portfela Futures: ... USDT';
    const totalBalInfo = document.createElement('div');
    totalBalInfo.innerText = 'Łączne saldo: ... USDT';
    futuresPanel.appendChild(futuresBalInfo);
    futuresPanel.appendChild(totalBalInfo);

    connectBtn.addEventListener('click', async () => {
      try {
        const balancesUrl = `${window.NGROK_URL}/api/balances`;
        const rBal = await fetch(balancesUrl, {
          headers: { 'ngrok-skip-browser-warning': '1' },
        });
        if (!rBal.ok) {
          throw new Error(`Error fetch balances: ${rBal.status}`);
        }
        const bData = await rBal.json();
        futuresBalInfo.innerText = `Saldo Portfela Futures: ${bData.futures} USDT`;
        totalBalInfo.innerText = `Łączne saldo: ${bData.total} USDT`;
      } catch (err) {
        console.error(err);
        futuresBalInfo.innerText = 'Błąd pobierania salda Futures.';
        totalBalInfo.innerText = 'Błąd pobierania łącznego salda.';
      }
    });

    // Checkbox AutoTrade
    const autoTradeContainer = document.createElement('div');
    autoTradeContainer.style.marginTop = '10px';
    const autoTradeToggle = document.createElement('input');
    autoTradeToggle.type = 'checkbox';
    autoTradeToggle.id = 'auto-trade-toggle';
    autoTradeToggle.checked = false;
    const autoTradeLabel = document.createElement('label');
    autoTradeLabel.htmlFor = 'auto-trade-toggle';
    autoTradeLabel.innerText = ' Auto Trade';
    autoTradeLabel.style.marginLeft = '10px';
    autoTradeContainer.appendChild(autoTradeToggle);
    autoTradeContainer.appendChild(autoTradeLabel);
    futuresPanel.appendChild(autoTradeContainer);

    autoTradeToggle.addEventListener('change', async (e) => {
      const isOn = e.target.checked;
      try {
        const resp = await fetch(`${window.NGROK_URL}/api/update-settings`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'ngrok-skip-browser-warning': '1',
          },
          body: JSON.stringify({ autoTrade: isOn }),
        });
        const d = await resp.json();
        if (d.message === 'Settings updated.') {
          alert('Auto Trade został zaktualizowany.');
        } else {
          alert(`Błąd: ${d.message}`);
        }
      } catch (er) {
        console.error(er);
        alert('Błąd przy update autoTrade.');
      }
    });

    // Ręczne otwieranie trade
    const manualTradeBtn = document.createElement('button');
    manualTradeBtn.innerText = 'Ręcznie Otwórz Trade';
    Object.assign(manualTradeBtn.style, {
      backgroundColor: '#008CBA',
      border: 'none',
      padding: '10px',
      borderRadius: '5px',
      color: 'white',
      marginTop: '10px',
    });
    futuresPanel.appendChild(manualTradeBtn);

    manualTradeBtn.addEventListener('click', () => {
      const type = prompt('Typ Trade (buy/sell)?')?.toLowerCase();
      if (!['buy', 'sell'].includes(type)) {
        alert('Niepoprawny typ.');
        return;
      }
      const symbol = prompt('Symbol (np. BTCUSDT):')?.toUpperCase();
      if (!symbol) {
        alert('Symbol jest wymagany.');
        return;
      }
      const startNow = confirm('Start od razu (OK=market)?');
      let price = 0;
      if (!startNow) {
        price = parseFloat(prompt('Cena startowa:') || '0');
        if (isNaN(price) || !price) {
          alert('Niepoprawna cena.');
          return;
        }
      }
      const qty = parseFloat(prompt('Ilość:') || '0');
      if (isNaN(qty) || qty <= 0) {
        alert('Niepoprawna ilość.');
        return;
      }
      const lev = parseInt(prompt('Dźwignia (np.125):') || '125', 10) || 125;
      const indicator = prompt('Indicator (easy_entry, ut_bot, eci_long):')?.toLowerCase();
      if (!['easy_entry', 'ut_bot', 'eci_long'].includes(indicator)) {
        alert('Niepoprawny wskaźnik.');
        return;
      }
      const isReal = confirm('Realny trade? (OK) czy papierowy (Anuluj)?');
      const endpoint = isReal ? '/api/open-exchange-trade' : '/api/open-paper-trade';

      fetch(`${window.NGROK_URL}${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'ngrok-skip-browser-warning': '1',
        },
        body: JSON.stringify({
          type,
          symbol,
          price: price || null,
          quantity: qty,
          leverage: lev,
          indicator,
        }),
      })
        .then((r) => r.json())
        .then((data) => {
          if (data.message?.includes('trade started')) {
            alert('Trade otwarty pomyślnie.');
          } else {
            alert(`Błąd: ${data.message}`);
          }
        })
        .catch((err) => {
          console.error('Error opening trade:', err);
          alert('Błąd przy otwieraniu trade.');
        });
    });

    const futOpenTrades = document.createElement('div');
    futOpenTrades.id = 'open-trades-futures';
    futOpenTrades.innerText = 'Otwarte Trade: ...';
    futuresPanel.appendChild(futOpenTrades);

    const futLastTrades = document.createElement('div');
    futLastTrades.id = 'last-trades';
    futLastTrades.innerText = 'Ostatnie Trade: ...';
    futuresPanel.appendChild(futLastTrades);

    // Klik w przycisk futures => toggle widoczności
    futuresBtn.addEventListener('click', () => {
      if (futuresPanel.style.display === 'none' || futuresPanel.style.display === '') {
        futuresPanel.style.display = 'flex';
      } else {
        futuresPanel.style.display = 'none';
      }
    });

    // ----------------------------------------------------------------------
    // updateOpenTrades, updateTradeHistory => do pokazywania listy trade'ów
    // ----------------------------------------------------------------------

    window.updateOpenTrades = (openTrades) => {
      const c = document.getElementById('open-trades');
      if (!c) return;
      c.innerHTML = '';
      openTrades.forEach((trade) => {
        const div = document.createElement('div');
        const tInd = trade.indicator ? trade.indicator.toUpperCase() : 'UNKNOWN';
        const tType = trade.type ? trade.type.toUpperCase() : 'UNKNOWN';
        div.innerText = `${tInd} ${tType} - ${trade.symbol} @ ${trade.price}, Qty: ${trade.quantity}`;
        div.style.color = (trade.type === 'sell') ? '#f44336' : '#4CAF50';
        div.style.marginBottom = '5px';
        c.prepend(div);
      });
    };

    window.updateTradeHistory = (closedTrades) => {
      const c = document.getElementById('trade-history');
      if (!c) return;
      c.innerHTML = '';
      closedTrades.forEach((trade) => {
        const div = document.createElement('div');
        const tInd = trade.indicator ? trade.indicator.toUpperCase() : 'UNKNOWN';
        const tType = trade.type ? trade.type.toUpperCase() : 'UNKNOWN';
        const exitPrice = trade.exitPrice != null ? trade.exitPrice : 'N/A';
        const dur = trade.duration != null ? `${trade.duration}s` : 'N/A';
        const prof = trade.profit != null ? parseFloat(trade.profit).toFixed(2) : 'N/A';
        const fe = trade.fee != null ? parseFloat(trade.fee).toFixed(2) : 'N/A';

        div.innerText = `${tInd} ${tType} - ${trade.symbol} @ ${trade.price} | Exit: ${exitPrice} | Duration: ${dur} | Profit: ${prof} | Fee: ${fe}`;

        if (trade.profit != null) {
          // Kolor profitu: zielony, jeśli > 0, czerwony jeśli <= 0
          if (trade.profit > 0) {
            div.style.color = 'lime';
          } else {
            div.style.color = '#f44336';
          }
        } else {
          // Domyślnie
          div.style.color = '#ccc';
        }

        div.style.marginBottom = '5px';
        c.prepend(div);
      });
    };

    // ----------------------------------------------------------------------
    // updateEciSubversionStats => wypełnienie sub-wersji A–E
    // ----------------------------------------------------------------------
    window.updateEciSubversionStats = (version, stats) => {
      const containerId = `eci_long_${version}-stats`;
      const container = document.getElementById(containerId);
      if (!container) return;

      const currentB = stats.currentBalance ?? 0;
      const initialB = stats.initialBalance ?? 0;  
      const balanceGains = currentB - initialB;

      container.innerHTML = `
        <div>Total Trades:</div><div>${stats.totalTrades ?? 0}</div>
        <div>Wins:</div><div>${stats.wins ?? 0}</div>
        <div>Losses:</div><div>${stats.losses ?? 0}</div>
        <div>Win Rate:</div><div>${(stats.winRate ?? 0).toFixed(2)}%</div>
        <div>Total Profit:</div><div>${(stats.totalProfit ?? 0).toFixed(2)}</div>
        <div>Avg Win:</div><div>${(stats.avgWin ?? 0).toFixed(2)}</div>
        <div>Avg Loss:</div><div>${(stats.avgLoss ?? 0).toFixed(2)}</div>
        <div>Total % Profit:</div><div>${(stats.totalPercentProfit ?? 0).toFixed(2)}</div>
        <div>Avg % Profit:</div><div>${(stats.avgPercentProfit ?? 0).toFixed(2)}</div>
        <div>Avg Duration:</div><div>${(stats.avgDuration ?? 0).toFixed(2)}s</div>
        <div>Total Fees:</div><div>${(stats.totalFees ?? 0).toFixed(2)}</div>
        <div>Avg Fee:</div><div>${(stats.avgFee ?? 0).toFixed(2)}</div>

        <!-- Bieżące saldo sub-wersji: -->
        <div>Current Balance:</div>
        <div id="eci_long_${version}-currBal" style="color:lime;font-weight:bold;">
          ${currentB.toFixed(2)}
        </div>

        <!-- Balance Gains (może być ujemny): -->
        <div>Balance Gains:</div>
        <div id="eci_long_${version}-gains-val">${balanceGains.toFixed(2)}</div>
      `;

      // Koloruj Gains na zielono/czerwono:
      const gainsDiv = document.getElementById(`eci_long_${version}-gains-val`);
      if (gainsDiv) {
        if (balanceGains < 0) {
          gainsDiv.style.color = 'red';
        } else if (balanceGains > 0) {
          gainsDiv.style.color = 'lime';
        } else {
          gainsDiv.style.color = '#ccc';
        }
        gainsDiv.style.fontWeight = 'bold';
      }
    };

    // ----------------------------------------------------------------------
    // updateStats => wypełnienie głównych statystyk globalnych (db.json)
    // ----------------------------------------------------------------------
    window.updateStats = (st) => {
      document.getElementById('total-trades').innerText = st.totalTrades || 0;
      document.getElementById('wins').innerText = st.wins || 0;
      document.getElementById('losses').innerText = st.losses || 0;
      document.getElementById('win-rate').innerText = `${(st.winRate || 0).toFixed(2)}%`;
      document.getElementById('total-profit').innerText = (st.totalProfit || 0).toFixed(2);
      document.getElementById('avg-win').innerText = (st.avgWin || 0).toFixed(2);
      document.getElementById('avg-loss').innerText = (st.avgLoss || 0).toFixed(2);
      document.getElementById('avg-duration').innerText = `${(st.avgDuration || 0).toFixed(2)}s`;
      document.getElementById('total-fees').innerText = (st.totalFees || 0).toFixed(2);
      document.getElementById('avg-fee').innerText = (st.avgFee || 0).toFixed(2);
      document.getElementById('total-percent-profit').innerText = (st.totalPercentProfit || 0).toFixed(2);
      document.getElementById('avg-percent-profit').innerText = (st.avgPercentProfit || 0).toFixed(2);

      // Combined Balance - na zielono
      const cb = document.getElementById('combined-balance');
      if (cb) {
        cb.innerText = (st.combinedBalance || 0).toFixed(2);
        cb.style.color = 'lime';
        cb.style.fontWeight = 'bold';
      }

      document.getElementById('used-margin').innerText = (st.totalUsedMargin || 0).toFixed(2);
      document.getElementById('margin-usage').innerText = `${(st.marginUsagePercent || 0).toFixed(2)}%`;
    };

    // ----------------------------------------------------------------------
    // updateTpStats => wypełnienie statów TP
    // ----------------------------------------------------------------------
    window.updateTpStats = (tp) => {
      const e = tp.easy_entry;
      const u = tp.ut_bot;
      if (e) {
        [
          'totalTpTrades','tpWins','tpLosses','tpWinRate','tpTotalProfit',
          'tpAvgProfit','tpAvgTrend','tpAvgDuration'
        ].forEach((f)=>{
          const el = document.getElementById(`tp-easy_entry-${f}`);
          if (el) {
            const val = e[f];
            el.innerText = isNaN(val) ? 'N/A' : parseFloat(val).toFixed(2);
          }
        });
      }
      if (u) {
        [
          'totalTpTrades','tpWins','tpLosses','tpWinRate','tpTotalProfit',
          'tpAvgProfit','tpAvgTrend','tpAvgDuration'
        ].forEach((f)=>{
          const el = document.getElementById(`tp-ut_bot-${f}`);
          if (el) {
            const val = u[f];
            el.innerText = isNaN(val) ? 'N/A' : parseFloat(val).toFixed(2);
          }
        });
      }
    };

    // Tworzenie okna easy_entry/ut_bot
    function createIndicatorWindow(ind) {
      if (document.querySelector(`.indicator-window[data-indicator="${ind}"]`)) {
        alert(`Okno ${ind} już otwarte.`);
        return;
      }
      const w = document.createElement('div');
      w.className = 'indicator-window';
      w.dataset.indicator = ind;
      Object.assign(w.style, {
        position: 'fixed',
        top: '200px',
        left: '200px',
        width: '400px',
        height: '500px',
        backgroundColor: '#333',
        color: '#fff',
        zIndex: '10000',
        border: '1px solid #4CAF50',
        borderRadius: '10px',
        boxShadow: '0 8px 16px rgba(0,0,0,0.6)',
        display: 'flex',
        flexDirection: 'column',
      });
      const h = document.createElement('div');
      Object.assign(h.style, {
        background: '#444',
        padding: '8px',
        cursor: 'move',
        userSelect: 'none',
        borderTopLeftRadius: '10px',
        borderTopRightRadius: '10px',
        fontWeight: 'bold',
      });
      if (ind === 'easy_entry') {
        h.innerText = 'Easy Entry Panel';
      } else if (ind === 'ut_bot') {
        h.innerText = 'UT Bot Panel';
      } else {
        h.innerText = `${ind.toUpperCase()} Panel`;
      }
      w.appendChild(h);

      const c = document.createElement('div');
      c.style.flex = '1';
      c.style.overflow = 'auto';
      c.style.padding = '10px';
      c.innerHTML = `<h3 style="color:#4CAF50;margin-top:0;">${ind.toUpperCase()} Panel</h3><p>...</p>`;
      w.appendChild(c);

      const f = document.createElement('div');
      Object.assign(f.style, {
        padding: '5px',
        textAlign: 'right',
        borderBottomLeftRadius: '10px',
        borderBottomRightRadius: '10px',
      });
      const cls = document.createElement('button');
      cls.innerText = 'Close';
      Object.assign(cls.style, {
        backgroundColor: '#f44336',
        color: '#fff',
        border: 'none',
        padding: '5px 10px',
        borderRadius: '5px',
      });
      cls.onclick = () => w.remove();
      f.appendChild(cls);
      w.appendChild(f);

      let offX, offY;
      h.addEventListener('mousedown', (e) => {
        offX = e.clientX - w.getBoundingClientRect().left;
        offY = e.clientY - w.getBoundingClientRect().top;
        document.addEventListener('mousemove', moveWin);
        document.addEventListener('mouseup', stopMove);
      });
      function moveWin(e) {
        e.preventDefault();
        w.style.left = `${e.clientX - offX}px`;
        w.style.top = `${e.clientY - offY}px`;
      }
      function stopMove() {
        document.removeEventListener('mousemove', moveWin);
        document.removeEventListener('mouseup', stopMove);
      }
      document.body.appendChild(w);
    }

    createWindowBtn.addEventListener('click', () => {
      const indVal = indicatorSelect.value;
      if (indVal === 'easy_entry' || indVal === 'ut_bot') {
        createIndicatorWindow(indVal);
      }
    });

    // Tworzymy okno TP
    function createTpWindow() {
      if (document.querySelector('.tp-window')) {
        alert('Okno TP już otwarte.');
        return;
      }
      const w = document.createElement('div');
      w.className = 'tp-window';
      w.dataset.indicator = 'tp';
      Object.assign(w.style, {
        position: 'fixed',
        top: '200px',
        left: '600px',
        width: '400px',
        height: '600px',
        backgroundColor: '#333',
        color: '#fff',
        zIndex: '10000',
        border: '1px solid #4CAF50',
        borderRadius: '10px',
        boxShadow: '0 8px 16px rgba(0,0,0,0.6)',
        display: 'flex',
        flexDirection: 'column',
      });

      const h = document.createElement('div');
      Object.assign(h.style, {
        background: '#444',
        padding: '8px',
        cursor: 'move',
        userSelect: 'none',
        borderTopLeftRadius: '10px',
        borderTopRightRadius: '10px',
        fontWeight: 'bold',
      });
      h.innerText = 'TP Panel';
      w.appendChild(h);

      const c = document.createElement('div');
      c.style.flex = '1';
      c.style.overflow = 'auto';
      c.style.padding = '10px';
      c.innerHTML = `
        <h3 style="color:#4CAF50;margin-top:0;">TP Statistics</h3>
        <h4 style="color:#FFD700;">Easy Entry</h4>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:5px;" id="tp-easy_entry-stats">
          <div>Total TP Trades:</div><div id="tp-easy_entry-totalTpTrades">0</div>
          <div>Wins:</div><div id="tp-easy_entry-tpWins">0</div>
          <div>Losses:</div><div id="tp-easy_entry-tpLosses">0</div>
          <div>Win Rate:</div><div id="tp-easy_entry-tpWinRate">0.00%</div>
          <div>Total Profit:</div><div id="tp-easy_entry-tpTotalProfit">0.00</div>
          <div>Avg Profit:</div><div id="tp-easy_entry-tpAvgProfit">0.00</div>
          <div>Avg Trend:</div><div id="tp-easy_entry-tpAvgTrend">0.00</div>
          <div>Avg Duration:</div><div id="tp-easy_entry-tpAvgDuration">0.00s</div>
        </div>
        <h4 style="color:#FFD700;">UT Bot</h4>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:5px;" id="tp-ut_bot-stats">
          <div>Total TP Trades:</div><div id="tp-ut_bot-totalTpTrades">0</div>
          <div>Wins:</div><div id="tp-ut_bot-tpWins">0</div>
          <div>Losses:</div><div id="tp-ut_bot-tpLosses">0</div>
          <div>Win Rate:</div><div id="tp-ut_bot-tpWinRate">0.00%</div>
          <div>Total Profit:</div><div id="tp-ut_bot-tpTotalProfit">0.00</div>
          <div>Avg Profit:</div><div id="tp-ut_bot-tpAvgProfit">0.00</div>
          <div>Avg Trend:</div><div id="tp-ut_bot-tpAvgTrend">0.00</div>
          <div>Avg Duration:</div><div id="tp-ut_bot-tpAvgDuration">0.00s</div>
        </div>
      `;
      w.appendChild(c);

      const f = document.createElement('div');
      Object.assign(f.style, {
        padding: '5px',
        textAlign: 'right',
        borderBottomLeftRadius: '10px',
        borderBottomRightRadius: '10px',
      });
      const cls = document.createElement('button');
      cls.innerText = 'Close';
      Object.assign(cls.style, {
        backgroundColor: '#f44336',
        color: '#fff',
        border: 'none',
        padding: '5px 10px',
        borderRadius: '5px',
      });
      cls.onclick = () => w.remove();
      f.appendChild(cls);
      w.appendChild(f);

      let offX, offY;
      h.addEventListener('mousedown', (e) => {
        offX = e.clientX - w.getBoundingClientRect().left;
        offY = e.clientY - w.getBoundingClientRect().top;
        document.addEventListener('mousemove', moveIt);
        document.addEventListener('mouseup', stopIt);
      });
      function moveIt(e) {
        w.style.left = `${e.clientX - offX}px`;
        w.style.top = `${e.clientY - offY}px`;
      }
      function stopIt() {
        document.removeEventListener('mousemove', moveIt);
        document.removeEventListener('mouseup', stopIt);
      }
      document.body.appendChild(w);

      // Po otwarciu – wypełniamy statystyki (o ile już mamy je w window)
      const st = window.indicatorStats.tp;
      if (st && window.updateTpStats) {
        window.updateTpStats(st);
      }

      // Słuchamy eventu indicatorStatsUpdated => odśwież
      window.addEventListener('indicatorStatsUpdated', (evt) => {
        if (evt.detail.tp && window.updateTpStats) {
          window.updateTpStats(evt.detail.tp);
        }
      });
    }

    tpWindowBtn.addEventListener('click', () => {
      createTpWindow();
    });

    // === Szczegółowy panel ECI (A–E) ===
    function createEciDetailsWindow() {
      if (document.getElementById('eci-details-window')) {
        return; // już otwarte
      }
      const w = document.createElement('div');
      w.id = 'eci-details-window';
      Object.assign(w.style, {
        position: 'fixed',
        top: '200px',
        left: '400px',
        width: '600px',
        height: '600px',
        backgroundColor: '#222',
        color: '#fff',
        zIndex: '10000',
        border: '1px solid #4CAF50',
        borderRadius: '10px',
        boxShadow: '0 8px 16px rgba(0,0,0,0.6)',
        display: 'flex',
        flexDirection: 'column',
      });
      const h = document.createElement('div');
      Object.assign(h.style, {
        background: '#444',
        padding: '8px',
        cursor: 'move',
        userSelect: 'none',
        borderTopLeftRadius: '10px',
        borderTopRightRadius: '10px',
        fontWeight: 'bold',
        position: 'relative',
      });
      h.innerText = 'ECI-Long - Szczegóły (A/B/C/D/E)';
      w.appendChild(h);

      // Dodaj przycisk "Wykres Salda" w prawym górnym rogu panelu ECI
      const chartBtn = document.createElement('button');
      chartBtn.innerText = 'Wykres Salda';
      Object.assign(chartBtn.style, {
        position: 'absolute',
        top: '5px',
        right: '5px',
        backgroundColor: '#00bcd4',
        color: '#fff',
        border: 'none',
        padding: '5px 10px',
        borderRadius: '5px',
        cursor: 'pointer',
      });
      chartBtn.addEventListener('click', () => {
        createEciChartWindow(); // Funkcja, która otworzy nowe okienko z wykresem
      });
      h.appendChild(chartBtn);

      const c = document.createElement('div');
      c.style.flex = '1';
      c.style.overflow = 'auto';
      c.style.padding = '10px';

      // Łączne statystyki ECI
      c.innerHTML = `
        <h3 style="color:#4CAF50;margin-top:0;">Łączne Statystyki ECI</h3>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:5px;" id="eci_long-detailed-stats">

          <div>Total Trades:</div><div id="eci_long-total-trades-detailed">0</div>
          <div>Wins:</div><div id="eci_long-wins-detailed">0</div>
          <div>Losses:</div><div id="eci_long-losses-detailed">0</div>
          <div>Win Rate:</div><div id="eci_long-win-rate-detailed">0.00%</div>
          <div>Total Profit:</div><div id="eci_long-total-profit-detailed">0.00</div>
          <div>Avg Win:</div><div id="eci_long-avg-win-detailed">0.00</div>
          <div>Avg Loss:</div><div id="eci_long-avg-loss-detailed">0.00</div>
          <div>Total % Profit:</div><div id="eci_long-total-percent-profit-detailed">0.00</div>
          <div>Avg % Profit:</div><div id="eci_long-avg-percent-profit-detailed">0.00</div>
          <div>Avg Duration:</div><div id="eci_long-avg-duration-detailed">0.00s</div>
          <div>Total Fees:</div><div id="eci_long-total-fees-detailed">0.00</div>
          <div>Avg Fee:</div><div id="eci_long-avg-fee-detailed">0.00</div>

          <div>Current Balance (łączne):</div><div id="eci_long-current-balance-detailed" style="color:lime;font-weight:bold;">0.00</div>
          <div>Max Balance:</div><div id="eci_long-max-balance-detailed">0.00</div>
          <div>Min Balance:</div><div id="eci_long-min-balance-detailed">0.00</div>
          <div>Margin Usage:</div><div id="eci_long-margin-usage-detailed">0.00%</div>
          <div>Used Margin:</div><div id="eci_long-used-margin-detailed">0.00</div>

          <div>Max Drawdown:</div><div id="eci_long-max-drawdown-detailed">0.00%</div>
          <div>Profit Factor:</div><div id="eci_long-profit-factor-detailed">0.00</div>
        </div>
        <hr style="margin:10px 0;border:0;border-top:1px solid #555;">
      `;

      ['A','B','C','D','E'].forEach(ver => {
        const sub = document.createElement('div');
        sub.style.marginTop = '10px';
        sub.innerHTML = `
          <h3 style="color:#FFD700;">ECI ${ver}</h3>
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:5px;align-items:center;">
            <div>Dźwignia (0-125x):</div>
            <input type="range" id="eci_long_${ver}-leverage-slider" min="0" max="125" step="1" style="width:120px;">
            <span id="eci_long_${ver}-leverage-val" style="color:#FFD700;font-weight:bold;">--</span>

            <div>Saldo (%) (0-100):</div>
            <input type="range" id="eci_long_${ver}-balance-slider" min="0" max="100" step="1" style="width:120px;">
            <span id="eci_long_${ver}-balance-val" style="color:#FFD700;font-weight:bold;">--</span>
          </div>

          <div style="margin-top:5px; display:grid;grid-template-columns:1fr 1fr;gap:5px;"
               id="eci_long_${ver}-stats"></div>

          <button id="eci_long_${ver}-reset"
                  style="margin-top:5px;background:#f44336;color:#fff;border:none;padding:3px 8px;border-radius:5px;cursor:pointer;">
            Reset ECI ${ver}
          </button>
          <hr>
        `;
        c.appendChild(sub);

        // Suwaki A–E + wczytywanie settings
        const levSlider = sub.querySelector(`#eci_long_${ver}-leverage-slider`);
        const levVal = sub.querySelector(`#eci_long_${ver}-leverage-val`);
        const balSlider = sub.querySelector(`#eci_long_${ver}-balance-slider`);
        const balVal = sub.querySelector(`#eci_long_${ver}-balance-val`);

        const subversSettings = window.indicatorStats.eci_long_settings || {};
        const subKey = 'eci_long' + ver;
        const config = subversSettings[subKey] || {};

        const storedLev = parseInt(config.leverage ?? '80', 10);
        const storedPct = parseInt(config.tradePercent ?? '10', 10);
        levSlider.value = storedLev;
        levVal.textContent = `${storedLev}x`;
        balSlider.value = storedPct;
        balVal.textContent = `${storedPct}%`;

        // Każda sub-wersja osobno (usuwamy stare powiązanie z forEach B,C,D,E)
        const saveSubEciSettings = async (versionKey, newLev, newPct) => {
          // Tylko dla jednego subKey
          const bodyData = {};
          bodyData[versionKey] = { leverage: newLev, tradePercent: newPct };
          try {
            const r = await fetch(`${window.NGROK_URL}/api/update-eci-settings`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'ngrok-skip-browser-warning': '1',
              },
              body: JSON.stringify(bodyData),
            });
            if (!r.ok) throw new Error('Failed to save ECI sub-version settings');
            const response = await r.json();
            if (response.message === 'ECI settings updated.') {
              console.log(`ECI sub-version ${versionKey} settings saved successfully.`);
            } else {
              console.error('Error saving ECI settings:', response.message);
            }
          } catch (er) {
            console.error(er);
            alert(`Error: ${er.message}`);
          }
        };

        levSlider.addEventListener('input', async (ev) => {
          const newLev = parseInt(ev.target.value, 10) || 0;
          levVal.textContent = `${newLev}x`;
          const currentPct = parseInt(balSlider.value, 10) || 10;
          await saveSubEciSettings(subKey, newLev, currentPct);
        });

        balSlider.addEventListener('input', async (ev) => {
          const newBal = parseInt(ev.target.value, 10) || 0;
          balVal.textContent = `${newBal}%`;
          const currentLev = parseInt(levSlider.value, 10) || 80;
          await saveSubEciSettings(subKey, currentLev, newBal);
        });

        const rstBtn = sub.querySelector(`#eci_long_${ver}-reset`);
        rstBtn.onclick = async () => {
          const ok = confirm(`Na pewno zresetować ECI ${ver}?`);
          if (!ok) return;
          try {
            const r = await fetch(`${window.NGROK_URL}/api/reset-eci-subversion`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'ngrok-skip-browser-warning': '1',
              },
              body: JSON.stringify({ version: ver }),
            });
            if (!r.ok) throw new Error('Failed to reset subversion');
            alert(`Statystyki ECI ${ver} zresetowane`);
            window.location.reload();
          } catch (er) {
            console.error(er);
            alert(`Błąd: ${er.message}`);
          }
        };
      });

      w.appendChild(c);

      const f = document.createElement('div');
      Object.assign(f.style, {
        padding: '5px',
        textAlign: 'right',
        borderBottomLeftRadius: '10px',
        borderBottomRightRadius: '10px',
      });
      const closeB = document.createElement('button');
      closeB.innerText = 'Close';
      Object.assign(closeB.style, {
        backgroundColor: '#f44336',
        color: '#fff',
        border: 'none',
        padding: '5px 10px',
        borderRadius: '5px',
      });
      closeB.onclick = () => w.remove();
      f.appendChild(closeB);
      w.appendChild(f);

      let offX, offY;
      h.addEventListener('mousedown', (e) => {
        offX = e.clientX - w.getBoundingClientRect().left;
        offY = e.clientY - w.getBoundingClientRect().top;
        document.addEventListener('mousemove', moveWin);
        document.addEventListener('mouseup', stopMove);
      });
      function moveWin(e) {
        e.preventDefault();
        w.style.left = `${e.clientX - offX}px`;
        w.style.top = `${e.clientY - offY}px`;
      }
      function stopMove() {
        document.removeEventListener('mousemove', moveWin);
        document.removeEventListener('mouseup', stopMove);
      }
      document.body.appendChild(w);

      // Funkcja do wypełnienia statów w ECI panelu
      const populateStats = () => {
        const eAll = window.indicatorStats.eci_long;
        if (eAll) {
          document.getElementById('eci_long-total-trades-detailed').innerText  = eAll.totalTrades || 0;
          document.getElementById('eci_long-wins-detailed').innerText          = eAll.wins || 0;
          document.getElementById('eci_long-losses-detailed').innerText        = eAll.losses || 0;
          document.getElementById('eci_long-win-rate-detailed').innerText      = `${(eAll.winRate || 0).toFixed(2)}%`;
          document.getElementById('eci_long-total-profit-detailed').innerText  = (eAll.totalProfit || 0).toFixed(2);
          document.getElementById('eci_long-avg-win-detailed').innerText       = (eAll.avgWin || 0).toFixed(2);
          document.getElementById('eci_long-avg-loss-detailed').innerText      = (eAll.avgLoss || 0).toFixed(2);
          document.getElementById('eci_long-total-percent-profit-detailed').innerText = (eAll.totalPercentProfit || 0).toFixed(2);
          document.getElementById('eci_long-avg-percent-profit-detailed').innerText   = (eAll.avgPercentProfit || 0).toFixed(2);
          document.getElementById('eci_long-avg-duration-detailed').innerText  = `${(eAll.avgDuration || 0).toFixed(2)}s`;
          document.getElementById('eci_long-total-fees-detailed').innerText    = (eAll.totalFees || 0).toFixed(2);
          document.getElementById('eci_long-avg-fee-detailed').innerText       = (eAll.avgFee || 0).toFixed(2);

          const cbEl = document.getElementById('eci_long-current-balance-detailed');
          if (cbEl && eAll.currentBalance != null) {
            cbEl.innerText = (eAll.currentBalance || 0).toFixed(2);
            cbEl.style.color = 'lime';
            cbEl.style.fontWeight = 'bold';
          }
          if (eAll.maxBalance != null) {
            document.getElementById('eci_long-max-balance-detailed').innerText = eAll.maxBalance.toFixed(2);
          }
          if (eAll.minBalance != null) {
            document.getElementById('eci_long-min-balance-detailed').innerText = eAll.minBalance.toFixed(2);
          }
          if (eAll.marginUsagePercent != null) {
            document.getElementById('eci_long-margin-usage-detailed').innerText = `${(eAll.marginUsagePercent || 0).toFixed(2)}%`;
          }
          if (eAll.totalUsedMargin != null) {
            document.getElementById('eci_long-used-margin-detailed').innerText = (eAll.totalUsedMargin || 0).toFixed(2);
          }
          // ewentualne drawdown, profitFactor
          if (eAll.maxDrawdown != null) {
            document.getElementById('eci_long-max-drawdown-detailed').innerText = `${(eAll.maxDrawdown || 0).toFixed(2)}%`;
          }
          if (eAll.profitFactor != null) {
            document.getElementById('eci_long-profit-factor-detailed').innerText = (eAll.profitFactor || 0).toFixed(2);
          }
        }
        // Sub-wersje
        ['A','B','C','D','E'].forEach((ver) => {
          const s = window.indicatorStats.eci_long_subv[ver];
          if (s && window.updateEciSubversionStats) {
            window.updateEciSubversionStats(ver, s);
          }
        });
      };

      populateStats();
    }

    eciDetailsBtn.addEventListener('click', () => {
      createEciDetailsWindow();
    });

    // Funkcja do automatycznego odświeżenia panelu ECI
    window.refreshEciDetailsWindow = function() {
      const eciWin = document.getElementById('eci-details-window');
      if (!eciWin) {
        console.log('[refreshEciDetailsWindow] ECI window not open => skip');
        return;
      }
      console.log('[refreshEciDetailsWindow] Refreshing ECI sub-version stats...');
      const eAll = window.indicatorStats.eci_long;
      if (eAll) {
        document.getElementById('eci_long-total-trades-detailed').innerText  = eAll.totalTrades || 0;
        document.getElementById('eci_long-wins-detailed').innerText          = eAll.wins || 0;
        document.getElementById('eci_long-losses-detailed').innerText        = eAll.losses || 0;
        document.getElementById('eci_long-win-rate-detailed').innerText      = `${(eAll.winRate || 0).toFixed(2)}%`;
        document.getElementById('eci_long-total-profit-detailed').innerText  = (eAll.totalProfit || 0).toFixed(2);
        document.getElementById('eci_long-avg-win-detailed').innerText       = (eAll.avgWin || 0).toFixed(2);
        document.getElementById('eci_long-avg-loss-detailed').innerText      = (eAll.avgLoss || 0).toFixed(2);
        document.getElementById('eci_long-total-percent-profit-detailed').innerText = (eAll.totalPercentProfit || 0).toFixed(2);
        document.getElementById('eci_long-avg-percent-profit-detailed').innerText   = (eAll.avgPercentProfit || 0).toFixed(2);
        document.getElementById('eci_long-avg-duration-detailed').innerText  = `${(eAll.avgDuration || 0).toFixed(2)}s`;
        document.getElementById('eci_long-total-fees-detailed').innerText    = (eAll.totalFees || 0).toFixed(2);
        document.getElementById('eci_long-avg-fee-detailed').innerText       = (eAll.avgFee || 0).toFixed(2);

        const cbEl = document.getElementById('eci_long-current-balance-detailed');
        if (cbEl) {
          cbEl.innerText = (eAll.currentBalance || 0).toFixed(2);
          cbEl.style.color = 'lime';
          cbEl.style.fontWeight = 'bold';
        }
        if (eAll.maxBalance != null) {
          document.getElementById('eci_long-max-balance-detailed').innerText = eAll.maxBalance.toFixed(2);
        }
        if (eAll.minBalance != null) {
          document.getElementById('eci_long-min-balance-detailed').innerText = eAll.minBalance.toFixed(2);
        }
        if (eAll.marginUsagePercent != null) {
          document.getElementById('eci_long-margin-usage-detailed').innerText = `${(eAll.marginUsagePercent || 0).toFixed(2)}%`;
        }
        if (eAll.totalUsedMargin != null) {
          document.getElementById('eci_long-used-margin-detailed').innerText = (eAll.totalUsedMargin || 0).toFixed(2);
        }
        if (eAll.maxDrawdown != null) {
          document.getElementById('eci_long-max-drawdown-detailed').innerText = `${(eAll.maxDrawdown || 0).toFixed(2)}%`;
        }
        if (eAll.profitFactor != null) {
          document.getElementById('eci_long-profit-factor-detailed').innerText = (eAll.profitFactor || 0).toFixed(2);
        }
      }

      ['A','B','C','D','E'].forEach((ver) => {
        const s = window.indicatorStats.eci_long_subv[ver];
        if (s && window.updateEciSubversionStats) {
          window.updateEciSubversionStats(ver, s);
        }
      });
    };

    // --------------------------------------------
    // Funkcja do stworzenia okna z wykresem Salda
    // --------------------------------------------
    function createEciChartWindow() {
      // Sprawdzamy, czy okno już istnieje:
      if (document.getElementById('eci-chart-window')) {
        return; // Okno już otwarte
      }
    
      // Główne okno
      const w = document.createElement('div');
      w.id = 'eci-chart-window';
      Object.assign(w.style, {
        position: 'fixed',
        top: '250px',
        left: '200px',
        width: '700px',
        height: '450px',
        backgroundColor: '#222',
        color: '#fff',
        zIndex: '10001',
        border: '1px solid #4CAF50',
        borderRadius: '10px',
        boxShadow: '0 8px 16px rgba(0,0,0,0.6)',
        display: 'flex',
        flexDirection: 'column',
      });
    
      // Pasek tytułu (drag move)
      const h = document.createElement('div');
      Object.assign(h.style, {
        background: '#444',
        padding: '8px',
        cursor: 'move',
        userSelect: 'none',
        borderTopLeftRadius: '10px',
        borderTopRightRadius: '10px',
        fontWeight: 'bold',
      });
      h.innerText = 'Wykres Salda ECI (A–E)';
      w.appendChild(h);
    
      // Kontener z canvase
      const c = document.createElement('div');
      c.style.flex = '1';
      c.style.overflow = 'auto';
      c.style.padding = '10px';
      c.innerHTML = `
        <canvas id="eciChartCanvas" width="660" height="340" style="background:#333;border:1px solid #555;"></canvas>
        <div id="eciChartTooltip"
             style="position:absolute; display:none; padding:6px; background:rgba(0,0,0,0.8);
                    color:#fff; border-radius:4px; pointer-events:none; font-size:12px;">
        </div>
      `;
      w.appendChild(c);
    
      // Stopka z przyciskiem zamykającym
      const f = document.createElement('div');
      Object.assign(f.style, {
        padding: '5px',
        textAlign: 'right',
        borderBottomLeftRadius: '10px',
        borderBottomRightRadius: '10px',
      });
      const cls = document.createElement('button');
      cls.innerText = 'Close';
      Object.assign(cls.style, {
        backgroundColor: '#f44336',
        color: '#fff',
        border: 'none',
        padding: '5px 10px',
        borderRadius: '5px',
      });
      cls.onclick = () => w.remove();
      f.appendChild(cls);
      w.appendChild(f);
    
      // Obsługa przeciągania okna
      let offX, offY;
      h.addEventListener('mousedown', (e) => {
        offX = e.clientX - w.getBoundingClientRect().left;
        offY = e.clientY - w.getBoundingClientRect().top;
        document.addEventListener('mousemove', moveWin);
        document.addEventListener('mouseup', stopMove);
      });
      function moveWin(e) {
        e.preventDefault();
        w.style.left = `${e.clientX - offX}px`;
        w.style.top = `${e.clientY - offY}px`;
      }
      function stopMove() {
        document.removeEventListener('mousemove', moveWin);
        document.removeEventListener('mouseup', stopMove);
      }
    
      document.body.appendChild(w);
    
      // -------------------------------
      // Rysowanie wykresu po krótkim opóźnieniu (lub od razu):
      // Można też tu wczytywać dane z fetch, jeśli chcesz dynamicznie
      // W tym przykładzie zakładamy, że mamy w window jakieś dane do wykresu.
      // -------------------------------
      setTimeout(() => {
        const canvas = document.getElementById('eciChartCanvas');
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        const tooltip = document.getElementById('eciChartTooltip');
    
        // Zakładamy, że w window.indicatorStats mamy .eci_long_subv,
        // ale tam są tylko statystyki. Dlatego poniżej przykładowo
        // przyjmujemy, że mamy "window.eciLongSubvData[ver].tradeHistory"
        // (musisz sam zapewnić takie dane w oknie).
        const subVersions = ['A','B','C','D','E'];
    
        // Przygotowujemy strukturę do rysowania:
        // Dla każdej sub-wersji pobieramy tradeHistory, grupujemy wg endTime,
        // bierzemy balanceAfter (ostatni trade w danej chwili). 
        // UWAGA: jeśli brak tradeHistory => pusta linia.
    
        const allPoints = []; // zbiorczo do wykrywania tooltipów
    
        // Kolory linii (dobierz dowolnie):
        const lineColors = {
          A: '#ff4',
          B: '#4f4',
          C: '#4ff',
          D: '#f4f',
          E: '#fa4'
        };
    
        // Funkcja parsująca datę:
        const parseTime = (t) => new Date(t).getTime();
    
        // Tymczasowo zbieramy listę [time, balance, subVersion, sumProfit, details...]
        const dataBySubversion = {};
    
        subVersions.forEach((ver) => {
          const subData = window.eciLongSubvData?.[ver]; 
          if (!subData || !subData.tradeHistory || !subData.tradeHistory.length) {
            dataBySubversion[ver] = []; // brak danych = pusto
            return;
          }
          const trades = subData.tradeHistory.filter(t => t.endTime); // tylko zakończone
          if (!trades.length) {
            dataBySubversion[ver] = [];
            return;
          }
    
          // Sortuj po endTime rosnąco
          trades.sort((a, b) => parseTime(a.endTime) - parseTime(b.endTime));
    
          // Grupa wg identycznego endTime
          const grouped = {};
          trades.forEach(tr => {
            const tEnd = parseTime(tr.endTime);
            if (!grouped[tEnd]) {
              grouped[tEnd] = {
                time: tEnd,
                balance: tr.balanceAfter,
                totalProfit: tr.profit || 0,
                trades: [tr]
              };
            } else {
              // sumujemy profit, bierzemy "balanceAfter" z ostatniego 
              grouped[tEnd].totalProfit += (tr.profit || 0);
              grouped[tEnd].trades.push(tr);
              // Zwykle balanceAfter weź z "najnowszego" trade, ale 
              // w praktyce one powinny mieć zbliżone/wspólne (jeśli naprawdę kończą się w tym samym momencie).
              grouped[tEnd].balance = tr.balanceAfter; 
            }
          });
    
          // Konwertujemy grouped w tablicę, znów sortujemy
          const points = Object.values(grouped).sort((a,b) => a.time - b.time);
    
          dataBySubversion[ver] = points.map(g => ({
            time: g.time,
            balance: g.balance,
            sumProfit: g.totalProfit,
            trades: g.trades
          }));
        });
    
        // Wyliczamy globalne min/max czasu i salda:
        let minT = Infinity, maxT = -Infinity;
        let minBal = Infinity, maxBal = -Infinity;
    
        subVersions.forEach(ver => {
          dataBySubversion[ver].forEach(pt => {
            if (pt.time < minT) minT = pt.time;
            if (pt.time > maxT) maxT = pt.time;
            if (pt.balance < minBal) minBal = pt.balance;
            if (pt.balance > maxBal) maxBal = pt.balance;
          });
        });
    
        // Jeśli nie znaleziono żadnych trade'ów => nic nie rysujemy:
        if (minT === Infinity) {
          ctx.fillStyle = '#ccc';
          ctx.font = '16px Arial';
          ctx.fillText('Brak danych (żadnych zakończonych transakcji).', 30, 50);
          return;
        }
    
        // Dodajmy minimalny margines:
        const leftPad = 50, rightPad = 20, topPad = 20, bottomPad = 30;
        const W = canvas.width, H = canvas.height;
    
        // Funkcje skalujące (czas -> x, saldo -> y):
        const timeRange = maxT - minT || 1;
        const balRange = maxBal - minBal || 1;
    
        const scaleX = (timeVal) => {
          return leftPad + ((timeVal - minT) / timeRange) * (W - leftPad - rightPad);
        };
        // Y ma rosnąć w górę, więc musimy odwrócić:
        const scaleY = (balVal) => {
          return H - bottomPad - ((balVal - minBal) / balRange) * (H - topPad - bottomPad);
        };
    
        // Oś X i oś Y
        ctx.strokeStyle = '#aaa';
        ctx.lineWidth = 1;
        ctx.beginPath();
        // OX
        ctx.moveTo(leftPad, H - bottomPad);
        ctx.lineTo(W - rightPad, H - bottomPad);
        // OY
        ctx.moveTo(leftPad, topPad);
        ctx.lineTo(leftPad, H - bottomPad);
        ctx.stroke();
    
        ctx.fillStyle = '#aaa';
        ctx.font = '12px sans-serif';
        // Prosty opis minBal i maxBal na osi Y:
        ctx.fillText(minBal.toFixed(2), leftPad + 2, H - bottomPad - 2);
        ctx.fillText(maxBal.toFixed(2), leftPad + 2, topPad + 10);
    
        // Oznaczenie czasu:
        const startDate = new Date(minT);
        const endDate = new Date(maxT);
        ctx.fillText(startDate.toLocaleString(), leftPad, H - bottomPad + 15);
        ctx.fillText(endDate.toLocaleString(), W - rightPad - 80, H - bottomPad + 15);
    
        // Rysujemy linie dla każdej sub-wersji
        subVersions.forEach(ver => {
          const points = dataBySubversion[ver];
          if (!points.length) return; // brak transakcji
    
          ctx.beginPath();
          ctx.lineWidth = 2;
          ctx.strokeStyle = lineColors[ver] || '#0f0';
    
          points.forEach((pt, idx) => {
            const x = scaleX(pt.time);
            const y = scaleY(pt.balance);
            if (idx === 0) {
              ctx.moveTo(x, y);
            } else {
              ctx.lineTo(x, y);
            }
          });
          ctx.stroke();
    
          // Rysujemy kółeczka + zapamiętujemy do tooltipa
          points.forEach((pt) => {
            const x = scaleX(pt.time);
            const y = scaleY(pt.balance);
            ctx.beginPath();
            ctx.fillStyle = lineColors[ver];
            ctx.arc(x, y, 4, 0, 2 * Math.PI);
            ctx.fill();
    
            // Dodajemy do globalnej listy punktów (do obsługi mousemove)
            allPoints.push({
              x, y, 
              r: 5, // promień "hotspotu"
              ver,
              time: pt.time,
              balance: pt.balance,
              sumProfit: pt.sumProfit,
              trades: pt.trades
            });
          });
        });
    
        // Tooltip:
        let tooltipTimeout = null;
        const showTooltip = (xx, yy, content) => {
          tooltip.innerHTML = content;
          tooltip.style.left = xx + 'px';
          tooltip.style.top = (yy - 40) + 'px';
          tooltip.style.display = 'block';
          if (tooltipTimeout) clearTimeout(tooltipTimeout);
          tooltipTimeout = setTimeout(() => {
            tooltip.style.display = 'none';
          }, 6000); // automatycznie chowa po 6 sek
        };
    
        canvas.addEventListener('mousemove', (e) => {
          const rect = canvas.getBoundingClientRect();
          const mx = e.clientX - rect.left;
          const my = e.clientY - rect.top;
    
          // Sprawdzamy odległość do kółeczek
          let found = null;
          for (let i = 0; i < allPoints.length; i++) {
            const p = allPoints[i];
            const dx = p.x - mx;
            const dy = p.y - my;
            if (Math.sqrt(dx*dx + dy*dy) <= p.r) {
              found = p;
              break;
            }
          }
          if (found) {
            // Budujemy treść tooltipa: 
            // sumProfit, data zakończenia, liczba trade'ów itp.
            const endDt = new Date(found.time).toLocaleString();
            const balStr = found.balance.toFixed(2);
            const sumProfStr = found.sumProfit.toFixed(2);
            // Możemy też zebrać czasy trwania w found.trades, lub łączny
            // W tym przykładzie sumujemy durations i wyświetlamy w sek
            let totalDuration = 0;
            found.trades.forEach(t => {
              totalDuration += (t.duration || 0);
            });
            const tradesCount = found.trades.length;
    
            const tipHtml = `
              <b>ECI ${found.ver}</b><br>
              Czas zakończenia: ${endDt}<br>
              Saldo: ${balStr}<br>
              Profit (suma): ${sumProfStr}<br>
              Ilość transakcji w tym momencie: ${tradesCount}<br>
              Suma czasu trwania: ${totalDuration.toFixed(2)}s
            `;
            showTooltip(mx + rect.left, my + rect.top, tipHtml);
          } else {
            tooltip.style.display = 'none';
          }
        });
    
      }, 200); // krótkie opóźnienie, aby okno się dodało do DOM
    }

  });
}

/**
 * Główna funkcja do aktualizacji interfejsu w przeglądarce
 * @param {object} dbData - obiekt z `db.json`
 */
export async function updateBotUI(dbData) {
  if (!pageInstance) {
    logger.error('Page instance not set in UI module.');
    return;
  }

  try {
    // Statystyki globalne z db.json
    const stats = dbData.statistics || {};
    const allTrades = dbData.tradeHistory || [];
    const openTrades = allTrades.filter(t => t.endTime === null && t.realTrade === true);
    const closedTrades = allTrades.filter(t => t.endTime !== null);

    // Wysyłamy do frontu (open/closed/global stats)
    await pageInstance.evaluate((openT, closedT, st) => {
      if (window.updateStats) {
        window.updateStats(st);
      }
      if (window.updateOpenTrades) {
        window.updateOpenTrades(openT);
      }
      if (window.updateTradeHistory) {
        window.updateTradeHistory(closedT);
      }
    }, openTrades, closedTrades, stats);

    // Odczyt ECI aggregator, easy, ut i tp
    const eciData   = await readIndicatorDB('eci_long'); // agregat
    const easyData  = await readIndicatorDB('easy_entry');
    const utData    = await readIndicatorDB('ut_bot');
    const tpData    = await readTPDB();

    // Pod-wersje (A–E)
    const subVersions = ['A','B','C','D','E'];
    const eciLongSubvStats = {};
    const eciLongSubvSettings = {};
    
    // Dodatkowo: przechowujemy CAŁE dane plików sub-wersji (z tradeHistory),
    // żeby móc je potem wykorzystać w wykresie:
    const eciLongSubvData = {};

    for (const v of subVersions) {
      const subInd = 'eci_long' + v;
      const subDB  = await readIndicatorDB(subInd);

      // dopisujemy initialBalance do subDB.statistics (dla frontu)
      if (!subDB.statistics.initialBalance) {
        subDB.statistics.initialBalance = subDB.settings?.initialBalance || 100;
      }

      eciLongSubvStats[v] = subDB.statistics;
      eciLongSubvSettings[subInd] = subDB.settings;  
      // Zapamiętujemy CAŁY plik (tradeHistory + statistics + settings) w eciLongSubvData[v]
      eciLongSubvData[v] = subDB;
    }

    // Jeśli aggregator eci_long.json ma aggregatedBalance => przerzucamy do eciData.statistics
    if (eciData.aggregatedBalance) {
      const ag = eciData.aggregatedBalance;
      eciData.statistics.currentBalance       = ag.currentBalance || 0;
      eciData.statistics.maxBalance           = ag.maxBalance || 0;
      eciData.statistics.minBalance           = ag.minBalance || 0;
      eciData.statistics.totalUsedMargin      = ag.totalUsedMargin || 0;
      eciData.statistics.marginUsagePercent   = ag.marginUsagePercent || 0;
    }

    // Wysyłamy do frontu
    await pageInstance.evaluate(
      (easy, ut, eci, tp, subStats, subSettings, subData) => {
        // Zapisujemy statystyki wskaźników
        window.indicatorStats.easy_entry       = easy.statistics;
        window.indicatorStats.ut_bot           = ut.statistics;
        window.indicatorStats.eci_long         = eci.statistics;
        window.indicatorStats.tp               = tp.statistics;
        
        // Statystyki poszczególnych sub-wersji
        window.indicatorStats.eci_long_subv    = subStats;
        // Ustawienia sub-wersji
        window.indicatorStats.eci_long_settings = subSettings;

        // *** Najważniejsze: wrzucamy całe dane (z tradeHistory) sub-wersji A–E,
        // aby createEciChartWindow mogło skorzystać z subData[ver].tradeHistory. 
        // Możemy to nazwać dowolnie, np. eciLongSubvData:
        window.eciLongSubvData = subData;

        // Wywołujemy event, aby zaktualizować panele
        window.dispatchEvent(new CustomEvent('indicatorStatsUpdated', {
          detail: {
            easy_entry: easy.statistics,
            ut_bot: ut.statistics,
            eci_long: eci.statistics,
            tp: tp.statistics,
            eci_long_subv: subStats,
            eci_long_settings: subSettings
          }
        }));

        console.log('[updateBotUI] Updated ECI + subversions + settings');
        if (window.refreshEciDetailsWindow) {
          window.refreshEciDetailsWindow();
        }
      },
      easyData,
      utData,
      eciData,
      tpData,
      eciLongSubvStats,
      eciLongSubvSettings,
      eciLongSubvData
    );

    logger.info('UI updated successfully.');
  } catch (error) {
    logger.error(`Error updating UI: ${error}`);
  }
}
