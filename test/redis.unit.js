require('./test')({
  name: 'with driver "redis"',
  redis: require('redis-mock').createClient(),
});
