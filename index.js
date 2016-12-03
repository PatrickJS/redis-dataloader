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

    const rSet = (key, rawVal) => toString(rawVal)
    .then(val => Q.Promise((resolve, reject) => redis.set(
        key, toString(val), (err, resp) => err ? reject(err) : resolve(resp)
    )));

    const rMGet = keys => Q.Promise((resolve, reject) => redis.mget(
        _.map(keys, k => `${keySpace}:${k}`),
        (err, results) => err ? reject(err) : Q.all(_.map(
            results,
            r => r === '' ?
                Q(new Error(`No key: ${keySpace}:${keys[i]}`)) : parse(r)
        ))
    ));

    const rDel = key => Q.Promise((resolve, reject) => redis.del(
        `${keySpace}:${key}`, (err, resp) => err ? reject(err) : resolve(resp)
    ));

    let keySpace;
    let loader;

    return class DataLoader {
        constructor(ks, batchLoadFn) {
            keySpace = ks;

            const userLoader = new DataLoader(batchLoadFn, { cache: false });

            loader = new DataLoader(keys => rMGet(
                _.map(keys, k => `${keySpace}:${k}`)
            )
            .then(results => Q.all(_.map(
                results,
                (v, i) => {
                    if(v instanceof Error) {
                        return Q(v);
                    }
                    else if(v === null) {
                        return userLoader.load(keys[i])
                        .then(resp => {
                            return rSet(keys[i], resp)
                            .then(() => resp || new Error(`No key: ${keys[i]}`));
                        });
                    }
                    else {
                        return resp;
                    }
                }
            ))));
        }

        load(key) {
            return loader.load(key);
        }

        clear(key) {
            return key ?
                rDel(key).then(() => loader.clear(key)) :
                Q.reject(new Error('Key parameter is required'));
        }
    };
};

