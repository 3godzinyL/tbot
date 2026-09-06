import {
  readDB,
  writeDB,
  updateGlobalStats,
  readIndicatorDB,
  writeIndicatorDB,
  updateIndicatorStats,
  readTPDB,
  writeTPDB,
  updateTpStats,
  readExchangeDB,
  writeExchangeDB,
  updateExchangeStats,
  readPaperTradesDB,
  writePaperTradesDB,
  readBCSettings
} from './db.js';

import { v4 as uuidv4 } from 'uuid';
import winston from 'winston';
import { updateBotUI } from './ui.js';
import { getCurrentPrice, getFuturesBalance } from './binanceApi.js';
import { openExchangeTrade, closeExchangeTrade } from './exchangeTrade.js';

// === LOGGER ===
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ timestamp, level, message }) => `${timestamp} ${level}: ${message}`)
  ),
  transports: [
    new winston.transports.File({ filename: 'trade-error.log', level: 'error' }),
    new winston.transports.File({ filename: 'trade-combined.log' }),
    new winston.transports.Console(),
  ],
});

/**
 * Loguje TP trade (Take Profit) do pliku tpTrades.json (dla easy_entry / ut_bot)
 * lub (opcjonalnie) do globalDB, jeśli indicator='eci_long'.
 */
export async function logTpTrade(tpTrade, isClosing = false) {
  logger.info(`logTpTrade: ID=${tpTrade?.id}, isClosing=${isClosing}`);
  try {
    const indicator = tpTrade.indicator;

    // 1) ECI agregat => loguj w globalDB (opcjonalne)
    if (indicator === 'eci_long') {
      const globalDB = await readDB();
      if (!isClosing) {
        globalDB.tradeHistory.push(tpTrade);
        logger.info(`New global TP trade logged: ${tpTrade.id}`);
      } else {
        const existingGlobalTpTrade = globalDB.tradeHistory.find(
          t => t.id === tpTrade.id && t.endTime === null && t.indicator === indicator
        );
        if (existingGlobalTpTrade) {
          Object.assign(existingGlobalTpTrade, {
            endTime: tpTrade.endTime,
            exitPrice: tpTrade.exitPrice,
            duration: tpTrade.duration,
            profit: tpTrade.profit,
            margin: tpTrade.margin,
            percentProfit: tpTrade.percentProfit,
            fee: tpTrade.fee,
            percentFee: tpTrade.percentFee,
          });
          logger.info(`Global TP trade updated: ${tpTrade.id}`);
        } else {
          logger.warn(`Global: TP Trade with ID ${tpTrade.id} not found or closed.`);
        }
      }
      updateGlobalStats(globalDB);
      await writeDB(globalDB);

    // 2) easy_entry / ut_bot => tpTrades.json
    } else if (indicator === 'easy_entry' || indicator === 'ut_bot') {
      const tpData = await readTPDB();
      if (!isClosing) {
        tpData.tradeHistory.push(tpTrade);
        logger.info(`New TP trade logged: ${tpTrade.id}`);
      } else {
        const existingTpTrade = tpData.tradeHistory.find(
          t => t.id === tpTrade.id && t.endTime === null
        );
        if (existingTpTrade) {
          Object.assign(existingTpTrade, {
            endTime: tpTrade.endTime,
            exitPrice: tpTrade.exitPrice,
            duration: tpTrade.duration,
            profit: tpTrade.profit,
            margin: tpTrade.margin,
            percentProfit: tpTrade.percentProfit,
            fee: tpTrade.fee,
            percentFee: tpTrade.percentFee,
          });
          logger.info(`TP trade updated: ${tpTrade.id}`);
        } else {
          logger.warn(`TP Trade with ID ${tpTrade.id} not found or already closed.`);
        }
      }
      updateTpStats(tpData);
      await writeTPDB(tpData);

    } else {
      // Inne wskaźniki => brak obsługi
      logger.warn(`Indicator ${indicator} does not require TP trade logging.`);
    }

    logger.info(
      `TP Trade ${isClosing ? 'closed' : 'logged'} => ${tpTrade.type.toUpperCase()} ${tpTrade.symbol}`
    );
  } catch (error) {
    logger.error(`Error logging TP trade: ${error}`);
  }
}

/**
 * Loguje trade (do globalDB, do wskaźnika, do exchange/paper).
 */
export async function logTrade(trade, isClosing = false, isRealTrade = true) {
  logger.info(`Logging trade: ${trade.id}, isClosing=${isClosing}, isRealTrade=${isRealTrade}`);
  try {
    // Walidacja
    const requiredFields = ['id','indicator','type','symbol','price','quantity'];
    const hasAllFields = requiredFields.every(
      field => trade[field] !== undefined && trade[field] !== null && trade[field] !== ''
    );
    if (!hasAllFields) {
      logger.error(`Trade missing fields => ${JSON.stringify(trade)}`);
      return;
    }

    // 1) Global DB
    const globalDB = await readDB();
    if (!isClosing) {
      globalDB.tradeHistory.push(trade);
      logger.info(`New global trade logged => ${trade.id}`);
    } else {
      const existingGlobal = globalDB.tradeHistory.find(
        t => t.id === trade.id && t.endTime === null
      );
      if (existingGlobal) {
        Object.assign(existingGlobal, {
          endTime: trade.endTime,
          exitPrice: trade.exitPrice,
          duration: trade.duration,
          profit: trade.profit,
          margin: trade.margin,
          percentProfit: trade.percentProfit,
          fee: trade.fee,
          percentFee: trade.percentFee,
        });
        logger.info(`Global trade updated => ${trade.id}`);
      } else {
        logger.warn(`Global: Trade with ID ${trade.id} not found or closed.`);
      }
    }
    updateGlobalStats(globalDB);
    await writeDB(globalDB);

    // 2) Logowanie do wskaźnika (i ewentualnie do eci_long agregatora)
    await logTradeToIndicator(trade, isClosing);

    // 3) Real -> exchangeTrades, Paper -> paperTrades
    if (isRealTrade) {
      const exchangeDB = await readExchangeDB();
      if (!isClosing) {
        exchangeDB.tradeHistory.push(trade);
        logger.info(`New exchange trade logged => ${trade.id}`);
      } else {
        const existingEx = exchangeDB.tradeHistory.find(
          t => t.id === trade.id && t.endTime === null
        );
        if (existingEx) {
          Object.assign(existingEx, {
            endTime: trade.endTime,
            exitPrice: trade.exitPrice,
            duration: trade.duration,
            profit: trade.profit,
            margin: trade.margin,
            percentProfit: trade.percentProfit,
            fee: trade.fee,
            percentFee: trade.percentFee,
          });
          logger.info(`Exchange trade updated => ${trade.id}`);
        } else {
          logger.warn(`Exchange: Trade with ID ${trade.id} not found or closed.`);
        }
      }
      updateExchangeStats(exchangeDB);
      await writeExchangeDB(exchangeDB);

    } else {
      // Papier
      const paperDB = await readPaperTradesDB();
      if (!isClosing) {
        paperDB.tradeHistory.push(trade);
        logger.info(`New paper trade logged => ${trade.id}`);
      } else {
        const existingPaper = paperDB.tradeHistory.find(
          t => t.id === trade.id && t.endTime === null
        );
        if (existingPaper) {
          Object.assign(existingPaper, {
            endTime: trade.endTime,
            exitPrice: trade.exitPrice,
            duration: trade.duration,
            profit: trade.profit,
            margin: trade.margin,
            percentProfit: trade.percentProfit,
            fee: trade.fee,
            percentFee: trade.percentFee,
          });
          logger.info(`Paper trade updated => ${trade.id}`);
        } else {
          logger.warn(`Paper: Trade with ID ${trade.id} not found or already closed.`);
        }
      }
      await writePaperTradesDB(paperDB);
    }

    // 4) Update UI
    const latestDB = await readDB();
    const eciStats = await readIndicatorDB('eci_long');
    await updateBotUI({ ...latestDB, eciStats });

    logger.info(
      `Trade ${isClosing ? 'closed' : 'logged'} => [${trade.indicator}] ${trade.type.toUpperCase()} ${trade.symbol}`
    );
  } catch (error) {
    logger.error(`Error logging trade => ${error}`);
  }
}

/**
 * Loguje do pliku wskaźnika + ewentualnie do "eci_long" (agregat).
 */
async function logTradeToIndicator(trade, isClosing = false) {
  try {
    const indicatorDB = await readIndicatorDB(trade.indicator);

    if (!isClosing) {
      indicatorDB.tradeHistory.push(trade);
      logger.info(`[logTradeToIndicator] New => ${trade.indicator}: ${trade.id}`);
    } else {
      const openT = indicatorDB.tradeHistory.find(
        t => t.id === trade.id && t.endTime === null
      );
      if (openT) {
        Object.assign(openT, {
          endTime: trade.endTime,
          exitPrice: trade.exitPrice,
          duration: trade.duration,
          profit: trade.profit,
          margin: trade.margin,
          percentProfit: trade.percentProfit,
          fee: trade.fee,
          percentFee: trade.percentFee,
          balanceAfter: trade.balanceAfter ?? openT.balanceAfter,
        });
        logger.info(`[logTradeToIndicator] Updated => ${trade.indicator}: ${trade.id}`);
      } else {
        logger.warn(`[logTradeToIndicator] Not found/or closed in ${trade.indicator}, ID=${trade.id}`);
      }
    }
    await updateIndicatorStats(indicatorDB, trade.indicator);
    await writeIndicatorDB(trade.indicator, indicatorDB);

    // eci_long aggregator
    if (trade.indicator.startsWith('eci_long') && trade.indicator !== 'eci_long') {
      const aggregatorID = trade.id + '_agg';
      const aggregatorDB = await readIndicatorDB('eci_long');

      const aggregatorTrade = {
        ...trade,
        id: aggregatorID,
        indicator: 'eci_long',
        subIndicator: trade.indicator,
      };

      if (!isClosing) {
        aggregatorDB.tradeHistory.push(aggregatorTrade);
        logger.info(`[logTradeToIndicator] eci_long aggregator => new trade ID=${aggregatorID}`);
      } else {
        const openAgg = aggregatorDB.tradeHistory.find(
          t => t.id === aggregatorID && t.endTime === null
        );
        if (openAgg) {
          Object.assign(openAgg, {
            endTime: aggregatorTrade.endTime,
            exitPrice: aggregatorTrade.exitPrice,
            duration: aggregatorTrade.duration,
            profit: aggregatorTrade.profit,
            margin: aggregatorTrade.margin,
            percentProfit: aggregatorTrade.percentProfit,
            fee: aggregatorTrade.fee,
            percentFee: aggregatorTrade.percentFee,
            balanceAfter: aggregatorTrade.balanceAfter ?? openAgg.balanceAfter,
          });
          logger.info(`[logTradeToIndicator] Aggregator updated => ID=${aggregatorID}`);
        } else {
          logger.warn(`[logTradeToIndicator] Aggregator eci_long: no open trade ID=${aggregatorID}`);
        }
      }
      await updateIndicatorStats(aggregatorDB, 'eci_long');
      await writeIndicatorDB('eci_long', aggregatorDB);
    }

  } catch (err) {
    logger.error(`Error in logTradeToIndicator => ${err}`);
  }
}

/**
 * handleNewTrade – obsługa nowego alertu z TradingView.
 */
export async function handleNewTrade(alertData) {
  try {
    logger.info('handleNewTrade => ' + JSON.stringify(alertData));

    const {
      indicator,
      type,
      symbol,
      price,
      quantity,
      stopLoss,
      takeProfit
    } = alertData;

    // Walidacja
    if (!indicator || !type || !symbol || !price) {
      logger.error(`Missing fields in alert => ${JSON.stringify(alertData)}`);
      return;
    }
    const pPrice = parseFloat(price);
    if (isNaN(pPrice) || pPrice <= 0) {
      logger.error(`Invalid price => ${price}`);
      return;
    }

    // (Opcjonalnie) ignoruj eci_long slCross/tpCross – ODKOMENTUJ, jeśli chcesz:
    /*
    if (
      indicator.startsWith('eci_long') &&
      (type === 'slCross' || type === 'tpCross')
    ) {
      logger.info(`Ignoring slCross/tpCross for ECI sub-ver => ${indicator}`);
      return;
    }
    */

    // Real czy Paper
    const isRealTrade = !alertData._paper;

    // Zamknij przeciwne
    await closeOppositeTrades(indicator, type, pPrice, isRealTrade);

    // Tworzymy newTrade
    let finalQty = parseFloat(quantity || 0.01);
    let usedMargin = 0;
    let leverage = 125;

    // ECI sub-wersje
    if (/^eci_long[ABCDE]$/.test(indicator)) {
      if (isRealTrade) {
        const bcSettings = await readBCSettings();
        const subKey = indicator;
        if (!bcSettings[subKey]?.active) {
          logger.info(`ECI sub-ver ${subKey} => active=false, skip real trade.`);
          return;
        }
        leverage = bcSettings[subKey].leverage || 125;
        const tradePercent = bcSettings[subKey].balancePercent || 10;

        const realFutBal = await getFuturesBalance();
        usedMargin = realFutBal * (tradePercent / 100);
        const totalPosValue = usedMargin * leverage;
        finalQty = totalPosValue / pPrice;
      } else {
        // Paper ECI
        const subDB = await readIndicatorDB(indicator);
        if (!subDB.settings) {
          subDB.settings = {
            initialBalance: 100,
            currentBalance: 100,
            tradePercent: 10,
            leverage: 125,
            maxBalance: 100,
            minBalance: 100,
          };
        }
        const balBefore = subDB.settings.currentBalance || 100;
        const tradePercent = subDB.settings.tradePercent || 10;
        leverage = subDB.settings.leverage || 125;

        usedMargin = balBefore * (tradePercent / 100);
        const totalPosValue = usedMargin * leverage;
        finalQty = totalPosValue / pPrice;
      }
    }

    const newTrade = {
      id: uuidv4(),
      indicator,
      type,
      symbol,
      price: pPrice,
      quantity: finalQty,
      leverage,
      stopLoss: stopLoss ? parseFloat(stopLoss) : null,
      takeProfit: takeProfit ? parseFloat(takeProfit) : null,
      realTrade: isRealTrade,

      startTime: new Date().toISOString(),
      endTime: null,

      profit: null,
      exitPrice: null,
      duration: null,
      margin: usedMargin,
      percentProfit: null,
      fee: null,
      percentFee: null,

      balanceBefore: null,
      balanceAfter: null,
    };

    // balanceBefore (paper ECI)
    if (!isRealTrade && /^eci_long[ABCDE]$/.test(indicator)) {
      const subDB = await readIndicatorDB(indicator);
      newTrade.balanceBefore = subDB.settings?.currentBalance || 100;
    }

    // Wywołanie
    if (isRealTrade) {
      await executeTrade(newTrade);
    } else {
      await executePaperTrade(newTrade);
    }
    logger.info(`handleNewTrade done => [${indicator}] type=${type}, real=${isRealTrade}`);
  } catch (err) {
    logger.error(`Error in handleNewTrade => ${err}`);
  }
}

/**
 * Zamyka otwarte transakcje w danym wskaźniku o przeciwnym typie (buy->close sell).
 */
export async function closeOppositeTrades(indicator, incomingType, exitPrice, isRealTrade = true) {
  try {
    logger.info(`closeOppositeTrades => indicator=${indicator}, newType=${incomingType}, exitPrice=${exitPrice}, isReal=${isRealTrade}`);
    const dbData = await readDB();
    const toClose = dbData.tradeHistory.filter(
      t => t.indicator === indicator &&
           t.endTime === null &&
           t.type !== incomingType &&
           t.realTrade === isRealTrade
    );

    for (const oldTr of toClose) {
      logger.info(`Closing OPPOSITE => ${oldTr.id} (type=${oldTr.type}), newType=${incomingType}`);
      await closeTrade(oldTr.id, exitPrice, undefined, isRealTrade);
    }
  } catch (err) {
    logger.error(`Error in closeOppositeTrades => ${err}`);
  }
}

/**
 * Zamknięcie jednej transakcji (paper lub real).
 */
export async function closeTrade(tradeId, exitPrice, updateBotUICallback = () => {}, isRealTrade = true) {
  try {
    logger.info(`closeTrade => ID=${tradeId}, exitPrice=${exitPrice}, isReal=${isRealTrade}`);

    const ePrice = parseFloat(exitPrice);
    if (isNaN(ePrice) || ePrice <= 0) {
      logger.warn(`Invalid exitPrice => ${exitPrice}`);
      return { success: false, message: 'Invalid exitPrice' };
    }

    // 1) Znajdź w globalDB
    const globalDB = await readDB();
    const openT = globalDB.tradeHistory.find(
      t => t.id === tradeId && t.endTime === null && t.realTrade === isRealTrade
    );
    if (!openT) {
      logger.warn(`Trade not found or closed => ID=${tradeId}`);
      return { success: false, message: 'Not found or closed' };
    }

    // 2) Real => zamknij na Binance
    if (isRealTrade) {
      await closeExchangeTrade(tradeId, ePrice);
    }

    // 3) PnL
    const entryP = parseFloat(openT.price);
    const qty = parseFloat(openT.quantity);
    const usedMargin = parseFloat(openT.margin || 0);
    const feeRate = 0.0004;
    const volume = entryP * qty;
    const totalFee = volume * feeRate * 2;

    let rawPnl = 0;
    if (openT.type === 'buy') {
      rawPnl = (ePrice - entryP) * qty;
    } else {
      rawPnl = (entryP - ePrice) * qty;
    }
    const profit = rawPnl - totalFee;
    const percentProfit = (usedMargin > 0) ? (profit / usedMargin) * 100 : 0;

    // 4) Zbuduj closedTrade
    const closedTrade = {
      ...openT,
      endTime: new Date().toISOString(),
      exitPrice: ePrice,
      duration: (Date.now() - new Date(openT.startTime).getTime()) / 1000,
      profit,
      margin: usedMargin,
      percentProfit,
      fee: totalFee,
      percentFee: (usedMargin > 0) ? (totalFee / usedMargin) * 100 : 0,
    };

    // 5) Jeśli PAPER ECI -> aktualizacja salda
    if (!isRealTrade && /^eci_long[ABCDE]$/.test(openT.indicator)) {
      const subDB = await readIndicatorDB(openT.indicator);
      if (!subDB.settings) {
        subDB.settings = {
          initialBalance: 100,
          currentBalance: 100,
          tradePercent: 10,
          leverage: 125,
        };
      }
      const oldBal = parseFloat(subDB.settings.currentBalance || 0);
      const newBal = oldBal + profit;
      subDB.settings.currentBalance = newBal;

      if (subDB.settings.maxBalance != null) {
        subDB.settings.maxBalance = Math.max(subDB.settings.maxBalance, newBal);
      }
      if (subDB.settings.minBalance != null) {
        subDB.settings.minBalance = Math.min(subDB.settings.minBalance, newBal);
      }
      closedTrade.balanceAfter = newBal;
      await writeIndicatorDB(openT.indicator, subDB);
      logger.info(`[closeTrade] PAPER ECI => oldBal=${oldBal}, newBal=${newBal}, profit=${profit.toFixed(2)}`);
    }

    // 6) Zapis (isClosing=true)
    await logTrade(closedTrade, true, isRealTrade);

    // 7) Update UI
    if (updateBotUICallback) {
      const freshDb = await readDB();
      await updateBotUICallback(freshDb);
    }

    logger.info(`[closeTrade] Done => ID=${tradeId}, profit=${profit.toFixed(2)}`);
    return { success: true, profit, percentProfit };
  } catch (err) {
    logger.error(`Error closing trade => ${err}`);
    return { success: false, message: String(err) };
  }
}

/**
 * Zamknięcie papierowego trade (analogicznie do closeTrade, ale isReal=false).
 */
export async function closePaperTrade(tradeId, exitPrice) {
  try {
    logger.info(`closePaperTrade => ID=${tradeId}, exitPrice=${exitPrice}`);
    return await closeTrade(tradeId, exitPrice, undefined, false);
  } catch (err) {
    logger.error(`Error closing Paper trade => ${err}`);
    return { success: false, message: 'Error closing Paper trade.' };
  }
}

/**
 * Otwórz papierowy trade (zapis w paperTradesDB, brak giełdy).
 */
export async function executePaperTrade(trade, updateBotUICallback = () => {}) {
  logger.info(`executePaperTrade => ${JSON.stringify(trade)}`);
  try {
    // 1) logTrade(isRealTrade=false)
    await logTrade(trade, false, false);

    // 2) ewentualny TP (easy_entry/ut_bot)
    if (!trade.indicator.startsWith('eci_long') && trade.takeProfit) {
      const tpTrade = { ...trade, id: uuidv4() };
      await logTpTrade(tpTrade, false);
      logger.info(`Paper TP trade logged => ${tpTrade.id}`);
    }

    // 3) Update UI
    const dbData = await readDB();
    await updateBotUICallback(dbData);

    logger.info(`Paper trade executed => ID=${trade.id}`);
  } catch (err) {
    logger.error(`Error executing paper trade => ${err}`);
  }
}

/**
 * Otwórz REAL trade na Binance (market) + zapisz do DB.
 */
export async function executeTrade(trade, updateBotUICallback = () => {}) {
  try {
    logger.info(`executeTrade => ${JSON.stringify(trade)}`);

    // 1) Otwieramy pozycję (market) na Binance
    await openExchangeTrade(trade);

    // 2) logTrade(isReal=true)
    await logTrade(trade, false, true);

    // 3) ewentualny TP (dla easy_entry / ut_bot)
    if (!trade.indicator.startsWith('eci_long') && trade.takeProfit) {
      const tpTrade = { ...trade, id: uuidv4() };
      await logTpTrade(tpTrade, false);
      logger.info(`Real TP trade logged => ${tpTrade.id}`);
    }

    // 4) Update UI
    const dbData = await readDB();
    await updateBotUICallback(dbData);

    logger.info(`Real trade executed => ID=${trade.id}`);
  } catch (err) {
    logger.error(`Error executing real trade => ${err}`);
  }
}

/**
 * Zamyka TP trade (z pliku tpTrades.json).
 */
export async function closeTpTrade(tradeId, exitPrice) {
  try {
    logger.info(`closeTpTrade => ID=${tradeId}, exit=${exitPrice}`);
    const tpData = await readTPDB();
    const tpOpen = tpData.tradeHistory.find(
      t => t.id === tradeId && t.endTime === null
    );
    if (!tpOpen) {
      logger.warn(`TP trade not found or closed => ID=${tradeId}`);
      return { success: false, message: 'TP not found or closed' };
    }

    const ePrice = parseFloat(exitPrice);
    const entryP = parseFloat(tpOpen.price);
    const qty = parseFloat(tpOpen.quantity || 0);
    const lev = tpOpen.leverage || 125;

    if (isNaN(ePrice) || isNaN(entryP) || isNaN(qty)) {
      logger.error('Invalid TP trade params');
      return { success: false, message: 'Invalid TP params' };
    }

    const margin = (entryP * qty) / lev;
    const feeRate = 0.0004;
    const volume = entryP * qty;
    const fee = volume * feeRate * 2;

    let rawPnl = 0;
    if (tpOpen.type === 'buy') {
      rawPnl = (ePrice - entryP) * qty;
    } else {
      rawPnl = (entryP - ePrice) * qty;
    }
    const profit = rawPnl - fee;
    const percentProfit = (profit / margin) * 100;

    const closedTp = {
      ...tpOpen,
      endTime: new Date().toISOString(),
      exitPrice: ePrice,
      duration: (Date.now() - new Date(tpOpen.startTime).getTime()) / 1000,
      profit,
      margin,
      percentProfit,
      fee,
      percentFee: (fee / margin) * 100,
    };
    await logTpTrade(closedTp, true);
    logger.info(`TP trade closed => ID=${tradeId}, profit=${profit.toFixed(2)}`);
    return { success: true, profit, percentProfit };
  } catch (err) {
    logger.error(`Error closing TP trade => ${err}`);
    return { success: false, message: 'Error closing TP trade.' };
  }
}

/**
 * Monitor co 1 min – sprawdza otwarte realTrade i zamyka je przy SL/TP (easy/ut).
 */
export async function monitorTrades() {
  try {
    logger.info('Starting trade monitoring...');
    const dbData = await readDB();
    const openTrades = dbData.tradeHistory.filter(
      t => t.endTime === null && t.realTrade
    );

    // Grupuj po indicator
    const tradesByInd = {};
    for (const t of openTrades) {
      if (!tradesByInd[t.indicator]) tradesByInd[t.indicator] = [];
      tradesByInd[t.indicator].push(t);
    }

    for (const [indicator, arr] of Object.entries(tradesByInd)) {
      if (!arr.length) continue;
      const symbol = arr[0].symbol;
      const curPrice = await getCurrentPrice(symbol);
      if (!curPrice) {
        logger.warn(`Could not fetch current price => ${symbol}`);
        continue;
      }

      // eci_long – skip sl/tp
      if (indicator.startsWith('eci_long')) {
        logger.info(`monitorTrades => skip SL/TP checks for eci_long => ${indicator}`);
        continue;
      }

      // easy_entry / ut_bot => zamknięcie, jeśli curPrice >= TP lub <= SL
      for (const tr of arr) {
        let doClose = false;
        if (tr.type === 'buy') {
          if (tr.takeProfit && curPrice >= tr.takeProfit) doClose = true;
          if (tr.stopLoss && curPrice <= tr.stopLoss) doClose = true;
        } else {
          // SELL
          if (tr.takeProfit && curPrice <= tr.takeProfit) doClose = true;
          if (tr.stopLoss && curPrice >= tr.stopLoss) doClose = true;
        }
        if (doClose) {
          await closeTrade(tr.id, curPrice, async (dbUpd) => {
            await updateBotUI(dbUpd);
          }, true);
          logger.info(`Closed trade ${tr.id} in ${indicator} => SL/TP trigger.`);
        }
      }
    }

    // rekurencyjnie co 60s
    setTimeout(monitorTrades, 60000);

  } catch (error) {
    logger.error(`Error in monitorTrades => ${error}`);
  }
}

/**
 * Zamknięcie wszystkich otwartych *realnych* transakcji w sub-wersji ECI (np. eci_longA).
 */
export async function closeAllEciSubTrades(subIndicator, exitPrice, updateBotUICallback = () => {}) {
  try {
    logger.info(`closeAllEciSubTrades => subIndicator=${subIndicator}, exitPrice=${exitPrice}`);
    const dbData = await readDB();
    const openSubTrades = dbData.tradeHistory.filter(
      t => t.indicator === subIndicator && t.endTime === null && t.realTrade
    );

    for (const tr of openSubTrades) {
      await closeTrade(tr.id, exitPrice, updateBotUICallback, true);
      logger.info(`Closed subversion trade => ${tr.id}`);
    }
  } catch (err) {
    logger.error(`Error in closeAllEciSubTrades => ${err}`);
  }
}

/**
 * Zamknięcie wszystkich otwartych *realnych* transakcji w aggregatorze `eci_long`.
 */
export async function closeAllEciLongTrades(exitPrice, updateBotUICallback = () => {}) {
  try {
    logger.info(`closeAllEciLongTrades => exitPrice=${exitPrice}`);
    const dbData = await readDB();
    const eciLongTrades = dbData.tradeHistory.filter(
      t => t.indicator === 'eci_long' && t.endTime === null && t.realTrade
    );

    for (const trade of eciLongTrades) {
      await closeTrade(trade.id, exitPrice, updateBotUICallback, true);
      logger.info(`ECI_Long aggregator trade => ${trade.id} closed at ${exitPrice}`);
    }
    await updateBotUICallback(await readDB());
  } catch (error) {
    logger.error(`Error closing all ECI_Long trades => ${error}`);
  }
}
