# Trade Bot

## Opis projektu
Trade Bot to zaawansowana wtyczka integrująca się z platformą TradingView, umożliwiająca automatyczne monitorowanie alertów wskaźników oraz analizowanie ich skuteczności. Aktualnie bot działa w trybie "papierowym", co oznacza, że transakcje są symulowane i zapisywane w plikach JSON. Dzięki temu można bezpiecznie testować strategie tradingowe przed uruchomieniem rzeczywistych transakcji na giełdzie Binance.

---

## Główne funkcje

- **Monitorowanie alertów:** Bot nasłuchuje alertów z TradingView, korzystając ze struktury DOM strony, co eliminuje konieczność korzystania z webhooków.
- **Symulacja transakcji:** Symulowane transakcje odwzorowują rzeczywiste trady na giełdzie Binance z uwzględnieniem takich parametrów, jak dźwignia, zyski i opłaty.
- **Analiza wskaźników:** Obsługa wskaźnika `eci_long` (w wersjach A-E) oraz innych wskaźników, takich jak `easy_entry` i `ut_bot`.
- **Integracja z Binance:** Odczyt danych o saldach i możliwość uruchomienia rzeczywistych transakcji w przyszłych wersjach.
- **Interfejs graficzny:** Panel zarządzania wstrzyknięty bezpośrednio w interfejs TradingView.

---

## Jak uruchomić projekt

### 1. Wymagania wstępne
- Node.js (zalecana wersja: LTS).
- Konto na TradingView z ustawionymi wskaźnikami.
- Konto na Binance (dla przyszłych wersji obsługujących transakcje rzeczywiste).

### 2. Instalacja

#### Instalacja ręczna
1. Sklonuj repozytorium:
   ```bash
   git clone https://github.com/3godzinyL/tbot.git
   ```
2. Przejdź do katalogu projektu:
   ```bash
   cd tbot
   ```
3. Zainstaluj zależności:
   ```bash
   npm install
   ```

### 3. Konfiguracja pliku `.env`
Utwórz plik `.env` w katalogu głównym projektu i uzupełnij go następującymi zmiennymi środowiskowymi:

```env
BINANCE_API_KEY=<Twój klucz API z Binance>
BINANCE_API_SECRET=<Twój sekret API z Binance>
WEBHOOK_TOKEN=<Twój unikalny token webhook(nie wymagany)>
WEBHOOK_PORT=3000
TRADINGVIEW_USER=<Twoja nazwa użytkownika TradingView>
TRADINGVIEW_PASS=<Twoje hasło do TradingView>
NODE_ENV=development
```

### 4. Uruchomienie bota
1. Uruchom aplikację:
   ```bash
   npm start
   ```
2. Bot automatycznie otworzy przeglądarkę i zaloguje się na Twoje konto TradingView. Jeśli istnieje plik `cookies.json`, zostanie on wykorzystany do pominięcia procesu logowania.
3. Po zalogowaniu przejdź na stronę wykresu TradingView i dodaj wskaźniki oraz alerty obsługiwane przez bota.

---

## Dodawanie wskaźników i alertów w TradingView

1. Otwórz wykres w TradingView.
2. Dodaj wskaźnik obsługiwany przez bota (np. `eci_long`).
3. Utwórz alert dla wskaźnika w formacie JSON, np.:

   ```json
   {
     "type": "buy",
     "symbol": "BTCUSDT",
     "price": 25000,
     "indicator": "eci_long",
     "version": "A"
   }
   ```
4. Bot automatycznie odbierze alert i zapisze transakcję w pliku JSON.

---

## Struktura projektu

- `index.js` – Główna logika aplikacji, uruchamianie monitorowania TradingView.
- `server.js` – Endpointy API do zarządzania ustawieniami i transakcjami.
- `ui.js` – Kod odpowiedzialny za wstrzykiwanie interfejsu użytkownika do TradingView.
- `db.js` – Obsługa plików JSON przechowujących dane o transakcjach.
- `trade.js` – Logika symulacji i przetwarzania transakcji.
- `binanceApi.js` – Integracja z Binance API.
- `eci_longE.json` – Przykładowe dane o transakcjach dla wskaźnika `eci_longE`.

---

## Stan projektu

Projekt jest w fazie rozwoju. Obecna wersja działa w trybie papierowym (symulowane transakcje). W przyszłości planowane są:
- Obsługa rzeczywistych transakcji na Binance Futures.
- Rozbudowa wskaźników i algorytmów.
- Ulepszenie interfejsu graficznego.

---

## Miejsce na zrzuty ekranu

1. **Interfejs bota w TradingView:**  
   ![image](https://github.com/user-attachments/assets/2435b990-2aa8-487f-a2c9-83d2a11e7614)

   
2. **Przykładowe dane o transakcjach:**  
![image](https://github.com/user-attachments/assets/baaf0a45-d4b2-46c2-b426-d73c33d7333c)

3. **Przykładowe uruchomienie bota**
![image](https://github.com/user-attachments/assets/bc5ed9b4-6e88-4e93-8e5a-31901af41a26)
4. **Wskaznik**
![image](https://github.com/user-attachments/assets/742bdf64-dd8d-4abe-8506-664b20f63a14)
![image](https://github.com/user-attachments/assets/3edc1232-58b6-4012-86f4-50e3fa492845)

---

## Wsparcie

Jeśli masz pytania, chcesz zgłosić błąd lub zasugerować nowe funkcje, otwórz zgłoszenie w sekcji Issues na GitHubie. Zachęcam również do dyskusji i dzielenia się swoimi uwagami!
