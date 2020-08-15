const _ = require('lodash');
const Promise = require('bluebird');
const DataLoader = require('dataloader');
const stringify = require('json-stable-stringify');

module.exports = fig => {
  const redis = fig.redis;
  const isIORedis = redis.constructor.name !== 'RedisClient';

  const parse = (resp, opt) =>
    new Promise((resolve, reject) => {
      try {
        if (resp === '' || resp === null) {
          resolve(resp);
        } else if (opt.deserialize) {
          resolve(opt.deserialize(resp));
        } else {
          resolve(JSON.parse(resp));
        }
      } catch (err) {
        reject(err);
      }
    });

  const toString = (val, opt) => {
    if (val === null) {
      return Promise.resolve('');
    } else if (opt.serialize) {
      return Promise.resolve(opt.serialize(val));
    } else if (_.isObject(val)) {
      return Promise.resolve(JSON.stringify(val));
    } else {
      return Promise.reject(new Error('Must be Object or Null'));
    }
  };

  const makeKey = (keySpace, key, cacheKeyFn) =>
    `${keySpace ? keySpace + ':' : ''}${cacheKeyFn(key)}`;

  const rSetAndGet = (keySpace, key, rawVal, opt) =>
    toString(rawVal, opt).then(
      val =>
        new Promise((resolve, reject) => {
          const fullKey = makeKey(keySpace, key, opt.cacheKeyFn);
          const multi = redis.multi();
          multi.set(fullKey, val);
          if (opt.expire) {
            multi.expire(fullKey, opt.expire);
          }
          multi.get(fullKey);
          multi.exec((err, replies) => {
            const lastReply = isIORedis
              ? _.last(_.last(replies))
              : _.last(replies);

            return err ? reject(err) : parse(lastReply, opt).then(resolve);
          });
        })
    );

  const rGet = (keySpace, key, opt) =>
    new Promise((resolve, reject) =>
      redis.get(
        makeKey(keySpace, key, opt.cacheKeyFn),
        (err, result) => (err ? reject(err) : parse(result, opt).then(resolve))
      )
    );

  const rMGet = (keySpace, keys, opt) =>
    new Promise((resolve, reject) =>
      redis.mget(
        _.map(keys, k => makeKey(keySpace, k, opt.cacheKeyFn)),
        (err, results) => {
          return err
            ? reject(err)
            : Promise.map(results, r => parse(r, opt)).then(resolve);
        }
      )
    );

  const rDel = (keySpace, key, opt) =>
    new Promise((resolve, reject) =>
      redis.del(
        makeKey(keySpace, key, opt.cacheKeyFn),
        (err, resp) => (err ? reject(err) : resolve(resp))
      )
    );

  return class RedisDataLoader {
    constructor(ks, userLoader, opt) {
      const customOptions = [
        'expire',
        'serialize',
        'deserialize',
        'cacheKeyFn',
      ];
      this.opt = _.pick(opt, customOptions) || {};
      this.opt.cacheKeyFn =
        this.opt.cacheKeyFn || (k => (_.isObject(k) ? stringify(k) : k));
      this.keySpace = ks;
      this.loader = new DataLoader(
        keys =>
          rMGet(this.keySpace, keys, this.opt).then(results =>
            Promise.map(results, (v, i) => {
              if (v === '') {
                return Promise.resolve(null);
              } else if (v === null) {
                return userLoader
                  .load(keys[i])
                  .then(resp =>
                    rSetAndGet(this.keySpace, keys[i], resp, this.opt)
                  )
                  .then(r => (r === '' ? null : r));
              } else {
                return Promise.resolve(v);
              }
            })
          ),
        _.chain(opt)
          .omit(customOptions)
          .extend({ cacheKeyFn: this.opt.cacheKeyFn })
          .value()
      );
    }

    load(key) {
      return key
        ? Promise.resolve(this.loader.load(key))
        : Promise.reject(new TypeError('key parameter is required'));
    }

    loadMany(keys) {
      return keys
        ? Promise.resolve(this.loader.loadMany(keys))
        : Promise.reject(new TypeError('keys parameter is required'));
    }

    prime(key, val) {
      if (!key) {
        return Promise.reject(new TypeError('key parameter is required'));
      } else if (val === undefined) {
        return Promise.reject(new TypeError('value parameter is required'));
      } else {
        return rSetAndGet(this.keySpace, key, val, this.opt).then(r => {
          this.loader.clear(key).prime(key, r === '' ? null : r);
        });
      }
    }

    clear(key) {
      return key
        ? rDel(this.keySpace, key, this.opt).then(() => this.loader.clear(key))
        : Promise.reject(new TypeError('key parameter is required'));
    }

    clearAllLocal() {
      return Promise.resolve(this.loader.clearAll());
    }

    clearLocal(key) {
      return Promise.resolve(this.loader.clear(key));
    }
  };
};
