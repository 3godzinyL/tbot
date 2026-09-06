document.addEventListener('DOMContentLoaded', () => {
    const startTradeBtn = document.getElementById('start-trade');
    const stopTradeBtn = document.getElementById('stop-trade');
    const settingsForm = document.getElementById('settings-form');
    const tradeHistoryList = document.getElementById('trade-history-list');
    const totalTradesEl = document.getElementById('total-trades');
    const winsEl = document.getElementById('wins');
    const lossesEl = document.getElementById('losses');
    const winRateEl = document.getElementById('win-rate');
    const totalProfitEl = document.getElementById('total-profit');
    const symbolInput = document.getElementById('symbol');
    const balancePercentageInput = document.getElementById('balancePercentage');
  
    // Funkcja do pobierania i wyświetlania historii transakcji
    async function fetchTradeHistory() {
      try {
        const response = await fetch('/api/trade-history');
        const data = await response.json();
        tradeHistoryList.innerHTML = '';
        data.forEach(trade => {
          const li = document.createElement('li');
          li.textContent = `${trade.type.toUpperCase()} ${trade.symbol} - Qty: ${trade.quantity} @ ${trade.price} - Start: ${trade.startTime} - End: ${trade.endTime || 'N/A'} - Profit: ${trade.profit !== null ? trade.profit : 'N/A'}`;
          tradeHistoryList.appendChild(li);
        });
      } catch (error) {
        console.error('Błąd podczas pobierania historii transakcji:', error);
      }
    }
  
    // Funkcja do pobierania i wyświetlania statystyk
    async function fetchStatistics() {
      try {
        const response = await fetch('/api/statistics');
        const data = await response.json();
        totalTradesEl.textContent = data.totalTrades;
        winsEl.textContent = data.wins;
        lossesEl.textContent = data.losses;
        winRateEl.textContent = data.winRate;
        totalProfitEl.textContent = data.totalProfit;
      } catch (error) {
        console.error('Błąd podczas pobierania statystyk:', error);
      }
    }
  
    // Funkcja do pobierania i wyświetlania ustawień
    async function fetchSettings() {
      try {
        const response = await fetch('/api/settings');
        const data = await response.json();
        symbolInput.value = data.symbol || '';
        balancePercentageInput.value = data.balancePercentage || '';
      } catch (error) {
        console.error('Błąd podczas pobierania ustawień:', error);
      }
    }
  
    // Event Listener dla przycisku Start Trade
    startTradeBtn.addEventListener('click', async () => {
      try {
        const response = await fetch('/api/start-trade', { method: 'POST' });
        const data = await response.json();
        alert(data.message);
      } catch (error) {
        console.error('Błąd podczas uruchamiania handlu:', error);
      }
    });
  
    // Event Listener dla przycisku Stop Trade
    stopTradeBtn.addEventListener('click', async () => {
      try {
        const response = await fetch('/api/stop-trade', { method: 'POST' });
        const data = await response.json();
        alert(data.message);
      } catch (error) {
        console.error('Błąd podczas zatrzymywania handlu:', error);
      }
    });
  
    // Event Listener dla formularza ustawień
    settingsForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const symbol = symbolInput.value.trim();
      const balancePercentage = balancePercentageInput.value.trim();
  
      if (!symbol || !balancePercentage) {
        alert('Proszę wypełnić wszystkie pola.');
        return;
      }
  
      try {
        const response = await fetch('/api/settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ symbol, balancePercentage }),
        });
        const data = await response.json();
        alert(data.message);
        fetchSettings();
      } catch (error) {
        console.error('Błąd podczas aktualizacji ustawień:', error);
      }
    });
  
    // Inicjalizacja danych na stronie
    fetchTradeHistory();
    fetchStatistics();
    fetchSettings();
  
    // Opcjonalnie, możesz ustawić interwały do automatycznego odświeżania danych
    setInterval(() => {
      fetchTradeHistory();
      fetchStatistics();
    }, 5000); // Odświeżanie co 5 sekund
  });
  