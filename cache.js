const Redis = require('ioredis');

const cacheEnabled = false;
let redis;
if (cacheEnabled) {
  redis = new Redis();
}

exports.isEnabled = () => cacheEnabled;

exports.get = async (key) => {
  const cache = await redis.get(key);
  if (cache) {
    console.log('get from cache', key);
    return cache;
  }
  return undefined;
};

exports.set = async (key, value) => {
  console.log('set cache', key);
  return redis.setex(key, 10 * 60, value);
};
