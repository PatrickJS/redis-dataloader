# Redis Dataloader

Batching and Caching layer based on the [Facebook Dataloader](https://github.com/facebook/dataloader) API.

```javascript
const redis = require('redis').createClient();
const DataLoader = require('dataloader');
const RedisDataLoader = require('redis-dataloader')({ redis: redis });

const redisDataLoader = new RedisDataLoader(
    // set a prefix for the keys stored in redis. This way you can avoid key
    // collisions for different data-sets in your redis instance.
    'redis-key-prefix',
    // create a regular dataloader. This should always be set with caching disabled.
    new DataLoader(myBatchLoadFunction, { cache: false }),
    // The options here are the same as the regular dataloader options, with
    // the additional option "expire"
    {
        // caching here is a local in memory cache
        cache: true,
        // if set redis keys will be set to expire after this many seconds
        // this may be useful as a fallback for a redis cache.
        expire: 60
    }
);
```

In general, RedisDataLoader has the same API as the Facebook Dataloader Api,
with a few differences.

- `clear` returns a promise (waits until redis succeeds at deleting the key)
- `clearAll` is not available (redis does not have an efficient way to do this?)
- `prime` will always overwrite the redis cache. It in turn calls prime on the local cache (which does not adjust the cache if the key already exists)
- dataloader results must be either `null` or a JSON object.
