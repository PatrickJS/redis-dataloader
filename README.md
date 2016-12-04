# Redis Dataloader

Batching and Caching layer using Redis as the Caching layer.
Redis Dataloader is based on the [Facebook Dataloader](https://github.com/facebook/dataloader),
and uses it internally.

## Example

```javascript
const redis = require('redis').createClient();
const DataLoader = require('dataloader');
const RedisDataLoader = require('redis-dataloader')({ redis: redis });

const loader = new RedisDataLoader(
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

// load an individual item by its key
loader.load(5).then(resp => console.log(resp));

//clear an individiaul item from the local and redis cache.
loader.clear(5).then(() => {})
```

## API Documentation

In general, RedisDataLoader has the same API as the Facebook Dataloader Api,
with a few differences. Read through the [Facebook Dataloader documentation](https://github.com/facebook/dataloader) and then note the differences mentioned here.

- `clear` returns a promise (waits until redis succeeds at deleting the key)
- `clearAll` is not available (redis does not have an efficient way to do this?)
- `prime` will always overwrite the redis cache. It in turn calls prime on the local cache (which does not adjust the cache if the key already exists)
- dataloader results must be either `null` or a JSON object.

### Instantiation

#### Dependency inject a Redis Connection

```
const redis = require('redis').createClient();
const RedisDataLoader = require('redis-dataloader')({ redis: redis });
```

#### Create a new Dataloader.

Each Dataloader holds its own local in memory cache (Same as Facebook Dataloader),
and additionally caches to your Redis instance.

```
const loader = new RedisDataLoader('<redis key prefix>', '<Facebook Dataloader>', '<Options>');
```

##### Redis Key Prefix

Specify a Prefix that will be appended to each key when storing in Redis.

So for example if your prefix is "bar" and you call `loader.load('foo')`, this key
will be stored in Redis as **bar:foo**

##### Facebook Dataloader

A regular Facebook Dataloader is passed in as the second parameter. It will be
used to fetch data from your underlying datastore (mongo, sql, whatever).
It is very important to **disable the cache** on this dataloader. Redis dataloader
will already do local in memory caching (unless you disable it).

##### Options

All the options available to Facebook Dataloader can be passed in here. An
additional option called **expire** is also available, and will set a ttl in seconds
on all keys set in redis if this option is passed.


### Caching

The purpose of Redis Dataloader is to provide a caching layer in redis on top
of the Facebook Dataloader. Facebook's Dataloader provides a local in memory cache.
This may be ok for short lived per-request caches, but may not be sufficient if
you need a long lived cache and/or you have multiple webservers that need to share
data.

Redis Dataloader will additionally use the same local cache that Facebook Dataloader
provides. It will first check the local cache, then check the redis cache, before
finally checking your underlying datastore. This pattern may be desirable if for
example you create a new DataLoader for each request. If your dataloader is long-lived
you may want to disable to the local cache, and just rely on the redis cache instead

```
const loader = new RedisDataLoader('prefix', new DataLoader(), { cache: false });
```
