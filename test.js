// test.js
import BinanceAPI from 'binance-api-node';
import dotenv from 'dotenv';

dotenv.config();

// Sprawdź, co faktycznie importujesz
console.log('BinanceAPI:', BinanceAPI);

// Jeśli BinanceAPI jest obiektem z domyślnym eksportem, użyj `BinanceAPI.default`
const Binance = BinanceAPI.default || BinanceAPI;

const client = Binance({
  apiKey: process.env.BINANCE_API_KEY,
  apiSecret: process.env.BINANCE_API_SECRET,
});

async function getServerTime() {
  try {
    const serverTime = await client.time();
    console.log('Raw server time:', serverTime); // Dodany log
    const localTime = Date.now();
    const diff = serverTime.serverTime - localTime;
    console.log(`Server Time: ${new Date(serverTime.serverTime).toISOString()}`);
    console.log(`Local Time:   ${new Date(localTime).toISOString()}`);
    console.log(`Time Difference (server - local): ${diff} ms`);
  } catch (error) {
    console.error('Error fetching server time:', error);
  }
}

async function testConnection() {
  try {
    const accountInfo = await client.accountInfo();
    console.log('Account Info:', accountInfo);
  } catch (error) {
    console.error('Error connecting to Binance:', error);
  }
}

// Najpierw pobierz serwerowy czas, a potem testuj połączenie
getServerTime().then(() => {
  testConnection();
});
