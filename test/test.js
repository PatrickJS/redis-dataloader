const _ = require('lodash');
const chai = require('chai');
chai.use(require('chai-as-promised'));
const { expect } = chai;
const sinon = require('sinon');
const DataLoader = require('dataloader');
const createRedisDataLoader = require('../index');

const mapPromise = (promise, fn) => Promise.all(promise.map(fn));

module.exports = ({ name, redis }) => {
  const RedisDataLoader = createRedisDataLoader({ redis });

  describe(name, () => {
    beforeEach(() => {
      const rDel = key =>
        new Promise((resolve, reject) =>
          redis.del(key, (err, resp) => (err ? reject(err) : resolve(resp)))
        );

      this.rSet = (k, v) =>
        new Promise((resolve, reject) =>
          redis.set(k, v, (err, resp) => (err ? reject(err) : resolve(resp)))
        );

      this.rGet = k =>
        new Promise((resolve, reject) => {
          redis.get(k, (err, resp) => (err ? reject(err) : resolve(resp)));
        });

      this.keySpace = 'key-space';
      this.data = {
        json: { foo: 'bar' },
        null: null,
      };

      this.stubs = {};

      this.loadFn = sinon.stub();

      _.each(this.data, (v, k) => {
        this.loadFn.withArgs(k).returns(Promise.resolve(v));
      });

      this.loadFn
        .withArgs(sinon.match({ a: 1, b: 2 }))
        .returns(Promise.resolve({ bar: 'baz' }));

      this.loadFn
        .withArgs(sinon.match([1, 2]))
        .returns(Promise.resolve({ ball: 'bat' }));

      this.userLoader = () =>
        new DataLoader(keys => mapPromise(keys, this.loadFn), {
          cache: false,
        });

      return mapPromise(
        _.keys(this.data).concat(['{"a":1,"b":2}', '[1,2]']),
        k => rDel(`${this.keySpace}:${k}`)
      ).then(() => {
        this.loader = new RedisDataLoader(this.keySpace, this.userLoader());
        this.noCacheLoader = new RedisDataLoader(
          this.keySpace,
          this.userLoader(),
          { cache: false }
        );
      });
    });

    afterEach(() => {
      _.each(this.stubs, s => s.restore());
    });

    describe('load', () => {
      it('should load json value', () =>
        this.loader.load('json').then(data => {
          expect(data).to.deep.equal(this.data.json);
        }));

      it('should allow for object key', () =>
        this.loader
          .load({ a: 1, b: 2 })
          .then(data => {
            expect(data).to.deep.equal({ bar: 'baz' });
            return this.rGet(`${this.keySpace}:{"a":1,"b":2}`);
          })
          .then(data => {
            expect(JSON.parse(data)).to.deep.equal({ bar: 'baz' });
          }));

      it('should ignore key order on object key', () =>
        this.loader
          .load({ b: 2, a: 1 })
          .then(data => {
            expect(data).to.deep.equal({ bar: 'baz' });
            return this.rGet(`${this.keySpace}:{"a":1,"b":2}`);
          })
          .then(data => {
            expect(JSON.parse(data)).to.deep.equal({ bar: 'baz' });
          }));

      it('should handle key that is array', () =>
        this.loader
          .load([1, 2])
          .then(data => {
            expect(data).to.deep.equal({ ball: 'bat' });
            return this.rGet(`${this.keySpace}:[1,2]`);
          })
          .then(data => {
            expect(JSON.parse(data)).to.deep.equal({ ball: 'bat' });
          }));

      it('should require key', () =>
        expect(this.loader.load()).to.be.rejectedWith(TypeError));

      it('should use local cache on second load', () => {
        this.stubs.redisMGet = sinon.stub(redis, 'mget', (keys, cb) => {
          cb(null, [JSON.stringify(this.data.json)]);
        });

        return this.loader
          .load('json')
          .then(data => {
            expect(this.loadFn.callCount).to.equal(0);
            expect(this.stubs.redisMGet.callCount).to.equal(1);
            return this.loader.load('json');
          })
          .then(data => {
            expect(this.loadFn.callCount).to.equal(0);
            expect(this.stubs.redisMGet.callCount).to.equal(1);
          });
      });

      it('should not use in memory cache if option is passed', () => {
        this.stubs.redisMGet = sinon.stub(redis, 'mget', (keys, cb) => {
          cb(null, [JSON.stringify(this.data.json)]);
        });

        return this.noCacheLoader
          .load('json')
          .then(data => {
            expect(this.loadFn.callCount).to.equal(0);
            expect(this.stubs.redisMGet.callCount).to.equal(1);
            return this.noCacheLoader.load('json');
          })
          .then(data => {
            expect(this.loadFn.callCount).to.equal(0);
            expect(this.stubs.redisMGet.callCount).to.equal(2);
          });
      });

      it('should load null values', () =>
        this.loader
          .load('null')
          .then(data => {
            expect(data).to.be.null;
            return this.loader.load('null');
          })
          .then(data => {
            expect(data).to.be.null;
          }));

      it('should handle redis cacheing of null values', () =>
        this.noCacheLoader
          .load('null')
          .then(data => {
            expect(data).to.be.null;
            return this.noCacheLoader.load('null');
          })
          .then(data => {
            expect(data).to.be.null;
          }));

      it('should handle redis key expiration if set', done => {
        const loader = new RedisDataLoader(this.keySpace, this.userLoader(), {
          cache: false,
          expire: 1,
        });

        loader
          .load('json')
          .then(data => {
            expect(data).to.deep.equal(this.data.json);
            setTimeout(() => {
              loader
                .load('json')
                .then(data => {
                  expect(data).to.deep.equal(this.data.json);
                  expect(this.loadFn.callCount).to.equal(2);
                  done();
                });
            }, 1100);
          })
          .catch(done);
      });

      it('should handle custom serialize and deserialize method', () => {
        const loader = new RedisDataLoader(this.keySpace, this.userLoader(), {
          serialize: v => 100,
          deserialize: v => new Date(Number(v)),
        });

        return loader.load('json').then(data => {
          expect(data).to.be.instanceof(Date);
          expect(data.getTime()).to.equal(100);
        });
      });

      it('should handle optional keySpace', () => {
        this.stubs.redisMGet = sinon.stub(redis, 'mget', (keys, cb) => {
          cb(null, [JSON.stringify(this.data.json)]);
        });

        const loader = new RedisDataLoader(null, this.userLoader());

        return loader
          .load('foo')
          .then(_ => {
            expect(this.stubs.redisMGet.args[0][0]).to.deep.equal([
              'foo',
            ]);
          });
      });
    });

    describe('loadMany', () => {
      it('should load multiple keys', () =>
        Promise.all((['json', 'null']).map((k) => this.loader.load(k))).then(results => {
          expect(results).to.deep.equal([this.data.json, this.data.null]);
        }));

      it('should handle object key', () =>
        Promise.all(([{ a: 1, b: 2 }]).map((k) => this.loader.load(k))).then(results => {
          expect(results).to.deep.equal([{ bar: 'baz' }]);
        }));

      it('should handle empty array', () =>
        Promise.all(([]).map((k) => this.loader.load(k))).then(results => {
          expect(results).to.deep.equal([]);
        }));

      it('should require array', () =>
        expect(this.loader.loadMany()).to.be.rejectedWith(TypeError));

      it('should handle custom cacheKeyFn', () => {
        const loader = new RedisDataLoader(this.keySpace, this.userLoader(), {
          cacheKeyFn: key => `foo-${key}`,
        });

        loader.loadMany(['json', 'null']).then(results => {
          expect(results).to.deep.equal([this.data.json, this.data.null]);
        });
      });

      it('should use local cache on second load when using custom cacheKeyFn', () => {
        this.stubs.redisMGet = sinon.stub(redis, 'mget', (keys, cb) => {
          cb(null, [JSON.stringify(this.data.json)]);
        });

        const loader = new RedisDataLoader(this.keySpace, this.userLoader(), {
          cacheKeyFn: key => `foo-${key}`,
        });

        return loader
          .loadMany(['json'])
          .then(data => {
            expect(this.loadFn.callCount).to.equal(0);
            expect(this.stubs.redisMGet.args[0][0]).to.deep.equal([
              'key-space:foo-json',
            ]);
            expect(this.stubs.redisMGet.callCount).to.equal(1);
            return loader.loadMany(['json']);
          })
          .then(data => {
            expect(this.loadFn.callCount).to.equal(0);
            expect(this.stubs.redisMGet.callCount).to.equal(1);
          });
      });
    });

    describe('prime', () => {
      it('should set cache', () =>
        this.loader
          .prime('json', { new: 'value' })
          .then(() => this.loader.load('json'))
          .then(data => {
            expect(data).to.deep.equal({ new: 'value' });
          }));

      it('should handle object key', () =>
        this.loader
          .prime({ a: 1, b: 2 }, { new: 'val' })
          .then(() => this.loader.load({ a: 1, b: 2 }))
          .then(data => {
            expect(data).to.deep.equal({ new: 'val' });
          }));

      it('should handle primeing without local cache', () =>
        this.noCacheLoader
          .prime('json', { new: 'value' })
          .then(() => this.noCacheLoader.load('json'))
          .then(data => {
            expect(data).to.deep.equal({ new: 'value' });
          }));

      it('should require key', () =>
        expect(
          this.loader.prime(undefined, { new: 'value' })
        ).to.be.rejectedWith(TypeError));

      it('should require value', () =>
        expect(this.loader.prime('json')).to.be.rejectedWith(TypeError));

      it('should allow null for value', () =>
        this.loader
          .prime('json', null)
          .then(() => this.loader.load('json'))
          .then(data => {
            expect(data).to.be.null;
          }));
    });

    describe('clear', () => {
      it('should clear cache', () =>
        this.loader
          .load('json')
          .then(() => this.loader.clear('json'))
          .then(() => this.loader.load('json'))
          .then(data => {
            expect(data).to.deep.equal(this.data.json);
            expect(this.loadFn.callCount).to.equal(2);
          }));

      it('should handle object key', () =>
        this.loader
          .load({ a: 1, b: 2 })
          .then(() => this.loader.clear({ a: 1, b: 2 }))
          .then(() => this.loader.load({ a: 1, b: 2 }))
          .then(data => {
            expect(data).to.deep.equal({ bar: 'baz' });
            expect(this.loadFn.callCount).to.equal(2);
          }));

      it('should require a key', () =>
        expect(this.loader.clear()).to.be.rejectedWith(TypeError));
    });

    describe('clearAllLocal', () => {
      it('should clear all local in-memory cache', () =>
        Promise.all((['json', 'null']).map((k) => this.loader.load(k)))
          .then(() => this.loader.clearAllLocal())
          .then(() =>
            this.rSet(`${this.keySpace}:json`, JSON.stringify({ new: 'valeo' }))
          )
          .then(() =>
            this.rSet(`${this.keySpace}:null`, JSON.stringify({ foo: 'bar' }))
          )
          .then(() => Promise.all((['null', 'json']).map((k) => this.loader.load(k))))
          .then(data => {
            expect(data).to.deep.equal([{ foo: 'bar' }, { new: 'valeo' }]);
          }));
    });

    describe('clearLocal', () => {
      it('should clear local cache for a specific key', () =>
        Promise.all((['json', 'null']).map((k) => this.loader.load(k)))
          .then(() => this.loader.clearLocal('json'))
          .then(() =>
            this.rSet(`${this.keySpace}:json`, JSON.stringify({ new: 'valeo' }))
          )
          .then(() =>
            this.rSet(`${this.keySpace}:null`, JSON.stringify({ foo: 'bar' }))
          )
          .then(() => Promise.all((['null', 'json']).map((k) => this.loader.load(k))))
          .then(data => {
            expect(data).to.deep.equal([null, { new: 'valeo' }]);
          }));
    });
  });
};
