const Redis = require('ioredis');
require('./test')({
  name: 'with driver "ioredis"',
  redis: new Redis(),
});
