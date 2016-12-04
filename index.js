'use strict';

const _ = require('lodash');
const Q = require('q');
const DataLoader = require('dataloader');

module.exports = fig => {
    const redis = fig.redis;

    const parse = resp => Q.Promise((resolve, reject) => {
        try {
            resolve(resp !== '' && resp !== null ? JSON.parse(resp) : resp);
        }
        catch(err) {
            reject(err);
        }
    });

    const toString = val => {
        if(val === null) {
            return Q('');
        }
        else if(_.isObject(val)) {
            return Q(JSON.stringify(val));
        }
        else {
            return Q.reject(new Error('Must be Object or Null'));
        }
    };

    const rSet = (keySpace, key, rawVal, expire) => toString(rawVal)
    .then(val => Q.Promise((resolve, reject) => redis.set(
        `${keySpace}:${key}`, val, (err, resp) => {
            if(err) {
                reject(err);
            }
            else {
                if(expire) {
                    redis.expire(`${keySpace}:${key}`, expire);
                }
                resolve(resp);
            }
        }
    )));

    const rMGet = (keySpace, keys) => {
        return Q.Promise((resolve, reject) => redis.mget(
            _.map(keys, k => `${keySpace}:${k}`),
            (err, results) => err ?
                reject(err) :
                Q.all(_.map(results, parse)).then(resolve)
        ));
    };

    const rDel = (keySpace, key) => Q.Promise((resolve, reject) => redis.del(
        `${keySpace}:${key}`, (err, resp) => err ? reject(err) : resolve(resp)
    ));

    return class RedisDataLoader {
        constructor(ks, userLoader, options) {
            this.keySpace = ks;

            this.expire = options && options.expire;

            this.loader = new DataLoader(
                keys => rMGet(this.keySpace, keys)
                .then(results => Q.all(_.map(
                    results,
                    (v, i) => {
                        if(v === '') {
                            return Q(null);
                        }
                        else if(v === null) {
                            return userLoader.load(keys[i])
                            .then(resp => {
                                return rSet(this.keySpace, keys[i], resp, this.expire)
                                .then(() => resp);
                            });
                        }
                        else {
                            return Q(v);
                        }
                    }
                ))),
                _.omit(options, 'expire')
            );
        }

        load(key) {
            return Q(this.loader.load(key));
        }

        loadMany(keys) {
            return Q(this.loader.loadMany(keys));
        }

        prime(key, val) {
            return rSet(this.keySpace, key, val, this.expire)
            .then(() => this.loader.prime(key, val));
        }

        clear(key) {
            return key ?
                rDel(this.keySpace, key).then(() => this.loader.clear(key)) :
                Q.reject(new Error('Key parameter is required'));
        }
    };
};

