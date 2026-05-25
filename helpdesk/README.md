# Helpdesk — Sistema di Ticketing

Sistema di ticketing web realizzato con Node.js per il corso TIW. Permette agli utenti di aprire ticket di assistenza, agli operatori di gestirli e risponderli, e agli amministratori di supervisionare tutto il sistema con statistiche in tempo reale.

## Stack

| Strato | Tecnologia |
|--------|------------|
| HTTP server | Express 5 |
| Template engine | express-handlebars 8 |
| Database | SQLite via better-sqlite3 |
| Sessioni | express-session |
| Password | bcrypt |
| Avvio dev | `node --watch` |

## Installazione e avvio

```bash
npm install
npm run db:init   # crea le tabelle
npm run seed      # popola con dati di test
npm run dev       # avvia in modalità watch
```

→ [http://localhost:3000](http://localhost:3000)

> **Nota per Node 24**: better-sqlite3 e bcrypt richiedono i binari precompilati per la versione di Node in uso. Se si usa Node 24, è necessario compilare da sorgente (richiede Visual Studio Build Tools) oppure usare Node 22.x via nvm.

## Credenziali di test

| Ruolo | Email | Password |
|-------|-------|----------|
| Admin | admin@helpdesk.it | admin123 |
| Operatore | mario.rossi@helpdesk.it | password123 |
| Operatore | lucia.bianchi@helpdesk.it | password123 |
| Utente | sara.verdi@example.com | password123 |
| Utente | luca.neri@example.com | password123 |
| Utente | anna.blu@example.com | password123 |

## Struttura cartelle

```
helpdesk/
├── src/
│   ├── server.js              # Entry point, configurazione Express
│   ├── middleware/
│   │   └── auth.js            # requireUtente, requireOperatore, requireAdmin
│   ├── routes/
│   │   ├── tickets.js         # Area utente (ticket + profilo)
│   │   ├── operatore.js       # Area operatore (dashboard, ticket assegnati)
│   │   ├── admin.js           # Area admin (ticket, utenti, auto-assign)
│   │   └── stats.js           # Analytics (admin + operatore)
│   └── db/
│       ├── db.js              # Singleton connessione SQLite
│       ├── init.js            # Crea le tabelle (npm run db:init)
│       └── seed.js            # Popola con dati di test (npm run seed)
├── views/
│   ├── layouts/main.hbs       # Layout principale (navbar, flash)
│   ├── home.hbs               # Homepage pubblica
│   ├── error.hbs              # Pagina di errore generica
│   ├── utente/                # Viste area utente
│   │   ├── list.hbs           # Lista ticket personali
│   │   ├── new.hbs            # Form apertura ticket
│   │   ├── detail.hbs         # Dettaglio ticket + commenti + valutazione
│   │   └── profilo.hbs        # Modifica profilo
│   ├── operatore/             # Viste area operatore
│   │   ├── dashboard.hbs      # KPI + ticket attivi
│   │   ├── list.hbs           # Lista ticket assegnati (filtri)
│   │   ├── ticket-detail.hbs  # Dettaglio ticket + note interne + timeline
│   │   ├── profilo.hbs        # Modifica profilo
│   │   └── stats.hbs          # Analytics personali
│   └── admin/                 # Viste area admin
│       ├── dashboard.hbs      # KPI globali + non assegnati + carico operatori
│       ├── list.hbs           # Tutti i ticket (filtri completi)
│       ├── ticket-detail.hbs  # Dettaglio + cambio stato/priorità/assegna
│       ├── utenti.hbs         # Lista utenti con contatori
│       ├── utente-form.hbs    # Form crea/modifica utente
│       └── stats.hbs          # Analytics globali con grafici CSS
├── public/
│   └── css/style.css          # CSS completo (responsive)
├── data/                      # Creata automaticamente da db:init
│   └── helpdesk.db
└── package.json
```

## Funzionalità per livello

### Livello 1 — Area utente
- Registrazione e login con bcrypt
- Apertura ticket con titolo, descrizione, categoria, priorità
- Lista ticket personali
- Dettaglio ticket con conversazione pubblica (messaggi stile chat)
- Aggiunta commenti su ticket aperti/in lavorazione
- Chiusura ticket risolti con valutazione a stelle (CSS-only, senza JS)
- Riapertura ticket chiusi
- Modifica profilo e cambio password con verifica password attuale

### Livello 2 — Area operatore
- Dashboard con KPI (ticket attivi per stato, risolti nel mese, rating medio)
- Lista ticket assegnati con filtri (stato, priorità, categoria, ricerca testo)
- Dettaglio ticket con tutta la conversazione incluse le note interne
- Aggiunta risposte pubbliche e note interne (visibili solo allo staff)
- Cambio stato (in_corso → risolto)
- Timeline storico stati
- Modifiche profilo e password

### Livello 3 — Area admin
- Dashboard globale con KPI, ticket non assegnati e carico per operatore
- Vista tutti i ticket con filtri estesi (incluso filtro per operatore assegnato)
- Gestione completa ticket: cambio stato, priorità, assegnazione manuale
- Auto-assign: assegna automaticamente all'operatore con meno ticket attivi
- Gestione utenti: crea, modifica, cambio ruolo (utente ↔ operatore)
- Analytics admin: KPI periodo configurabile, distribuzioni, trend 7 giorni, performance operatori, ticket scaduti >48h
- Analytics operatore: statistiche personali (ticket assegnati, risolti, rating)

## Scelte progettuali principali

### Ruoli e autorizzazioni
Tre middleware in `src/middleware/auth.js`:
- `requireUtente`: verifica che esista una sessione, altrimenti redirect a `/login` salvando l'URL di ritorno
- `requireOperatore`: accettato sia da operatori che admin (`role === 'operatore' || 'admin'`)
- `requireAdmin`: solo admin; altrimenti 403

In ogni route viene verificato anche che la risorsa appartenga all'utente (es. `ticket.user_id === req.session.user.id`), non ci si fida solo del middleware di ruolo.

### Modello dati
- `users`: ruolo incluso nella tabella, nessuna tabella separata per ruoli
- `tickets`: `assigned_to` nullable per gestire i ticket in coda
- `comments`: colonna `is_internal` (0/1) per distinguere risposte pubbliche da note interne senza creare una seconda tabella
- `status_history`: tabella separata per l'audit trail — ogni cambio di stato crea un record con chi ha fatto la modifica e quando
- `ratings`: vincolo `UNIQUE(ticket_id)` — una sola valutazione per ticket

### Sessioni
In `req.session.user` vengono salvati solo `id`, `name`, `email`, `role`. Non viene mai salvata la password (nemmeno l'hash). I dati freschi vengono riletti dal DB ad ogni richiesta che ne ha bisogno.

### Validazione
Sempre lato server, mai fidarsi del client. Ogni POST valida i campi obbligatori, i valori enum (categoria, priorità, stato), i limiti di lunghezza e i vincoli di business (es. non si può commentare un ticket chiuso). Se la validazione fallisce, il form viene ri-renderizzato con i valori inseriti e i messaggi di errore.

### SQL
Query dirette con `better-sqlite3` (sincrono), senza ORM. Questo rende il codice didatticamente trasparente: si vede esattamente quale SQL viene eseguito. I filtri dinamici vengono costruiti con array `conditions`/`params` per evitare SQL injection mantenendo la flessibilità.
