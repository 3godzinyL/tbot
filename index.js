import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import dotenv from 'dotenv';
import fs from 'fs-extra';
import { injectBotUI, updateBotUI } from './ui.js';
import app from './server.js';
import { readDB } from './db.js';
import { handleNewTrade, closeAllEciSubTrades } from './trade.js';
import { v4 as uuidv4 } from 'uuid';
import winston from 'winston';
import { readExchangeDB } from './db.js';
import { monitorTrades } from './trade.js';
import { monitorExchangeTrades } from './exchangeTrade.js';
import EventEmitter from 'events';

// Wczytaj .env
dotenv.config();

// Stealth Puppeteer
puppeteer.use(StealthPlugin());

// Logger
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ timestamp, level, message }) => `${timestamp} ${level}: ${message}`)
  ),
  transports: [
    new winston.transports.File({ filename: 'monitor-error.log', level: 'error' }),
    new winston.transports.File({ filename: 'monitor-combined.log' }),
    new winston.transports.Console()
  ],
});

// Alert -> trade
const eventEmitter = new EventEmitter();
eventEmitter.on('newAlert', async (alertData) => {
  logger.info('New alert received. Running monitors...');
  await monitorTrades();
  await monitorExchangeTrades();
});

// Globalne
let browserInstance;
let pageInstance;
let isTrading = false;

// User agents
const userAgents = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64)...',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)...'
];

// Port
const PORT = process.env.WEBHOOK_PORT || 3000;

async function monitorTradingView() {
  if (isTrading) {
    logger.warn('Monitoring is already active.');
    return;
  }
  isTrading = true;

  try {
    const randomUserAgent = userAgents[Math.floor(Math.random() * userAgents.length)];
    browserInstance = await puppeteer.launch({
      headless: false,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--window-size=1920,1080',
        '--disable-dev-shm-usage',
        '--disable-extensions',
        '--disable-gpu',
      ],
      defaultViewport: null,
    });
    pageInstance = await browserInstance.newPage();
    await pageInstance.setUserAgent(randomUserAgent);

    // Logi z konsoli/błędy strony
    pageInstance.on('console', (msg) => {
      for (let i = 0; i < msg.args().length; ++i) {
        logger.info(`PAGE LOG: ${msg.args()[i]}`);
      }
    });
    pageInstance.on('pageerror', (error) => {
      logger.error(`PAGE ERROR: ${error?.message || error}`);
    });

    // ----------------- 1) Czy mamy cookies? -----------------
    let hasCookies = false;
    try {
      if (await fs.pathExists('cookies.json')) {
        const content = await fs.readFile('cookies.json', 'utf8');
        if (content.trim().length > 0) {
          const cookies = JSON.parse(content);
          if (cookies.length > 0) {
            await pageInstance.setCookie(...cookies);
            hasCookies = true;
            logger.info('Cookies found and loaded. Assuming user is logged in.');
          } else {
            logger.info('cookies.json is empty array, skipping...');
          }
        } else {
          logger.info('cookies.json is empty file, skipping...');
        }
      } else {
        logger.info('cookies.json does not exist, skipping...');
      }
    } catch (err) {
      logger.warn(`Error loading cookies.json: ${err.message}`);
    }

    // ----------------- 2) Jeśli mamy cookies, idziemy od razu na wykres -----------------
    if (hasCookies) {
      logger.info('Going directly to chart page (assuming we are logged in)...');
      await pageInstance.goto('https://www.tradingview.com/chart/?symbol=BINANCE:BTCUSDT', { waitUntil: 'networkidle2' });

    } else {
      // ----------------- 2B) Brak cookies -> logowanie -----------------
      logger.info('No valid cookies. Logging in...');

      // Idziemy na stronę logowania
      await pageInstance.goto('https://www.tradingview.com/accounts/signin/', { waitUntil: 'networkidle2' });

      // Pola logowania
      const userSelector = 'input[name="username"], input[data-name="username"], input[type="text"]';
      const passSelector = 'input[name="password"], input[data-name="password"], input[type="password"]';

      try {
        // Czekamy na pola
        await pageInstance.waitForSelector(userSelector, { timeout: 10000 });
        await pageInstance.waitForSelector(passSelector, { timeout: 10000 });

        logger.info('Typing credentials...');
        await pageInstance.type(userSelector, process.env.TRADINGVIEW_USER, { delay: 100 });
        await pageInstance.type(passSelector, process.env.TRADINGVIEW_PASS, { delay: 100 });

        // Przyciski "Sign in" (zmień, jeśli inny selektor)
        const signInBtn = 'button[data-overflow-tooltip-text="Sign in"]';
        await pageInstance.waitForSelector(signInBtn, { timeout: 10000 });
        await pageInstance.click(signInBtn);
        logger.info('Clicked sign in, waiting for navigation...');

        await pageInstance.waitForNavigation({ waitUntil: 'networkidle2' });
        // Poczekaj dodatkowe 5s
        await new Promise(r => setTimeout(r, 5000));

        // Zapis cookies
        try {
          const newCookies = await pageInstance.cookies();
          await fs.writeJson('cookies.json', newCookies);
          logger.info('Cookies saved after login.');
        } catch (err) {
          logger.error(`Error writing cookies.json: ${err.message}`);
        }

        // Teraz przechodzimy na wykres
        logger.info('Going to chart page...');
        await pageInstance.goto('https://www.tradingview.com/chart/?symbol=BINANCE:BTCUSDT', { waitUntil: 'networkidle2' });

      } catch (err) {
        logger.error(`Login process failed: ${err.message}`);
        // W razie błędu też warto przejść na wykres, może cookies i tak są...
        await pageInstance.goto('https://www.tradingview.com/chart/?symbol=BINANCE:BTCUSDT', { waitUntil: 'networkidle2' });
      }
    }

    // ----------------- 3) W tym miejscu powinniśmy być na wykresie -----------------
    logger.info('Now injecting Bot UI...');

    await injectBotUI(pageInstance);

    const initialDbData = await readDB();
    await updateBotUI(initialDbData);

    // Przechwyt alert() w oknie
    await pageInstance.evaluate(() => {
      const originalAlert = window.alert;
      window.alert = function(message) {
        window.handleAlert(message);
        originalAlert.apply(this, arguments);
      };
    });

    // Definiujemy handleAlert
    await pageInstance.exposeFunction('handleAlert', async (alertJson) => {
      logger.info('handleAlert invoked');
      try {
        logger.info(`Received alert JSON: ${alertJson}`);
        let alertData;
        try {
          alertData = JSON.parse(alertJson);
        } catch (err) {
          logger.warn(`Alert is not valid JSON: ${alertJson}`);
          return;
        }
    
        // Minimalna walidacja
        const required = ['type','symbol','price','indicator'];
        const hasAll = required.every((f) => alertData[f] !== undefined && alertData[f] !== null);
        if (!hasAll) {
          logger.warn(`Alert missing fields: ${alertJson}`);
          return;
        }
    
        // Obsługa ECI-LONG, gdzie w JSON jest "indicator":"eci_long" i "version":"A/B/C/D/E"
        if (alertData.indicator === 'eci_long') {
          const version = alertData.version;
          if (!['A','B','C','D','E'].includes(version)) {
            logger.warn(`ECI-Long alert has unknown version: ${version}`);
            return;
          }
          // finalny indicator np. eci_longE
          alertData.indicator = `eci_long${version}`;
        }
    
        // AutoTrade? (czy zamieniać na papierowy)
        const dbData = await readDB();
        const autoTradeEnabled = dbData.settings.autoTrade || false;
    
        // Zastąp placeholdery
        if (typeof alertData.symbol === 'string' && alertData.symbol.includes('{')) {
          logger.warn(`Placeholder symbol detected: ${alertData.symbol} -> forcing "BTCUSDT"`);
          alertData.symbol = 'BTCUSDT';
        }
        if (typeof alertData.price === 'string') {
          let tryPrice = parseFloat(alertData.price);
          if (isNaN(tryPrice)) {
            logger.warn(`Placeholder price detected: ${alertData.price} -> forcing price=0`);
            tryPrice = 0;
          }
          alertData.price = tryPrice;
        }
    
        // Emit event, np. do monitorTrades
        eventEmitter.emit('newAlert', alertData);
    
        // ECI slCross/tpCross => zamknięcie sub-wersji
       // if (['tpCross','slCross'].includes(alertData.type) && alertData.indicator.startsWith('eci_long')) {
          //logger.info(`Closing all trades for subindicator ${alertData.indicator} at price ${alertData.price}`);
         // await closeAllEciSubTrades(alertData.indicator, parseFloat(alertData.price), async (upd) => {
         //   await updateBotUI(upd);
        //  });
         // return;
       // }
    
        // Nowa transakcja (paper vs real)
        alertData._paper = !autoTradeEnabled;  // jeśli autoTrade= false -> paper trade
        logger.info(`Spawning handleNewTrade: ${alertData.indicator}, type=${alertData.type}, paper=${alertData._paper}`);
        await handleNewTrade(alertData);
    
      } catch (error) {
        logger.error(`Error in handleAlert: ${error}`);
      }
    });
    
    // MutationObserver do wykrywania alertów w HTML (injected do strony):
    await pageInstance.evaluate(() => {
      const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
          mutation.addedNodes.forEach((node) => {
            if (node.nodeType === Node.ELEMENT_NODE) {
              const alertElement =
                node.querySelector('[class*="description-"]') ||
                node.querySelector('.tv-alert__description');
              if (alertElement) {
                const alertText = alertElement.textContent.trim();
                console.log('Alert found:', alertText);
                if (alertText.startsWith('{') && alertText.endsWith('}')) {
                  window.handleAlert(alertText);
                }
              }
            }
          });
        });
      });
      const targetNode = document.body;
      if (targetNode) {
        observer.observe(targetNode, { childList: true, subtree: true });
        console.log('MutationObserver is observing the body.');
      } else {
        console.error('Body element not found.');
      }
    });

    // Obsługa 429
    pageInstance.on('response', async (resp) => {
      if (resp.status() === 429) {
        logger.error('Too many requests (429). Closing browser...');
        await browserInstance.close();
        setTimeout(monitorTradingView, 60000);
      }
    });

    logger.info('Monitoring TradingView started.');

  } catch (error) {
    logger.error(`Error in monitorTradingView: ${error}`);
    if (browserInstance) {
      await browserInstance.close();
    }
    setTimeout(monitorTradingView, 60000);
  }
}

// Uruchom serwer i start monitorowania
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  logger.info(`Server running on port ${PORT}`);
  monitorTradingView();
});
