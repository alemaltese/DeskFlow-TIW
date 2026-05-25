'use strict';
const Database = require('better-sqlite3');
const path = require('path');
const bcrypt = require('bcrypt');

const db = new Database(path.join(__dirname, '../../data/helpdesk.db'));
db.pragma('foreign_keys = ON');

const hash = (pwd) => bcrypt.hashSync(pwd, 10);

const seed = db.transaction(() => {
  db.exec(`
    DELETE FROM ratings;
    DELETE FROM status_history;
    DELETE FROM comments;
    DELETE FROM tickets;
    DELETE FROM users;
  `);

  // ── Users ──────────────────────────────────────────────────────────────────
  const insertUser = db.prepare(
    `INSERT INTO users (email, password_hash, name, role) VALUES (?, ?, ?, ?)`
  );

  const admin = insertUser.run('admin@test.com',         hash('password'),    'Admin Sistema',   'admin');
  const mario = insertUser.run('operatore1@test.com',   hash('password'), 'Mario Rossi',     'operatore');
  const lucia = insertUser.run('operatore2@test.com', hash('password'), 'Lucia Bianchi',   'operatore');
  const sara  = insertUser.run('utente1@test.com',    hash('password'), 'Sara Verdi',      'utente');
  const luca  = insertUser.run('utente2@test.com',     hash('password'), 'Luca Neri',       'utente');
  const anna  = insertUser.run('utente3@test.com',      hash('password'), 'Anna Blu',        'utente');

  const adminId = admin.lastInsertRowid;
  const marioId = mario.lastInsertRowid;
  const luciaId = lucia.lastInsertRowid;
  const saraId  = sara.lastInsertRowid;
  const lucaId  = luca.lastInsertRowid;
  const annaId  = anna.lastInsertRowid;

  // ── Tickets ─────────────────────────────────────────────────────────────────
  const insertTicket = db.prepare(`
    INSERT INTO tickets (user_id, title, description, category, status, priority, assigned_to, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  // 1 – URGENTE · APERTO · non assegnato
  const t1 = insertTicket.run(
    saraId,
    'Server di produzione non raggiungibile',
    "Dalle 06:15 il server principale non risponde. I client ricevono \"Connection refused\" su tutte le porte. Ho già verificato che la macchina fisica è accesa. Impatto: nessun utente riesce a lavorare.",
    'tecnico', 'aperto', 'urgente', null,
    '2024-01-15 06:20:00', '2024-01-15 06:20:00'
  );

  // 2 – URGENTE · IN_CORSO · Mario
  const t2 = insertTicket.run(
    lucaId,
    'Impossibile accedere al portale clienti — loop di login',
    "Da ieri sera il login reindirizza nuovamente alla pagina di accesso senza errori. Il problema si verifica sia da browser che dall'app mobile. Ho cancellato cookie e cache.",
    'account', 'in_corso', 'urgente', marioId,
    '2024-01-14 22:00:00', '2024-01-15 08:30:00'
  );

  // 3 – ALTA · APERTO · non assegnato
  const t3 = insertTicket.run(
    annaId,
    'VPN aziendale — errore 802 dopo aggiornamento Windows',
    "Dopo l'aggiornamento KB5034441 del 14/01 il client VPN restituisce errore 802. Ho provato a reinstallarlo e a disabilitare il firewall locale senza successo. Sistema operativo: Windows 11 22H2.",
    'tecnico', 'aperto', 'alta', null,
    '2024-01-15 09:00:00', '2024-01-15 09:00:00'
  );

  // 4 – ALTA · IN_CORSO · Lucia
  const t4 = insertTicket.run(
    saraId,
    'Export CSV con caratteri accentati corrotti',
    "I file CSV esportati mostrano caratteri strani al posto di à, è, ì, ò, ù. Il problema riguarda solo i campi testuali. Ho verificato con Excel 365 e con LibreOffice: stesso risultato.",
    'tecnico', 'in_corso', 'alta', luciaId,
    '2024-01-13 10:00:00', '2024-01-14 09:00:00'
  );

  // 5 – MEDIA · IN_CORSO · Mario
  const t5 = insertTicket.run(
    lucaId,
    'Dashboard lenta con dataset superiori a 10.000 righe',
    "Il caricamento supera i 30 secondi con dataset grandi. Con dataset piccoli funziona correttamente. Ho eseguito un profiling: la query principale impiega 28 secondi. Il problema sembra lato backend.",
    'tecnico', 'in_corso', 'media', marioId,
    '2024-01-13 08:45:00', '2024-01-14 11:00:00'
  );

  // 6 – MEDIA · RISOLTO · Lucia
  const t6 = insertTicket.run(
    annaId,
    'Fattura di dicembre importo errato',
    "La fattura INV-2023-1245 riporta €480 invece di €420 come da contratto firmato il 15/11/2023. Allego il numero fattura per riferimento.",
    'fatturazione', 'risolto', 'media', luciaId,
    '2024-01-08 11:00:00', '2024-01-12 15:00:00'
  );

  // 7 – MEDIA · RISOLTO · Mario
  const t7 = insertTicket.run(
    lucaId,
    'Richiesta nota di credito per fattura INV-2023-1198',
    "A seguito dell'accordo con il commerciale del 05/01, chiedo l'emissione di una nota di credito per la fattura INV-2023-1198 (importo: €240).",
    'fatturazione', 'risolto', 'media', marioId,
    '2024-01-06 09:30:00', '2024-01-10 14:00:00'
  );

  // 8 – BASSA · RISOLTO · Lucia
  const t8 = insertTicket.run(
    saraId,
    'Richiesta informazioni piano Enterprise',
    "Vorrei ricevere informazioni dettagliate sul piano Enterprise: funzionalità incluse, limiti utenti e prezzi per volumi elevati. Siamo un team di circa 200 persone.",
    'account', 'risolto', 'bassa', luciaId,
    '2024-01-05 10:00:00', '2024-01-07 11:00:00'
  );

  // 9 – ALTA · CHIUSO · Mario
  const t9 = insertTicket.run(
    annaId,
    'Cambio email account principale',
    "Devo aggiornare l'indirizzo email principale del mio account aziendale. Il vecchio indirizzo (anna.blu@example.com) non sarà più attivo dal 01/02. Nuovo indirizzo: anna.blu.new@example.com.",
    'account', 'chiuso', 'alta', marioId,
    '2024-01-03 13:00:00', '2024-01-07 16:00:00'
  );

  // 10 – BASSA · CHIUSO · Lucia
  const t10 = insertTicket.run(
    saraId,
    'Aggiornamento dati di fatturazione aziendali',
    "A seguito della fusione societaria, devo aggiornare la ragione sociale e il codice fiscale associati all'account di fatturazione. Nuova ragione sociale: Verdi & Associati Srl.",
    'fatturazione', 'chiuso', 'bassa', luciaId,
    '2024-01-02 09:00:00', '2024-01-04 17:00:00'
  );

  const t1Id  = t1.lastInsertRowid;
  const t2Id  = t2.lastInsertRowid;
  const t3Id  = t3.lastInsertRowid;
  const t4Id  = t4.lastInsertRowid;
  const t5Id  = t5.lastInsertRowid;
  const t6Id  = t6.lastInsertRowid;
  const t7Id  = t7.lastInsertRowid;
  const t8Id  = t8.lastInsertRowid;
  const t9Id  = t9.lastInsertRowid;
  const t10Id = t10.lastInsertRowid;

  // ── Comments ────────────────────────────────────────────────────────────────
  const insertComment = db.prepare(`
    INSERT INTO comments (ticket_id, user_id, content, is_internal, created_at)
    VALUES (?, ?, ?, ?, ?)
  `);

  // T1 – Server non raggiungibile (aperto, non assegnato)
  insertComment.run(t1Id, saraId, "Ho anche provato a pingare l'IP direttamente: nessuna risposta. Dal pannello di controllo del datacenter il server risulta online.", 0, '2024-01-15 06:35:00');
  insertComment.run(t1Id, saraId, "Aggiornamento: ho verificato anche la console remota — il sistema operativo sembra avviato ma i servizi di rete non rispondono.", 0, '2024-01-15 07:00:00');

  // T2 – Loop di login (in_corso, Mario)
  insertComment.run(t2Id, lucaId,  "Confermo: succede sia in incognito che su un secondo browser. Ho anche provato da un altro dispositivo, stesso risultato.", 0, '2024-01-14 22:30:00');
  insertComment.run(t2Id, marioId, "Buongiorno Luca, ho preso in carico il ticket. Sto analizzando i log di autenticazione del suo account.", 0, '2024-01-15 08:35:00');
  insertComment.run(t2Id, marioId, "Individuata la causa: token di sessione scaduto e mancata rotazione automatica. Bug introdotto con il deploy di lunedì 13/01. Sto preparando il fix.", 1, '2024-01-15 09:00:00');
  insertComment.run(t2Id, lucaId,  "Grazie Mario, attendo. Il problema mi impedisce di lavorare con i clienti.", 0, '2024-01-15 09:15:00');

  // T3 – VPN (aperto, non assegnato)
  insertComment.run(t3Id, annaId, "Ho provato anche con un profilo VPN diverso: stesso errore 802. Altri colleghi con lo stesso aggiornamento Windows hanno il medesimo problema.", 0, '2024-01-15 09:30:00');
  insertComment.run(t3Id, annaId, "Trovato sul forum ufficiale: sembra un conflitto del KB5034441 con il driver TAP del client VPN. Allego il link alla discussione.", 0, '2024-01-15 10:00:00');

  // T4 – CSV encoding (in_corso, Lucia)
  insertComment.run(t4Id, saraId,  "Il problema riguarda solo i campi con lettere accentate. I numeri e i caratteri ASCII normali sono corretti.", 0, '2024-01-13 10:30:00');
  insertComment.run(t4Id, luciaId, "Confermato: il bug è nell'encoding del modulo export, che usa Latin-1 invece di UTF-8. Deploy del fix pianificato per oggi pomeriggio.", 0, '2024-01-14 09:15:00');
  insertComment.run(t4Id, luciaId, "Bug introdotto con il refactoring del modulo export v2.3.1 del 10/01. Aggiungo un test di regressione per l'encoding.", 1, '2024-01-14 09:20:00');

  // T5 – Dashboard lenta (in_corso, Mario)
  insertComment.run(t5Id, lucaId,  "Ho misurato: con 1.000 righe carica in 2s, con 5.000 in 12s, con 10.000 in 30s. Crescita chiaramente non lineare.", 0, '2024-01-13 09:30:00');
  insertComment.run(t5Id, marioId, "Identificata la query N+1 nella funzione di aggregazione del dashboard. Sto riscrivendo con una JOIN singola.", 0, '2024-01-14 11:15:00');
  insertComment.run(t5Id, marioId, "Query ottimizzata in staging: da 28s a 0.4s con 10k righe. Deploy in produzione domani mattina previa approvazione.", 1, '2024-01-14 16:00:00');

  // T6 – Fattura errata (risolto, Lucia)
  insertComment.run(t6Id, annaId,  "La fattura riporta €480 invece di €420 come da contratto. Differenza: €60. Vi invio il contratto firmato via email.", 0, '2024-01-08 11:30:00');
  insertComment.run(t6Id, luciaId, "Ho verificato il contratto e confermo l'errore. Provvedo all'emissione di una nota di credito NC-2024-0007 per €60.", 0, '2024-01-09 09:00:00');
  insertComment.run(t6Id, luciaId, "Errore generato dalla migrazione del piano tariffario di novembre. Segnalato al team billing per verificare eventuali altri casi simili.", 1, '2024-01-09 09:05:00');
  insertComment.run(t6Id, annaId,  "Ho ricevuto la nota di credito NC-2024-0007. Tutto risolto, grazie per la rapidità!", 0, '2024-01-12 15:30:00');

  // T7 – Nota di credito (risolto, Mario)
  insertComment.run(t7Id, marioId, "Ho verificato con il commerciale la validità della richiesta. La nota di credito NC-2024-0003 (€240) è stata emessa e inviata via email.", 0, '2024-01-10 14:00:00');
  insertComment.run(t7Id, lucaId,  "Ho ricevuto la nota di credito NC-2024-0003. Grazie!", 0, '2024-01-10 15:00:00');

  // T8 – Piano Enterprise (risolto, Lucia)
  insertComment.run(t8Id, luciaId, "Ciao Sara! Il piano Enterprise include: utenti illimitati, SSO, supporto dedicato 24/7 e SLA 99.9% garantito. Ti invio il listino prezzi per email.", 0, '2024-01-06 10:00:00');
  insertComment.run(t8Id, saraId,  "Perfetto, ho ricevuto il listino. Procedo con la valutazione interna del board. Grazie per la risposta rapida!", 0, '2024-01-07 09:00:00');

  // T9 – Cambio email (chiuso, Mario)
  insertComment.run(t9Id, annaId,  "Il nuovo indirizzo è anna.blu.new@example.com. Ho già verificato che è libero e funzionante.", 0, '2024-01-03 13:30:00');
  insertComment.run(t9Id, marioId, "Ho avviato la procedura di cambio email. Richiede verifica manuale da parte del team security (policy aziendale).", 0, '2024-01-04 09:00:00');
  insertComment.run(t9Id, marioId, "L'account ha 2FA attivo: dopo il cambio email l'utente dovrà ri-verificare il proprio autenticatore. Lo avverto via SMS.", 1, '2024-01-04 09:05:00');
  insertComment.run(t9Id, annaId,  "Ho completato la verifica 2FA. Tutto funziona correttamente con il nuovo indirizzo. Grazie!", 0, '2024-01-07 15:00:00');

  // T10 – Aggiornamento fatturazione (chiuso, Lucia)
  insertComment.run(t10Id, saraId,  "Nuova ragione sociale: Verdi & Associati Srl, CF 12345678901, P.IVA IT12345678901. Indirizzo immutato.", 0, '2024-01-02 09:30:00');
  insertComment.run(t10Id, luciaId, "Aggiornamento effettuato nel sistema di fatturazione. Le prossime fatture riporteranno la nuova ragione sociale.", 0, '2024-01-03 10:00:00');
  insertComment.run(t10Id, saraId,  "Confermato: ho ricevuto una fattura di prova con i nuovi dati. Tutto corretto!", 0, '2024-01-04 17:00:00');

  // ── Status history ──────────────────────────────────────────────────────────
  const insertHistory = db.prepare(`
    INSERT INTO status_history (ticket_id, changed_by, old_status, new_status, created_at)
    VALUES (?, ?, ?, ?, ?)
  `);

  // T2: aperto → in_corso
  insertHistory.run(t2Id, marioId, 'aperto', 'in_corso', '2024-01-15 08:30:00');

  // T4: aperto → in_corso
  insertHistory.run(t4Id, luciaId, 'aperto', 'in_corso', '2024-01-14 09:00:00');

  // T5: aperto → in_corso
  insertHistory.run(t5Id, marioId, 'aperto', 'in_corso', '2024-01-14 11:00:00');

  // T6: aperto → in_corso → risolto
  insertHistory.run(t6Id, luciaId, 'aperto',   'in_corso', '2024-01-09 09:00:00');
  insertHistory.run(t6Id, luciaId, 'in_corso', 'risolto',  '2024-01-12 15:00:00');

  // T7: aperto → in_corso → risolto
  insertHistory.run(t7Id, marioId, 'aperto',   'in_corso', '2024-01-08 09:00:00');
  insertHistory.run(t7Id, marioId, 'in_corso', 'risolto',  '2024-01-10 14:00:00');

  // T8: aperto → in_corso → risolto
  insertHistory.run(t8Id, luciaId, 'aperto',   'in_corso', '2024-01-06 10:00:00');
  insertHistory.run(t8Id, luciaId, 'in_corso', 'risolto',  '2024-01-07 10:00:00');

  // T9: aperto → in_corso → risolto → chiuso
  insertHistory.run(t9Id, marioId, 'aperto',   'in_corso', '2024-01-04 09:00:00');
  insertHistory.run(t9Id, marioId, 'in_corso', 'risolto',  '2024-01-07 15:00:00');
  insertHistory.run(t9Id, adminId, 'risolto',  'chiuso',   '2024-01-07 16:00:00');

  // T10: aperto → in_corso → risolto → chiuso
  insertHistory.run(t10Id, luciaId, 'aperto',   'in_corso', '2024-01-03 10:00:00');
  insertHistory.run(t10Id, luciaId, 'in_corso', 'risolto',  '2024-01-04 17:00:00');
  insertHistory.run(t10Id, adminId, 'risolto',  'chiuso',   '2024-01-04 18:00:00');

  // ── Ratings (solo ticket chiusi: t9, t10) ────────────────────────────────────
  const insertRating = db.prepare(`
    INSERT INTO ratings (ticket_id, user_id, score, note, created_at)
    VALUES (?, ?, ?, ?, ?)
  `);

  insertRating.run(t9Id,  annaId, 5, 'Problema risolto velocemente e con grande professionalità. Ottimo lavoro!', '2024-01-07 16:30:00');
  insertRating.run(t10Id, saraId, 4, 'Aggiornamento preciso e comunicazione chiara. Avrei apprezzato un aggiornamento intermedio.', '2024-01-04 18:30:00');
});

seed();
console.log('Seed completato con successo.');
db.close();
