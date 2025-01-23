// server.js
import express from 'express';
import bodyParser from 'body-parser';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';
import { getFuturesBalance, getTotalBalances } from './binanceApi.js';
import {
  logTrade, 
  executeTrade, 
  executePaperTrade,
  closeTrade,
  closePaperTrade,
  handleNewTrade,
  monitorTrades,
  closeTpTrade
} from './trade.js';
import { 
  readDB, writeDB, readTPDB, writeTPDB, 
  readExchangeDB, writeExchangeDB, 
  readPaperTradesDB, writePaperTradesDB,
  readIndicatorDB, writeIndicatorDB
} from './db.js';
import winston from 'winston';
import { updateBotUI } from './ui.js'; // Import funkcji do aktualizacji UI

const app = express();

// Logger
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ timestamp, level, message }) => `${timestamp} ${level}: ${message}`)
  ),
  transports: [
    new winston.transports.File({ filename: 'server-error.log', level: 'error' }),
    new winston.transports.File({ filename: 'server-combined.log' }),
    new winston.transports.Console(),
  ],
});

app.use(cors({
  origin: '*', // Na czas testów
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'ngrok-skip-browser-warning'], // Dodanie nagłówka
}));

app.use(bodyParser.json());

// Middleware do logowania odpowiedzi JSON
app.use((req, res, next) => {
  const oldJson = res.json;
  res.json = function (data) {
    logger.info(`Sending JSON response: ${JSON.stringify(data)}`);
    oldJson.apply(res, arguments);
  };
  next();
});

// Definicje endpointów

app.post('/api/close-tp-trade', async (req, res) => {
  const { tradeId, endPrice } = req.body;
  const result = await closeTpTrade(tradeId, endPrice);
  if (result.success) {
    // Aktualizacja UI po zamknięciu TP trade
    const dbData = await readDB();
    await updateBotUI(dbData);
    res.status(200).json({ message: 'TP Trade closed.', profit: result.profit });
  } else {
    res.status(400).json({ message: result.message });
  }
});

app.get('/api/statistics', async (req, res) => {
  try {
    const dbData = await readDB();
    res.status(200).json(dbData.statistics);
  } catch (error) {
    logger.error('Error fetching statistics:', error);
    res.status(500).json({ message: 'Error fetching statistics.' });
  }
});

app.get('/api/settings', async (req, res) => {
  try {
    const dbData = await readDB();
    res.status(200).json(dbData.settings);
  } catch (error) {
    logger.error('Error fetching settings:', error);
    res.status(500).json({ message: 'Error fetching settings.' });
  }
});

app.post('/api/update-settings', async (req, res) => {
  const { autoTrade } = req.body;
  try {
    const dbData = await readDB();
    dbData.settings.autoTrade = !!autoTrade;
    await writeDB(dbData);
    // Aktualizacja UI po zmianie ustawień
    await updateBotUI(dbData);
    res.json({ message: 'Settings updated.' });
  } catch (error) {
    logger.error('Error updating settings:', error);
    res.status(500).json({ message: 'Error updating settings.' });
  }
});

// ====== NOWY ENDPOINT: Aktualizacja ustawień ECI ======
app.post('/api/update-eci-settings', async (req, res) => {
  try {
    const updateData = req.body;  
    // updateData np. = { "eci_longA": { leverage: 80, tradePercent: 10 }, "eci_longC": { ... } }

    // Dla każdego klucza (sub-wersji) robimy read/write:
    for (const subKey in updateData) {
      // subKey = "eci_longA", "eci_longB", ...
      const subDB = await readIndicatorDB(subKey);
      // Upewnij się, że jest .settings:
      if (!subDB.settings) {
        subDB.settings = {};
      }
      // Nadpisujemy wartości z requestu
      Object.assign(subDB.settings, updateData[subKey]);

      // Zapisz
      await writeIndicatorDB(subKey, subDB);
    }

    // Po zapisaniu, odśwież UI:
    const dbData = await readDB(); // wczytuje db.json (globalne)
    await updateBotUI(dbData);

    return res.json({ message: 'ECI settings updated.' });
  } catch (error) {
    logger.error('Error updating ECI settings:', error);
    return res.status(500).json({ message: 'Error updating ECI settings.' });
  }
});
app.get('/api/paper-trade-history', async (req, res) => {
  try {
    const paperTrades = await readPaperTradesDB();
    res.status(200).json(paperTrades.tradeHistory);
  } catch (error) {
    logger.error('Error fetching paper trade history:', error);
    res.status(500).json({ message: 'Error fetching paper trade history.' });
  }
});

app.get('/api/exchange-trade-history', async (req, res) => {
  try {
    const exchangeTrades = await readExchangeDB();
    res.status(200).json(exchangeTrades.tradeHistory);
  } catch (error) {
    logger.error('Error fetching exchange trade history:', error);
    res.status(500).json({ message: 'Error fetching exchange trade history.' });
  }
});

app.get('/api/tp-statistics', async (req, res) => {
  try {
    const tpData = await readTPDB();
    res.status(200).json(tpData.statistics);
  } catch (error) {
    logger.error('Error fetching TP statistics:', error);
    res.status(500).json({ message: 'Error fetching TP statistics.' });
  }
});

app.get('/api/balances', async (req, res) => {
  try {
    const balances = await getTotalBalances();
    logger.info('Balances fetched via API:', balances);
    res.setHeader('Content-Type', 'application/json');
    logger.info('Sending balances response headers:', res.getHeaders());
    res.status(200).json(balances);
  } catch (error) {
    logger.error('Error fetching balances:', error);
    res.status(500).json({ message: 'Error fetching balances' });
  }
});

app.post('/api/open-exchange-trade', async (req, res) => {
  const { type, symbol, price, quantity, leverage, indicator } = req.body;
  if (!indicator) {
    return res.status(400).json({ message: 'Indicator is required.' });
  }
  const trade = {
    id: uuidv4(),
    indicator,
    type,
    symbol,
    price: parseFloat(price),
    quantity: parseFloat(quantity),
    leverage: parseInt(leverage, 10) || 125,
    stopLoss: parseFloat(req.body.stopLoss) || 0,
    takeProfit: parseFloat(req.body.takeProfit) || 0,
    targetPrice: type === 'buy' ? (parseFloat(req.body.takeProfit) || null) : (parseFloat(req.body.stopLoss) || null),
    realTrade: true,
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
  try {
    await executeTrade(trade, async (updatedDbData) => {
      await updateBotUI(updatedDbData);
    });
    res.status(200).json({ message: 'Exchange trade started.', trade });
  } catch (error) {
    logger.error('Error starting exchange trade:', error);
    res.status(500).json({ message: 'Server error.' });
  }
});

app.post('/api/close-exchange-trade', async (req, res) => {
  const { tradeId, endPrice } = req.body;
  const result = await closeTrade(tradeId, endPrice, async (updatedDbData) => {
    await updateBotUI(updatedDbData);
  }, true);
  if (result.success) {
    res.status(200).json({ message: 'Exchange trade closed.', profit: result.profit });
  } else {
    res.status(400).json({ message: result.message });
  }
});

app.get('/api/monitor-trades', async (req, res) => {
  try {
    await monitorTrades();
    res.status(200).json({ message: 'Trades monitored.' });
  } catch (error) {
    logger.error('Error monitoring trades:', error);
    res.status(500).json({ message: 'Error monitoring trades.' });
  }
});

app.post('/api/open-paper-trade', async (req, res) => {
  const { type, symbol, price, quantity, leverage, indicator } = req.body;
  if (!indicator) {
    return res.status(400).json({ message: 'Indicator is required.' });
  }
  const trade = {
    id: uuidv4(),
    indicator,
    type,
    symbol,
    price: parseFloat(price),
    quantity: parseFloat(quantity),
    leverage: parseInt(leverage, 10) || 125,
    stopLoss: parseFloat(req.body.stopLoss) || 0,
    takeProfit: parseFloat(req.body.takeProfit) || 0,
    targetPrice: type === 'buy' ? (parseFloat(req.body.takeProfit) || null) : (parseFloat(req.body.stopLoss) || null),
    realTrade: false,
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
  try {
    await executePaperTrade(trade, async (updatedDbData) => {
      await updateBotUI(updatedDbData);
    });
    res.status(200).json({ message: 'Paper trade started.', trade });
  } catch (error) {
    logger.error('Error starting paper trade:', error);
    res.status(500).json({ message: 'Server error.' });
  }
});

app.post('/api/close-paper-trade', async (req, res) => {
  const { tradeId, endPrice } = req.body;
  const result = await closePaperTrade(tradeId, endPrice);
  if (result.success) {
    // Aktualizacja UI po zamknięciu paper trade
    const dbData = await readDB();
    await updateBotUI(dbData);
    res.status(200).json({ message: 'Paper trade closed.', profit: result.profit });
  } else {
    res.status(400).json({ message: result.message });
  }
});

export default app;
