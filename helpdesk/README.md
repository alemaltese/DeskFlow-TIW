# DeskFlow — Helpdesk Ticketing System

Applicazione web di helpdesk per la gestione di ticket di supporto, sviluppata come progetto universitario per il corso **Tecnologie Internet per il Web (TIW)**. Tre ruoli distinti (utente, operatore, admin) con flusso di lavoro completo: apertura ticket → assegnazione automatica → lavorazione → risoluzione → chiusura con valutazione a stelle.

---

## Funzionalità

| Ruolo | Funzionalità |
|---|---|
| **Utente** | Registrazione / login, apertura ticket con categoria e priorità, commenti pubblici, chiusura con valutazione a stelle (1–5), riapertura ticket chiusi, modifica profilo e password |
| **Operatore** | Dashboard personale con KPI, lista ticket assegnati con filtri, cambio stato (in_corso / risolto), modifica priorità, commenti pubblici e note interne (visibili solo allo staff), modifica profilo |
| **Admin** | Dashboard globale con workload operatori, lista ticket con filtri avanzati, assegnazione manuale e auto-assign (operatore con meno ticket attivi), cambio stato / priorità, commenti, gestione utenti (CRUD), analytics avanzate, profilo |

---

## Stack tecnologico

| Componente | Libreria / Versione |
|---|---|
| Runtime | Node.js ≥ 20 |
| Framework HTTP | Express 5 |
| Database | SQLite tramite `better-sqlite3` ^11 |
| Template engine | `express-handlebars` ^8 (layout + partials) |
| Sessioni | `express-session` ^1 |
| Hash password | `bcrypt` ^5 |

---

## Struttura del progetto

```
helpdesk/
├── data/
│   └── helpdesk.db              # database SQLite (generato da npm run db:init)
├── public/                      # asset statici (CSS, immagini)
├── src/
│   ├── db/
│   │   ├── connection.js        # istanza better-sqlite3 condivisa
│   │   ├── schema.sql           # DDL delle 5 tabelle
│   │   ├── init.js              # crea le tabelle (esegue schema.sql)
│   │   └── seed.js              # popola il DB con dati di esempio
│   ├── middleware/
│   │   ├── auth.js              # requireUtente / requireOperatore / requireAdmin
│   │   └── flash.js             # req.setFlash / res.locals.flash
│   ├── repositories/
│   │   ├── users.repo.js        # query su users
│   │   ├── tickets.repo.js      # query su tickets, comments, status_history, ratings
│   │   └── stats.repo.js        # query di analytics (sola lettura)
│   ├── routes/
│   │   ├── auth.js              # /login, /register, /logout
│   │   ├── tickets.js           # /tickets/* (utente)
│   │   ├── operatore.js         # /operatore/* (operatore)
│   │   ├── admin.js             # /admin/* — ticket + utenti (admin)
│   │   └── stats.js             # /admin/stats (admin)
│   └── server.js                # bootstrap Express, middleware globali, error handler
└── views/
    ├── layouts/main.hbs          # layout principale (navbar, flash)
    ├── home.hbs                  # homepage pubblica
    ├── partials/                 # header, footer, flash
    ├── auth/                     # login, register
    ├── utente/                   # list, new, detail, profilo
    ├── operatore/                # dashboard, list, ticket-detail, profilo
    ├── admin/                    # dashboard, list, ticket-detail, utenti, utente-form, stats, profilo
    └── errors/                   # 404, 500
```

---

## Schema del database

```
users
  id, email (UNIQUE), password_hash, name
  role: 'utente' | 'operatore' | 'admin'
  created_at

tickets
  id, user_id → users.id
  title, description
  category: 'tecnico' | 'account' | 'fatturazione' | 'altro'
  status:   'aperto' | 'in_corso' | 'risolto' | 'chiuso'
  priority: 'bassa' | 'media' | 'alta' | 'urgente'
  assigned_to → users.id  (nullable)
  created_at, updated_at

comments
  id, ticket_id → tickets.id, user_id → users.id
  content, is_internal (0 = pubblico · 1 = nota interna)
  created_at

status_history
  id, ticket_id → tickets.id, changed_by → users.id
  event_type ('status' | 'priority' | 'assign')
  old_value, new_value, changed_at

ratings
  id, ticket_id → tickets.id (UNIQUE), user_id → users.id
  score (1–5), note, created_at
```

---

## Architettura

### Repository Pattern

Tutto il codice SQL è isolato nei tre file `src/repositories/*.repo.js`. Le route HTTP non contengono query: chiamano solo funzioni esportate dai repository.

- **Prepared statement a livello di modulo** — ogni `db.prepare(...)` statico viene eseguito una sola volta al caricamento del modulo, con overhead zero a runtime.
- **Query dinamiche** — `filterOperatorTickets`, `filterAdminTickets` e `buildTrend` costruiscono la clausola `WHERE` in base ai parametri ricevuti; in questi casi `db.prepare()` è all'interno della funzione (documentato con `// NOTE: dynamic query`).
- **Transazioni** — le operazioni multi-tabella (`createTicket`, `closeTicket`, `reopenTicket`, `updateTicketStatus`, `assignTicket`, …) sono avvolte in `db.transaction()` per garantire atomicità.

### Sessione snella

La sessione Express contiene **solo `userId`**. Ad ogni request, il middleware globale in `server.js` carica l'utente dal database:

```javascript
app.use((req, res, next) => {
  const u = req.session.userId ? usersRepo.findById(req.session.userId) : null;
  res.locals.currentUser = u;
  res.locals.isOperatore = u && (u.role === 'operatore' || u.role === 'admin');
  res.locals.isAdmin     = u && u.role === 'admin';
  next();
});
```

I dati di profilo aggiornati sono visibili immediatamente al prossimo request, senza re-login.

### Error handling con Content Negotiation

Il 404 e il 500 distinguono il tipo di client:
- Richieste HTML → vista dedicata (`views/errors/404.hbs`, `views/errors/500.hbs`)
- Richieste API/JSON → `{ error: 'not_found' }` / `{ error: 'internal' }`

Lo stack trace è mostrato nella vista 500 solo in ambiente di sviluppo (`NODE_ENV !== 'production'`).

---

## Installazione e avvio

```bash
# 1. Installa le dipendenze
cd helpdesk
npm install

# 2. Crea il database (esegue schema.sql)
npm run db:init

# 3. Popola con dati di esempio
npm run seed

# 4. Avvia il server (produzione)
npm start

# oppure con auto-reload su modifiche
npm run dev
```

Il server è disponibile su **http://localhost:3000**.

> **Nota per Node 24**: `better-sqlite3` e `bcrypt` richiedono i binari nativi precompilati per la versione di Node in uso. Se si usa Node 24, potrebbe essere necessario ricompilare da sorgente (richiede Visual Studio Build Tools su Windows) oppure usare Node 22.x tramite `nvm`.

---

## Credenziali di test

Tutti gli utenti usano la password **`password`**.

| Email | Nome | Ruolo |
|---|---|---|
| `admin@test.com` | Admin Sistema | admin |
| `operatore1@test.com` | Mario Rossi | operatore |
| `operatore2@test.com` | Lucia Bianchi | operatore |
| `utente1@test.com` | Sara Verdi | utente |
| `utente2@test.com` | Luca Neri | utente |
| `utente3@test.com` | Anna Blu | utente |

---

## Variabili d'ambiente

| Variabile | Default | Descrizione |
|---|---|---|
| `PORT` | `3000` | Porta su cui il server è in ascolto |
| `NODE_ENV` | — | Se impostata a `production`, nasconde lo stack trace nella pagina 500 |

---

## Rotte principali

| Metodo | Path | Accesso | Descrizione |
|---|---|---|---|
| GET | `/` | tutti | Redirect alla home del ruolo corrente |
| GET/POST | `/login` | pubblico | Autenticazione |
| GET/POST | `/register` | pubblico | Registrazione nuovo utente |
| GET | `/logout` | autenticato | Distrugge la sessione |
| GET | `/tickets` | utente | Lista ticket dell'utente |
| GET/POST | `/tickets/new` | utente | Apertura nuovo ticket |
| GET | `/tickets/:id` | utente | Dettaglio ticket + commenti + storico |
| POST | `/tickets/:id/comments` | utente | Aggiunge commento |
| POST | `/tickets/:id/chiudi` | utente | Chiude il ticket con valutazione |
| POST | `/tickets/:id/riapri` | utente | Riapre un ticket chiuso |
| GET/POST | `/profilo` | utente | Modifica profilo e password |
| GET | `/operatore/dashboard` | operatore | Dashboard con KPI personali |
| GET | `/operatore/tickets` | operatore | Lista ticket assegnati (filtri) |
| GET | `/operatore/tickets/:id` | operatore | Dettaglio + azioni (stato, priorità, commenti) |
| POST | `/operatore/tickets/:id/status` | operatore | Cambia stato (in_corso / risolto) |
| POST | `/operatore/tickets/:id/priority` | operatore | Cambia priorità |
| POST | `/operatore/tickets/:id/comments` | operatore | Aggiunge commento pubblico o nota interna |
| GET/POST | `/operatore/profilo` | operatore | Modifica profilo e password |
| GET | `/admin/dashboard` | admin | Dashboard globale + workload operatori |
| GET | `/admin/tickets` | admin | Tutti i ticket con filtri avanzati |
| GET | `/admin/tickets/:id` | admin | Dettaglio + assegnazione + azioni |
| POST | `/admin/tickets/:id/assegna` | admin | Assegna operatore manualmente |
| POST | `/admin/tickets/:id/auto-assign` | admin | Auto-assegna all'operatore con meno ticket |
| POST | `/admin/tickets/:id/status` | admin | Cambia stato |
| POST | `/admin/tickets/:id/priorita` | admin | Cambia priorità |
| POST | `/admin/tickets/:id/commenti` | admin | Aggiunge commento / nota interna |
| GET | `/admin/utenti` | admin | Lista utenti con contatori ticket |
| GET/POST | `/admin/utenti/nuovo` | admin | Crea nuovo utente |
| GET/POST | `/admin/utenti/:id/modifica` | admin | Modifica utente esistente |
| GET | `/admin/profilo` | admin | Profilo admin |
| GET | `/admin/stats` | admin | Analytics avanzate |
