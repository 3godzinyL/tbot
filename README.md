# Trade Bot

## Opis projektu
Trade Bot to wtyczka do TradingView, która pozwala na automatyczne monitorowanie alertów i analizowanie wyników wskaźników. Aktualnie bot działa w trybie "papierowym", co oznacza, że transakcje są zapisywane w plikach JSON do oceny skuteczności wskaźników. W przyszłych aktualizacjach bot umożliwi rzeczywiste zawieranie transakcji na giełdzie Binance.

---

## Główne funkcje

- **Monitorowanie alertów**: Bot nasłuchuje alertów z TradingView na podstawie struktury DOM strony, bez użycia webhooków.
- **Obsługa wskaźników**: Analiza wyników wskaźników takich jak `eci_long` (z podwersjami A-E), `easy_entry` i `ut_bot`.
- **Zarządzanie transakcjami**: Papierowe transakcje są zapisywane w JSON, zawierając szczegółowe dane o ich przebiegu i wynikach.
- **Integracja z Binance**: Wsparcie dla konta Binance Futures i danych o saldach portfela.
- **Panel UI**: Interfejs graficzny wstrzyknięty w TradingView dla zarządzania botem.

---

## Jak uruchomić projekt

### 1. Wymagania wstępne
- Node.js (zalecana wersja: LTS)
- Konto na TradingView
- Konto na Binance (dla przyszłych wersji obsługujących transakcje rzeczywiste)

### 2. Instalacja

#### Instalacja z paczki ZIP
1. Pobierz plik ZIP z sekcji `Releases` na GitHub.
2. Rozpakuj zawartość do wybranego folderu.
3. Zainstaluj Node.js na swoim urządzeniu.

#### Instalacja ręczna
1. Sklonuj repozytorium:
   ```bash
   git clone https://github.com/twoj-username/twoj-repo.git
   ```
2. Przejdź do katalogu projektu:
   ```bash
   cd twoj-repo
   ```
3. Zainstaluj zależności:
   ```bash
   npm install
   ```

### 3. Konfiguracja pliku `.env`
Utwórz plik `.env` w katalogu głównym projektu i uzupełnij go poniższymi zmiennymi:

```env
BINANCE_API_KEY=<Twój klucz API z Binance>
BINANCE_API_SECRET=<Twój sekret API z Binance>
WEBHOOK_TOKEN=<Twój unikalny token webhook>
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
2. Bot automatycznie otworzy przeglądarkę i zaloguje się na konto TradingView. Jeśli plik `cookies.json` istnieje, zostaną załadowane ciasteczka, aby pominąć proces logowania.
3. Na stronie wykresu TradingView możesz zarządzać botem za pomocą wstrzykniętego interfejsu użytkownika.

---

## Dodawanie wskaźników i alertów w TradingView

1. Otwórz wykres w TradingView.
2. Dodaj wskaźnik obsługiwany przez bota (np. `eci_long` lub `easy_entry`).
3. Utwórz alert dla wskaźnika z konfiguracją JSON w następującym formacie:
   ```json
   {
     "type": "buy",
     "symbol": "BTCUSDT",
     "price": 25000,
     "indicator": "eci_long",
     "version": "A"
   }
   ```
4. Bot automatycznie odbierze alert i przetworzy go.

---

## Struktura plików

- `index.js`: Główna logika aplikacji.
- `server.js`: Endpointy API do interakcji z botem.
- `ui.js`: Kod odpowiedzialny za wstrzykiwanie UI do TradingView.
- `db.js`: Obsługa plików JSON przechowujących dane transakcji.
- `binanceApi.js`: Integracja z Binance API.

---

## Stan projektu
Projekt jest w fazie rozwoju. Obecna wersja działa w trybie papierowym (symulowane transakcje). W przyszłości planowane są:
- Obsługa rzeczywistych transakcji na Binance Futures.
- Ulepszone wskaźniki i algorytmy tradingowe.
- Rozbudowa panelu użytkownika.

---

## Wsparcie
Obecnie bot wspiera tylko giełdę Binance. Jeśli masz pytania lub chcesz zgłosić błąd, otwórz zgłoszenie w sekcji Issues na GitHub.

---

## Miejsce na zrzuty ekranu
1. **Interfejs bota w TradingView**:
   ![Zrzut ekranu interfejsu](link_do_obrazu.png)

2. **Przykładowe dane o transakcjach**:
   ![Zrzut ekranu danych](link_do_obrazu.png)
