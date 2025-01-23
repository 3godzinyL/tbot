// trade.js

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
  writePaperTradesDB
} from './db.js';

import { v4 as uuidv4 } from 'uuid';
import winston from 'winston';
import { updateBotUI } from './ui.js';
import { getCurrentPrice } from './binanceApi.js';

// Konfiguracja loggera
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
 * Loguje TP trade (Take Profit) do osobnego pliku TP.
 */
export async function logTpTrade(tpTrade, isClosing = false) {
  logger.info(`logTpTrade: ID=${tpTrade?.id}, isClosing=${isClosing}`);
  try {
    const indicator = tpTrade.indicator;

    // ECI (agregowane) raczej nie obsługujemy w "TP panelu"
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
          logger.warn(`Global: TP Trade with ID ${tpTrade.id} not found or already closed.`);
        }
      }
      updateGlobalStats(globalDB);
      await writeDB(globalDB);

    } else if (indicator === 'easy_entry' || indicator === 'ut_bot') {
      // Logika do pliku TP (tp.json / bc/tpTrades.json)
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
          logger.warn(`TP Trade with ID ${tpTrade.id} not found or closed.`);
        }
      }
      updateTpStats(tpData);
      await writeTPDB(tpData);

    } else {
      logger.warn(`Indicator ${indicator} does not require TP trade logging.`);
    }

    logger.info(`TP Trade ${isClosing ? 'closed' : 'logged'}: ${tpTrade.type.toUpperCase()} ${tpTrade.symbol}`);
  } catch (error) {
    logger.error(`Error logging TP trade: ${error}`);
  }
}

/**
 * Loguje trade (zarówno realny, jak i papierowy).
 */
export async function logTrade(trade, isClosing = false, isRealTrade = true) {
  logger.info(`Logging trade: ${trade.id}, isClosing=${isClosing}, isRealTrade=${isRealTrade}`);
  try {
    const requiredFields = ['id','indicator','type','symbol','price','quantity'];
    const hasAllFields = requiredFields.every(
      field => trade[field] !== undefined && trade[field] !== null && trade[field] !== ''
    );
    if (!hasAllFields) {
      logger.error(`Trade is missing required fields: ${JSON.stringify(trade)}`);
      return;
    }

    // 1) Log do globalDB (db.json)
    const globalDB = await readDB();

    if (!isClosing) {
      // Nowa transakcja
      globalDB.tradeHistory.push(trade);
      logger.info(`New global trade logged: ${trade.id}`);
    } else {
      // Zamknięcie istniejącego
      const existingGlobalTrade = globalDB.tradeHistory.find(t => t.id === trade.id && t.endTime === null);
      if (existingGlobalTrade) {
        Object.assign(existingGlobalTrade, {
          endTime: trade.endTime,
          exitPrice: trade.exitPrice,
          duration: trade.duration,
          profit: trade.profit,
          margin: trade.margin,
          percentProfit: trade.percentProfit,
          fee: trade.fee,
          percentFee: trade.percentFee,
        });
        logger.info(`Global trade updated: ${trade.id}`);
      } else {
        logger.warn(`Global: Trade with ID ${trade.id} not found or already closed.`);
      }
    }
    updateGlobalStats(globalDB);
    await writeDB(globalDB);

    // 2) Logowanie do odpowiedniego wskaźnika (i ewentualnie agregatora ECI)
    await logTradeToIndicator(trade, isClosing);

    // 3) Trade realny -> Exchange DB, wpp -> Paper DB
    if (isRealTrade) {
      if (trade.indicator === 'futures') {
        const exchangeDB = await readExchangeDB();
        if (!isClosing) {
          exchangeDB.tradeHistory.push(trade);
          logger.info(`New exchange trade logged: ${trade.id}`);
        } else {
          const existingTrade = exchangeDB.tradeHistory.find(t => t.id === trade.id && t.endTime === null);
          if (existingTrade) {
            Object.assign(existingTrade, {
              endTime: trade.endTime,
              exitPrice: trade.exitPrice,
              duration: trade.duration,
              profit: trade.profit,
              margin: trade.margin,
              percentProfit: trade.percentProfit,
              fee: trade.fee,
              percentFee: trade.percentFee,
            });
            logger.info(`Exchange trade updated: ${trade.id}`);
          } else {
            logger.warn(`Exchange: Trade with ID ${trade.id} not found or closed.`);
          }
        }
        updateExchangeStats(exchangeDB);
        await writeExchangeDB(exchangeDB);
      }
      // eci_long / easy_entry / ut_bot -> już zapisane w logTradeToIndicator
    } else {
      // Papierowe
      const paperTradesDB = await readPaperTradesDB();
      if (!isClosing) {
        paperTradesDB.tradeHistory.push(trade);
        logger.info(`New paper trade logged: ${trade.id}`);
      } else {
        const existingTrade = paperTradesDB.tradeHistory.find(t => t.id === trade.id && t.endTime === null);
        if (existingTrade) {
          Object.assign(existingTrade, {
            endTime: trade.endTime,
            exitPrice: trade.exitPrice,
            duration: trade.duration,
            profit: trade.profit,
            margin: trade.margin,
            percentProfit: trade.percentProfit,
            fee: trade.fee,
            percentFee: trade.percentFee,
          });
          logger.info(`Paper trade updated: ${trade.id}`);
        } else {
          logger.warn(`Paper: Trade with ID ${trade.id} not found or already closed.`);
        }
      }
      await writePaperTradesDB(paperTradesDB);
    }

    // 4) Aktualizacja UI
    const dbData = await readDB();
    await updateBotUI({ ...dbData, eciStats: await readIndicatorDB('eci_long') });

    logger.info(`Trade ${isClosing ? 'closed' : 'logged'}: [${trade.indicator}] ${trade.type.toUpperCase()} ${trade.symbol}`);
  } catch (error) {
    logger.error(`Error logging trade: ${error}`);
  }
}

/**
 * Loguje do pliku wskaźnika + ewentualnie do agregatora ECI.
 */
async function logTradeToIndicator(trade, isClosing) {
  try {
    // 1) Najpierw do pliku sub-wersji (np. eci_longC.json)
    const indicatorDB = await readIndicatorDB(trade.indicator);

    if (!isClosing) {
      // nowy trade
      indicatorDB.tradeHistory.push(trade);
      logger.info(`[logTradeToIndicator] New trade -> ${trade.indicator}: ${trade.id}`);
    } else {
      // zamknięcie
      const existing = indicatorDB.tradeHistory.find(t => t.id === trade.id && t.endTime === null);
      if (existing) {
        Object.assign(existing, {
          endTime: trade.endTime,
          exitPrice: trade.exitPrice,
          duration: trade.duration,
          profit: trade.profit,
          margin: trade.margin,
          percentProfit: trade.percentProfit,
          fee: trade.fee,
          percentFee: trade.percentFee,
          balanceAfter: trade.balanceAfter ?? existing.balanceAfter,
        });
        logger.info(`[logTradeToIndicator] Updated trade -> ${trade.indicator}: ${trade.id}`);
      } else {
        logger.warn(`[logTradeToIndicator] NOT FOUND (or closed) in ${trade.indicator}: ID=${trade.id}`);
      }
    }

    // 2) Zaktualizuj statystyki sub-wersji
    await updateIndicatorStats(indicatorDB, trade.indicator);
    // 3) Zapisz do pliku
    await writeIndicatorDB(trade.indicator, indicatorDB);

    logger.info(`[logTradeToIndicator] AFTER WRITE: Sub-version '${trade.indicator}' has total trades: ${indicatorDB.tradeHistory.length}`);

    // 4) Jeśli to jest sub-wersja eci_longX => dopisujemy do agregatora eci_long
    if (trade.indicator.startsWith('eci_long') && trade.indicator !== 'eci_long') {
      const aggregatorID = trade.id + '_agg';
      const aggregatorDB = await readIndicatorDB('eci_long');

      // Klon trade'a do "agregatora"
      const aggregatorTrade = {
        ...trade,
        id: aggregatorID,
        indicator: 'eci_long',
        subIndicator: trade.indicator,
      };

      if (!isClosing) {
        aggregatorDB.tradeHistory.push(aggregatorTrade);
        logger.info(`[logTradeToIndicator] Aggregator new trade -> eci_long, ID=${aggregatorID} (from ${trade.indicator})`);
      } else {
        const existingAgg = aggregatorDB.tradeHistory.find(t => t.id === aggregatorID && t.endTime === null);
        if (existingAgg) {
          Object.assign(existingAgg, {
            endTime: aggregatorTrade.endTime,
            exitPrice: aggregatorTrade.exitPrice,
            duration: aggregatorTrade.duration,
            profit: aggregatorTrade.profit,
            margin: aggregatorTrade.margin,
            percentProfit: aggregatorTrade.percentProfit,
            fee: aggregatorTrade.fee,
            percentFee: aggregatorTrade.percentFee,
            balanceAfter: aggregatorTrade.balanceAfter ?? existingAgg.balanceAfter,
          });
          logger.info(`[logTradeToIndicator] Aggregator updated -> ID=${aggregatorID}`);
        } else {
          logger.warn(`[logTradeToIndicator] Aggregator eci_long: can't find open trade ID=${aggregatorID}`);
        }
      }

      // 5) updateIndicatorStats + zapis do eci_long
      await updateIndicatorStats(aggregatorDB, 'eci_long');
      await writeIndicatorDB('eci_long', aggregatorDB);

      logger.info(`[logTradeToIndicator] AFTER WRITE aggregator: 'eci_long' total trades: ${aggregatorDB.tradeHistory.length}`);
    }

  } catch (err) {
    logger.error(`Error in logTradeToIndicator: ${err}`);
  }
}

/**
 * handleNewTrade – obsługa nowego alertu, tworzy nowy trade.
 */
export async function handleNewTrade(alertData) {
  try {
    logger.info('handleNewTrade called with: ' + JSON.stringify(alertData));

    const {
      indicator,
      type,        // "buy" / "sell" / ewentualnie "slCross" / "tpCross"
      symbol,
      price,
      quantity,
      stopLoss,
      takeProfit
    } = alertData;

    // 1) Minimalna walidacja
    if (!indicator || !type || !symbol || !price) {
      logger.error(`Missing fields in alert: ${JSON.stringify(alertData)}`);
      return;
    }
    const pPrice = parseFloat(price);
    if (isNaN(pPrice) || pPrice <= 0) {
      logger.error(`Invalid price in alert: ${price}`);
      return;
    }

    // =============== [ECI: SKIP slCross/tpCross] ===============
    if (
      indicator.startsWith('eci_long') && 
      (type === 'slCross' || type === 'tpCross')
    ) {
      // Dla subwersji ECI całkowicie ignorujemy alerty "SL" czy "TP" 
      // (według wymagań – "nie zamyka trade przy alercie sl/tp dla eci").
      logger.info(`Ignoring slCross/tpCross alert for ECI sub-version: ${indicator}`);
      return;
    }
    // ===========================================================

    // 2) Czy to trade realny czy paper
    const isRealTrade = !alertData._paper; // true=real, false=paper

    // 3) Zamykanie przeciwnych pozycji (np. SELL -> wchodzi BUY)
    await closeOppositeTrades(indicator, type, pPrice, isRealTrade);

    // 4) Konstruujemy obiekt nowego trade
    let finalQty = parseFloat(quantity || 0.01);
    let usedMargin = 0;
    let leverage = 125; 

    // Dla sub-wersji eci_longA…E wczytujemy parametry z JSON
    if (/^eci_long[ABCDE]$/.test(indicator)) {
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
      const balanceBefore = subDB.settings.currentBalance || 100;
      const tradePercent = subDB.settings.tradePercent || 10;
      leverage = subDB.settings.leverage || 125;

      // Ile USDT chcemy zaryzykować
      const positionSizeUSDT = balanceBefore * (tradePercent / 100);
      usedMargin = positionSizeUSDT;

      // Całkowity rozmiar pozycji w USDT (z dźwignią)
      const totalPosValueUSDT = usedMargin * leverage;
      // Ilość coina
      finalQty = totalPosValueUSDT / pPrice;
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

    if (/^eci_long[ABCDE]$/.test(indicator)) {
      // Zapamiętujemy stan salda sub-wersji w momencie otwarcia
      const subDB = await readIndicatorDB(indicator);
      newTrade.balanceBefore = subDB.settings?.currentBalance || 100;
    }

    // 5) Logujemy transakcję
    if (isRealTrade) {
      await executeTrade(newTrade, async (updatedDB) => {
        await updateBotUI(updatedDB);
      });
    } else {
      await executePaperTrade(newTrade, async (updatedDB) => {
        await updateBotUI(updatedDB);
      });
    }

    logger.info(`handleNewTrade: subVer=${indicator}, type=${type}, real=${isRealTrade}`);
  } catch (err) {
    logger.error(`Error in handleNewTrade: ${err}`);
  }
}

/**
 * Zamyka wszystkie otwarte transakcje w danej sub-wersji ECI.
 */
export async function closeAllEciSubTrades(subIndicator, exitPrice, updateBotUICallback=()=>{}) {
  try {
    logger.info(`closeAllEciSubTrades for ${subIndicator} at price=${exitPrice}`);
    const dbData = await readDB();
    const openSubTrades = dbData.tradeHistory.filter(
      t => t.indicator === subIndicator && t.endTime === null && t.realTrade
    );
    for(const tr of openSubTrades) {
      await closeTrade(tr.id, exitPrice, updateBotUICallback, true);
      logger.info(`Closed subversion trade: ${tr.id}`);
    }
  } catch(err) {
    logger.error(`Error in closeAllEciSubTrades: ${err}`);
  }
}

/**
 * Zamyka wszystkie otwarte transakcje w eci_long (agregat).
 */
export async function closeAllEciLongTrades(exitPrice, updateBotUICallback = () => {}) {
  try {
    logger.info(`closeAllEciLongTrades at ${exitPrice}`);
    const dbData = await readDB();
    const eciLongTrades = dbData.tradeHistory.filter(
      t => t.indicator === 'eci_long' && t.endTime === null && t.realTrade
    );
    for(const trade of eciLongTrades) {
      await closeTrade(trade.id, exitPrice, updateBotUICallback, true);
      logger.info(`ECI_Long aggregator Trade ${trade.id} closed at ${exitPrice}`);
    }
    await updateBotUICallback(await readDB());
  } catch (error) {
    logger.error(`Error closing all ECI_Long trades: ${error}`);
  }
}

/**
 * Zamknięcie trade (real/paper). Przeliczamy PnL, fee itp.
 */
export async function closeTrade(tradeId, exitPrice, updateBotUICallback = () => {}, isRealTrade = true) {
  try {
    logger.info(`closeTrade => ID=${tradeId}, exitPrice=${exitPrice}, isReal=${isRealTrade}`);

    const ePrice = parseFloat(exitPrice);
    if (isNaN(ePrice) || ePrice <= 0) {
      logger.warn(`Invalid exitPrice: ${exitPrice}`);
      return { success: false, message: 'Invalid exitPrice' };
    }

    // 1) Znajdź w globalDB
    const globalDB = await readDB();
    const openT = globalDB.tradeHistory.find(
      t => t.id === tradeId && t.endTime === null && t.realTrade === isRealTrade
    );
    if (!openT) {
      logger.warn(`Trade not found or already closed: ID=${tradeId}`);
      return { success: false, message: 'Not found or closed' };
    }

    // 2) Znajdź w pliku wskaźnika
    const indicatorDB = await readIndicatorDB(openT.indicator);
    const openI = indicatorDB.tradeHistory.find(t => t.id === tradeId && t.endTime === null);
    if (!openI) {
      logger.warn(`Trade not found in indicatorDB: ${openT.indicator}, ID=${tradeId}`);
      return { success: false, message: 'Not found in indicator DB' };
    }

    // 3) Obliczamy PnL
    const entryP = parseFloat(openT.price);
    const qty = parseFloat(openT.quantity);
    const usedMargin = parseFloat(openT.margin || 0);
    const lev = openT.leverage || 125;

    // Fee (proste, np. 0.04% *2)
    const feeRate = 0.0004;
    const volume = entryP * qty; 
    const totalFee = volume * feeRate * 2; // open+close
    
    let rawPnl = 0;
    if (openT.type === 'buy') {
      rawPnl = (ePrice - entryP) * qty;
    } else {
      rawPnl = (entryP - ePrice) * qty;
    }
    const profit = rawPnl - totalFee; 
    const percentProfit = (usedMargin > 0) ? (profit / usedMargin) * 100 : 0;

    // 4) Montujemy obiekt transakcji zamkniętej
    const closedT = {
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

    // 5) Jeżeli to sub-wersja eci_longA…E, aktualizujemy saldo
    if (/^eci_long[ABCDE]$/.test(openT.indicator)) {
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

      // Saldo = stary stan + profit
      const newBal = oldBal + profit;
      subDB.settings.currentBalance = newBal;

      // maxBalance/minBalance
      if (subDB.settings.maxBalance != null) {
        subDB.settings.maxBalance = Math.max(subDB.settings.maxBalance, newBal);
      }
      if (subDB.settings.minBalance != null) {
        subDB.settings.minBalance = Math.min(subDB.settings.minBalance, newBal);
      }

      // Zapisujemy w obiekcie zamkniętej transakcji
      closedT.balanceAfter = newBal;

      // Zapis do pliku sub-wersji
      await writeIndicatorDB(openT.indicator, subDB);

      logger.info(`[closeTrade] subVer ${openT.indicator} => oldBal=${oldBal}, newBal=${newBal}, profit=${profit.toFixed(2)}`);
    }

    // 6) Log zamknięcia (global + sub-wersja + aggregator ECI)
    await logTrade(closedT, true, isRealTrade);

    // 7) Update UI
    const newDB = await readDB();
    await updateBotUICallback(newDB);

    logger.info(`[closeTrade] Trade closed: ID=${tradeId}, profit=${profit.toFixed(2)}`);
    return { success: true, profit, percentProfit };
  } catch (err) {
    logger.error(`Error closing trade: ${err}`);
    return { success: false, message: String(err) };
  }
}

/**
 * Uruchamia papierowy trade – tylko zapis w DB (bez giełdy).
 */
export async function executePaperTrade(trade, updateBotUICallback = () => {}) {
  logger.info(`Executing paper trade: ${JSON.stringify(trade)}`);
  try {
    await logTrade(trade, false, false);
    logger.info(`Paper trade logged: ${trade.id}`);

    // TP (osobny trade) jeśli easy_entry/ut_bot
    if (!trade.indicator.startsWith('eci_long') && trade.takeProfit) {
      const tpTrade = { ...trade, id: uuidv4() };
      await logTpTrade(tpTrade, false);
      logger.info(`Paper TP trade logged: ${tpTrade.id}`);
    }

    const dbData = await readDB();
    await updateBotUICallback(dbData);

    logger.info(`Paper trade executed: ID=${trade.id}`);
  } catch (err) {
    logger.error(`Error executing paper trade: ${err}`);
  }
}

/**
 * Realny trade (np. zlecenie market) – tu ograniczamy się do logowania w DB.
 */
export async function executeTrade(trade, updateBotUICallback = () => {}) {
  try {
    logger.info(`Executing real trade: ${JSON.stringify(trade)}`);

    await logTrade(trade, false, true);
    logger.info(`Real trade logged: ${trade.id}`);

    // TP w easy_entry/ut_bot (poza ECI sub-wersjami)
    if (!trade.indicator.startsWith('eci_long') && trade.takeProfit) {
      const tpTrade = { ...trade, id: uuidv4() };
      await logTpTrade(tpTrade, false);
      logger.info(`TP Trade logged: ${tpTrade.id}`);
    }

    const dbData = await readDB();
    await updateBotUICallback(dbData);

    logger.info(`Real trade executed (ID=${trade.id})`);
  } catch (err) {
    logger.error(`Error executing real trade: ${err}`);
  }
}

/**
 * Zamyka TP trade (np. z tp.json).
 */
export async function closeTpTrade(tradeId, exitPrice) {
  try {
    logger.info(`closeTpTrade: ID=${tradeId}, exit=${exitPrice}`);
    const tpData = await readTPDB();
    const tpOpen = tpData.tradeHistory.find(t => t.id === tradeId && t.endTime === null);
    if(!tpOpen) {
      logger.warn(`TP trade not found or closed: ${tradeId}`);
      return { success:false, message:'TP not found or closed'};
    }
    const ePrice= parseFloat(exitPrice);
    const entryP= parseFloat(tpOpen.price);
    const qty= parseFloat(tpOpen.quantity||0);
    const lev= tpOpen.leverage||125;

    if(isNaN(ePrice)||isNaN(entryP)||isNaN(qty)){
      logger.error('Invalid TP trade params.');
      return {success:false, message:'Invalid TP params'};
    }

    const margin=(entryP*qty)/lev;
    const feeRate=0.0004;
    const volume= entryP*qty;
    const fee= volume*feeRate*2;
    let rawPnl=0;
    if(tpOpen.type==='buy'){
      rawPnl=(ePrice - entryP)*qty;
    } else {
      rawPnl=(entryP - ePrice)*qty;
    }
    const profit= rawPnl - fee;
    const percentProfit=(profit/margin)*100;

    const closedTp = {
      ...tpOpen,
      endTime: new Date().toISOString(),
      exitPrice: ePrice,
      duration: (Date.now() - new Date(tpOpen.startTime).getTime())/1000,
      profit,
      margin,
      percentProfit,
      fee,
      percentFee:(fee/margin)*100,
    };
    await logTpTrade(closedTp, true);
    logger.info(`TP trade closed: profit=${profit.toFixed(2)}`);
    return { success:true, profit, percentProfit };
  } catch (err) {
    logger.error(`Error closing TP trade: ${err}`);
    return { success:false, message:'Error closing TP trade.'};
  }
}

/**
 * Zamyka otwarte transakcje w danym wskaźniku o przeciwnym typie.
 */
export async function closeOppositeTrades(indicator, incomingType, exitPrice, isRealTrade = true) {
  try {
    logger.info(`closeOppositeTrades for ${indicator}, incomingType=${incomingType}, exitPrice=${exitPrice}`);
    const dbData = await readDB();
    const toClose = dbData.tradeHistory.filter(
      t => t.indicator === indicator
        && t.endTime === null
        && t.type !== incomingType
        && t.realTrade === isRealTrade
    );

    for (const tr of toClose) {
      logger.info(`Closing OPPOSITE trade ${tr.id} (type=${tr.type}) => new alert is ${incomingType}`);
      await closeTrade(tr.id, exitPrice, async (upd) => {
        await updateBotUI(upd);
      }, isRealTrade);
    }

  } catch (err) {
    logger.error(`Error in closeOppositeTrades: ${err}`);
  }
}

/**
 * Zamyka papierowy trade (analogicznie do closeTrade, ale isRealTrade=false).
 */
export async function closePaperTrade(tradeId, exitPrice) {
  try {
    logger.info(`closePaperTrade: ID=${tradeId}, exit=${exitPrice}`);
    return await closeTrade(tradeId, exitPrice, undefined, false);
  } catch (err) {
    logger.error(`Error closing Paper trade: ${err}`);
    return { success:false, message:'Error closing Paper trade.'};
  }
}

/**
 * Przykład monitorowania co 1 minutę – sprawdza open trades, zamyka je przy SL/TP.
 */
export async function monitorTrades() {
  try {
    logger.info('Starting trade monitoring...');
    const dbData = await readDB();
    const openTrades = dbData.tradeHistory.filter(t => t.endTime === null && t.realTrade);

    // Grupuj po indicator
    const tradesByInd = {};
    for(const t of openTrades) {
      if(!tradesByInd[t.indicator]) tradesByInd[t.indicator]=[];
      tradesByInd[t.indicator].push(t);
    }

    for(const [indicator, arr] of Object.entries(tradesByInd)) {
      if (!arr.length) continue;
      const symbol = arr[0].symbol;
      const curPrice = await getCurrentPrice(symbol);
      if(!curPrice) {
        logger.warn(`Could not fetch current price for ${symbol}`);
        continue;
      }

      // Obsługa eci_long sub-wersji:
      // Lepiej sprawdzać, czy i tak chcemy zamknąć ECI przy SL/TP.
      // W twoim wymogu "nie zamyka" – więc można pominąć.
      if (indicator.startsWith('eci_long')) {
        // W tym przykładzie: ignorujemy SL/TP w monitorze (nie zamykamy).
        logger.info(`monitorTrades => skipping SL/TP checks for eci_long sub-version: ${indicator}`);
        continue;
      }

      // Ewentualna obsługa easy_entry / ut_bot => zamknięcie, jeśli curPrice >= TP lub <= SL
      for(const tr of arr) {
        let doClose = false;
        if(tr.type==='buy') {
          if(tr.takeProfit && curPrice >= tr.takeProfit) doClose=true;
          if(tr.stopLoss && curPrice <= tr.stopLoss) doClose=true;
        } else {
          // SELL
          if(tr.takeProfit && curPrice <= tr.takeProfit) doClose=true;
          if(tr.stopLoss && curPrice >= tr.stopLoss) doClose=true;
        }
        if(doClose) {
          await closeTrade(tr.id, curPrice, async(dbUpd)=>{
            await updateBotUI(dbUpd);
          }, true);
          logger.info(`Closed trade ${tr.id} in ${indicator} due to TP/SL trigger.`);
        }
      }
    }

    // rekurencyjnie co 60s
    setTimeout(monitorTrades, 60000);

  } catch (error) {
    logger.error(`Error in monitorTrades: ${error}`);
  }
}
