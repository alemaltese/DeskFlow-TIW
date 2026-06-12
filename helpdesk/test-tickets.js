const db = require('./src/db/connection');
const ticketRepo = require('./src/repositories/tickets.repo');
const tickets = ticketRepo.findByUserId(2).map((t, index) => ({
  ...t,
  userIndex: index + 1
}));
console.log(tickets.map(t => ({ id: t.id, title: t.title, userIndex: t.userIndex })));
