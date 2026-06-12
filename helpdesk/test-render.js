const { engine } = require('express-handlebars');
const path = require('path');
const exphbs = require('express-handlebars');

const hbs = exphbs.create({
  extname: '.hbs',
  helpers: {
    formatDate() { return 'date'; },
    capitalize(str) { return str; }
  }
});

const templatePath = path.join(__dirname, 'views/utente/list.hbs');
const data = {
  tickets: [
    { id: 10, title: 'Test 1', category: 'tecnico', priority: 'alta', status: 'aperto', userIndex: 1 },
    { id: 11, title: 'Test 2', category: 'account', priority: 'bassa', status: 'chiuso', userIndex: 2 }
  ]
};

hbs.renderView(templatePath, data, (err, html) => {
  if (err) console.error(err);
  console.log(html);
});
