require('./test')({
  name: 'with driver "redis"',
  redis: require('redis').createClient(),
});
