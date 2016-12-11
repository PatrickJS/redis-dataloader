'use strict';

const _ = require('lodash');
const Q = require('q');
const expect = require('chai').expect;
const sinon = require('sinon');
const redis = require('redis').createClient();
const DataLoader = require('dataloader');
const RedisDataLoader = require('./index.js')({ redis: redis });

describe('redis-dataloader', () => {
    beforeEach(done => {
        const rDel = key => Q.Promise((resolve, reject) => redis.del(
            key, (err, resp) => err ? reject(err) : resolve(resp)
        ));

        this.keySpace = 'key-space';
        this.data = {
            json: { foo: 'bar' },
            'null': null
        };

        this.stubs = {};

        this.loadFn = sinon.stub();

        _.each(this.data, (v, k) => {
            this.loadFn.withArgs(k).returns(Q(v));
        });

        this.userLoader = () => new DataLoader(
            keys => Q.all(_.map(keys, this.loadFn)),
            { cache: false }
        );

        Q.all(_.map(_.keys(this.data), k => rDel(`${this.keySpace}:${k}`)))
        .then(() => {
            this.loader = new RedisDataLoader(this.keySpace, this.userLoader());

            this.noCacheLoader = new RedisDataLoader(
                this.keySpace,
                this.userLoader(),
                { cache: false }
            );

            done();
        }).done();
    });

    afterEach(() => _.each(this.stubs, s => s.restore()));

    describe('load', () => {
        it('should load json value', done => {
            this.loader.load('json').then(data => {
                expect(data).to.deep.equal(this.data.json);
                done();
            }).done();
        });

        it('should use local cache on second load', done => {
            this.stubs.redisMGet = sinon.stub(redis, 'mget', (keys, cb) => {
                cb(null, [JSON.stringify(this.data.json)]);
            });

            this.loader.load('json')
            .then(data => {
                expect(this.loadFn.callCount).to.equal(0);
                expect(this.stubs.redisMGet.callCount).to.equal(1);
                return this.loader.load('json');
            })
            .then(data => {
                expect(this.loadFn.callCount).to.equal(0);
                expect(this.stubs.redisMGet.callCount).to.equal(1);
                done();
            }).done();
        });

        it('should not use in memory cache if option is passed', done => {
            this.stubs.redisMGet = sinon.stub(redis, 'mget', (keys, cb) => {
                cb(null, [JSON.stringify(this.data.json)]);
            });

            this.noCacheLoader.load('json')
            .then(data => {
                expect(this.loadFn.callCount).to.equal(0);
                expect(this.stubs.redisMGet.callCount).to.equal(1);
                return this.noCacheLoader.load('json');
            })
            .then(data => {
                expect(this.loadFn.callCount).to.equal(0);
                expect(this.stubs.redisMGet.callCount).to.equal(2);
                done();
            }).done();
        });

        it('should load null values', done => {
            this.loader.load('null')
            .then(data => {
                expect(data).to.be.null;
                return this.loader.load('null');
            })
            .then(data => {
                expect(data).to.be.null;
                done();
            }).done();
        });

        it('should handle redis cacheing of null values', done => {
            this.noCacheLoader.load('null')
            .then(data => {
                expect(data).to.be.null;
                return this.noCacheLoader.load('null');
            })
            .then(data => {
                expect(data).to.be.null;
                done();
            }).done();
        });

        it('should handle redis key expiration if set', done => {
            const loader = new RedisDataLoader(
                this.keySpace,
                this.userLoader(),
                { cache: false, expire: 1 }
            );

            loader.load('json')
            .then(data => {
                expect(data).to.deep.equal(this.data.json);
                setTimeout(() => {
                    loader.load('json')
                    .then(data => {
                        expect(data).to.deep.equal(this.data.json);
                        expect(this.loadFn.callCount).to.equal(2);
                        done();
                    }).done();
                }, 1100);
            }).done();
        });

        it('should handle custom serialize and deserialize method', done => {
            const loader = new RedisDataLoader(
                this.keySpace,
                this.userLoader(),
                {
                    serialize: v => 100,
                    deserialize: v => new Date(Number(v))
                }
            );

            loader.load('json')
            .then(data => {
                expect(data).to.be.instanceof(Date);
                expect(data.getTime()).to.equal(100);
                done();
            }).done();
        });
    });

    describe('loadMany', () => {
        it('should load multiple keys', done => {
            this.loader.loadMany(['json', 'null'])
            .then(results => {
                expect(results).to.deep.equal([this.data.json, this.data.null]);
                done();
            }).done();
        });
    });

    describe('prime', () => {
        it('should set cache', done => {
            this.loader.prime('json', { new: 'value' })
            .then(() => this.loader.load('json'))
            .then(data => {
                expect(data).to.deep.equal({ new: 'value' });
                done();
            }).done();
        });

        it('should handle primeing without local cache', done => {
            this.noCacheLoader.prime('json', { new: 'value' })
            .then(() => this.noCacheLoader.load('json'))
            .then(data => {
                expect(data).to.deep.equal({ new: 'value' });
                done();
            }).done();
        });
    });

    describe('clear', () => {
        it('should clear cache', done => {
            this.loader.load('json')
            .then(() => this.loader.clear('json'))
            .then(() => this.loader.load('json'))
            .then(data => {
                expect(data).to.deep.equal(this.data.json);
                expect(this.loadFn.callCount).to.equal(2);
                done();
            }).done();
        });

        it('should require a key', done => {
            this.loader.clear()
            .catch(err => {
                expect(err.message).to.equal('Key parameter is required');
                done();
            }).done();
        });
    });
});
