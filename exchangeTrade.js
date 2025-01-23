// exchangeTrade.js
import { client } from './binanceApi.js';
import { readExchangeDB, writeExchangeDB, updateExchangeStats } from './db.js';
import winston from 'winston';

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ timestamp, level, message }) => `${timestamp} ${level}: ${message}`)
  ),
  transports: [
    new winston.transports.File({ filename: 'exchange-error.log', level: 'error' }),
    new winston.transports.File({ filename: 'exchange-combined.log' }),
  ],
});

/**
 * Otwiera pozycję na Binance Futures
 * @param {Object} trade - Obiekt trade zawierający szczegóły
 */
export async function openExchangeTrade(trade) {
  try {
    const { symbol, side, type, quantity, price, leverage } = trade;

    // Ustaw dźwignię
    await client.futuresLeverage({
      symbol,
      leverage,
    });

    // Przygotuj parametry zamówienia
    const orderParams = {
      symbol,
      side: side.toUpperCase(), // 'BUY' lub 'SELL'
      type, // np. 'MARKET', 'LIMIT'
      quantity,
      // Jeśli typ to LIMIT, dodaj price i timeInForce
      ...(type === 'LIMIT' && { price, timeInForce: 'GTC' }),
    };

    // Złóż zamówienie
    const order = await client.futuresOrder(orderParams);
    logger.info(`Opened ${side} order on ${symbol} at ${price || 'market price'}. Order ID: ${order.orderId}`);

    // Zapisz trade w DB
    const exchangeDB = await readExchangeDB();
    const newTrade = {
      id: trade.id,
      symbol,
      side,
      type,
      quantity,
      price: price ? parseFloat(price) : null,
      leverage,
      orderId: order.orderId,
      startTime: new Date().toISOString(),
      endTime: null,
      profit: null,
      exitPrice: null,
      duration: null,
      margin: null,
      percentProfit: null,
      fee: null,
      percentFee: null,
    };
    exchangeDB.tradeHistory.push(newTrade);
    await writeExchangeDB(exchangeDB);
    await updateExchangeStats(exchangeDB); // Aktualizacja statystyk
    logger.info(`Trade logged: ${newTrade.id}`);
    return newTrade;
  } catch (error) {
    logger.error(`Error opening exchange trade: ${error.message}`);
    throw error;
  }
}

/**
 * Zamyka pozycję na Binance Futures
 * @param {String} tradeId - ID trade do zamknięcia
 * @param {Number} exitPrice - Cena zamknięcia
 */
export async function closeExchangeTrade(tradeId, exitPrice) {
  try {
    const exchangeDB = await readExchangeDB();
    const trade = exchangeDB.tradeHistory.find(t => t.id === tradeId && t.endTime === null);

    if (!trade) {
      logger.warn(`Trade with ID ${tradeId} not found or already closed.`);
      return { success: false, message: 'Trade not found or already closed.' };
    }

    const { symbol, side, quantity, leverage, orderId } = trade;

    // Zamknij pozycję poprzez przeciwny side
    const closeSide = side === 'BUY' ? 'SELL' : 'BUY';

    const closeOrderParams = {
      symbol,
      side: closeSide,
      type: 'MARKET',
      quantity,
    };

    const closeOrder = await client.futuresOrder(closeOrderParams);
    logger.info(`Closed order on ${symbol}. Close Order ID: ${closeOrder.orderId}`);

    // Oblicz PnL
    const entryPrice = trade.price;
    const pnl = side === 'BUY' ? (exitPrice - entryPrice) * quantity : (entryPrice - exitPrice) * quantity;

    // Aktualizuj trade w DB
    trade.endTime = new Date().toISOString();
    trade.exitPrice = exitPrice;
    trade.profit = pnl;
    trade.margin = (entryPrice * quantity) / leverage;
    trade.fee = (entryPrice * quantity) * 0.001; // Przykładowa stawka opłaty
    trade.percentProfit = (pnl / trade.margin) * 100;
    trade.percentFee = (trade.fee / trade.margin) * 100;

    await writeExchangeDB(exchangeDB);
    await updateExchangeStats(exchangeDB); // Aktualizacja statystyk
    logger.info(`Trade closed: ${trade.id} with PnL: ${pnl}`);
    return { success: true, profit: pnl };
  } catch (error) {
    logger.error(`Error closing exchange trade: ${error.message}`);
    return { success: false, message: 'Error closing exchange trade.' };
  }
}

/**
 * Monitoruje otwarte trade’y na Binance Futures
 */
export async function monitorExchangeTrades() {
  try {
    const exchangeDB = await readExchangeDB();
    const openTrades = exchangeDB.tradeHistory.filter(t => t.endTime === null);

    for (const trade of openTrades) {
      // Możesz dodać logikę monitorowania, np. sprawdzanie ceny rynkowej
      // i zamykanie trade’u jeśli warunki są spełnione
      // Przykład: sprawdzenie czy osiągnięto stop loss lub take profit

      // Przykładowa logika:
      const currentPrice = await getCurrentPrice(trade.symbol);
      if (trade.side === 'BUY' && currentPrice <= trade.stopLoss) {
        await closeExchangeTrade(trade.id, currentPrice);
      } else if (trade.side === 'SELL' && currentPrice >= trade.stopLoss) {
        await closeExchangeTrade(trade.id, currentPrice);
      }

      // Możesz dodać więcej warunków, np. osiągnięcie take profit
      if (trade.side === 'BUY' && currentPrice >= trade.takeProfit) {
        await closeExchangeTrade(trade.id, currentPrice);
      } else if (trade.side === 'SELL' && currentPrice <= trade.takeProfit) {
        await closeExchangeTrade(trade.id, currentPrice);
      }
    }

    logger.info('Exchange trades monitored.');
  } catch (error) {
    logger.error(`Error monitoring exchange trades: ${error.message}`);
  }
}

// Funkcja pomocnicza do pobierania aktualnej ceny
async function getCurrentPrice(symbol) {
  try {
    const ticker = await client.futuresPrice({ symbol });
    return parseFloat(ticker.price);
  } catch (error) {
    logger.error(`Error fetching current price for ${symbol}:`, error);
    return null;
  }
}
