// db.js
import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';
import winston from 'winston';
import { updateBotUI } from './ui.js'; // Upewnij się, że masz to samo ścieżki;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Folder TV
const TV_DIR = path.join(__dirname, 'TV');
fs.ensureDirSync(TV_DIR);

const dbPath     = path.join(TV_DIR, 'db.json');       // global DB
const easyPath   = path.join(TV_DIR, 'easy.json');
const utbotPath  = path.join(TV_DIR, 'utbot.json');
const tpPath     = path.join(TV_DIR, 'tp.json');

// ECI: agregat i subwersje
const eciLongPath  = path.join(TV_DIR, 'eci_long.json'); 
const eciLongAPath = path.join(TV_DIR, 'eci_longA.json');
const eciLongBPath = path.join(TV_DIR, 'eci_longB.json');
const eciLongCPath = path.join(TV_DIR, 'eci_longC.json');
const eciLongDPath = path.join(TV_DIR, 'eci_longD.json');
const eciLongEPath = path.join(TV_DIR, 'eci_longE.json');

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

// Folder BC (jeśli używasz do realnych exchange/paper itp.)
const BC_DIR = path.join(__dirname, 'BC');
fs.ensureDirSync(BC_DIR);

const EXCHANGE_DB_PATH       = path.join(BC_DIR, 'exchangeTrades.json');
const TP_DB_PATH             = path.join(BC_DIR, 'tpTrades.json');
const PAPER_TRADES_DB_PATH   = path.join(BC_DIR, 'paperTrades.json');

// =========== EXCHANGE DB (futures) =================
export async function readExchangeDB() {
  try {
    const exists = await fs.pathExists(EXCHANGE_DB_PATH);
    if (!exists) {
      const initialData = {
        tradeHistory: [],
        statistics: {
          totalExchangeTrades: 0,
          exchangeWins: 0,
          exchangeLosses: 0,
          exchangeWinRate: 0,
          exchangeTotalProfit: 0,
          exchangeAvgProfit: 0,
          exchangeTotalFees: 0,
          exchangeAvgFee: 0,
        },
      };
      await fs.writeJson(EXCHANGE_DB_PATH, initialData, { spaces: 2 });
      return initialData;
    }
    const data = await fs.readJson(EXCHANGE_DB_PATH);
    if (!data.tradeHistory) data.tradeHistory = [];
    if (!data.statistics) {
      data.statistics = {
        totalExchangeTrades: 0,
        exchangeWins: 0,
        exchangeLosses: 0,
        exchangeWinRate: 0,
        exchangeTotalProfit: 0,
        exchangeAvgProfit: 0,
        exchangeTotalFees: 0,
        exchangeAvgFee: 0,
      };
    }
    return data;
  } catch (err) {
    logger.error('Error reading Exchange DB:', err);
    throw err;
  }
}

export async function writeExchangeDB(data) {
  try {
    const tmp = `${EXCHANGE_DB_PATH}.tmp`;
    await fs.writeJson(tmp, data, { spaces: 2 });
    await fs.move(tmp, EXCHANGE_DB_PATH, { overwrite: true });
    logger.info('Exchange DB successfully written.');
  } catch (err) {
    logger.error('Error writing Exchange DB:', err);
    throw err;
  }
}

export function updateExchangeStats(data) {
  const trades = data.tradeHistory;
  data.statistics = {
    totalExchangeTrades: trades.length,
    exchangeWins: trades.filter(t => t.profit > 0).length,
    exchangeLosses: trades.filter(t => t.profit <= 0).length,
    exchangeWinRate: trades.length ? (trades.filter(t => t.profit > 0).length / trades.length) * 100 : 0,
    exchangeTotalProfit: trades.reduce((sum, t) => sum + (t.profit || 0), 0),
    exchangeAvgProfit: trades.length ? trades.reduce((s, t) => s + (t.profit || 0), 0) / trades.length : 0,
    exchangeTotalFees: trades.reduce((s, t) => s + (t.fee || 0), 0),
    exchangeAvgFee: trades.length ? trades.reduce((s, t) => s + (t.fee || 0), 0) / trades.length : 0,
  };
  logger.info(`Exchange Stats Updated: ${JSON.stringify(data.statistics)}`);
}

// =========== GLOBAL DB (db.json) =================
function defaultGlobalDB() {
  return {
    tradeHistory: [],
    statistics: {
      totalTrades: 0,
      wins: 0,
      losses: 0,
      winRate: 0.00,
      totalProfit: 0.00,
      avgWin: 0.00,
      avgLoss: 0.00,
      totalPercentProfit: 0.00,
      avgPercentProfit: 0.00,
      avgDuration: 0.00,
      totalFees: 0.00,
      avgFee: 0.00,
    },
    settings: {
      symbol: 'BTCUSDT',
      balancePercentage: 1,
      autoTrade: true,
    },
  };
}

export async function readDB() {
  try {
    const data = await fs.readJson(dbPath);
    if (!data.tradeHistory) data.tradeHistory = [];
    if (!data.statistics) data.statistics = defaultGlobalDB().statistics;
    parseGlobalStats(data.statistics);
    return data;
  } catch (err) {
    logger.error('Error reading global DB:', err);
    return defaultGlobalDB();
  }
}

export async function writeDB(data) {
  try {
    await fs.writeJson(dbPath, data, { spaces: 2 });
    logger.info('Global database updated.');
  } catch (err) {
    logger.error('Error writing global DB:', err);
  }
}

export async function updateGlobalStats(dbData) {
  try {
    // 1) Najpierw zaktualizuj sub-wersje (A–E), żeby w .statistics zawsze
    //    było currentBalance = settings.currentBalance itd.
    const eciSubVersions = ['A','B','C','D','E'];
    for (const ver of eciSubVersions) {
      const subIndicator = `eci_long${ver}`;
      const subData = await readIndicatorDB(subIndicator);
      await updateIndicatorStats(subData, subIndicator); // wymuszenie
      await writeIndicatorDB(subIndicator, subData);
    }

    // 2) Odczytaj na nowo "db.json"
    const freshDB = await readDB();

    // 3) Skopiuj tradeHistory z globalDB + subwersje
    let trades = freshDB.tradeHistory || [];

    for (const ver of eciSubVersions) {
      const subInd = `eci_long${ver}`;
      const subData = await readIndicatorDB(subInd);
      // TU TEŻ wymuszamy updateIndicatorStats sub-wersji (jeszcze raz, w razie co)
      await updateIndicatorStats(subData, subInd);
      trades = trades.concat(subData.tradeHistory || []);
    }

    // 4) Obliczamy combinedBalance + totalUsedMargin
    let combinedBalance = 0;
    let totalUsedMargin = 0;
    for (const ver of eciSubVersions) {
      const subData = await readIndicatorDB(`eci_long${ver}`);
      combinedBalance += subData.statistics?.currentBalance || 0;
      totalUsedMargin += subData.statistics?.totalUsedMargin || 0;
    }

    // 5) Zsumuj statystyki w freshDB.statistics
    freshDB.statistics = {
      totalTrades: trades.length,
      wins: trades.filter(t => t.profit > 0).length,
      losses: trades.filter(t => t.profit <= 0).length,
      winRate: trades.length ? (trades.filter(t => t.profit > 0).length / trades.length) * 100 : 0,
      totalProfit: trades.reduce((sum, t) => sum + (t.profit || 0), 0),
      avgWin: (() => {
        const wins = trades.filter(t => t.profit > 0);
        return wins.length ? wins.reduce((s, x) => s + (x.profit || 0), 0) / wins.length : 0;
      })(),
      avgLoss: (() => {
        const losses = trades.filter(t => t.profit <= 0);
        return losses.length ? losses.reduce((s, x) => s + (x.profit || 0), 0) / losses.length : 0;
      })(),
      totalFees: trades.reduce((s, t) => s + (t.fee || 0), 0),
      avgFee: trades.length ? trades.reduce((s, t) => s + (t.fee || 0), 0) / trades.length : 0,
      totalPercentProfit: trades.reduce((s, t) => s + (t.percentProfit || 0), 0),
      avgPercentProfit: trades.length ? trades.reduce((s, t) => s + (t.percentProfit || 0), 0) / trades.length : 0,
      avgDuration: (() => {
        const durTrades = trades.filter(t => t.duration !== null && typeof t.duration === 'number');
        return durTrades.length ? durTrades.reduce((s, x) => s + (x.duration || 0), 0) / durTrades.length : 0;
      })(),
      combinedBalance,
      totalUsedMargin,
      marginUsagePercent: combinedBalance ? (totalUsedMargin / combinedBalance) * 100 : 0,
    };

    logger.info(`Global Stats Updated => ${JSON.stringify(freshDB.statistics)}`);

    await writeDB(freshDB); // Zapisz do pliku
    // i update UI
    await updateBotUI({ ...freshDB });

  } catch (err) {
    logger.error(`Error updating global stats: ${err}`);
  }
}

// =========== INDICATOR DB (easy, ut, eci_long + eci_longA…E) =================
function defaultIndicatorDB() {
  return {
    tradeHistory: [],
    statistics: {
      totalTrades: 0,
      wins: 0,
      losses: 0,
      winRate: 0,
      totalProfit: 0,
      avgWin: 0,
      avgLoss: 0,
      totalPercentProfit: 0,
      avgPercentProfit: 0,
      avgDuration: 0,
      totalFees: 0,
      avgFee: 0
    }
  };
}
function defaultSubVersionSettings() {
  return {
    initialBalance: 100,
    currentBalance: 100,
    tradePercent: 10,
    leverage: 125,
    marginUsagePercent: 0,
    maxBalance: 100,
    minBalance: 100,
    totalTrades: 0,
    totalProfit: 0,
    totalFees: 0
  };
}

function ensureSubVersionDefaults(jsonData) {
  if (!jsonData.settings) {
    jsonData.settings = defaultSubVersionSettings();
  } else {
    const defaults = defaultSubVersionSettings();
    for (const k in defaults) {
      if (jsonData.settings[k] === undefined) {
        jsonData.settings[k] = defaults[k];
      }
    }
  }
  return jsonData;
}

export async function readIndicatorDB(indicator) {
  let filePath;
  switch (indicator) {
    case 'easy_entry': filePath = easyPath; break;
    case 'ut_bot':     filePath = utbotPath; break;
    case 'eci_long':   filePath = eciLongPath; break;
    case 'eci_longA':  filePath = eciLongAPath; break;
    case 'eci_longB':  filePath = eciLongBPath; break;
    case 'eci_longC':  filePath = eciLongCPath; break;
    case 'eci_longD':  filePath = eciLongDPath; break;
    case 'eci_longE':  filePath = eciLongEPath; break;
    default:
      logger.error(`Unsupported indicator: ${indicator}`);
      return defaultIndicatorDB();
  }

  try {
    const exists = await fs.pathExists(filePath);
    if (!exists) {
      let init = defaultIndicatorDB(); 
      if (indicator.startsWith('eci_long') && indicator !== 'eci_long') {
        init = ensureSubVersionDefaults(init);
      }
      await fs.writeJson(filePath, init, { spaces: 2 });
      return init;
    }

    const rawData = await fs.readJson(filePath);
    const defaults = defaultIndicatorDB();

    const finalData = {
      ...rawData,
      tradeHistory: rawData.tradeHistory ?? defaults.tradeHistory,
      statistics: {
        ...defaults.statistics,
        ...rawData.statistics
      }
    };

    if (indicator.startsWith('eci_long') && indicator !== 'eci_long') {
      ensureSubVersionDefaults(finalData);
    }

    return finalData;
  } catch (err) {
    logger.error(`Error reading ${indicator} DB:`, err);
    let init = defaultIndicatorDB();
    if (indicator.startsWith('eci_long') && indicator !== 'eci_long') {
      init = ensureSubVersionDefaults(init);
    }
    await fs.writeJson(filePath, init, { spaces: 2 });
    return init;
  }
}

export async function writeIndicatorDB(indicator, data) {
  let filePath;
  switch (indicator) {
    case 'easy_entry': filePath = easyPath; break;
    case 'ut_bot':     filePath = utbotPath; break;
    case 'eci_long':   filePath = eciLongPath; break;
    case 'eci_longA':  filePath = eciLongAPath; break;
    case 'eci_longB':  filePath = eciLongBPath; break;
    case 'eci_longC':  filePath = eciLongCPath; break;
    case 'eci_longD':  filePath = eciLongDPath; break;
    case 'eci_longE':  filePath = eciLongEPath; break;
    default:
      logger.error(`Unsupported indicator: ${indicator}`);
      return;
  }
  try {
    const tmp = `${filePath}.tmp`;
    await fs.writeJson(tmp, data, { spaces: 2 });
    await fs.move(tmp, filePath, { overwrite: true });
    logger.info(`${indicator} DB successfully written.`);
  } catch (err) {
    logger.error(`Error writing ${indicator} DB:`, err);
    throw err;
  }
}

/**
 * Aktualizacja statystyk wskaźnika (easy_entry, ut_bot, eci_long, eci_longA, eci_longB, itp.)
 * 
 * @param {object} data - Obiekt wczytany z pliku JSON (np. eci_longA.json)
 * @param {string} indicator - nazwa, np. "eci_longA", "eci_longB" lub "eci_long"
 */
export async function updateIndicatorStats(data, indicator) {
  let trades = data.tradeHistory || [];

  // (1) Jeśli to sub-wersja ECI (A–E), przepisujemy .settings → .statistics nawet gdy brak trades
  if (indicator.startsWith('eci_long') && indicator !== 'eci_long') {
    if (!data.settings) {
      data.settings = {
        initialBalance: 100,
        currentBalance: 100,
        maxBalance: 100,
        minBalance: 100,
        tradePercent: 10,
        leverage: 125,
        marginUsagePercent: 0,
        totalProfit: 0,
        totalFees: 0,
      };
    }
    data.statistics.initialBalance = data.settings.initialBalance || 100;
    data.statistics.currentBalance = data.settings.currentBalance || 0;
    data.statistics.maxBalance     = data.settings.maxBalance || 0;
    data.statistics.minBalance     = data.settings.minBalance || 0;
    data.statistics.totalUsedMargin =
      ((data.settings.marginUsagePercent || 0) / 100) *
      (data.settings.currentBalance || 0);
  }

  // (2) Jeśli to agregat eci_long, musimy zsumować sub-wersje
  let sumCurrentBalance = 0;
  let sumMaxBalance = 0;
  let sumMinBalance = 0;
  let sumUsedMargin = 0;

  if (indicator === 'eci_long') {
    try {
      const subVersions = ['A', 'B', 'C', 'D', 'E'];
      for (const ver of subVersions) {
        const subData = await readIndicatorDB(`eci_long${ver}`);
        // Doliczamy sub-wersje do trades
        trades = trades.concat(subData.tradeHistory || []);

        // Zbiór wartości do sumowania
        sumCurrentBalance += (subData.statistics?.currentBalance || 0);
        sumMaxBalance     += (subData.statistics?.maxBalance || 0);
        sumMinBalance     += (subData.statistics?.minBalance || 0);
        sumUsedMargin     += (subData.statistics?.totalUsedMargin || 0);
      }

      data.aggregatedBalance = {
        currentBalance: sumCurrentBalance,
        maxBalance: sumMaxBalance,
        minBalance: sumMinBalance,
        totalUsedMargin: sumUsedMargin,
        marginUsagePercent: sumCurrentBalance
          ? (sumUsedMargin / sumCurrentBalance) * 100
          : 0,
      };
    } catch (err) {
      logger.error(`Error aggregating ECI subversion stats: ${err}`);
    }
  }

  // (3) Liczymy statystyki podstawowe (na bazie tradeHistory = "trades")
  const totalTrades = trades.length;
  const wins = trades.filter(t => (t.profit || 0) > 0);
  const losses = trades.filter(t => (t.profit || 0) <= 0);

  const countWins = wins.length;
  const countLosses = losses.length;

  const totalProfit = trades.reduce((s, t) => s + (t.profit || 0), 0);
  const totalFees = trades.reduce((s, t) => s + (t.fee || 0), 0);
  const totalPercentProfit = trades.reduce((s, t) => s + (t.percentProfit || 0), 0);

  const avgWin = countWins
    ? wins.reduce((sum, w) => sum + (w.profit || 0), 0) / countWins
    : 0;
  const avgLoss = countLosses
    ? losses.reduce((sum, l) => sum + (l.profit || 0), 0) / countLosses
    : 0;

  // Średni fee
  const avgFee = totalTrades
    ? totalFees / totalTrades
    : 0;

  // Średni % profit
  const avgPercentProfit = totalTrades
    ? totalPercentProfit / totalTrades
    : 0;

  // Średni czas trwania
  const durationTrades = trades.filter(t => typeof t.duration === 'number' && !isNaN(t.duration));
  const avgDuration = durationTrades.length
    ? durationTrades.reduce((s, d) => s + (d.duration || 0), 0) / durationTrades.length
    : 0;

  // (4) Przypisujemy do data.statistics
  data.statistics.totalTrades = totalTrades;
  data.statistics.wins        = countWins;
  data.statistics.losses      = countLosses;
  data.statistics.winRate     = totalTrades ? (countWins / totalTrades) * 100 : 0;

  data.statistics.totalProfit = totalProfit;
  data.statistics.avgWin      = avgWin;
  data.statistics.avgLoss     = avgLoss;

  data.statistics.totalFees   = totalFees;
  data.statistics.avgFee      = avgFee;

  data.statistics.totalPercentProfit = totalPercentProfit;
  data.statistics.avgPercentProfit   = avgPercentProfit;
  data.statistics.avgDuration        = avgDuration;

  // (5) Jeśli to eci_long (agregat) i mamy data.aggregatedBalance => przerzucamy
  if (indicator === 'eci_long' && data.aggregatedBalance) {
    data.statistics.currentBalance      = data.aggregatedBalance.currentBalance;
    data.statistics.maxBalance          = data.aggregatedBalance.maxBalance;
    data.statistics.minBalance          = data.aggregatedBalance.minBalance;
    data.statistics.totalUsedMargin     = data.aggregatedBalance.totalUsedMargin;
    data.statistics.marginUsagePercent  = data.aggregatedBalance.marginUsagePercent;
  }

  logger.info(`[updateIndicatorStats] for ${indicator} => ${JSON.stringify(data.statistics)}`);
}


/** Parsowanie statystyk (opcjonalne) */
function parseGlobalStats(stats) {
  stats.winRate               = parseFloat(stats.winRate) || 0;
  stats.totalProfit           = parseFloat(stats.totalProfit) || 0;
  stats.avgWin                = parseFloat(stats.avgWin) || 0;
  stats.avgLoss               = parseFloat(stats.avgLoss) || 0;
  stats.totalPercentProfit    = parseFloat(stats.totalPercentProfit) || 0;
  stats.avgPercentProfit      = parseFloat(stats.avgPercentProfit) || 0;
  stats.avgDuration           = parseFloat(stats.avgDuration) || 0;
  stats.totalFees             = parseFloat(stats.totalFees) || 0;
  stats.avgFee                = parseFloat(stats.avgFee) || 0;
}

function parseTPStats(statObj) {
  ['easy_entry', 'ut_bot'].forEach(ind => {
    if (statObj[ind]) {
      statObj[ind].tpWinRate       = parseFloat(statObj[ind].tpWinRate) || 0;
      statObj[ind].tpTotalProfit   = parseFloat(statObj[ind].tpTotalProfit) || 0;
      statObj[ind].tpAvgProfit     = parseFloat(statObj[ind].tpAvgProfit) || 0;
      statObj[ind].tpAvgTrend      = parseFloat(statObj[ind].tpAvgTrend) || 0;
      statObj[ind].tpAvgDuration   = parseFloat(statObj[ind].tpAvgDuration) || 0;
    }
  });
}

// =========== TP DB =================
export async function readTPDB() {
  try {
    const exists = await fs.pathExists(tpPath);
    if (!exists) {
      const initialData = {
        tradeHistory: [],
        statistics: {
          totalTpTrades: 0,
          tpWins: 0,
          tpLosses: 0,
          tpWinRate: 0,
          tpTotalProfit: 0,
          tpAvgProfit: 0,
          tpAvgTrend: 0,
          tpAvgDuration: 0,
        },
      };
      await fs.writeJson(tpPath, initialData, { spaces: 2 });
      return initialData;
    }
    const data = await fs.readJson(tpPath);
    if (!data.tradeHistory) data.tradeHistory = [];
    if (!data.statistics) {
      data.statistics = {
        totalTpTrades: 0,
        tpWins: 0,
        tpLosses: 0,
        tpWinRate: 0,
        tpTotalProfit: 0,
        tpAvgProfit: 0,
        tpAvgTrend: 0,
        tpAvgDuration: 0,
      };
    }
    return data;
  } catch (err) {
    logger.error('Error reading TP DB:', err);
    return {
      tradeHistory: [],
      statistics: {
        totalTpTrades: 0,
        tpWins: 0,
        tpLosses: 0,
        tpWinRate: 0,
        tpTotalProfit: 0,
        tpAvgProfit: 0,
        tpAvgTrend: 0,
        tpAvgDuration: 0,
      },
    };
  }
}

export async function writeTPDB(data) {
  try {
    await fs.writeJson(tpPath, data, { spaces: 2 });
    logger.info('TP DB successfully written.');
  } catch (err) {
    logger.error('Error writing TP DB:', err);
    throw err;
  }
}

export function updateTpStats(data) {
  const trades = data.tradeHistory || [];
  data.statistics = {
    totalTpTrades: trades.length,
    tpWins: trades.filter(t => t.profit > 0).length,
    tpLosses: trades.filter(t => t.profit <= 0).length,
    tpWinRate: trades.length ? (trades.filter(t => t.profit > 0).length / trades.length) * 100 : 0,
    tpTotalProfit: trades.reduce((s, t) => s + (t.profit || 0), 0),
    tpAvgProfit: trades.length ? trades.reduce((s, t) => s + (t.profit || 0), 0) / trades.length : 0,
    tpAvgTrend: trades.length ? trades.reduce((s, t) => s + (t.trend || 0), 0) / trades.length : 0,
    tpAvgDuration: trades.length ? trades.reduce((s, t) => s + (t.duration || 0), 0) / trades.length : 0,
  };
  logger.info(`TP Stats Updated: ${JSON.stringify(data.statistics)}`);
}

// =========== PAPER TRADES DB =================
export async function readPaperTradesDB() {
  try {
    const exists = await fs.pathExists(PAPER_TRADES_DB_PATH);
    if (!exists) {
      const initialData = {
        tradeHistory: [],
      };
      await fs.writeJson(PAPER_TRADES_DB_PATH, initialData, { spaces: 2 });
      return initialData;
    }
    const data = await fs.readJson(PAPER_TRADES_DB_PATH);
    if (!data.tradeHistory) data.tradeHistory = [];
    return data;
  } catch (err) {
    logger.error('Error reading Paper Trades DB:', err);
    return {
      tradeHistory: [],
    };
  }
}

export async function writePaperTradesDB(data) {
  try {
    await fs.writeJson(PAPER_TRADES_DB_PATH, data, { spaces: 2 });
    logger.info('Paper Trades DB successfully written.');
  } catch (err) {
    logger.error('Error writing Paper Trades DB:', err);
    throw err;
  }
}
