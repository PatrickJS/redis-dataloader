'use strict';

const _ = require('lodash');
const Q = require('q');
const DataLoader = require('dataloader');

module.exports = fig => {
    const redis = fig.redis;

    const parse = (resp, opt) => Q.Promise((resolve, reject) => {
        try {
            if(resp === '' || resp === null) {
                resolve(resp);
            }
            else if(opt.deserialize) {
                resolve(opt.deserialize(resp));
            }
            else {
                resolve(JSON.parse(resp));
            }
        }
        catch(err) {
            reject(err);
        }
    });

    const toString = (val, opt) => {
        if(val === null) {
            return Q('');
        }
        else if(opt.serialize) {
            return Q(opt.serialize(val));
        }
        else if(_.isObject(val)) {
            return Q(JSON.stringify(val));
        }
        else {
            return Q.reject(new Error('Must be Object or Null'));
        }
    };

    const makeKey = (keySpace, key) => `${keySpace}:${key}`;

    const rSetAndGet = (keySpace, key, rawVal, opt) => toString(rawVal, opt)
    .then(val => Q.Promise((resolve, reject) => {
        const fullKey = makeKey(keySpace, key);
        const multi = redis.multi();
        multi.set(fullKey, val);
        if(opt.expire) {
            multi.expire(fullKey, opt.expire);
        }
        multi.get(fullKey);
        multi.exec((err, replies) => err ?
            reject(err) : parse(_.last(replies), opt).then(resolve)
        );
    }));

    const rGet = (keySpace, key, opt) => Q.Promise(
        (resolve, reject) => redis.get(
            makeKey(keySpace, key),
            (err, result) => err ? reject(err) : parse(result, opt).then(resolve)
        )
    );

    const rMGet = (keySpace, keys, opt) => Q.Promise(
        (resolve, reject) => redis.mget(
            _.map(keys, k => makeKey(keySpace, k)),
            (err, results) => err ?
                reject(err) :
                Q.all(_.map(results, r => parse(r, opt))).then(resolve)
        )
    );

    const rDel = (keySpace, key) => Q.Promise((resolve, reject) => redis.del(
        makeKey(keySpace, key), (err, resp) => err ? reject(err) : resolve(resp)
    ));

    return class RedisDataLoader {
        constructor(ks, userLoader, opt) {
            const customOptions = ['expire', 'serialize', 'deserialize'];
            this.opt = _.pick(opt, customOptions) || {};
            this.keySpace = ks;
            this.loader = new DataLoader(
                keys => rMGet(this.keySpace, keys, this.opt)
                .then(results => Q.all(_.map(
                    results,
                    (v, i) => {
                        if(v === '') {
                            return Q(null);
                        }
                        else if(v === null) {
                            return userLoader.load(keys[i])
                            .then(resp => rSetAndGet(
                                this.keySpace, keys[i], resp, this.opt
                            ))
                            .then(r => r === '' ? null : r);
                        }
                        else {
                            return Q(v);
                        }
                    }
                ))),
                _.omit(opt, customOptions)
            );
        }

        load(key) {
            return Q(this.loader.load(key));
        }

        loadMany(keys) {
            return Q(this.loader.loadMany(keys));
        }

        prime(key, val) {
            return rSetAndGet(this.keySpace, key, val, this.opt)
            .then(resp => this.loader.clear(key).prime(key, resp));
        }

        clear(key) {
            return key ?
                rDel(this.keySpace, key).then(() => this.loader.clear(key)) :
                Q.reject(new Error('Key parameter is required'));
        }
    };
};

