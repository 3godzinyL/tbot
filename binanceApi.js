// binanceApi.js
import BinanceAPI from 'binance-api-node';
import dotenv from 'dotenv';
import axios from 'axios';
import winston from 'winston';

dotenv.config();

// Logger
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ timestamp, level, message }) => `${timestamp} ${level}: ${message}`)
  ),
  transports: [
    new winston.transports.File({ filename: 'binance-api-error.log', level: 'error' }),
    new winston.transports.File({ filename: 'binance-api-combined.log' }),
    new winston.transports.Console(),
  ],
});

const Binance = BinanceAPI.default || BinanceAPI;

let timeOffset = 0;

// Funkcja do pobrania offsetu czasowego
async function getTimeOffset() {
  try {
    const response = await axios.get('https://fapi.binance.com/fapi/v1/time');
    const serverTime = response.data.serverTime;
    const localTime = Date.now();
    const offset = serverTime - localTime;
    logger.info(`Time offset: ${offset} ms`);
    return offset;
  } catch (error) {
    logger.error('Error fetching server time:', error);
    return 0;
  }
}

// Inicjalizacja offsetu czasu przy starcie
async function initializeTimeOffset() {
  timeOffset = await getTimeOffset();
}

await initializeTimeOffset();

// Funkcja do okresowej aktualizacji timeOffset (co 60 sekund)
setInterval(async () => {
  timeOffset = await getTimeOffset();
}, 60000); // 60000 ms = 60 sekund

// Definicja funkcji getTime, która uwzględnia timeOffset
function getTime() {
  return Date.now() + timeOffset;
}

// Tworzenie klienta Binance z funkcją getTime
export const client = Binance({
  apiKey: process.env.BINANCE_API_KEY,
  apiSecret: process.env.BINANCE_API_SECRET,
  getTime,
});

// Funkcja do pobierania aktualnej ceny
export async function getCurrentPrice(symbol) {
  try {
    const response = await axios.get(`https://api.binance.com/api/v3/ticker/price?symbol=${symbol}`);
    return parseFloat(response.data.price);
  } catch (error) {
    logger.error(`Error fetching current price for ${symbol}:`, error);
    throw error;
  }
}

// Funkcje do pobierania salda z uwzględnieniem offsetu

export async function getFuturesBalance(retries = 3) {
  try {
    const futuresAccount = await client.futuresAccountInfo();
    const usdtAsset = futuresAccount.assets.find(a => a.asset === 'USDT');
    return usdtAsset ? parseFloat(usdtAsset.walletBalance) : 0;
  } catch (error) {
    if (error.code === -1021 && retries > 0) {
      logger.warn('Timestamp error, retrying after synchronizing time...');
      timeOffset = await getTimeOffset(); // Aktualizacja offsetu
      return await getFuturesBalance(retries - 1);
    } else {
      logger.error('Error fetching futures balance:', error);
      throw error;
    }
  }
}

export async function getTotalBalances(retries = 3) {
  try {
    const futuresAccount = await client.futuresAccountInfo();
    const usdtFuturesAsset = futuresAccount.assets.find(a => a.asset === 'USDT');
    const futures = usdtFuturesAsset ? parseFloat(usdtFuturesAsset.walletBalance) : 0;

    const spotInfo = await client.accountInfo();
    const usdtSpot = spotInfo.balances.find(b => b.asset === 'USDT');
    const spot = usdtSpot ? parseFloat(usdtSpot.free) : 0;

    const total = futures + spot;
    return { futures, spot, total };
  } catch (error) {
    if (error.code === -1021 && retries > 0) {
      logger.warn('Timestamp error, retrying after synchronizing time...');
      timeOffset = await getTimeOffset(); // Aktualizacja offsetu
      return await getTotalBalances(retries - 1);
    } else {
      logger.error('Error fetching total balances:', error);
      throw error;
    }
  }
}
