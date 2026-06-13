'use strict';

// ── Client-side JS ─────────────────────────────────────────────────────────
(function () {

  // ── Toggle visibilità password ─────────────────────────────────────────
  document.addEventListener('click', function (e) {
    if (!e.target.closest('.pw-toggle')) return;
    const wrap  = e.target.closest('.pw-wrap');
    if (!wrap) return;
    const input = wrap.querySelector('input');
    if (!input) return;
    input.type = input.type === 'password' ? 'text' : 'password';
  });

  // ── Polling stato ticket ───────────────────────────────────────────────
  const statusEl = document.querySelector('[data-ticket-status]');
  if (statusEl) {
    const ticketId = statusEl.dataset.ticketStatus;
    const STATUS_CLASSES = ['badge-aperto', 'badge-in_corso', 'badge-risolto', 'badge-chiuso'];

    setInterval(function () {
      fetch('/api/tickets/' + ticketId + '/status', {
        headers: { 'Accept': 'application/json' },
      })
        .then(function (res) {
          if (!res.ok) return;
          return res.json();
        })
        .then(function (data) {
          if (!data || !data.status) return;
          const currentStatus = statusEl.textContent.trim().toLowerCase();
          
          // Se lo stato effettivo sul DB è diverso da quello mostrato in pagina,
          // la soluzione più robusta è ricaricare l'intera vista. 
          // Questo aggiornerà non solo il badge, ma anche la timeline, i commenti 
          // e la visibilità dei form (es. se viene chiuso, il form sparisce).
          if (data.status !== currentStatus) {
            window.location.reload();
          }
        })
        .catch(function () {});
    }, 10000);
  }

}());
