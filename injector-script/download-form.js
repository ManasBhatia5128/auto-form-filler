const https = require('https');
const fs = require('fs');

const url = 'https://docs.google.com/forms/d/e/1FAIpQLSfZvvP7yKiqEXpViiaVYV-Wi2GpsWtYdwWm7yKsmt2wsEBkwg/viewform';

https.get(url, (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    fs.writeFileSync('form.html', data);
    console.log('Saved to form.html');
  });
});
